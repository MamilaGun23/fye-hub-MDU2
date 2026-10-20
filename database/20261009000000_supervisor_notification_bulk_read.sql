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
