-- Extend published calendar events into the shared event-management record.
-- event_requests remains the mentor approval record; calendar_events is the
-- published event shared by supervisors, mentors, and students.

DO $$
BEGIN
  IF to_regclass('public.calendar_events') IS NULL THEN
    RAISE EXCEPTION 'calendar_events must exist before applying event management lifecycle migration';
  END IF;
END;
$$;

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS event_status TEXT NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_token TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_note TEXT,
  ADD COLUMN IF NOT EXISTS mentor_outcome TEXT,
  ADD COLUMN IF NOT EXISTS organizer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.calendar_events'::regclass
      AND conname = 'calendar_events_event_status_check'
  ) THEN
    ALTER TABLE public.calendar_events
      ADD CONSTRAINT calendar_events_event_status_check
      CHECK (event_status IN ('scheduled', 'cancelled', 'completed'));
  END IF;
END;
$$;

UPDATE public.calendar_events
SET ends_at = starts_at + INTERVAL '2 hours'
WHERE ends_at IS NULL;

UPDATE public.calendar_events
SET attendance_token = gen_random_uuid()::TEXT
WHERE event_type = 'event' AND attendance_token IS NULL;

ALTER TABLE public.event_attendance
  ADD COLUMN IF NOT EXISTS calendar_event_id BIGINT REFERENCES public.calendar_events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS attendance_method TEXT NOT NULL DEFAULT 'qr',
  ADD COLUMN IF NOT EXISTS recorded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_reason TEXT,
  ADD COLUMN IF NOT EXISTS is_valid BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invalidation_reason TEXT;

ALTER TABLE public.event_attendance
  ALTER COLUMN event_request_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_attendance'::regclass
      AND conname = 'event_attendance_method_check'
  ) THEN
    ALTER TABLE public.event_attendance
      ADD CONSTRAINT event_attendance_method_check
      CHECK (attendance_method IN ('qr', 'manual'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_attendance'::regclass
      AND conname = 'event_attendance_event_reference_check'
  ) THEN
    ALTER TABLE public.event_attendance
      ADD CONSTRAINT event_attendance_event_reference_check
      CHECK (event_request_id IS NOT NULL OR calendar_event_id IS NOT NULL);
  END IF;
END;
$$;

UPDATE public.event_attendance AS attendance
SET calendar_event_id = request.calendar_event_id
FROM public.event_requests AS request
WHERE attendance.event_request_id = request.id
  AND attendance.calendar_event_id IS NULL
  AND request.calendar_event_id IS NOT NULL;

UPDATE public.calendar_events AS published
SET attendance_token = COALESCE(request.qr_token, published.attendance_token),
    organizer_id = request.mentor_id
FROM public.event_requests AS request
WHERE request.calendar_event_id = published.id
  AND request.status = 'approved';

CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_attendance_token_uidx
  ON public.calendar_events(attendance_token)
  WHERE attendance_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS event_attendance_calendar_event_attendee_uidx
  ON public.event_attendance(calendar_event_id, attendee_id)
  WHERE calendar_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calendar_events_status_starts_idx
  ON public.calendar_events(event_status, starts_at);

ALTER TABLE public.event_notifications
  ADD COLUMN IF NOT EXISTS calendar_event_id BIGINT REFERENCES public.calendar_events(id) ON DELETE CASCADE;

ALTER TABLE public.event_notifications
  ALTER COLUMN event_request_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_notifications'::regclass
      AND conname = 'event_notifications_notification_type_check'
  ) THEN
    ALTER TABLE public.event_notifications
      DROP CONSTRAINT event_notifications_notification_type_check;
  END IF;
  ALTER TABLE public.event_notifications
    ADD CONSTRAINT event_notifications_notification_type_check
    CHECK (notification_type IN (
      'approved', 'rejected', 'one_day_reminder', 'one_hour_reminder',
      'event_updated', 'event_cancelled', 'event_completed'
    ));
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_notifications'::regclass
      AND conname = 'event_notifications_event_reference_check'
  ) THEN
    ALTER TABLE public.event_notifications
      ADD CONSTRAINT event_notifications_event_reference_check
      CHECK (event_request_id IS NOT NULL OR calendar_event_id IS NOT NULL);
  END IF;
