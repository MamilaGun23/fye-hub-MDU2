ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS school TEXT,
  ADD COLUMN IF NOT EXISTS study_year SMALLINT,
  ADD COLUMN IF NOT EXISTS student_number TEXT;

UPDATE public.profiles
SET first_name = split_part(btrim(full_name), ' ', 1),
    last_name = NULLIF(btrim(substr(btrim(full_name), length(split_part(btrim(full_name), ' ', 1)) + 1)), '')
WHERE full_name IS NOT NULL
  AND first_name IS NULL
  AND last_name IS NULL;

ALTER TABLE public.mentor_applications
  ADD COLUMN IF NOT EXISTS school TEXT;

CREATE OR REPLACE FUNCTION public.current_user_is_mentor()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'mentor'
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_is_mentor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_mentor() TO authenticated;

DROP POLICY IF EXISTS "Mentors cannot update other profiles" ON public.profiles;
CREATE POLICY "Mentors cannot update other profiles"
  ON public.profiles AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (NOT public.current_user_is_mentor() OR id = auth.uid())
  WITH CHECK (NOT public.current_user_is_mentor() OR id = auth.uid());

DROP POLICY IF EXISTS "Mentors cannot insert profiles" ON public.profiles;
CREATE POLICY "Mentors cannot insert profiles"
  ON public.profiles AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (NOT public.current_user_is_mentor());

DROP POLICY IF EXISTS "Mentors cannot delete profiles" ON public.profiles;
CREATE POLICY "Mentors cannot delete profiles"
  ON public.profiles AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (NOT public.current_user_is_mentor());

CREATE OR REPLACE FUNCTION public.validate_future_mentor_event_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.event_date + NEW.event_time) <= (now() AT TIME ZONE 'Africa/Johannesburg') THEN
    RAISE EXCEPTION 'Choose a future event date and time.';
  END IF;
  IF NULLIF(btrim(NEW.title), '') IS NULL
    OR NULLIF(btrim(NEW.purpose), '') IS NULL
    OR NULLIF(btrim(NEW.venue), '') IS NULL THEN
    RAISE EXCEPTION 'Event title, purpose, and venue are required.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_future_mentor_event_request
  ON public.event_requests;
CREATE TRIGGER validate_future_mentor_event_request
  BEFORE INSERT OR UPDATE OF event_date, event_time, title, purpose, venue
  ON public.event_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_future_mentor_event_request();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mentor_applications'::regclass
      AND conname = 'mentor_applications_status_check'
  ) THEN
    ALTER TABLE public.mentor_applications
      DROP CONSTRAINT mentor_applications_status_check;
  END IF;
  ALTER TABLE public.mentor_applications
    ADD CONSTRAINT mentor_applications_status_check
    CHECK (status IN ('pending', 'shortlisted', 'approved', 'declined'));
END;
$$;

