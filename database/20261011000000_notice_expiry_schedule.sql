-- Run in the Supabase SQL editor as the postgres database role.
-- Install the required extension before referring to its cron schema.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Run once per minute, even when no dashboards are open.
SELECT cron.schedule('fye-expire-university-updates','* * * * *','SELECT public.expire_system_notices();');