END;
$$;

UPDATE public.event_notifications AS notification
SET calendar_event_id = request.calendar_event_id
FROM public.event_requests AS request
WHERE notification.event_request_id = request.id
  AND notification.calendar_event_id IS NULL
  AND request.calendar_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_notifications_calendar_due_idx
  ON public.event_notifications(recipient_id, calendar_event_id, scheduled_for);

CREATE TABLE IF NOT EXISTS public.event_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_event_id BIGINT NOT NULL REFERENCES public.calendar_events(id) ON DELETE RESTRICT,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL CHECK (action_type IN (
    'request_approved', 'event_created', 'event_updated', 'event_cancelled',
    'event_completed', 'outcome_submitted', 'attendance_added', 'attendance_corrected'
  )),
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_activity_log_event_created_idx
  ON public.event_activity_log(calendar_event_id, created_at DESC);
ALTER TABLE public.event_activity_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.event_activity_log TO authenticated;
DROP POLICY IF EXISTS "Supervisors read event activity" ON public.event_activity_log;
CREATE POLICY "Supervisors read event activity"
  ON public.event_activity_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'supervisor'
  ));

CREATE OR REPLACE FUNCTION public.set_calendar_event_lifecycle_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type = 'event' THEN
    NEW.ends_at := COALESCE(NEW.ends_at, NEW.starts_at + INTERVAL '2 hours');
    NEW.attendance_token := COALESCE(NEW.attendance_token, gen_random_uuid()::TEXT);
    NEW.event_status := COALESCE(NEW.event_status, 'scheduled');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calendar_event_lifecycle_defaults ON public.calendar_events;
CREATE TRIGGER calendar_event_lifecycle_defaults
  BEFORE INSERT OR UPDATE OF starts_at, ends_at
  ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.set_calendar_event_lifecycle_defaults();

CREATE OR REPLACE FUNCTION public.sync_event_request_to_calendar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.calendar_event_id IS NOT NULL THEN
    UPDATE public.calendar_events
    SET attendance_token = COALESCE(NEW.qr_token, attendance_token),
        organizer_id = NEW.mentor_id
    WHERE id = NEW.calendar_event_id;
    IF NEW.status = 'approved' THEN
      IF TG_OP = 'INSERT' THEN
        INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
        VALUES (NEW.calendar_event_id, NEW.approved_by, 'request_approved',
          jsonb_build_object('mentor_id', NEW.mentor_id, 'title', NEW.title));
      ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
        VALUES (NEW.calendar_event_id, NEW.approved_by, 'request_approved',
          jsonb_build_object('mentor_id', NEW.mentor_id, 'title', NEW.title));
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_request_calendar_sync ON public.event_requests;
CREATE TRIGGER event_request_calendar_sync
  AFTER INSERT OR UPDATE OF status, calendar_event_id, qr_token
  ON public.event_requests
  FOR EACH ROW EXECUTE FUNCTION public.sync_event_request_to_calendar();

CREATE OR REPLACE FUNCTION public.link_notification_to_calendar_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.notification_type IN ('one_day_reminder', 'one_hour_reminder')
    AND NEW.scheduled_for <= now() THEN
    RETURN NULL;
  END IF;
  IF NEW.calendar_event_id IS NULL AND NEW.event_request_id IS NOT NULL THEN
    SELECT calendar_event_id INTO NEW.calendar_event_id
    FROM public.event_requests
    WHERE id = NEW.event_request_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_notification_calendar_link ON public.event_notifications;
CREATE TRIGGER event_notification_calendar_link
  BEFORE INSERT OR UPDATE OF event_request_id, calendar_event_id
  ON public.event_notifications
  FOR EACH ROW EXECUTE FUNCTION public.link_notification_to_calendar_event();

