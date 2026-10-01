CREATE TABLE IF NOT EXISTS public.supervisor_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('event_request', 'mentor_application', 'admin_notice')),
  subject_id TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  UNIQUE (recipient_id, notification_type, subject_id)
);

CREATE INDEX IF NOT EXISTS supervisor_notifications_inbox_idx
  ON public.supervisor_notifications(recipient_id, created_at DESC);

ALTER TABLE public.supervisor_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.supervisor_notifications TO authenticated;

DROP POLICY IF EXISTS "Supervisors read their own notifications"
  ON public.supervisor_notifications;
CREATE POLICY "Supervisors read their own notifications"
  ON public.supervisor_notifications FOR SELECT TO authenticated
  USING (
    recipient_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'supervisor'
    )
  );

CREATE OR REPLACE FUNCTION public.notify_supervisors_of_event_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.supervisor_notifications (
    recipient_id, notification_type, subject_id, title, message
  )
  SELECT
    supervisor.id,
    'event_request',
    NEW.id::TEXT,
    'New mentor event request',
    COALESCE(mentor.full_name, mentor.email, 'A mentor')
      || ' requested approval for “' || NEW.title || '”.'
  FROM public.profiles AS supervisor
  LEFT JOIN public.profiles AS mentor ON mentor.id = NEW.mentor_id
  WHERE supervisor.role = 'supervisor'
  ON CONFLICT (recipient_id, notification_type, subject_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_supervisors_of_event_request() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_supervisors_of_event_request ON public.event_requests;
CREATE TRIGGER notify_supervisors_of_event_request
  AFTER INSERT ON public.event_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_supervisors_of_event_request();

CREATE OR REPLACE FUNCTION public.notify_supervisors_of_mentor_application()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  applicant_name TEXT;
BEGIN
  IF NEW.status <> 'pending' OR (
    TG_OP = 'UPDATE'
    AND OLD.status = 'pending'
    AND OLD.is_legacy = NEW.is_legacy
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, email, 'A student') INTO applicant_name
  FROM public.profiles
  WHERE id = NEW.applicant_id;

  INSERT INTO public.supervisor_notifications (
    recipient_id, notification_type, subject_id, title, message
  )
  SELECT
    supervisor.id,
    'mentor_application',
    NEW.id::TEXT,
    'New mentor application',
    COALESCE(applicant_name, 'A student') || ' submitted a mentor application for review.'
  FROM public.profiles AS supervisor
  WHERE supervisor.role = 'supervisor'
  ON CONFLICT (recipient_id, notification_type, subject_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_supervisors_of_mentor_application() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_supervisors_of_mentor_application ON public.mentor_applications;
CREATE TRIGGER notify_supervisors_of_mentor_application
  AFTER INSERT OR UPDATE OF status, is_legacy ON public.mentor_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_supervisors_of_mentor_application();

CREATE OR REPLACE FUNCTION public.notify_supervisors_of_admin_notice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT NEW.is_active OR (
    TG_OP = 'UPDATE' AND OLD.is_active = true
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.supervisor_notifications (
    recipient_id, notification_type, subject_id, title, message
  )
  SELECT
    supervisor.id,
    'admin_notice',
    NEW.id::TEXT,
    'Admin published a notice',
    NEW.title || ': ' || NEW.message
  FROM public.profiles AS supervisor
  WHERE supervisor.role = 'supervisor'
  ON CONFLICT (recipient_id, notification_type, subject_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_supervisors_of_admin_notice() FROM PUBLIC;

DROP TRIGGER IF EXISTS notify_supervisors_of_admin_notice ON public.system_notices;
CREATE TRIGGER notify_supervisors_of_admin_notice
  AFTER INSERT OR UPDATE OF is_active ON public.system_notices
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_supervisors_of_admin_notice();

CREATE OR REPLACE FUNCTION public.mark_supervisor_notification_read(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;

  UPDATE public.supervisor_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_supervisor_notification_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_supervisor_notification_read(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';