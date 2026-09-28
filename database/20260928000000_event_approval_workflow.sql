CREATE TABLE IF NOT EXISTS public.event_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  purpose TEXT NOT NULL,
  event_date DATE NOT NULL,
  event_time TIME NOT NULL,
  venue VARCHAR(200) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  supervisor_note TEXT,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  qr_token TEXT UNIQUE,
  calendar_event_id UUID UNIQUE REFERENCES public.calendar_events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_request_id UUID NOT NULL REFERENCES public.event_requests(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (
    notification_type IN ('approved', 'rejected', 'one_day_reminder', 'one_hour_reminder')
  ),
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  qr_token TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, event_request_id, notification_type)
);

ALTER TABLE public.event_notifications
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.event_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_request_id UUID NOT NULL REFERENCES public.event_requests(id) ON DELETE CASCADE,
  attendee_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_request_id, attendee_id)
);

CREATE INDEX IF NOT EXISTS event_requests_status_created_idx
  ON public.event_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS event_requests_mentor_created_idx
  ON public.event_requests(mentor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_notifications_recipient_due_idx
  ON public.event_notifications(recipient_id, scheduled_for DESC);

ALTER TABLE public.event_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_attendance ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.event_requests TO authenticated;
GRANT SELECT ON public.event_notifications TO authenticated;
GRANT SELECT ON public.event_attendance TO authenticated;

DROP POLICY IF EXISTS "Mentors submit own approved event requests" ON public.event_requests;

DROP POLICY IF EXISTS "Users read their event requests" ON public.event_requests;
CREATE POLICY "Users read their event requests"
  ON public.event_requests FOR SELECT TO authenticated
  USING (
    mentor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'supervisor'
    )
  );

DROP POLICY IF EXISTS "Recipients read due event notifications" ON public.event_notifications;
CREATE POLICY "Recipients read due event notifications"
  ON public.event_notifications FOR SELECT TO authenticated
  USING (recipient_id = auth.uid() AND scheduled_for <= now());

DROP POLICY IF EXISTS "Recipients mark own event notifications read" ON public.event_notifications;

DROP POLICY IF EXISTS "Users read own event attendance" ON public.event_attendance;
CREATE POLICY "Users read own event attendance"
  ON public.event_attendance FOR SELECT TO authenticated
  USING (
    attendee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'supervisor'
    )
  );