DROP FUNCTION IF EXISTS public.create_supervisor_event(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT);
CREATE FUNCTION public.create_supervisor_event(
  p_title TEXT,
  p_description TEXT,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_venue TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  event_id BIGINT;
  event_end TIMESTAMPTZ;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor_id AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;
  IF NULLIF(btrim(p_title), '') IS NULL
    OR NULLIF(btrim(p_description), '') IS NULL
    OR NULLIF(btrim(p_venue), '') IS NULL
    OR p_starts_at IS NULL THEN
    RAISE EXCEPTION 'Complete all event fields.';
  END IF;

  event_end := COALESCE(p_ends_at, p_starts_at + INTERVAL '2 hours');
  IF p_starts_at <= now() OR event_end <= p_starts_at THEN
    RAISE EXCEPTION 'Choose a future start time and an end time after it.';
  END IF;

  INSERT INTO public.calendar_events (
    title, event_type, description, starts_at, location, created_by, audience,
    ends_at, attendance_token, organizer_id, event_status
  ) VALUES (
    btrim(p_title), 'event', btrim(p_description), p_starts_at, btrim(p_venue),
    actor_id, 'university', event_end, gen_random_uuid()::TEXT, actor_id, 'scheduled'
  ) RETURNING id INTO event_id;

    INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
    VALUES (event_id, actor_id, 'event_created', jsonb_build_object(
      'title', btrim(p_title), 'starts_at', p_starts_at, 'ends_at', event_end, 'venue', btrim(p_venue)
    ));

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT id, event_id, 'approved', 'New FYE event: ' || btrim(p_title),
    btrim(p_title) || ' is on ' || to_char(p_starts_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY at HH24:MI')
      || ' in ' || btrim(p_venue) || '.', now()
  FROM public.profiles WHERE role = 'student';

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT id, event_id, reminder.notification_type, reminder.title,
    reminder.message, reminder.reminder_at
  FROM public.profiles
  CROSS JOIN LATERAL (VALUES
    ('one_day_reminder'::TEXT, 'Event tomorrow: ' || btrim(p_title),
      btrim(p_title) || ' is tomorrow at ' || to_char(p_starts_at AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')
        || ' in ' || btrim(p_venue) || '.', p_starts_at - INTERVAL '1 day'),
    ('one_hour_reminder'::TEXT, 'Event starting soon: ' || btrim(p_title),
      btrim(p_title) || ' starts in one hour at ' || btrim(p_venue) || '.', p_starts_at - INTERVAL '1 hour')
  ) AS reminder(notification_type, title, message, reminder_at)
  WHERE role = 'student' AND reminder.reminder_at > now();

  RETURN event_id;
END;
$$;

DROP FUNCTION IF EXISTS public.update_supervisor_event(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.update_supervisor_event(BIGINT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT);
CREATE FUNCTION public.update_supervisor_event(
  p_event_id BIGINT,
  p_title TEXT,
  p_description TEXT,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_venue TEXT,
  p_change_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  event_row public.calendar_events%ROWTYPE;
  event_end TIMESTAMPTZ;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor_id AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;
  IF NULLIF(btrim(p_title), '') IS NULL
    OR NULLIF(btrim(p_description), '') IS NULL
    OR NULLIF(btrim(p_venue), '') IS NULL
    OR p_starts_at IS NULL OR NULLIF(btrim(p_change_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Complete all event fields and provide a reason for the change.';
  END IF;
  event_end := COALESCE(p_ends_at, p_starts_at + INTERVAL '2 hours');
  IF p_starts_at <= now() OR event_end <= p_starts_at THEN
    RAISE EXCEPTION 'Choose a future start time and an end time after it.';
  END IF;

  SELECT * INTO event_row FROM public.calendar_events
  WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR event_row.event_type <> 'event' OR event_row.event_status <> 'scheduled' THEN
    RAISE EXCEPTION 'Only scheduled events can be edited.';
  END IF;

  UPDATE public.calendar_events
  SET title = btrim(p_title), description = btrim(p_description),
      starts_at = p_starts_at, ends_at = event_end, location = btrim(p_venue)
  WHERE id = p_event_id;

  INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
  VALUES (p_event_id, actor_id, 'event_updated', jsonb_build_object(
    'reason', btrim(p_change_reason),
    'before', jsonb_build_object('title', event_row.title, 'description', event_row.description,
      'starts_at', event_row.starts_at, 'ends_at', event_row.ends_at, 'venue', event_row.location),
    'after', jsonb_build_object('title', btrim(p_title), 'description', btrim(p_description),
      'starts_at', p_starts_at, 'ends_at', event_end, 'venue', btrim(p_venue))
  ));

  DELETE FROM public.event_notifications
  WHERE calendar_event_id = p_event_id
    AND notification_type IN ('one_day_reminder', 'one_hour_reminder')
    AND scheduled_for > now();

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT id, p_event_id, reminder.notification_type, reminder.title,
    reminder.message, reminder.reminder_at
  FROM public.profiles
  CROSS JOIN LATERAL (VALUES
    ('one_day_reminder'::TEXT, 'Event tomorrow: ' || btrim(p_title),
      btrim(p_title) || ' is tomorrow at ' || to_char(p_starts_at AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')
        || ' in ' || btrim(p_venue) || '.', p_starts_at - INTERVAL '1 day'),
    ('one_hour_reminder'::TEXT, 'Event starting soon: ' || btrim(p_title),
      btrim(p_title) || ' starts in one hour at ' || btrim(p_venue) || '.', p_starts_at - INTERVAL '1 hour')
  ) AS reminder(notification_type, title, message, reminder_at)
  WHERE role = 'student' AND reminder.reminder_at > now();

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT id, p_event_id, 'event_updated', 'Event updated: ' || btrim(p_title),
    btrim(p_title) || ' has updated event details. It is now on '
      || to_char(p_starts_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY at HH24:MI')
      || ' in ' || btrim(p_venue) || '.', now()
  FROM public.profiles WHERE role = 'student';

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT event_row.organizer_id, p_event_id, 'event_updated', 'Event updated: ' || btrim(p_title),
    btrim(p_title) || ' has updated event details. It is now on '
      || to_char(p_starts_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY at HH24:MI')
      || ' in ' || btrim(p_venue) || '.', now()
  WHERE event_row.organizer_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = event_row.organizer_id AND role = 'mentor');
END;
$$;

DROP FUNCTION IF EXISTS public.cancel_supervisor_event(UUID, TEXT);
DROP FUNCTION IF EXISTS public.cancel_supervisor_event(BIGINT, TEXT);
CREATE FUNCTION public.cancel_supervisor_event(p_event_id BIGINT, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  event_row public.calendar_events%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor_id AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required.';
  END IF;
  SELECT * INTO event_row FROM public.calendar_events
  WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR event_row.event_type <> 'event' OR event_row.event_status <> 'scheduled' THEN
    RAISE EXCEPTION 'Only scheduled events can be cancelled.';
  END IF;

  UPDATE public.calendar_events
  SET event_status = 'cancelled', cancelled_at = now(),
      cancellation_reason = btrim(p_reason)
  WHERE id = p_event_id;
  INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
  VALUES (p_event_id, actor_id, 'event_cancelled', jsonb_build_object('reason', btrim(p_reason)));
  DELETE FROM public.event_notifications
  WHERE calendar_event_id = p_event_id
    AND notification_type IN ('one_day_reminder', 'one_hour_reminder')
    AND scheduled_for > now();

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT id, p_event_id, 'event_cancelled', 'Event cancelled: ' || event_row.title,
    event_row.title || ' has been cancelled. Reason: ' || btrim(p_reason), now()
  FROM public.profiles WHERE role = 'student';

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT event_row.organizer_id, p_event_id, 'event_cancelled', 'Event cancelled: ' || event_row.title,
    event_row.title || ' has been cancelled. Reason: ' || btrim(p_reason), now()
  WHERE event_row.organizer_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = event_row.organizer_id AND role = 'mentor');
END;
$$;

DROP FUNCTION IF EXISTS public.complete_supervisor_event(UUID, TEXT);
DROP FUNCTION IF EXISTS public.complete_supervisor_event(BIGINT, TEXT);
CREATE FUNCTION public.complete_supervisor_event(p_event_id BIGINT, p_note TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  event_row public.calendar_events%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor_id AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;
  SELECT * INTO event_row FROM public.calendar_events
  WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR event_row.event_type <> 'event' OR event_row.event_status <> 'scheduled' THEN
    RAISE EXCEPTION 'Only scheduled events can be completed.';
  END IF;
  IF now() < event_row.ends_at THEN
    RAISE EXCEPTION 'This event cannot be completed before its scheduled end time.';
  END IF;
  UPDATE public.calendar_events
  SET event_status = 'completed', completed_at = now(), completion_note = NULLIF(btrim(p_note), '')
  WHERE id = p_event_id;
  INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
  VALUES (p_event_id, actor_id, 'event_completed', jsonb_build_object('note', NULLIF(btrim(p_note), '')));
  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT id, p_event_id, 'event_completed', 'Event completed: ' || event_row.title,
    event_row.title || ' has been marked complete.', now()
  FROM public.profiles WHERE role = 'student';

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT event_row.organizer_id, p_event_id, 'event_completed', 'Event completed: ' || event_row.title,
    event_row.title || ' has been marked complete.', now()
  WHERE event_row.organizer_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = event_row.organizer_id AND role = 'mentor');
END;
$$;

DROP FUNCTION IF EXISTS public.submit_event_outcome(UUID, TEXT);
DROP FUNCTION IF EXISTS public.submit_event_outcome(BIGINT, TEXT);
CREATE FUNCTION public.submit_event_outcome(p_event_id BIGINT, p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  request_id UUID;
BEGIN
  IF actor_id IS NULL OR NULLIF(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'A signed-in mentor and an outcome note are required.';
  END IF;
  SELECT request.id INTO request_id
  FROM public.event_requests AS request
  JOIN public.calendar_events AS published ON published.id = request.calendar_event_id
  WHERE published.id = p_event_id
    AND request.mentor_id = actor_id
    AND request.status = 'approved'
    AND published.event_status IN ('scheduled', 'completed');
  IF request_id IS NULL THEN
    RAISE EXCEPTION 'Only the requesting mentor can submit this event outcome.';
  END IF;
  UPDATE public.calendar_events SET mentor_outcome = btrim(p_note)
  WHERE id = p_event_id;
  INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
  VALUES (p_event_id, actor_id, 'outcome_submitted', jsonb_build_object('note', btrim(p_note)));
END;
$$;

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
  IF attendee IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = attendee AND role = 'student'
  ) THEN
    RAISE EXCEPTION 'Sign in with an active student account to record attendance.';
  END IF;
  SELECT * INTO event_row
  FROM public.calendar_events
  WHERE attendance_token = p_qr_token AND event_status = 'scheduled' AND event_type = 'event';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This attendance QR code is invalid, cancelled, or no longer active.';
  END IF;
  IF now() < event_row.starts_at - INTERVAL '1 hour'
    OR now() > event_row.ends_at + INTERVAL '2 hours' THEN
    RAISE EXCEPTION 'Check-in is only available from one hour before until two hours after the event.';
  END IF;
  SELECT id INTO request_id FROM public.event_requests WHERE calendar_event_id = event_row.id LIMIT 1;
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

DROP FUNCTION IF EXISTS public.get_approved_event_for_attendance(TEXT);
CREATE FUNCTION public.get_approved_event_for_attendance(p_qr_token TEXT)
RETURNS TABLE (
  title VARCHAR,
  purpose TEXT,
  event_date DATE,
  event_time TIME,
  venue VARCHAR,
  can_check_in BOOLEAN,
  check_in_message TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT published.title::VARCHAR,
    COALESCE(request.purpose, published.description)::TEXT,
    (published.starts_at AT TIME ZONE 'Africa/Johannesburg')::DATE,
    (published.starts_at AT TIME ZONE 'Africa/Johannesburg')::TIME,
    published.location::VARCHAR,
    published.event_status = 'scheduled'
      AND now() >= published.starts_at - INTERVAL '1 hour'
      AND now() <= published.ends_at + INTERVAL '2 hours',
    CASE
      WHEN published.event_status <> 'scheduled' THEN 'This event is no longer active.'
      WHEN now() < published.starts_at - INTERVAL '1 hour' THEN 'Check-in opens one hour before the event.'
      WHEN now() > published.ends_at + INTERVAL '2 hours' THEN 'The check-in window for this event has closed.'
      ELSE 'Check in to record your attendance.'
    END
  FROM public.calendar_events AS published
  LEFT JOIN public.event_requests AS request ON request.calendar_event_id = published.id
  WHERE published.attendance_token = p_qr_token AND published.event_type = 'event'
  LIMIT 1;
$$;

DROP FUNCTION IF EXISTS public.record_manual_event_attendance(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.record_manual_event_attendance(BIGINT, UUID, TEXT);
CREATE FUNCTION public.record_manual_event_attendance(
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
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_attendee_id AND role = 'student'
  ) THEN
    RAISE EXCEPTION 'Choose a valid event and student.';
  END IF;
  IF event_row.event_status = 'scheduled'
    AND (now() < event_row.starts_at - INTERVAL '1 hour' OR now() > event_row.ends_at + INTERVAL '2 hours') THEN
    RAISE EXCEPTION 'Manual check-in is only available during the event check-in window.';
  END IF;
  SELECT id INTO request_id FROM public.event_requests WHERE calendar_event_id = p_event_id LIMIT 1;
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
    RAISE EXCEPTION 'This student is already recorded as attending.';
  END IF;
  INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
  VALUES (p_event_id, actor_id, 'attendance_added', jsonb_build_object(
    'attendee_id', p_attendee_id, 'method', 'manual', 'reason', btrim(p_reason),
    'previous_checked_in_at', previous_attendance.checked_in_at,
    'previous_method', previous_attendance.attendance_method,
    'previous_reason', previous_attendance.correction_reason
  ));
END;
$$;

DROP FUNCTION IF EXISTS public.invalidate_event_attendance(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.invalidate_event_attendance(BIGINT, UUID, TEXT);
CREATE FUNCTION public.invalidate_event_attendance(
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
  attendance_row public.event_attendance%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor_id AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to correct attendance.';
  END IF;
  SELECT * INTO attendance_row FROM public.event_attendance
  WHERE calendar_event_id = p_event_id AND attendee_id = p_attendee_id AND is_valid = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active attendance record was found for this student.';
  END IF;
  UPDATE public.event_attendance
  SET is_valid = false, invalidated_at = now(), invalidated_by = actor_id,
      invalidation_reason = btrim(p_reason)
  WHERE calendar_event_id = p_event_id AND attendee_id = p_attendee_id AND is_valid = true;
  INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
  VALUES (p_event_id, actor_id, 'attendance_corrected', jsonb_build_object(
    'attendee_id', p_attendee_id, 'reason', btrim(p_reason),
    'previous_checked_in_at', attendance_row.checked_in_at,
    'previous_method', attendance_row.attendance_method,
    'previous_correction_reason', attendance_row.correction_reason
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.create_supervisor_event(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_supervisor_event(BIGINT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_supervisor_event(BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_supervisor_event(BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_event_outcome(BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_event_attendance(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_approved_event_for_attendance(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_manual_event_attendance(BIGINT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invalidate_event_attendance(BIGINT, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_supervisor_event(TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_supervisor_event(BIGINT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_supervisor_event(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_supervisor_event(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_event_outcome(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_event_attendance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_approved_event_for_attendance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_event_attendance(BIGINT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invalidate_event_attendance(BIGINT, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';