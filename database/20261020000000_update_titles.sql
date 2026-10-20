-- Apply to an existing deployment after its current migrations.
-- Preserve the selected update title throughout supervisor notifications.
BEGIN;

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
    NEW.title,
    NEW.message
  FROM public.profiles AS supervisor
  WHERE supervisor.role = 'supervisor'
  ON CONFLICT (recipient_id, notification_type, subject_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_supervisors_of_admin_notice() FROM PUBLIC;

-- Keep existing content, dates and read state; replace only the old generic heading.
UPDATE public.supervisor_notifications AS notification
SET title = notice.title
FROM public.system_notices AS notice
WHERE notification.notification_type = 'admin_notice'
  AND notification.subject_id = notice.id::TEXT
  AND notification.title = 'Admin published a notice';

-- The optional demo installer tracks routine definitions as part of its contract.
DO $$
BEGIN
  IF to_regclass('public.fye_contract_baseline') IS NOT NULL
     AND to_regprocedure('public.fye_contract_hash()') IS NOT NULL THEN
    EXECUTE 'INSERT INTO public.fye_contract_baseline(id, schema_hash)
      VALUES (true, public.fye_contract_hash())
      ON CONFLICT (id) DO UPDATE SET schema_hash = EXCLUDED.schema_hash';
  END IF;
END;
$$;

COMMIT;
NOTIFY pgrst, 'reload schema';