CREATE OR REPLACE FUNCTION public.create_event_request(
  p_title TEXT,
  p_purpose TEXT,
  p_event_date DATE,
  p_event_time TIME,
  p_venue TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  request_id UUID;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id
      AND role = 'mentor'
      AND mentor_approval_status = 'approved'
  ) THEN
    RAISE EXCEPTION 'Only approved mentors can submit event requests.';
  END IF;

  IF NULLIF(btrim(p_title), '') IS NULL
    OR NULLIF(btrim(p_purpose), '') IS NULL
    OR p_event_date IS NULL
    OR p_event_time IS NULL
    OR NULLIF(btrim(p_venue), '') IS NULL THEN
    RAISE EXCEPTION 'Complete all event request fields.';
  END IF;

  INSERT INTO public.event_requests (
    mentor_id, title, purpose, event_date, event_time, venue
  ) VALUES (
    actor_id, btrim(p_title), btrim(p_purpose), p_event_date, p_event_time, btrim(p_venue)
  ) RETURNING id INTO request_id;

  RETURN request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_event_request(
  p_event_id UUID,
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
  request_row public.event_requests%ROWTYPE;
  generated_qr_token TEXT;
  calendar_id UUID;
  event_starts_at TIMESTAMPTZ;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;

  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Choose approve or decline.';
  END IF;

  IF p_decision = 'rejected' AND NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when declining an event.';
  END IF;

  SELECT * INTO request_row
  FROM public.event_requests
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND OR request_row.status <> 'pending' THEN
    RAISE EXCEPTION 'This event request is no longer pending.';
  END IF;

  IF p_decision = 'approved' THEN
    generated_qr_token := gen_random_uuid()::TEXT;
    event_starts_at := (request_row.event_date + request_row.event_time)
      AT TIME ZONE 'Africa/Johannesburg';

    INSERT INTO public.calendar_events (
      title, event_type, description, starts_at, location, created_by, audience
    ) VALUES (
      request_row.title,
      'event',
      request_row.purpose,
      event_starts_at,
      request_row.venue,
      actor_id,
      'university'
    ) RETURNING id INTO calendar_id;

    UPDATE public.event_requests
    SET status = 'approved',
        supervisor_note = NULLIF(btrim(p_reason), ''),
        approved_by = actor_id,
        qr_token = generated_qr_token,
        calendar_event_id = calendar_id,
        updated_at = now()
    WHERE id = p_event_id;

    INSERT INTO public.event_notifications (
      recipient_id, event_request_id, notification_type, title, message, qr_token, scheduled_for
    )
    SELECT
      profiles.id,
      request_row.id,
      'approved',
      'New approved event: ' || request_row.title,
      request_row.title || ' is on ' || request_row.event_date::TEXT || ' at '
        || to_char(request_row.event_time, 'HH24:MI') || ' in ' || request_row.venue || '.',
      NULL,
      now()
    FROM public.profiles
    WHERE profiles.role = 'student';

    INSERT INTO public.event_notifications (
      recipient_id, event_request_id, notification_type, title, message, qr_token, scheduled_for
    ) VALUES
      (
        request_row.mentor_id, request_row.id, 'approved',
        'Event approved: ' || request_row.title,
        'Your event is approved. Share the attendance QR code with attendees.',
        generated_qr_token, now()
      ),
      (
        request_row.mentor_id, request_row.id, 'one_day_reminder',
        'Event tomorrow: ' || request_row.title,
        request_row.title || ' is tomorrow at ' || to_char(request_row.event_time, 'HH24:MI')
          || ' in ' || request_row.venue || '.',
        NULL, event_starts_at - INTERVAL '1 day'
      ),
      (
        request_row.mentor_id, request_row.id, 'one_hour_reminder',
        'Event starting soon: ' || request_row.title,
        request_row.title || ' starts in one hour at ' || request_row.venue || '.',
        NULL, event_starts_at - INTERVAL '1 hour'
      );

    INSERT INTO public.event_notifications (
      recipient_id, event_request_id, notification_type, title, message, scheduled_for
    )
    SELECT
      profiles.id,
      request_row.id,
      'one_day_reminder',
      'Event tomorrow: ' || request_row.title,
      request_row.title || ' is tomorrow at ' || to_char(request_row.event_time, 'HH24:MI')
        || ' in ' || request_row.venue || '.',
      event_starts_at - INTERVAL '1 day'
    FROM public.profiles
    WHERE profiles.role = 'student';

    INSERT INTO public.event_notifications (
      recipient_id, event_request_id, notification_type, title, message, scheduled_for
    )
    SELECT
      profiles.id,
      request_row.id,
      'one_hour_reminder',
      'Event starting soon: ' || request_row.title,
      request_row.title || ' starts in one hour at ' || request_row.venue || '.',
      event_starts_at - INTERVAL '1 hour'
    FROM public.profiles
    WHERE profiles.role = 'student';
  ELSE
    UPDATE public.event_requests
    SET status = 'rejected',
        supervisor_note = btrim(p_reason),
        approved_by = actor_id,
        updated_at = now()
    WHERE id = p_event_id;

    INSERT INTO public.event_notifications (
      recipient_id, event_request_id, notification_type, title, message, scheduled_for
    ) VALUES (
      request_row.mentor_id,
      request_row.id,
      'rejected',
      'Event declined: ' || request_row.title,
      btrim(p_reason),
      now()
    );
  END IF;
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
  request_id UUID;
BEGIN
  IF attendee IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = attendee AND role = 'student'
  ) THEN
    RAISE EXCEPTION 'Sign in with a student account to record attendance.';
  END IF;

  SELECT id INTO request_id
  FROM public.event_requests
  WHERE qr_token = p_qr_token AND status = 'approved';

  IF request_id IS NULL THEN
    RAISE EXCEPTION 'This attendance QR code is invalid or no longer active.';
  END IF;

  INSERT INTO public.event_attendance (event_request_id, attendee_id)
  VALUES (request_id, attendee)
  ON CONFLICT (event_request_id, attendee_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_approved_event_for_attendance(p_qr_token TEXT)
RETURNS TABLE (
  title VARCHAR,
  purpose TEXT,
  event_date DATE,
  event_time TIME,
  venue VARCHAR
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT request.title, request.purpose, request.event_date, request.event_time, request.venue
  FROM public.event_requests AS request
  WHERE request.qr_token = p_qr_token AND request.status = 'approved'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.mark_event_notification_read(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.event_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.create_event_request(TEXT, TEXT, DATE, TIME, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_event_request(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_event_attendance(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_approved_event_for_attendance(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_event_notification_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_request(TEXT, TEXT, DATE, TIME, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_event_request(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_event_attendance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_approved_event_for_attendance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_event_notification_read(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';