-- Keep full-cohort directory reads within the API statement timeout.
BEGIN;
-- Check the viewer's role once per statement. CASE prevents the relationship
-- subquery from running for staff: OR-connected policies can otherwise evaluate
-- the assignment RLS and mentor authority helpers repeatedly for every profile.
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Supervisors can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can read related profiles" ON public.profiles;
CREATE POLICY "Users can read related profiles" ON public.profiles FOR SELECT TO authenticated USING(
 CASE
  WHEN (SELECT public.is_admin()) OR (SELECT public.fye_supervisor()) THEN true
  WHEN id=(SELECT auth.uid()) THEN true
  ELSE EXISTS(SELECT 1 FROM public.active_mentor_assignments a
   WHERE (a.student_id=(SELECT auth.uid()) AND a.mentor_id=profiles.id)
      OR (a.mentor_id=(SELECT auth.uid()) AND a.student_id=profiles.id))
 END);
DROP POLICY IF EXISTS "Supervisors can read all mentor assignments" ON public.mentor_assignments;
CREATE POLICY "Supervisors can read all mentor assignments" ON public.mentor_assignments FOR SELECT TO authenticated
 USING((SELECT public.fye_supervisor()));
DROP POLICY IF EXISTS "Participants can read mentor assignments" ON public.mentor_assignments;
CREATE POLICY "Participants can read mentor assignments" ON public.mentor_assignments FOR SELECT TO authenticated
 USING(student_id=(SELECT auth.uid()) OR mentor_id=(SELECT auth.uid()) OR assigned_by=(SELECT auth.uid()));
CREATE INDEX IF NOT EXISTS mentor_assignments_active_mentor ON public.mentor_assignments(mentor_id,student_id) WHERE ended_at IS NULL;
INSERT INTO public.fye_schema_versions(version) VALUES('dashboard-read-performance-v1') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.demo_seed_status() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('version',2,'academic_rules',EXISTS(SELECT 1 FROM fye_schema_versions WHERE version='academic-demo-v1'),'demo_isolation',true,'workflows',EXISTS(SELECT 1 FROM fye_schema_versions WHERE version='academic-demo-workflows-v1'),
 'directory_reads',EXISTS(SELECT 1 FROM fye_schema_versions WHERE version='dashboard-read-performance-v1'),
 'schema_intact',EXISTS(SELECT 1 FROM fye_contract_baseline WHERE schema_hash=fye_contract_hash()),
 'faculties',(SELECT jsonb_agg(jsonb_build_object('id',id::text,'name',name) ORDER BY id) FROM faculties),
 'programmes',(SELECT jsonb_agg(jsonb_build_object('id',id::text,'faculty_id',faculty_id::text,'name',name,'qualification_level',qualification_level,'max_study_year',max_study_year,'first_time_entry',first_time_entry) ORDER BY id) FROM programmes))
$$;
INSERT INTO public.fye_contract_baseline(id,schema_hash) VALUES(true,public.fye_contract_hash())
 ON CONFLICT(id) DO UPDATE SET schema_hash=EXCLUDED.schema_hash;
COMMIT;
NOTIFY pgrst,'reload schema';
