CREATE OR REPLACE FUNCTION public.is_fye_student(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_profile_id AND role IN ('student', 'mentor')
  ) AND (
    p_profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'supervisor'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.is_fye_student(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_fye_student(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.copy_student_event_notifications_to_mentors()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.recipient_id AND role = 'student'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.event_notifications (
    recipient_id,
    event_request_id,
    calendar_event_id,
    notification_type,
    title,
    message,
    qr_token,
    scheduled_for
  )
  SELECT
    mentor.id,
    NEW.event_request_id,
    NEW.calendar_event_id,
    NEW.notification_type,
    NEW.title,
    NEW.message,
    NULL,
    NEW.scheduled_for
  FROM public.profiles AS mentor
  WHERE mentor.role = 'mentor'
    AND NOT EXISTS (
      SELECT 1 FROM public.event_notifications AS existing
      WHERE existing.recipient_id = mentor.id
        AND existing.notification_type = NEW.notification_type
        AND (
          (NEW.event_request_id IS NOT NULL AND existing.event_request_id = NEW.event_request_id)
          OR (NEW.calendar_event_id IS NOT NULL AND existing.calendar_event_id = NEW.calendar_event_id)
        )
    )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.copy_student_event_notifications_to_mentors() FROM PUBLIC;

DROP TRIGGER IF EXISTS copy_student_event_notifications_to_mentors
  ON public.event_notifications;
CREATE TRIGGER copy_student_event_notifications_to_mentors
  AFTER INSERT ON public.event_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.copy_student_event_notifications_to_mentors();

CREATE OR REPLACE FUNCTION public.mark_event_attendance(p_qr_token TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attendee UUID := auth.uid();
  event_row public.calendar_events%ROWTYPE;
  request_id UUID;
  attendance_id UUID;
BEGIN
  IF attendee IS NULL OR NOT public.is_fye_student(attendee) THEN
    RAISE EXCEPTION 'Sign in with a student account to record attendance.';
  END IF;

  SELECT * INTO event_row
  FROM public.calendar_events
  WHERE attendance_token = p_qr_token
    AND event_status = 'scheduled'
    AND event_type = 'event';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This attendance QR code is invalid, cancelled, or no longer active.';
  END IF;

  IF now() < event_row.starts_at - INTERVAL '1 hour'
    OR now() > event_row.ends_at + INTERVAL '2 hours' THEN
    RAISE EXCEPTION 'Check-in is only available from one hour before until two hours after the event.';
  END IF;

  SELECT id INTO request_id
  FROM public.event_requests
  WHERE calendar_event_id = event_row.id
  LIMIT 1;

  INSERT INTO public.event_attendance (
    event_request_id, calendar_event_id, attendee_id, attendance_method, recorded_by
  ) VALUES (request_id, event_row.id, attendee, 'qr', attendee)
  ON CONFLICT DO NOTHING
  RETURNING id INTO attendance_id;

  IF attendance_id IS NOT NULL THEN
    INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
    VALUES (event_row.id, attendee, 'attendance_added', jsonb_build_object('method', 'qr'));
  END IF;
END;
$$;

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
    SELECT 1 FROM public.profiles WHERE id = actor_id AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
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

REVOKE ALL ON FUNCTION public.mark_event_attendance(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_manual_event_attendance(BIGINT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_event_attendance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_event_attendance(BIGINT, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';