-- Run this SELECT in Supabase SQL Editor as postgres. It changes no data/schema.
-- Export the result as JSON or CSV to .demo-seed/audit-export.json (or .csv).
-- Keep the export private: it contains schema definitions and existing student numbers.
-- No passwords, Auth tokens or administrative keys are selected.
WITH table_metadata AS (
  SELECT n.nspname AS schema_name, c.relname AS table_name,
    c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', a.attname, 'type', format_type(a.atttypid,a.atttypmod),
      'nullable', NOT a.attnotnull, 'identity', a.attidentity,
      'default', pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum),'[]'::jsonb)
     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
     WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname),'[]'::jsonb)
     FROM pg_constraint WHERE conrelid=c.oid) AS constraints,
    (SELECT COALESCE(jsonb_agg(indexdef ORDER BY indexname),'[]'::jsonb)
     FROM pg_indexes WHERE schemaname=n.nspname AND tablename=c.relname) AS indexes
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','auth','storage')
    AND (n.nspname='public' OR c.relname IN ('users','objects','buckets'))
), triggers AS (
  SELECT n.nspname AS schema_name,c.relname AS table_name,t.tgname AS name,
    t.tgenabled AS enabled,pg_get_triggerdef(t.oid,true) AS definition,
    pg_get_functiondef(t.tgfoid) AS function_definition
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE NOT t.tgisinternal AND (n.nspname='public' OR (n.nspname='auth' AND c.relname='users'))
), routines AS (
  SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS result,p.prosecdef AS security_definer,
    p.proconfig AS configuration,pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind='f'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')
)
SELECT jsonb_build_object(
  'audit_version',1,
  'captured_at',now(),
  'academic_date',(now() AT TIME ZONE 'Africa/Johannesburg')::date,
  'database_name',current_database(),
  'faculties',(SELECT COALESCE(jsonb_agg(to_jsonb(f) || jsonb_build_object('id',f.id::text) ORDER BY f.id),'[]'::jsonb) FROM public.faculties f),
  'programmes',(SELECT COALESCE(jsonb_agg(to_jsonb(p) || jsonb_build_object('id',p.id::text,'faculty_id',p.faculty_id::text) ORDER BY p.id),'[]'::jsonb) FROM public.programmes p),
  'tables',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY schema_name,table_name),'[]'::jsonb) FROM table_metadata t),
  'triggers',(SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY schema_name,table_name,name),'[]'::jsonb) FROM triggers t),
  'routines',(SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY name,arguments),'[]'::jsonb) FROM routines r),
  'policies',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname),'[]'::jsonb)
    FROM pg_policies p WHERE schemaname IN ('public','storage')),
  'grants',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY table_schema,table_name,grantee,privilege_type),'[]'::jsonb)
    FROM information_schema.role_table_grants g WHERE table_schema IN ('public','storage')),
  'routine_grants',(SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY routine_name,grantee),'[]'::jsonb)
    FROM information_schema.role_routine_grants g WHERE routine_schema='public'),
  'profile_counts',(SELECT COALESCE(jsonb_agg(to_jsonb(c) || jsonb_build_object('faculty_id',c.faculty_id::text,'programme_id',c.programme_id::text)),'[]'::jsonb) FROM (
    SELECT faculty_id,programme_id,role,is_active,count(*) AS count FROM public.profiles
    GROUP BY faculty_id,programme_id,role,is_active ORDER BY faculty_id,programme_id,role,is_active) c),
  'existing_student_numbers',(SELECT COALESCE(jsonb_agg(student_number ORDER BY student_number),'[]'::jsonb)
    FROM public.profiles WHERE student_number IS NOT NULL),
  'existing_demo_emails',(SELECT COALESCE(jsonb_agg(lower(email) ORDER BY email),'[]'::jsonb)
    FROM auth.users WHERE lower(email) LIKE '%@example.test'),
  'auth_profile_summary',jsonb_build_object(
    'auth_accounts',(SELECT count(*) FROM auth.users),
    'profiles',(SELECT count(*) FROM public.profiles),
    'auth_without_profile',(SELECT count(*) FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE p.id IS NULL),
    'profiles_without_auth',(SELECT count(*) FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE u.id IS NULL)),
  'storage_buckets',(SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'public',public,
    'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) ORDER BY id),'[]'::jsonb) FROM storage.buckets),
  'scheduled_jobs_extension',(SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron'))
) AS audit;