CREATE OR REPLACE FUNCTION public.review_mentor_application(
  p_application_id UUID,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  updated_application_id UUID;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role = 'supervisor' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active supervisor access is required.';
  END IF;

  IF p_decision IS NULL OR p_decision NOT IN ('shortlisted', 'approved', 'declined') THEN
    RAISE EXCEPTION 'Choose shortlist, approve, or decline.';
  END IF;
  IF p_decision = 'declined' AND NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when declining an application.';
  END IF;

  UPDATE public.mentor_applications
  SET status = p_decision,
      review_reason = CASE
        WHEN p_decision IN ('shortlisted', 'declined') THEN NULLIF(btrim(p_reason), '')
        ELSE NULL
      END,
      reviewed_by = actor_id,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_application_id
    AND (
      (status = 'pending' AND p_decision IN ('shortlisted', 'declined'))
      OR (status = 'shortlisted' AND p_decision IN ('approved', 'declined'))
    )
  RETURNING id INTO updated_application_id;

  IF updated_application_id IS NULL THEN
    RAISE EXCEPTION 'This application is no longer at the selected review stage.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_mentor_application(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_mentor_application(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_mentor_profile(
  p_mentor_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_school TEXT,
  p_faculty_id BIGINT,
  p_programme_id BIGINT,
  p_bio TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active admin access is required.';
  END IF;

  IF NULLIF(btrim(p_first_name), '') IS NULL
    OR NULLIF(btrim(p_last_name), '') IS NULL
    OR NULLIF(btrim(p_school), '') IS NULL
    OR p_faculty_id IS NULL
    OR p_programme_id IS NULL
    OR length(COALESCE(p_bio, '')) > 1000
    OR NOT EXISTS (
      SELECT 1 FROM public.programmes
      WHERE id = p_programme_id AND faculty_id = p_faculty_id
    ) THEN
    RAISE EXCEPTION 'Complete the mentor profile and choose a programme from the selected faculty.';
  END IF;

  UPDATE public.profiles
  SET first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      full_name = btrim(p_first_name) || ' ' || btrim(p_last_name),
      school = btrim(p_school),
      faculty_id = p_faculty_id,
      programme_id = p_programme_id,
      bio = NULLIF(btrim(p_bio), '')
  WHERE id = p_mentor_id AND role = 'mentor';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected mentor account no longer exists.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_mentor_account(p_mentor_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active admin access is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_mentor_id AND role = 'mentor'
  ) THEN
    RAISE EXCEPTION 'Only mentor accounts can be deleted here.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mentor_assignments
    WHERE mentor_id = p_mentor_id AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Reassign or close this mentor’s active student assignments before deleting the account.';
  END IF;

  DELETE FROM auth.users WHERE id = p_mentor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected mentor account could not be deleted.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_mentor_profile(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_mentor_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_mentor_profile(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_mentor_account(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_own_study_year(p_study_year SMALLINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_study_year IS NULL OR p_study_year NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Choose a valid year of study.';
  END IF;

  UPDATE public.profiles
  SET study_year = p_study_year
  WHERE id = auth.uid()
    AND role IN ('student', 'mentor')
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active student account is required.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_own_study_year(SMALLINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_own_study_year(SMALLINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_own_student_details(
  p_student_number TEXT,
  p_study_year SMALLINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL
    OR NULLIF(btrim(p_student_number), '') IS NULL
    OR length(btrim(p_student_number)) > 40
    OR p_study_year IS NULL
    OR p_study_year NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Enter a valid student number and year of study.';
  END IF;

  UPDATE public.profiles
  SET student_number = btrim(p_student_number),
      study_year = p_study_year
  WHERE id = auth.uid()
    AND role IN ('student', 'mentor')
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active student account is required.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_own_student_details(TEXT, SMALLINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_own_student_details(TEXT, SMALLINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.require_active_mentor_applicant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  applicant_year SMALLINT;
BEGIN
  SELECT study_year INTO applicant_year
  FROM public.profiles
  WHERE id = NEW.applicant_id
    AND role IN ('student', 'mentor')
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active student account is required to submit a mentor application.';
  END IF;

  IF applicant_year IS NULL OR applicant_year < 2 OR NEW.study_year <> applicant_year THEN
    RAISE EXCEPTION 'Mentor applications are available only to students in year 2 or above; confirm your saved year of study.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_mentor_application(
  p_student_number TEXT,
  p_study_year SMALLINT,
  p_previous_academic_year TEXT,
  p_academic_record_path TEXT,
  p_school TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  application_id UUID;
BEGIN
  IF NULLIF(btrim(p_school), '') IS NULL THEN
    RAISE EXCEPTION 'Enter the school you belong to.';
  END IF;

  application_id := public.submit_mentor_application(
    p_student_number,
    p_study_year,
    p_previous_academic_year,
    p_academic_record_path
  );

  UPDATE public.mentor_applications
  SET school = btrim(p_school)
  WHERE id = application_id AND applicant_id = auth.uid();

  UPDATE public.profiles
  SET school = btrim(p_school)
  WHERE id = auth.uid();

  RETURN application_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_mentor_application(TEXT, SMALLINT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_mentor_application(TEXT, SMALLINT, TEXT, TEXT, TEXT) TO authenticated;

DROP TABLE IF EXISTS public.mentor_student_messages CASCADE;

CREATE TABLE public.mentor_student_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS mentor_student_messages_thread_idx
  ON public.mentor_student_messages(mentor_id, student_id, created_at DESC);

ALTER TABLE public.mentor_student_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.mentor_student_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.has_active_mentor_assignment(
  p_mentor_id UUID,
  p_student_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.mentor_assignments AS assignment
    JOIN public.profiles AS mentor ON mentor.id = assignment.mentor_id
    JOIN public.profiles AS student ON student.id = assignment.student_id
    WHERE assignment.mentor_id = p_mentor_id
      AND assignment.student_id = p_student_id
      AND assignment.ended_at IS NULL
      AND mentor.is_active = true
      AND student.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.has_active_mentor_assignment(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_mentor_assignment(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "Assigned mentor and student read their messages"
  ON public.mentor_student_messages;
CREATE POLICY "Assigned mentor and student read their messages"
  ON public.mentor_student_messages FOR SELECT TO authenticated
  USING (
    auth.uid() IN (mentor_id, student_id)
    AND public.has_active_mentor_assignment(mentor_id, student_id)
  );

CREATE OR REPLACE FUNCTION public.send_mentor_student_message(
  p_recipient_id UUID,
  p_body TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  mentor_profile_id UUID;
  student_profile_id UUID;
  message_id UUID;
BEGIN
  IF actor_id IS NULL OR NULLIF(btrim(p_body), '') IS NULL OR length(btrim(p_body)) > 2000 THEN
    RAISE EXCEPTION 'Enter a message of no more than 2000 characters.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role = 'mentor' AND is_active = true
  ) THEN
    mentor_profile_id := actor_id;
    student_profile_id := p_recipient_id;
  ELSIF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role IN ('student', 'mentor') AND is_active = true
  ) THEN
    mentor_profile_id := p_recipient_id;
    student_profile_id := actor_id;
  ELSE
    RAISE EXCEPTION 'An active student or mentor account is required.';
  END IF;

  IF NOT public.has_active_mentor_assignment(mentor_profile_id, student_profile_id) THEN
    RAISE EXCEPTION 'Messages are available only between currently assigned mentor pairs.';
  END IF;

  INSERT INTO public.mentor_student_messages (mentor_id, student_id, sender_id, body)
  VALUES (mentor_profile_id, student_profile_id, actor_id, btrim(p_body))
  RETURNING id INTO message_id;

  RETURN message_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_mentor_student_message(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_mentor_student_message(UUID, TEXT) TO authenticated;

DROP TABLE IF EXISTS public.mentor_contact_status CASCADE;

CREATE TABLE public.mentor_contact_status (
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_contact_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mentor_id, student_id)
);

ALTER TABLE public.mentor_contact_status ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.mentor_contact_status TO authenticated;

DROP POLICY IF EXISTS "Mentors students and supervisors read contact status"
  ON public.mentor_contact_status;
CREATE POLICY "Mentors students and supervisors read contact status"
  ON public.mentor_contact_status FOR SELECT TO authenticated
  USING (
    auth.uid() IN (mentor_id, student_id)
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'supervisor' AND is_active = true
    )
  );

CREATE OR REPLACE FUNCTION public.record_mentor_contact(p_student_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
BEGIN
  IF actor_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = actor_id AND role = 'mentor' AND is_active = true
    )
    OR NOT public.has_active_mentor_assignment(actor_id, p_student_id) THEN
    RAISE EXCEPTION 'Only the assigned active mentor can record student contact.';
  END IF;

  INSERT INTO public.mentor_contact_status (mentor_id, student_id, last_contact_at)
  VALUES (actor_id, p_student_id, now())
  ON CONFLICT (mentor_id, student_id)
  DO UPDATE SET last_contact_at = EXCLUDED.last_contact_at;

  UPDATE public.supervisor_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE notification_type = 'mentor_contact_overdue'
    AND subject_id = actor_id::TEXT || ':' || p_student_id::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.record_mentor_contact(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_mentor_contact(UUID) TO authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.supervisor_notifications'::regclass
      AND conname = 'supervisor_notifications_notification_type_check'
  ) THEN
    ALTER TABLE public.supervisor_notifications
      DROP CONSTRAINT supervisor_notifications_notification_type_check;
  END IF;
  ALTER TABLE public.supervisor_notifications
    ADD CONSTRAINT supervisor_notifications_notification_type_check
    CHECK (notification_type IN (
      'event_request', 'mentor_application', 'admin_notice', 'mentor_contact_overdue'
    ));
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_mentor_contact_alerts()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'supervisor' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active supervisor access is required.';
  END IF;

  INSERT INTO public.supervisor_notifications (
    recipient_id, notification_type, subject_id, title, message
  )
  SELECT
    supervisor.id,
    'mentor_contact_overdue',
    assignment.mentor_id::TEXT || ':' || assignment.student_id::TEXT,
    'Mentee contact overdue',
    COALESCE(mentor.full_name, mentor.email, 'A mentor')
      || ' has not logged first contact with '
      || COALESCE(student.full_name, student.email, 'their assigned student')
      || ' within 7 days of assignment.'
  FROM public.mentor_assignments AS assignment
  JOIN public.profiles AS mentor ON mentor.id = assignment.mentor_id AND mentor.is_active
  JOIN public.profiles AS student ON student.id = assignment.student_id AND student.is_active
  CROSS JOIN public.profiles AS supervisor
  LEFT JOIN public.mentor_contact_status AS contact
    ON contact.mentor_id = assignment.mentor_id
    AND contact.student_id = assignment.student_id
  WHERE assignment.ended_at IS NULL
    AND assignment.assigned_at <= now() - INTERVAL '7 days'
    AND (contact.last_contact_at IS NULL OR contact.last_contact_at < assignment.assigned_at)
    AND supervisor.role = 'supervisor'
    AND supervisor.is_active = true
  ON CONFLICT (recipient_id, notification_type, subject_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_mentor_contact_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_mentor_contact_alerts() TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_students_evenly(
  p_faculty_id BIGINT,
  p_programme_id BIGINT,
  p_student_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  student_profile_id UUID;
  mentor_profile_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'supervisor' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active supervisor access is required.';
  END IF;

  IF p_faculty_id IS NULL OR p_programme_id IS NULL
    OR p_student_ids IS NULL OR cardinality(p_student_ids) = 0 THEN
    RAISE EXCEPTION 'Choose a faculty, programme, and at least one student.';
  END IF;

  FOR student_profile_id IN
    SELECT DISTINCT requested.student_id
    FROM unnest(p_student_ids) AS requested(student_id)
    ORDER BY requested.student_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles AS student
      WHERE student.id = student_profile_id
        AND student.role = 'student'
        AND student.is_active = true
        AND student.faculty_id = p_faculty_id
        AND student.programme_id = p_programme_id
        AND NOT EXISTS (
          SELECT 1 FROM public.mentor_assignments AS assignment
          WHERE assignment.student_id = student.id
            AND assignment.ended_at IS NULL
        )
    ) THEN
      RAISE EXCEPTION 'One or more selected students are no longer eligible for assignment.';
    END IF;

    SELECT mentor.id INTO mentor_profile_id
    FROM public.profiles AS mentor
    LEFT JOIN LATERAL (
      SELECT count(*)::INTEGER AS assigned_count
      FROM public.mentor_assignments AS assignment
      WHERE assignment.mentor_id = mentor.id
        AND assignment.ended_at IS NULL
    ) AS load ON true
    WHERE mentor.role = 'mentor'
      AND mentor.is_active = true
      AND mentor.faculty_id = p_faculty_id
      AND mentor.programme_id = p_programme_id
      AND public.mentor_application_is_approved(mentor.id)
      AND load.assigned_count < 20
    ORDER BY load.assigned_count, mentor.id
    FOR UPDATE OF mentor SKIP LOCKED
    LIMIT 1;

    IF mentor_profile_id IS NULL THEN
      RAISE EXCEPTION 'There is not enough approved mentor capacity for all selected students.';
    END IF;

    INSERT INTO public.mentor_assignments (student_id, mentor_id)
    VALUES (student_profile_id, mentor_profile_id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_students_evenly(BIGINT, BIGINT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_students_evenly(BIGINT, BIGINT, UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_event_notification_unread(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.event_notifications
  SET read_at = NULL
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_system_notice_notification_unread(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.system_notice_notifications
  SET read_at = NULL
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_supervisor_notification_unread(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'supervisor' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active supervisor access is required.';
  END IF;

  UPDATE public.supervisor_notifications
  SET read_at = NULL
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_event_notification_unread(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_system_notice_notification_unread(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_supervisor_notification_unread(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_event_notification_unread(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_system_notice_notification_unread(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_supervisor_notification_unread(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
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


-- 20261009000000_supervisor_notification_bulk_read.sql
-- Mark the signed-in supervisor's entire inbox read, including older items.
CREATE OR REPLACE FUNCTION public.mark_all_supervisor_notifications_read()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'supervisor' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active supervisor access is required.';
  END IF;

  UPDATE public.supervisor_notifications
  SET read_at = now()
  WHERE recipient_id = auth.uid() AND read_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_all_supervisor_notifications_read() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_all_supervisor_notifications_read() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- 20261010000000_faculty_events_and_dashboard_details.sql
-- Apply after the existing migrations, including 20261009000000.
BEGIN;
ALTER TABLE public.event_requests ADD COLUMN IF NOT EXISTS faculty_id BIGINT REFERENCES public.faculties(id);
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS faculty_id BIGINT REFERENCES public.faculties(id);
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS faculty_only BOOLEAN NOT NULL DEFAULT false;
DROP TRIGGER IF EXISTS scope_mentor_event_request ON public.event_requests;
UPDATE public.event_requests r SET faculty_id = p.faculty_id
FROM public.profiles p WHERE p.id = r.mentor_id AND r.faculty_id IS NULL;
UPDATE public.calendar_events e SET faculty_id = r.faculty_id
FROM public.event_requests r WHERE r.calendar_event_id = e.id AND e.faculty_id IS NULL;
UPDATE public.calendar_events e SET faculty_only=true WHERE EXISTS(SELECT 1 FROM public.event_requests r WHERE r.calendar_event_id=e.id);

CREATE OR REPLACE FUNCTION public.scope_mentor_event_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE mentor_faculty BIGINT;
BEGIN
  SELECT faculty_id INTO mentor_faculty FROM public.profiles
  WHERE id = NEW.mentor_id AND is_active = true;
  IF mentor_faculty IS NULL THEN RAISE EXCEPTION 'Assign the mentor to a faculty before requesting an event.'; END IF;
  IF TG_OP = 'INSERT' THEN NEW.faculty_id := mentor_faculty;
  ELSIF NEW.faculty_id IS DISTINCT FROM OLD.faculty_id THEN
    RAISE EXCEPTION 'The faculty of an event request cannot be changed.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS scope_mentor_event_request ON public.event_requests;
CREATE TRIGGER scope_mentor_event_request BEFORE INSERT OR UPDATE OF faculty_id ON public.event_requests
FOR EACH ROW EXECUTE FUNCTION public.scope_mentor_event_request();

-- Keep the approved request, calendar, QR token and faculty on one event record.
CREATE OR REPLACE FUNCTION public.sync_event_request_to_calendar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.calendar_event_id IS NOT NULL THEN
    UPDATE public.calendar_events SET attendance_token = COALESCE(NEW.qr_token, attendance_token),
      organizer_id = NEW.mentor_id, faculty_id = NEW.faculty_id, faculty_only=true WHERE id = NEW.calendar_event_id;
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      INSERT INTO public.event_activity_log(calendar_event_id, actor_id, action_type, details)
      VALUES(NEW.calendar_event_id, NEW.approved_by, 'request_approved', jsonb_build_object('mentor_id',NEW.mentor_id,'title',NEW.title));
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.review_event_request(p_event_id UUID,p_decision TEXT,p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE req public.event_requests%ROWTYPE; event_id BIGINT; token TEXT; starts TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='supervisor' AND is_active=true) THEN RAISE EXCEPTION 'Active supervisor access is required.'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Choose approve or decline.'; END IF;
  IF p_decision='rejected' AND NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A decline reason is required.'; END IF;
  SELECT * INTO req FROM public.event_requests WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR req.status<>'pending' THEN RAISE EXCEPTION 'This request is no longer pending.'; END IF;
  IF p_decision='rejected' THEN
    UPDATE public.event_requests SET status='rejected',supervisor_note=btrim(p_reason),approved_by=auth.uid(),updated_at=now() WHERE id=req.id;
    INSERT INTO public.event_notifications(recipient_id,event_request_id,notification_type,title,message,scheduled_for)
    VALUES(req.mentor_id,req.id,'rejected',left('Event declined: '||req.title,200),btrim(p_reason),now());
    RETURN;
  END IF;
  starts:=(req.event_date+req.event_time) AT TIME ZONE 'Africa/Johannesburg';
  IF starts<=now() THEN RAISE EXCEPTION 'Only future events can be approved.'; END IF;
  IF req.faculty_id IS NULL THEN RAISE EXCEPTION 'The request needs an assigned faculty before approval.'; END IF;
  IF NOT public.mentor_application_is_approved(req.mentor_id) OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=req.mentor_id AND is_active=true AND faculty_id=req.faculty_id) THEN RAISE EXCEPTION 'The requesting mentor must still be active and assigned to the request faculty.'; END IF;
  token:=gen_random_uuid()::TEXT;
  INSERT INTO public.calendar_events(title,event_type,description,starts_at,ends_at,location,created_by,audience,organizer_id,attendance_token,event_status,faculty_id,faculty_only)
  VALUES(req.title,'event',req.purpose,starts,starts+INTERVAL '2 hours',req.venue,auth.uid(),'university',req.mentor_id,token,'scheduled',req.faculty_id,true) RETURNING id INTO event_id;
  UPDATE public.event_requests SET status='approved',supervisor_note=NULLIF(btrim(p_reason),''),approved_by=auth.uid(),qr_token=token,calendar_event_id=event_id,updated_at=now() WHERE id=req.id;
  INSERT INTO public.event_notifications(recipient_id,event_request_id,calendar_event_id,notification_type,title,message,scheduled_for)
  SELECT id,req.id,event_id,'approved',left('New approved event: '||req.title,200),
    req.title||' is on '||to_char(starts AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY HH24:MI')||' in '||req.venue,now()
  FROM public.profiles WHERE role IN ('student','mentor') AND is_active=true AND faculty_id=req.faculty_id AND id<>req.mentor_id;
  INSERT INTO public.event_notifications(recipient_id,event_request_id,calendar_event_id,notification_type,title,message,qr_token,scheduled_for)
  VALUES(req.mentor_id,req.id,event_id,'approved',left('Event approved: '||req.title,200),'Share the attendance QR code with students in your faculty.',token,now());
  INSERT INTO public.event_notifications(recipient_id,event_request_id,calendar_event_id,notification_type,title,message,scheduled_for)
  SELECT p.id,req.id,event_id,reminder.kind,req.title,reminder.message,reminder.due
  FROM public.profiles p CROSS JOIN LATERAL (VALUES
    ('one_day_reminder'::TEXT,req.title||' takes place tomorrow.',starts-INTERVAL '1 day'),
    ('one_hour_reminder'::TEXT,req.title||' starts in one hour.',starts-INTERVAL '1 hour')
  ) reminder(kind,message,due)
  WHERE p.role IN ('student','mentor') AND p.is_active=true AND p.faculty_id=req.faculty_id AND reminder.due>now();
END; $$;

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.calendar_events TO authenticated;
DROP POLICY IF EXISTS "FYE event audience" ON public.calendar_events;
CREATE POLICY "FYE event audience" ON public.calendar_events FOR SELECT TO authenticated USING (
  event_type = 'event' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
    AND (p.role IN ('admin','supervisor') OR (p.role IN ('student','mentor') AND event_status <> 'cancelled'
      AND ((NOT calendar_events.faculty_only AND calendar_events.faculty_id IS NULL) OR p.faculty_id = calendar_events.faculty_id))))
);
-- A restrictive policy also constrains any broader policies in the original schema.
DROP POLICY IF EXISTS "Enforce faculty event visibility" ON public.calendar_events;
CREATE POLICY "Enforce faculty event visibility" ON public.calendar_events AS RESTRICTIVE FOR SELECT TO public USING (
  event_type <> 'event' OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
    AND (p.role IN ('admin','supervisor') OR (p.role IN ('student','mentor') AND event_status <> 'cancelled'
      AND ((NOT calendar_events.faculty_only AND calendar_events.faculty_id IS NULL) OR p.faculty_id = calendar_events.faculty_id))))
);
DROP POLICY IF EXISTS "Only supervisors publish events" ON public.calendar_events;
CREATE POLICY "Only supervisors publish events" ON public.calendar_events AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (
  EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='supervisor' AND is_active=true)
);
DROP POLICY IF EXISTS "Only supervisors change events" ON public.calendar_events;
CREATE POLICY "Only supervisors change events" ON public.calendar_events AS RESTRICTIVE FOR UPDATE TO authenticated USING (
  EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='supervisor' AND is_active=true)
) WITH CHECK (EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='supervisor' AND is_active=true));

CREATE OR REPLACE FUNCTION public.scope_event_notification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE event_faculty BIGINT; target_faculty BIGINT; target_role TEXT;
BEGIN
  SELECT faculty_id INTO event_faculty FROM public.calendar_events
  WHERE id = COALESCE(NEW.calendar_event_id, (SELECT calendar_event_id FROM public.event_requests WHERE id = NEW.event_request_id));
  SELECT faculty_id, role INTO target_faculty,target_role FROM public.profiles WHERE id = NEW.recipient_id;
  IF event_faculty IS NOT NULL AND target_role IN ('student','mentor') AND target_faculty IS DISTINCT FROM event_faculty THEN RETURN NULL; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS z_scope_event_notification ON public.event_notifications;
CREATE TRIGGER z_scope_event_notification BEFORE INSERT ON public.event_notifications
FOR EACH ROW EXECUTE FUNCTION public.scope_event_notification();

-- Scoped approval and cancellation own their complete recipient lists. The
-- legacy copying trigger must not duplicate them or consume the QR notice.
CREATE OR REPLACE FUNCTION public.copy_student_event_notifications_to_mentors()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE event_row public.calendar_events%ROWTYPE;
BEGIN
  IF NEW.notification_type='event_cancelled' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.recipient_id AND role='student') THEN RETURN NEW; END IF;
  SELECT * INTO event_row FROM public.calendar_events WHERE id=COALESCE(NEW.calendar_event_id,(SELECT calendar_event_id FROM public.event_requests WHERE id=NEW.event_request_id));
  IF event_row.faculty_only THEN RETURN NEW; END IF;
  INSERT INTO public.event_notifications(recipient_id,event_request_id,calendar_event_id,notification_type,title,message,qr_token,scheduled_for)
  SELECT p.id,NEW.event_request_id,NEW.calendar_event_id,NEW.notification_type,NEW.title,NEW.message,NULL,NEW.scheduled_for
  FROM public.profiles p WHERE p.role='mentor' AND p.is_active=true AND p.id IS DISTINCT FROM event_row.organizer_id
    AND (event_row.faculty_id IS NULL OR p.faculty_id=event_row.faculty_id)
    AND NOT EXISTS(SELECT 1 FROM public.event_notifications n WHERE n.recipient_id=p.id AND n.notification_type=NEW.notification_type
      AND ((NEW.event_request_id IS NOT NULL AND n.event_request_id=NEW.event_request_id) OR (NEW.calendar_event_id IS NOT NULL AND n.calendar_event_id=NEW.calendar_event_id)))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
-- Remove old notifications that previously advertised faculty events to other faculties.
DELETE FROM public.event_notifications n USING public.calendar_events e, public.profiles p
WHERE n.calendar_event_id=e.id AND n.recipient_id=p.id AND e.faculty_id IS NOT NULL
AND p.role IN ('student','mentor') AND p.faculty_id IS DISTINCT FROM e.faculty_id;

CREATE OR REPLACE FUNCTION public.enforce_attendance_faculty()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE event_faculty BIGINT; attendee_faculty BIGINT; faculty_event BOOLEAN;
BEGIN
  SELECT faculty_id,faculty_only INTO event_faculty,faculty_event FROM public.calendar_events WHERE id=NEW.calendar_event_id;
  SELECT faculty_id INTO attendee_faculty FROM public.profiles WHERE id=NEW.attendee_id;
  IF (faculty_event AND event_faculty IS NULL) OR (event_faculty IS NOT NULL AND attendee_faculty IS DISTINCT FROM event_faculty) THEN
    RAISE EXCEPTION 'Only attendees from the event faculty can check in.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_attendance_faculty ON public.event_attendance;
CREATE TRIGGER enforce_attendance_faculty BEFORE INSERT OR UPDATE OF attendee_id, calendar_event_id ON public.event_attendance
FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_faculty();

CREATE OR REPLACE FUNCTION public.mark_event_attendance(p_qr_token TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE attendee UUID:=auth.uid(); event_row public.calendar_events%ROWTYPE; request_id UUID; attendance_id UUID;
BEGIN
  IF attendee IS NULL OR NOT public.is_fye_student(attendee) THEN RAISE EXCEPTION 'Sign in with an active student or mentor account.'; END IF;
  SELECT * INTO event_row FROM public.calendar_events WHERE attendance_token=p_qr_token AND event_type='event' AND event_status='scheduled' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This attendance code is invalid, cancelled, or no longer active.'; END IF;
  IF (event_row.faculty_only OR event_row.faculty_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=attendee AND faculty_id=event_row.faculty_id) THEN RAISE EXCEPTION 'This event is restricted to its faculty.'; END IF;
  IF now()<event_row.starts_at-INTERVAL '1 hour' OR now()>event_row.ends_at+INTERVAL '2 hours' THEN RAISE EXCEPTION 'The check-in window is closed.'; END IF;
  SELECT id INTO request_id FROM public.event_requests WHERE calendar_event_id=event_row.id LIMIT 1;
  INSERT INTO public.event_attendance(event_request_id,calendar_event_id,attendee_id,attendance_method,recorded_by)
  VALUES(request_id,event_row.id,attendee,'qr',attendee) ON CONFLICT DO NOTHING RETURNING id INTO attendance_id;
  IF attendance_id IS NOT NULL THEN
    INSERT INTO public.event_activity_log(calendar_event_id,actor_id,action_type,details) VALUES(event_row.id,attendee,'attendance_added',jsonb_build_object('method','qr'));
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.get_approved_event_for_attendance(p_qr_token TEXT)
RETURNS TABLE(title VARCHAR,purpose TEXT,event_date DATE,event_time TIME,venue VARCHAR,can_check_in BOOLEAN,check_in_message TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.title::VARCHAR,COALESCE(r.purpose,e.description)::TEXT,
    (e.starts_at AT TIME ZONE 'Africa/Johannesburg')::DATE,(e.starts_at AT TIME ZONE 'Africa/Johannesburg')::TIME,e.location::VARCHAR,
    e.event_status='scheduled' AND now() BETWEEN e.starts_at-INTERVAL '1 hour' AND e.ends_at+INTERVAL '2 hours',
    CASE WHEN e.event_status<>'scheduled' THEN 'This event is no longer active.'
      WHEN now()<e.starts_at-INTERVAL '1 hour' THEN 'Check-in opens one hour before the event.'
      WHEN now()>e.ends_at+INTERVAL '2 hours' THEN 'The check-in window has closed.' ELSE 'Check in to record your attendance.' END
  FROM public.calendar_events e LEFT JOIN public.event_requests r ON r.calendar_event_id=e.id
  WHERE e.attendance_token=p_qr_token AND e.event_type='event'
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active=true
    AND (p.role IN ('admin','supervisor') OR (p.role IN ('student','mentor') AND ((NOT e.faculty_only AND e.faculty_id IS NULL) OR p.faculty_id=e.faculty_id)))) LIMIT 1;
$$;

CREATE TABLE IF NOT EXISTS public.event_cancellation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_event_id BIGINT NOT NULL REFERENCES public.calendar_events(id),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id),
  reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined','completed')),
  review_note TEXT, reviewed_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), reviewed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS event_cancellation_open_idx ON public.event_cancellation_requests(calendar_event_id)
WHERE status IN ('pending','approved');
ALTER TABLE public.event_cancellation_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.event_cancellation_requests TO authenticated;
DROP POLICY IF EXISTS "Read event cancellation requests" ON public.event_cancellation_requests;
CREATE POLICY "Read event cancellation requests" ON public.event_cancellation_requests FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active=true
    AND (p.role='supervisor' OR p.id=mentor_id))
);

CREATE OR REPLACE FUNCTION public.request_event_cancellation(p_event_id BIGINT,p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE request_id UUID; event_row public.calendar_events%ROWTYPE;
BEGIN
  SELECT * INTO event_row FROM public.calendar_events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR event_row.event_status<>'scheduled' OR event_row.organizer_id IS DISTINCT FROM auth.uid()
    OR NOT public.mentor_application_is_approved(auth.uid()) THEN RAISE EXCEPTION 'Only the event mentor can request cancellation of a scheduled event.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active=true) THEN RAISE EXCEPTION 'Active account required.'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL OR length(btrim(p_reason))>1000 THEN RAISE EXCEPTION 'Enter a reason of 1 to 1000 characters.'; END IF;
  INSERT INTO public.event_cancellation_requests(calendar_event_id,mentor_id,reason)
  VALUES(p_event_id,auth.uid(),btrim(p_reason)) RETURNING id INTO request_id;
  -- Use the existing event-request notification category to retain compatibility.
  INSERT INTO public.supervisor_notifications(recipient_id,notification_type,subject_id,title,message)
  SELECT id,'event_request','cancellation:'||request_id::TEXT,'Cancellation requested: '||event_row.title,btrim(p_reason)
  FROM public.profiles WHERE role='supervisor' AND is_active=true;
END; $$;

CREATE OR REPLACE FUNCTION public.review_event_cancellation(p_request_id UUID,p_approve BOOLEAN,p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE req public.event_cancellation_requests%ROWTYPE; event_row public.calendar_events%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='supervisor' AND is_active=true) THEN RAISE EXCEPTION 'Active supervisor access is required.'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'Choose approve or decline.'; END IF;
  IF NOT p_approve AND NULLIF(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Provide a reason when declining.'; END IF;
  SELECT * INTO req FROM public.event_cancellation_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR req.status<>'pending' THEN RAISE EXCEPTION 'This cancellation request is no longer pending.'; END IF;
  SELECT * INTO event_row FROM public.calendar_events WHERE id=req.calendar_event_id;
  IF event_row.event_status<>'scheduled' THEN RAISE EXCEPTION 'The event is no longer scheduled.'; END IF;
  UPDATE public.event_cancellation_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
    review_note=p_note,reviewed_by=auth.uid(),reviewed_at=now() WHERE id=req.id;
  INSERT INTO public.event_notifications(recipient_id,calendar_event_id,notification_type,title,message,scheduled_for)
  VALUES(req.mentor_id,req.calendar_event_id,'event_updated',
    left(CASE WHEN p_approve THEN 'Cancellation approved: ' ELSE 'Cancellation declined: ' END||event_row.title,200),
    CASE WHEN p_approve THEN 'Your supervisor approved the cancellation request. The event remains scheduled until removed from the calendar.'
      ELSE 'The event remains scheduled. '||p_note END,now());
END; $$;

-- All cancellation paths notify the full affected student/mentor audience, remove
-- reminders, and close any cancellation request without deleting attendance history.
CREATE OR REPLACE FUNCTION public.finish_event_cancellation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.event_status='cancelled' AND OLD.event_status IS DISTINCT FROM NEW.event_status THEN
    UPDATE public.event_cancellation_requests SET status='completed' WHERE calendar_event_id=NEW.id AND status IN ('pending','approved');
    DELETE FROM public.event_notifications WHERE calendar_event_id=NEW.id AND notification_type IN ('one_day_reminder','one_hour_reminder') AND scheduled_for>now();
    INSERT INTO public.event_notifications(recipient_id,calendar_event_id,notification_type,title,message,scheduled_for)
    SELECT p.id,NEW.id,'event_cancelled',left('Event cancelled: '||NEW.title,200),NEW.title||' was cancelled. Reason: '||COALESCE(NEW.cancellation_reason,'Contact your supervisor.'),now()
    FROM public.profiles p WHERE p.is_active=true AND p.role IN ('student','mentor')
      AND (NEW.faculty_id IS NULL OR p.faculty_id=NEW.faculty_id)
      AND NOT EXISTS(SELECT 1 FROM public.event_notifications n WHERE n.calendar_event_id=NEW.id AND n.recipient_id=p.id AND n.notification_type='event_cancelled');
  END IF;
  IF NEW.event_status='completed' AND OLD.event_status IS DISTINCT FROM NEW.event_status THEN
    UPDATE public.event_cancellation_requests SET status='declined',review_note='The event was marked complete before cancellation.',reviewed_by=auth.uid(),reviewed_at=now()
    WHERE calendar_event_id=NEW.id AND status IN ('pending','approved');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS finish_event_cancellation ON public.calendar_events;
CREATE TRIGGER finish_event_cancellation AFTER UPDATE OF event_status ON public.calendar_events
FOR EACH ROW EXECUTE FUNCTION public.finish_event_cancellation();

CREATE OR REPLACE FUNCTION public.cancel_supervisor_event(p_event_id BIGINT,p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='supervisor' AND is_active=true) THEN RAISE EXCEPTION 'Active supervisor access is required.'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A cancellation reason is required.'; END IF;
  PERFORM 1 FROM public.calendar_events WHERE id=p_event_id AND event_type='event' AND event_status='scheduled' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only scheduled events can be cancelled.'; END IF;
  UPDATE public.calendar_events SET event_status='cancelled',cancelled_at=now(),cancellation_reason=btrim(p_reason) WHERE id=p_event_id;
  INSERT INTO public.event_activity_log(calendar_event_id,actor_id,action_type,details)
  VALUES(p_event_id,auth.uid(),'event_cancelled',jsonb_build_object('reason',btrim(p_reason)));
END; $$;

-- Admin detail views and reports share a single authorised source of truth.
CREATE OR REPLACE FUNCTION public.get_admin_analytics_details(p_metric TEXT,p_period_days INTEGER DEFAULT 90)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result JSONB; period_start TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active=true) THEN RAISE EXCEPTION 'Active admin access is required.'; END IF;
  IF p_period_days IS NULL OR p_period_days NOT IN (0,30,90,365) THEN RAISE EXCEPTION 'Unsupported period.'; END IF;
  period_start:=CASE WHEN p_period_days=0 THEN NULL ELSE now()-make_interval(days=>p_period_days) END;
  IF p_metric IN ('students','mentors','disabled') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('profile_id',id,'name',full_name,'email',email,'role',role,'faculty_id',faculty_id,'programme_id',programme_id,'active',is_active) ORDER BY full_name),'[]'::JSONB) INTO result
    FROM public.profiles WHERE (p_metric='students' AND role IN ('student','mentor') AND is_active=true)
      OR (p_metric='mentors' AND role='mentor' AND is_active=true)
      OR (p_metric='disabled' AND role IN ('student','mentor') AND is_active=false);
  ELSIF p_metric IN ('events','upcoming') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('event_id',e.id,'title',e.title,'starts_at',e.starts_at,'status',e.event_status,'faculty_id',e.faculty_id,
      'students_attended',(SELECT count(*) FROM public.event_attendance a JOIN public.profiles p ON p.id=a.attendee_id WHERE a.calendar_event_id=e.id AND a.is_valid=true AND p.role='student'),
      'total_attendance',(SELECT count(*) FROM public.event_attendance a WHERE a.calendar_event_id=e.id AND a.is_valid=true)) ORDER BY e.starts_at DESC),'[]'::JSONB) INTO result
    FROM public.calendar_events e WHERE e.event_type='event' AND
      ((p_metric='events' AND (period_start IS NULL OR e.starts_at>=period_start)) OR (p_metric='upcoming' AND e.event_status='scheduled' AND e.starts_at>=now()));
  ELSIF p_metric='assignments' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('student_id',a.student_id,'student',s.full_name,'mentor_id',a.mentor_id,'mentor',m.full_name,'assigned_at',a.assigned_at)),'[]'::JSONB) INTO result
    FROM public.mentor_assignments a LEFT JOIN public.profiles s ON s.id=a.student_id LEFT JOIN public.profiles m ON m.id=a.mentor_id WHERE a.ended_at IS NULL;
  ELSIF p_metric='notices' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('title',title,'starts_at',starts_at,'ends_at',ends_at,'status',CASE WHEN starts_at>now() THEN 'Scheduled' ELSE 'Showing' END)),'[]'::JSONB) INTO result
    FROM public.system_notices WHERE is_active=true AND (ends_at IS NULL OR ends_at>now());
  ELSE RAISE EXCEPTION 'Unsupported analytics metric.'; END IF;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_admin_event_attendance(p_event_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active=true) THEN RAISE EXCEPTION 'Active admin access is required.'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('profile_id',p.id,'name',p.full_name,'email',p.email,'role',p.role,'checked_in_at',a.checked_in_at,'method',a.attendance_method) ORDER BY a.checked_in_at),'[]'::JSONB)
  INTO result FROM public.event_attendance a JOIN public.profiles p ON p.id=a.attendee_id WHERE a.calendar_event_id=p_event_id AND a.is_valid=true;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.expire_system_notices()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active=true) THEN RAISE EXCEPTION 'Active admin access is required.'; END IF;
  UPDATE public.system_notices SET is_active=false WHERE is_active=true AND ends_at IS NOT NULL AND ends_at<=now();
END; $$;
SELECT public.expire_system_notices();

CREATE OR REPLACE FUNCTION public.stop_expired_notice_on_write()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.ends_at IS NOT NULL AND NEW.ends_at<=now() THEN NEW.is_active:=false; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS stop_expired_notice_on_write ON public.system_notices;
CREATE TRIGGER stop_expired_notice_on_write BEFORE INSERT OR UPDATE OF is_active,ends_at ON public.system_notices
FOR EACH ROW EXECUTE FUNCTION public.stop_expired_notice_on_write();

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
    AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='calendar_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_events;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
    AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='event_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_notifications;
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.request_event_cancellation(BIGINT,TEXT),public.review_event_cancellation(UUID,BOOLEAN,TEXT),public.get_admin_analytics_details(TEXT,INTEGER),public.get_admin_event_attendance(BIGINT),public.expire_system_notices() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_event_request(UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_event_request(UUID,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_event_attendance(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_event_attendance(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.get_approved_event_for_attendance(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_approved_event_for_attendance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_event_cancellation(BIGINT,TEXT),public.review_event_cancellation(UUID,BOOLEAN,TEXT),public.get_admin_analytics_details(TEXT,INTEGER),public.get_admin_event_attendance(BIGINT),public.expire_system_notices() TO authenticated;
REVOKE ALL ON FUNCTION public.scope_mentor_event_request(),public.scope_event_notification(),public.enforce_attendance_faculty(),public.finish_event_cancellation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.copy_student_event_notifications_to_mentors() FROM PUBLIC;
NOTIFY pgrst,'reload schema';

-- Expired notices are excluded immediately, even between scheduled sweeps.
CREATE OR REPLACE FUNCTION public.get_admin_analytics(p_period_days INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  period_start TIMESTAMPTZ;
  event_total BIGINT;
  upcoming_total BIGINT;
  student_total BIGINT;
  mentor_total BIGINT;
  disabled_total BIGINT;
  assignment_total BIGINT;
  notice_total BIGINT;
  monthly_events JSONB;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active admin access is required.';
  END IF;

  IF p_period_days IS NULL OR p_period_days NOT IN (0, 30, 90, 365) THEN
    RAISE EXCEPTION 'Choose a supported analytics period.';
  END IF;

  period_start := CASE
    WHEN p_period_days = 0 THEN NULL
    ELSE now() - make_interval(days => p_period_days)
  END;

  SELECT count(*) INTO student_total
  FROM public.profiles
  WHERE role IN ('student', 'mentor') AND is_active = true;

  SELECT count(*) INTO mentor_total
  FROM public.profiles
  WHERE role = 'mentor' AND is_active = true;

  SELECT count(*) INTO disabled_total
  FROM public.profiles
  WHERE role IN ('student', 'mentor') AND is_active = false;

  SELECT count(*) INTO event_total
  FROM public.calendar_events
  WHERE event_type = 'event'
    AND (period_start IS NULL OR starts_at >= period_start);

  SELECT count(*) INTO upcoming_total
  FROM public.calendar_events
  WHERE event_type = 'event'
    AND event_status = 'scheduled'
    AND starts_at >= now();

  SELECT count(*) INTO assignment_total
  FROM public.mentor_assignments
  WHERE ended_at IS NULL;

  SELECT count(*) INTO notice_total
  FROM public.system_notices
  WHERE is_active = true AND (ends_at IS NULL OR ends_at > now());

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('month', monthly.month_start, 'count', monthly.event_count)
      ORDER BY monthly.month_start),
    '[]'::JSONB
  ) INTO monthly_events
  FROM (
    SELECT date_trunc('month', starts_at)::DATE AS month_start, count(*) AS event_count
    FROM public.calendar_events
    WHERE event_type = 'event'
      AND (period_start IS NULL OR starts_at >= period_start)
    GROUP BY date_trunc('month', starts_at)::DATE
  ) AS monthly;

  RETURN jsonb_build_object(
    'active_students', student_total,
    'active_mentors', mentor_total,
    'disabled_profiles', disabled_total,
    'events_in_period', event_total,
    'upcoming_events', upcoming_total,
    'active_assignments', assignment_total,
    'active_notices', notice_total,
    'events_by_month', monthly_events
  );
END;
$$;

COMMIT;


-- For expiry sweeps when no dashboards are open, enable pg_cron and run 20261011000000_notice_expiry_schedule.sql.
