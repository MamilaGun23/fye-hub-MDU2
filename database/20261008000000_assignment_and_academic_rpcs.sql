-- 20261008000000_assignment_and_academic_rpcs.sql
-- Missing RPCs for supervisor assignment, admin faculty deletion, and manual attendance

-- 1. assign_students_to_mentor: Allows supervisors to manually assign selected students to an approved mentor
CREATE OR REPLACE FUNCTION public.assign_students_to_mentor(
  p_mentor_id UUID,
  p_student_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  mentor_row public.profiles%ROWTYPE;
  student_id_item UUID;
  student_row public.profiles%ROWTYPE;
  current_assigned_count INTEGER;
  student_count INTEGER;
BEGIN
  -- Verify supervisor access
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role = 'supervisor' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active supervisor access is required.';
  END IF;

  -- Validate inputs
  IF p_mentor_id IS NULL OR p_student_ids IS NULL OR cardinality(p_student_ids) = 0 THEN
    RAISE EXCEPTION 'Choose a mentor and at least one student.';
  END IF;

  student_count := cardinality(p_student_ids);

  -- Verify mentor exists, is active, has approved mentor status
  SELECT * INTO mentor_row
  FROM public.profiles
  WHERE id = p_mentor_id
    AND role = 'mentor'
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND OR NOT public.mentor_application_is_approved(p_mentor_id) THEN
    RAISE EXCEPTION 'The selected mentor is not eligible for student assignments.';
  END IF;

  -- Check current caseload capacity
  SELECT count(*)::INTEGER INTO current_assigned_count
  FROM public.mentor_assignments
  WHERE mentor_id = p_mentor_id
    AND ended_at IS NULL;

  IF (current_assigned_count + student_count) > 20 THEN
    RAISE EXCEPTION 'This mentor can only take % more student(s); % were selected.',
      GREATEST(0, 20 - current_assigned_count), student_count;
  END IF;

  -- Verify each student is eligible and assign them
  FOR student_id_item IN
    SELECT DISTINCT unnest(p_student_ids)
  LOOP
    SELECT * INTO student_row
    FROM public.profiles
    WHERE id = student_id_item
      AND role = 'student'
      AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'One or more selected students are no longer active student accounts.';
    END IF;

    -- Check matching faculty and programme
    IF student_row.faculty_id IS DISTINCT FROM mentor_row.faculty_id
      OR student_row.programme_id IS DISTINCT FROM mentor_row.programme_id THEN
      RAISE EXCEPTION 'Student % belongs to a different faculty or programme.',
        COALESCE(student_row.full_name, student_row.email, student_id_item::TEXT);
    END IF;

    -- Check if student already has an active assignment
    IF EXISTS (
      SELECT 1 FROM public.mentor_assignments
      WHERE student_id = student_id_item
        AND ended_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Student % is already assigned to a mentor.',
        COALESCE(student_row.full_name, student_row.email, student_id_item::TEXT);
    END IF;

    -- Insert active assignment
    INSERT INTO public.mentor_assignments (student_id, mentor_id)
    VALUES (student_id_item, p_mentor_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_students_to_mentor(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_students_to_mentor(UUID, UUID[]) TO authenticated;


-- 2. delete_faculty_and_programmes: Allows admins to delete a faculty and its associated programmes
CREATE OR REPLACE FUNCTION public.delete_faculty_and_programmes(
  p_faculty_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  in_use_count INTEGER;
BEGIN
  -- Verify admin access
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active admin access is required.';
  END IF;

  IF p_faculty_id IS NULL THEN
    RAISE EXCEPTION 'Choose a faculty to delete.';
  END IF;

  -- Check if any profile is using this faculty or any of its programmes
  SELECT count(*)::INTEGER INTO in_use_count
  FROM public.profiles
  WHERE faculty_id = p_faculty_id
     OR programme_id IN (
       SELECT id FROM public.programmes WHERE faculty_id = p_faculty_id
     );

  IF in_use_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete this faculty because it or its programmes are associated with % active user profile(s). Reassign these users before deleting.', in_use_count;
  END IF;

  -- Delete associated programmes first, then the faculty
  DELETE FROM public.programmes WHERE faculty_id = p_faculty_id;
  DELETE FROM public.faculties WHERE id = p_faculty_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected faculty no longer exists.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_faculty_and_programmes(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_faculty_and_programmes(BIGINT) TO authenticated;


-- 3. record_manual_event_attendance: Allows supervisors to manually record attendance for an eligible student
CREATE OR REPLACE FUNCTION public.record_manual_event_attendance(
  p_event_id BIGINT,
  p_attendee_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  request_id UUID;
  inserted_id UUID;
  event_row public.calendar_events%ROWTYPE;
  previous_attendance public.event_attendance%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor_id AND role = 'supervisor' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active supervisor access is required.';
  END IF;

  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for a manual attendance change.';
  END IF;

  SELECT * INTO event_row FROM public.calendar_events
  WHERE id = p_event_id AND event_type = 'event' AND event_status IN ('scheduled', 'completed');

  IF NOT FOUND OR NOT public.is_fye_student(p_attendee_id) THEN
    RAISE EXCEPTION 'Choose a valid event and student.';
  END IF;

  IF event_row.event_status = 'scheduled'
    AND (now() < event_row.starts_at - INTERVAL '1 hour' OR now() > event_row.ends_at + INTERVAL '2 hours') THEN
    RAISE EXCEPTION 'Manual check-in is only available during the event check-in window.';
  END IF;

  SELECT id INTO request_id FROM public.event_requests
  WHERE calendar_event_id = p_event_id LIMIT 1;

  SELECT * INTO previous_attendance FROM public.event_attendance
  WHERE calendar_event_id = p_event_id AND attendee_id = p_attendee_id FOR UPDATE;

  INSERT INTO public.event_attendance (
    event_request_id, calendar_event_id, attendee_id, attendance_method,
    recorded_by, correction_reason, is_valid, checked_in_at
  ) VALUES (request_id, p_event_id, p_attendee_id, 'manual', actor_id, btrim(p_reason), true, now())
  ON CONFLICT (calendar_event_id, attendee_id) WHERE calendar_event_id IS NOT NULL
  DO UPDATE SET is_valid = true, invalidated_at = NULL, invalidated_by = NULL,
    invalidation_reason = NULL, attendance_method = 'manual', recorded_by = actor_id,
    correction_reason = btrim(p_reason), checked_in_at = now()
  WHERE public.event_attendance.is_valid = false
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    RAISE EXCEPTION 'This student is already checked in.';
  END IF;

  INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
  VALUES (p_event_id, actor_id, 'attendance_added', jsonb_build_object(
    'attendee_id', p_attendee_id, 'method', 'manual', 'reason', btrim(p_reason),
    'restored', previous_attendance.id IS NOT NULL
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.record_manual_event_attendance(BIGINT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_manual_event_attendance(BIGINT, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
