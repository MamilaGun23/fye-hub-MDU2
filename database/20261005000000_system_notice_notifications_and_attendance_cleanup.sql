CREATE TABLE IF NOT EXISTS public.system_notice_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_notice_id BIGINT NOT NULL REFERENCES public.system_notices(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  UNIQUE (system_notice_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS system_notice_notifications_inbox_idx
  ON public.system_notice_notifications(recipient_id, scheduled_for DESC);

ALTER TABLE public.system_notice_notifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.system_notice_notifications TO authenticated;

DROP POLICY IF EXISTS "Users read their own system notice notifications"
  ON public.system_notice_notifications;
CREATE POLICY "Users read their own system notice notifications"
  ON public.system_notice_notifications FOR SELECT TO authenticated
  USING (recipient_id = auth.uid());

CREATE OR REPLACE FUNCTION public.create_system_notice_notifications()
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

  INSERT INTO public.system_notice_notifications (
    system_notice_id,
    recipient_id,
    title,
    message,
    scheduled_for
  )
  SELECT
    NEW.id,
    profile.id,
    NEW.title,
    NEW.message,
    NEW.starts_at
  FROM public.profiles AS profile
  WHERE profile.role IN ('student', 'mentor')
  ON CONFLICT (system_notice_id, recipient_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.create_system_notice_notifications() FROM PUBLIC;

DROP TRIGGER IF EXISTS create_system_notice_notifications ON public.system_notices;
CREATE TRIGGER create_system_notice_notifications
  AFTER INSERT OR UPDATE OF is_active ON public.system_notices
  FOR EACH ROW
  EXECUTE FUNCTION public.create_system_notice_notifications();

INSERT INTO public.system_notice_notifications (
  system_notice_id,
  recipient_id,
  title,
  message,
  scheduled_for
)
SELECT notice.id, profile.id, notice.title, notice.message, notice.starts_at
FROM public.system_notices AS notice
CROSS JOIN public.profiles AS profile
WHERE notice.is_active
  AND notice.starts_at <= now()
  AND (notice.ends_at IS NULL OR notice.ends_at > now())
  AND profile.role IN ('student', 'mentor')
ON CONFLICT (system_notice_id, recipient_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.mark_system_notice_notification_read(
  p_notification_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.system_notice_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_system_notice_notification_read(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_system_notice_notification_read(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.record_manual_event_attendance(BIGINT, UUID, TEXT);
DROP FUNCTION IF EXISTS public.record_manual_event_attendance(UUID, UUID, TEXT);

NOTIFY pgrst, 'reload schema';