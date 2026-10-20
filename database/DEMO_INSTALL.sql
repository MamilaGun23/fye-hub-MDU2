-- Apply once in the EXISTING prototype Supabase SQL Editor as postgres.
-- Atomic installation; preserves existing users/history. Requires installed pg_cron.
BEGIN;

-- SOURCE: 20261019000000_academic_lifecycle.sql
-- Apply after 20261011000000. Preserves existing users, applications and matches.

CREATE TABLE IF NOT EXISTS public.fye_schema_versions(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.fye_schema_versions ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public.fye_contract_baseline(id boolean PRIMARY KEY DEFAULT true CHECK(id),schema_hash text NOT NULL);
ALTER TABLE public.fye_contract_baseline ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fye_schema_versions,public.fye_contract_baseline FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.fye_contract_hash() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT md5(coalesce(string_agg(k||':'||v,E'\n' ORDER BY k,v),'')) FROM (
  SELECT 'column:'||table_schema||'.'||table_name||'.'||ordinal_position AS k,
   column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'')||':'||is_identity AS v
  FROM information_schema.columns WHERE table_schema IN ('public','auth','storage')
  UNION ALL SELECT 'routine:'||p.oid::regprocedure::text,pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'
  UNION ALL SELECT 'policy:'||schemaname||'.'||tablename||'.'||policyname,coalesce(qual,'')||':'||coalesce(with_check,'')||':'||roles::text||':'||permissive||':'||cmd FROM pg_policies WHERE schemaname IN ('public','storage')
  UNION ALL SELECT 'trigger:'||t.tgrelid::regclass::text||'.'||t.tgname,pg_get_triggerdef(t.oid)||':'||t.tgenabled::text FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname IN ('public','auth','storage')
  UNION ALL SELECT 'constraint:'||c.conrelid::regclass::text||'.'||c.conname,pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname IN ('public','auth','storage')
  UNION ALL SELECT 'grant:'||p.oid::regprocedure::text,coalesce(p.proacl::text,'') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  UNION ALL SELECT 'relation:'||n.nspname||'.'||c.relname,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||CASE WHEN c.relkind='v' THEN pg_get_viewdef(c.oid) ELSE '' END FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','v')
  UNION ALL SELECT 'index:'||schemaname||'.'||indexname,indexdef FROM pg_indexes WHERE schemaname IN ('public','auth','storage')
 ) contract
$$;
REVOKE ALL ON FUNCTION public.fye_contract_hash() FROM PUBLIC;
ALTER TABLE public.programmes ADD COLUMN IF NOT EXISTS qualification_level text
  CHECK (qualification_level IN ('undergraduate','honours','postgraduate_diploma','masters','doctorate'));
ALTER TABLE public.programmes ADD COLUMN IF NOT EXISTS max_study_year smallint CHECK(max_study_year BETWEEN 1 AND 20);
ALTER TABLE public.programmes ADD COLUMN IF NOT EXISTS first_time_entry boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_entry_year smallint CHECK(first_entry_year BETWEEN 1900 AND 2200);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS entry_status text CHECK(entry_status IN ('first_time','returning'));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS academic_verified_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS academic_verified_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS language_preference text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_time_cohort_year integer;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_student_number_unique ON public.profiles(student_number) WHERE student_number IS NOT NULL AND btrim(student_number)<>'';

CREATE OR REPLACE FUNCTION public.fye_today() RETURNS date LANGUAGE sql STABLE
SET search_path=public AS $$ SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date $$;
CREATE OR REPLACE FUNCTION public.fye_cycle() RETURNS integer LANGUAGE sql STABLE
SET search_path=public AS $$ SELECT extract(year FROM fye_today())::int - CASE WHEN extract(month FROM fye_today())=1 THEN 1 ELSE 0 END $$;
CREATE OR REPLACE FUNCTION public.fye_window_open() RETURNS boolean LANGUAGE sql STABLE
SET search_path=public AS $$ SELECT extract(month FROM fye_today()) IN (10,11,12,1) $$;
CREATE OR REPLACE FUNCTION public.fye_supervisor() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND role='supervisor' AND is_active) $$;

CREATE TABLE IF NOT EXISTS public.mentor_appointments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mentor_id uuid NOT NULL REFERENCES public.profiles(id),
 application_id uuid, starts_at timestamptz NOT NULL, ended_at timestamptz,
 paused boolean NOT NULL DEFAULT false, pause_reason text, ended_reason text,
 approved_by uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mentor_appointment_open ON public.mentor_appointments(mentor_id) WHERE ended_at IS NULL;
ALTER TABLE public.mentor_appointments ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.mentor_appointments TO authenticated;
DROP POLICY IF EXISTS appointment_read ON public.mentor_appointments;
CREATE POLICY appointment_read ON public.mentor_appointments FOR SELECT TO authenticated
 USING(mentor_id=auth.uid() OR public.fye_supervisor() OR public.is_admin());
-- Preserve existing mentor access, but require academic verification for NEW matches.
INSERT INTO public.mentor_appointments(mentor_id,starts_at,paused,pause_reason)
 SELECT p.id,now(),true,'Verify academic details before assigning new students.' FROM public.profiles p
 WHERE NOT EXISTS(SELECT 1 FROM public.fye_schema_versions WHERE version='academic-bootstrap-v1') AND ((p.role='mentor' AND p.mentor_approval_status='approved') OR EXISTS(
  SELECT 1 FROM public.mentor_applications a WHERE a.applicant_id=p.id AND a.status='approved'))
 ON CONFLICT DO NOTHING;
INSERT INTO public.fye_schema_versions(version) VALUES('academic-bootstrap-v1') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mentor_programme_mappings(
 mentor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 programme_id bigint NOT NULL REFERENCES public.programmes(id),
 approved_by uuid NOT NULL REFERENCES public.profiles(id), approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(mentor_id,programme_id)
);
ALTER TABLE public.mentor_programme_mappings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.mentor_programme_mappings TO authenticated;
DROP POLICY IF EXISTS mapping_read ON public.mentor_programme_mappings;
CREATE POLICY mapping_read ON public.mentor_programme_mappings FOR SELECT TO authenticated USING(true);

ALTER TABLE public.mentor_assignments ADD COLUMN IF NOT EXISTS academic_year integer;
ALTER TABLE public.mentor_assignments ADD COLUMN IF NOT EXISTS effective_end_at timestamptz;
ALTER TABLE public.mentor_assignments ADD COLUMN IF NOT EXISTS end_reason text;
ALTER TABLE public.mentor_assignments ADD COLUMN IF NOT EXISTS needs_reassignment boolean NOT NULL DEFAULT false;
-- Unknown legacy academic years remain visible for review; no years are guessed.
CREATE OR REPLACE VIEW public.active_mentor_assignments WITH(security_invoker=true) AS
 SELECT * FROM public.mentor_assignments WHERE ended_at IS NULL AND (effective_end_at>now() OR academic_year IS NULL) AND assigned_at<=now()
 AND NOT public.mentor_application_is_approved(student_id);
GRANT SELECT ON public.active_mentor_assignments TO authenticated;

CREATE OR REPLACE FUNCTION public.mentor_application_is_approved(p_profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM mentor_appointments a JOIN profiles p ON p.id=a.mentor_id
  WHERE a.mentor_id=p_profile_id AND a.starts_at<=now() AND a.ended_at IS NULL AND p.is_active)
$$;
CREATE OR REPLACE FUNCTION public.current_user_is_mentor() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public AS $$ SELECT mentor_application_is_approved(auth.uid()) $$;
CREATE OR REPLACE FUNCTION public.fye_eligible_mentee(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM profiles p JOIN programmes q ON q.id=p.programme_id AND q.faculty_id=p.faculty_id
 WHERE p.id=p_id AND p.role='student' AND p.is_active AND q.qualification_level='undergraduate' AND q.first_time_entry
 AND p.study_year=1 AND p.entry_status='first_time' AND p.first_entry_year=extract(year FROM fye_today())
 AND p.academic_verified_at IS NOT NULL AND NOT mentor_application_is_approved(p.id))
$$;
CREATE OR REPLACE FUNCTION public.fye_mentor_matches(p_mentor uuid,p_programme bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM profiles m JOIN programmes mq ON mq.id=m.programme_id
 JOIN programmes target ON target.id=p_programme AND target.faculty_id=m.faculty_id
 JOIN mentor_appointments a ON a.mentor_id=m.id AND a.ended_at IS NULL AND a.starts_at<=now() AND NOT a.paused
 WHERE m.id=p_mentor AND m.is_active AND m.academic_verified_at IS NOT NULL
 AND target.qualification_level='undergraduate' AND target.first_time_entry
 AND ((mq.qualification_level='undergraduate' AND m.programme_id=p_programme)
 OR (mq.qualification_level<>'undergraduate' AND EXISTS(SELECT 1 FROM mentor_programme_mappings x WHERE x.mentor_id=m.id AND x.programme_id=p_programme))))
$$;

CREATE OR REPLACE FUNCTION public.guard_academic_profile() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_user IN ('authenticated','anon','authenticator') THEN
  IF TG_OP='INSERT' OR NEW.role IS DISTINCT FROM OLD.role OR NEW.mentor_approval_status IS DISTINCT FROM OLD.mentor_approval_status
    OR NEW.is_active IS DISTINCT FROM OLD.is_active OR NEW.academic_verified_at IS DISTINCT FROM OLD.academic_verified_at
    OR NEW.academic_verified_by IS DISTINCT FROM OLD.academic_verified_by THEN
   RAISE EXCEPTION 'Use the authorised account or academic verification workflow.';
  END IF;
 END IF;
 IF TG_OP='UPDATE' AND current_user IN ('authenticated','anon','authenticator') AND NEW.first_time_cohort_year IS DISTINCT FROM OLD.first_time_cohort_year
 THEN RAISE EXCEPTION 'First-time cohort history is protected.'; END IF;
 IF NEW.entry_status='first_time' THEN NEW.first_time_cohort_year:=NEW.first_entry_year; END IF;
 IF TG_OP='UPDATE' AND (NEW.programme_id IS DISTINCT FROM OLD.programme_id OR NEW.faculty_id IS DISTINCT FROM OLD.faculty_id
 OR NEW.study_year IS DISTINCT FROM OLD.study_year OR NEW.student_number IS DISTINCT FROM OLD.student_number OR NEW.first_entry_year IS DISTINCT FROM OLD.first_entry_year OR NEW.entry_status IS DISTINCT FROM OLD.entry_status) THEN
  NEW.academic_verified_at:=NULL; NEW.academic_verified_by:=NULL;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS academic_profile_guard ON public.profiles;
CREATE TRIGGER academic_profile_guard BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_academic_profile();
CREATE OR REPLACE FUNCTION public.flag_changed_mentor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF (NEW.programme_id IS DISTINCT FROM OLD.programme_id OR NEW.faculty_id IS DISTINCT FROM OLD.faculty_id OR NOT NEW.is_active
 OR (OLD.academic_verified_at IS NOT NULL AND NEW.academic_verified_at IS NULL)) THEN
  UPDATE mentor_appointments SET paused=true,pause_reason='Academic details or account eligibility changed.' WHERE mentor_id=NEW.id AND ended_at IS NULL;
  UPDATE mentor_assignments SET needs_reassignment=true WHERE mentor_id=NEW.id AND ended_at IS NULL;
  UPDATE mentor_applications SET results_verified_at=NULL,results_verified_by=NULL,
    replacement_review_required=(status='approved'),updated_at=now()
    WHERE applicant_id=NEW.id AND status IN ('pending','shortlisted','approved') AND results_verified_at IS NOT NULL;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS flag_changed_mentor ON public.profiles;
CREATE TRIGGER flag_changed_mentor AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.flag_changed_mentor();

CREATE OR REPLACE FUNCTION public.declare_academic_details(p_first_entry_year integer,p_entry_status text,p_study_year smallint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_first_entry_year IS NULL OR p_first_entry_year NOT BETWEEN 1900 AND extract(year FROM fye_today())
 OR p_entry_status IS NULL OR p_entry_status NOT IN ('first_time','returning') OR p_study_year IS NULL OR p_study_year<1 THEN
 RAISE EXCEPTION 'Provide valid entry year, study year and previous-university-study status.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles p JOIN programmes q ON q.id=p.programme_id AND q.faculty_id=p.faculty_id
 WHERE p.id=auth.uid() AND p.is_active AND p.role IN ('student','mentor') AND p_study_year<=q.max_study_year
 AND (p_entry_status<>'first_time' OR (q.qualification_level='undergraduate' AND q.first_time_entry AND p_study_year=1 AND p_first_entry_year=extract(year FROM fye_today()))))
 THEN RAISE EXCEPTION 'Academic details do not match the programme qualification.'; END IF;
 UPDATE profiles SET first_entry_year=p_first_entry_year,entry_status=p_entry_status,study_year=p_study_year WHERE id=auth.uid();
END $$;
CREATE OR REPLACE FUNCTION public.verify_academic_details(p_profile_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT fye_supervisor() THEN RAISE EXCEPTION 'Active supervisor access required.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles p JOIN programmes q ON q.id=p.programme_id AND q.faculty_id=p.faculty_id
 WHERE p.id=p_profile_id AND p.is_active AND p.first_entry_year BETWEEN 1900 AND extract(year FROM fye_today())
 AND p.entry_status IN ('first_time','returning') AND p.study_year BETWEEN 1 AND q.max_study_year AND q.qualification_level IS NOT NULL
 AND (p.entry_status<>'first_time' OR (q.qualification_level='undergraduate' AND q.first_time_entry AND p.study_year=1 AND p.first_entry_year=extract(year FROM fye_today()))))
 THEN RAISE EXCEPTION 'Complete valid academic details before verifying.'; END IF;
 UPDATE profiles SET academic_verified_at=now(),academic_verified_by=auth.uid() WHERE id=p_profile_id;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_academic_assignment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s profiles%ROWTYPE; m profiles%ROWTYPE; y int:=extract(year FROM fye_today());
BEGIN
 IF TG_OP='UPDATE' AND NEW.ended_at IS NOT NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.academic_year IS NULL AND NEW.academic_year IS NOT NULL AND fye_supervisor()
 AND NEW.student_id=OLD.student_id AND NEW.mentor_id=OLD.mentor_id AND NEW.assigned_at=OLD.assigned_at
 AND NEW.effective_end_at=make_timestamptz(NEW.academic_year+1,1,1,0,0,0,'Africa/Johannesburg') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.student_id=OLD.student_id AND NEW.mentor_id=OLD.mentor_id
 AND NEW.academic_year IS NOT DISTINCT FROM OLD.academic_year AND NEW.effective_end_at IS NOT DISTINCT FROM OLD.effective_end_at
 AND NEW.assigned_at=OLD.assigned_at THEN RETURN NEW; END IF;
 SELECT * INTO m FROM profiles WHERE id=NEW.mentor_id FOR UPDATE;
 SELECT * INTO s FROM profiles WHERE id=NEW.student_id FOR UPDATE;
 IF NOT fye_eligible_mentee(NEW.student_id) OR NOT fye_mentor_matches(NEW.mentor_id,s.programme_id)
 OR s.faculty_id IS DISTINCT FROM m.faculty_id THEN RAISE EXCEPTION 'Only verified first-time undergraduate students and eligible same-faculty mentors can be matched.'; END IF;
 NEW.academic_year:=y; NEW.assigned_at:=now();
 NEW.effective_end_at:=make_timestamptz(y+1,1,1,0,0,0,'Africa/Johannesburg');
 NEW.assigned_by:=coalesce(NEW.assigned_by,auth.uid());
 UPDATE mentor_assignments SET ended_at=effective_end_at,end_reason='Academic year ended.'
 WHERE student_id=NEW.student_id AND ended_at IS NULL AND effective_end_at<=now();
 IF EXISTS(SELECT 1 FROM mentor_assignments WHERE student_id=NEW.student_id AND ended_at IS NULL
 AND (TG_OP='INSERT' OR id<>NEW.id)) THEN RAISE EXCEPTION 'Student already has an active or unreviewed legacy assignment.'; END IF;
 IF (SELECT count(*) FROM mentor_assignments WHERE mentor_id=NEW.mentor_id AND ended_at IS NULL
 AND (effective_end_at>now() OR effective_end_at IS NULL) AND (TG_OP='INSERT' OR id<>NEW.id))>=20
 THEN RAISE EXCEPTION 'Mentor capacity is 20 students in total.'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS mentor_assignments_require_approval ON public.mentor_assignments;
DROP TRIGGER IF EXISTS mentor_assignments_require_approved_mentor_insert ON public.mentor_assignments;
DROP TRIGGER IF EXISTS mentor_assignments_require_approved_mentor_update ON public.mentor_assignments;
DROP TRIGGER IF EXISTS academic_assignment_guard ON public.mentor_assignments;
CREATE TRIGGER academic_assignment_guard BEFORE INSERT OR UPDATE ON public.mentor_assignments FOR EACH ROW EXECUTE FUNCTION public.enforce_academic_assignment();

CREATE OR REPLACE FUNCTION public.assign_students_to_mentor(p_mentor_id uuid,p_student_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s uuid;
BEGIN
 IF NOT fye_supervisor() THEN RAISE EXCEPTION 'Active supervisor access required.'; END IF;
 IF coalesce(cardinality(p_student_ids),0)=0 THEN RAISE EXCEPTION 'Select students.'; END IF;
 FOR s IN SELECT DISTINCT unnest(p_student_ids) ORDER BY 1 LOOP
 INSERT INTO mentor_assignments(student_id,mentor_id,assigned_by) VALUES(s,p_mentor_id,auth.uid()); END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.assign_students_evenly(p_faculty_id bigint,p_programme_id bigint,p_student_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s uuid; m uuid;
BEGIN
 IF NOT fye_supervisor() THEN RAISE EXCEPTION 'Active supervisor access required.'; END IF;
 IF coalesce(cardinality(p_student_ids),0)=0 THEN RAISE EXCEPTION 'Select students.'; END IF;
 FOR s IN SELECT DISTINCT unnest(p_student_ids) ORDER BY 1 LOOP
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=s AND faculty_id=p_faculty_id AND programme_id=p_programme_id)
  THEN RAISE EXCEPTION 'Student is outside the selected programme.'; END IF;
  SELECT p.id INTO m FROM profiles p WHERE fye_mentor_matches(p.id,p_programme_id)
  AND (SELECT count(*) FROM mentor_assignments a WHERE a.mentor_id=p.id AND a.ended_at IS NULL AND (a.effective_end_at>now() OR a.effective_end_at IS NULL))<20
  ORDER BY (SELECT count(*) FROM active_mentor_assignments a WHERE a.mentor_id=p.id),p.id FOR UPDATE OF p LIMIT 1;
  IF m IS NULL THEN RAISE EXCEPTION 'Insufficient mentor capacity.'; END IF;
  INSERT INTO mentor_assignments(student_id,mentor_id,assigned_by) VALUES(s,m,auth.uid());
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.has_active_mentor_assignment(p_mentor_id uuid,p_student_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM active_mentor_assignments a JOIN profiles m ON m.id=a.mentor_id JOIN profiles s ON s.id=a.student_id
 WHERE a.mentor_id=p_mentor_id AND a.student_id=p_student_id AND m.is_active AND s.is_active AND mentor_application_is_approved(m.id))
$$;

ALTER TABLE public.mentor_applications DROP CONSTRAINT IF EXISTS mentor_applications_applicant_id_key;
DROP INDEX IF EXISTS public.mentor_applications_student_number_uidx;
ALTER TABLE public.mentor_applications DROP CONSTRAINT IF EXISTS mentor_applications_study_year_check;
ALTER TABLE public.mentor_applications ADD CONSTRAINT mentor_applications_study_year_check CHECK(study_year IS NULL OR study_year>=1);
ALTER TABLE public.mentor_applications DROP CONSTRAINT IF EXISTS mentor_applications_status_check;
ALTER TABLE public.mentor_applications ADD CONSTRAINT mentor_applications_status_check CHECK(status IN ('draft','pending','shortlisted','approved','declined','withdrawn','closed'));
ALTER TABLE public.mentor_applications ADD COLUMN IF NOT EXISTS cycle_year integer;
ALTER TABLE public.mentor_applications ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE public.mentor_applications ADD COLUMN IF NOT EXISTS cohort_snapshot jsonb;
ALTER TABLE public.mentor_applications ADD COLUMN IF NOT EXISTS registration_record_path text;
ALTER TABLE public.mentor_applications ADD COLUMN IF NOT EXISTS results_verified_at timestamptz;
ALTER TABLE public.mentor_applications ADD COLUMN IF NOT EXISTS results_verified_by uuid REFERENCES public.profiles(id);
ALTER TABLE public.mentor_applications ADD COLUMN IF NOT EXISTS results_year integer;
ALTER TABLE public.mentor_applications ADD COLUMN IF NOT EXISTS progression_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE public.mentor_applications ADD COLUMN IF NOT EXISTS supplementary_pending boolean NOT NULL DEFAULT false;
ALTER TABLE public.mentor_applications ADD COLUMN IF NOT EXISTS registration_year integer;
ALTER TABLE public.mentor_applications ADD COLUMN IF NOT EXISTS completion_extension timestamptz;
ALTER TABLE public.mentor_applications ADD COLUMN IF NOT EXISTS replacement_review_required boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS mentor_application_cycle_unique ON public.mentor_applications(applicant_id,cycle_year) WHERE cycle_year IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.mentor_application_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, application_id uuid NOT NULL REFERENCES public.mentor_applications(id) ON DELETE CASCADE,
 actor_id uuid, action text NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mentor_application_history ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.mentor_application_history TO authenticated;
DROP POLICY IF EXISTS application_history_read ON public.mentor_application_history;
CREATE POLICY application_history_read ON public.mentor_application_history FOR SELECT TO authenticated
USING(fye_supervisor() OR EXISTS(SELECT 1 FROM mentor_applications a WHERE a.id=application_id AND a.applicant_id=auth.uid()));
CREATE OR REPLACE FUNCTION public.record_application_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO mentor_application_history(application_id,actor_id,action,snapshot)
 VALUES(NEW.id,auth.uid(),CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,to_jsonb(NEW)); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS application_history ON public.mentor_applications;
CREATE TRIGGER application_history AFTER INSERT OR UPDATE ON public.mentor_applications FOR EACH ROW EXECUTE FUNCTION public.record_application_history();
CREATE OR REPLACE FUNCTION public.require_active_mentor_applicant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=NEW.applicant_id AND is_active AND role IN ('student','mentor'))
 THEN RAISE EXCEPTION 'An active student account is required.'; END IF; RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fye_check_document(p_path text,p_owner uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_path IS NULL OR split_part(p_path,'/',1)<>p_owner::text OR p_path !~ '\.pdf$' OR p_path ~ '(^|/)\.\.?(/|$)'
 OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='mentor-academic-records' AND name=p_path)
 THEN RAISE EXCEPTION 'Upload your own PDF academic or registration record.'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.save_mentor_application(p_details jsonb,p_submit boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p profiles%ROWTYPE; q programmes%ROWTYPE; a mentor_applications%ROWTYPE; result uuid; cy int:=fye_cycle(); first_app boolean;
BEGIN
 IF p_submit IS NULL OR p_details IS NULL THEN RAISE EXCEPTION 'Provide application details.'; END IF;
 SELECT * INTO p FROM profiles WHERE id=auth.uid() AND is_active AND role IN ('student','mentor') FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p.id AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'Verify your email and sign in as an active student.'; END IF;
 IF NOT fye_window_open() THEN RAISE EXCEPTION 'New applications open October 1 through January 31.'; END IF;
 IF EXISTS(SELECT 1 FROM mentor_appointments WHERE mentor_id=p.id AND ended_at IS NULL) THEN RAISE EXCEPTION 'An open mentor appointment already exists; no annual reapplication is needed.'; END IF;
 SELECT * INTO q FROM programmes WHERE id=p.programme_id AND faculty_id=p.faculty_id;
 IF q.qualification_level IS NULL OR p.first_entry_year IS NULL OR p.entry_status IS NULL OR p.study_year NOT BETWEEN 1 AND q.max_study_year
 THEN RAISE EXCEPTION 'Complete your academic details first.'; END IF;
 first_app:=coalesce(p.first_time_cohort_year=cy,false) OR p.entry_status='first_time';
 IF first_app AND (p.first_entry_year<>cy OR q.qualification_level<>'undergraduate' OR NOT q.first_time_entry)
 THEN RAISE EXCEPTION 'New January entrants wait until October.'; END IF;
 SELECT * INTO a FROM mentor_applications WHERE applicant_id=p.id AND cycle_year=cy FOR UPDATE;
 IF a.id IS NOT NULL AND a.status NOT IN ('draft','declined') THEN RAISE EXCEPTION 'Submitted answers are locked. Use results completion or withdrawal.'; END IF;
 IF p_submit THEN
  IF p.student_number IS NULL OR nullif(btrim(p_details->>'school'),'') IS NULL THEN RAISE EXCEPTION 'Student number and school are required.'; END IF;
  IF NOT first_app THEN
   PERFORM fye_check_document(p_details->>'academic_record_path',p.id);
   PERFORM fye_check_document(p_details->>'registration_record_path',p.id);
   IF nullif(p_details->>'results_year','') IS NULL THEN RAISE EXCEPTION 'Provide the academic results year.'; END IF;
  ELSIF nullif(p_details->>'academic_record_path','') IS NOT NULL THEN PERFORM fye_check_document(p_details->>'academic_record_path',p.id); END IF;
 END IF;
 IF nullif(p_details->>'results_year','') IS NOT NULL AND (p_details->>'results_year')::int NOT BETWEEN 1900 AND extract(year FROM fye_today())
 THEN RAISE EXCEPTION 'Choose a valid academic results year.'; END IF;
 INSERT INTO mentor_applications(id,applicant_id,student_number,study_year,school,previous_academic_year,academic_record_path,
 registration_record_path,results_year,status,cycle_year,submitted_at,cohort_snapshot,is_legacy,review_reason)
 VALUES(coalesce(a.id,gen_random_uuid()),p.id,p.student_number,p.study_year,p_details->>'school',p_details->>'previous_academic_year',
 nullif(p_details->>'academic_record_path',''),nullif(p_details->>'registration_record_path',''),nullif(p_details->>'results_year','')::integer,CASE WHEN p_submit THEN 'pending' ELSE 'draft' END,cy,
 CASE WHEN p_submit THEN coalesce(a.submitted_at,now()) ELSE NULL END,
 coalesce(a.cohort_snapshot,jsonb_build_object('first_time',first_app,'first_entry_year',p.first_entry_year,'qualification_level',q.qualification_level,'programme_id',p.programme_id)),false,NULL)
 ON CONFLICT(id) DO UPDATE SET school=EXCLUDED.school,previous_academic_year=EXCLUDED.previous_academic_year,
 academic_record_path=EXCLUDED.academic_record_path,registration_record_path=EXCLUDED.registration_record_path,results_year=EXCLUDED.results_year,status=EXCLUDED.status,
 submitted_at=EXCLUDED.submitted_at,results_verified_at=NULL,results_verified_by=NULL,review_reason=NULL,updated_at=now()
 RETURNING id INTO result;
 RETURN result;
END $$;
-- Keep old callers safe while clients upgrade; all paths use the cycle-aware RPC.
CREATE OR REPLACE FUNCTION public.submit_mentor_application(p_student_number text,p_study_year smallint,p_previous_academic_year text,p_academic_record_path text,p_school text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT save_mentor_application(jsonb_build_object('school',p_school,'previous_academic_year',p_previous_academic_year,'academic_record_path',p_academic_record_path),true)
$$;
CREATE OR REPLACE FUNCTION public.submit_mentor_application(p_student_number text,p_study_year smallint,p_previous_academic_year text,p_academic_record_path text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 SELECT save_mentor_application(jsonb_build_object('school',(SELECT school FROM profiles WHERE id=auth.uid()),'previous_academic_year',p_previous_academic_year,'academic_record_path',p_academic_record_path),true)
$$;
CREATE OR REPLACE FUNCTION public.complete_mentor_documents(p_application_id uuid,p_academic_path text,p_registration_path text,p_results_year integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a mentor_applications%ROWTYPE; deadline timestamptz;
BEGIN
 SELECT * INTO a FROM mentor_applications WHERE id=p_application_id AND applicant_id=auth.uid() AND submitted_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND OR a.status NOT IN ('pending','shortlisted','approved') THEN RAISE EXCEPTION 'Choose your submitted application.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND is_active) THEN RAISE EXCEPTION 'Active account required.'; END IF;
 deadline:=coalesce(a.completion_extension,make_timestamptz(a.cycle_year+1,4,1,0,0,0,'Africa/Johannesburg'));
 IF a.status<>'approved' AND now()>=deadline THEN RAISE EXCEPTION 'The results completion deadline passed; request a supervisor extension.'; END IF;
 PERFORM fye_check_document(p_academic_path,a.applicant_id); PERFORM fye_check_document(p_registration_path,a.applicant_id);
 IF p_results_year IS NULL OR p_results_year NOT BETWEEN 1900 AND extract(year FROM fye_today()) THEN RAISE EXCEPTION 'Select the results academic year.'; END IF;
 UPDATE mentor_applications SET academic_record_path=p_academic_path,registration_record_path=p_registration_path,results_year=p_results_year,
 results_verified_at=NULL,results_verified_by=NULL,progression_confirmed=false,registration_year=NULL,replacement_review_required=(status='approved'),updated_at=now() WHERE id=a.id;
 IF a.status='approved' THEN UPDATE mentor_appointments SET paused=true,pause_reason='Replacement academic evidence requires review.' WHERE application_id=a.id AND ended_at IS NULL; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.verify_mentor_documents(p_application_id uuid,p_progression boolean,p_supplementary_pending boolean,p_registration_year integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a mentor_applications%ROWTYPE;
BEGIN
 IF NOT fye_supervisor() THEN RAISE EXCEPTION 'Active supervisor access required.'; END IF;
 SELECT * INTO a FROM mentor_applications WHERE id=p_application_id FOR UPDATE;
 IF a.status NOT IN ('pending','shortlisted','approved') OR a.cycle_year IS NULL OR a.results_year IS NULL
 THEN RAISE EXCEPTION 'A submitted application and results year are required.'; END IF;
 PERFORM fye_check_document(a.academic_record_path,a.applicant_id); PERFORM fye_check_document(a.registration_record_path,a.applicant_id);
 IF p_registration_year IS DISTINCT FROM a.cycle_year+1 THEN RAISE EXCEPTION 'Verify registration for the appointment academic year.'; END IF;
 IF coalesce((a.cohort_snapshot->>'first_time')::boolean,false) AND a.results_year<>a.cycle_year
 THEN RAISE EXCEPTION 'Verify final results for the first-year academic year.'; END IF;
 UPDATE mentor_applications SET results_verified_at=now(),results_verified_by=auth.uid(),progression_confirmed=coalesce(p_progression,false),
 supplementary_pending=coalesce(p_supplementary_pending,true),registration_year=p_registration_year,replacement_review_required=false,updated_at=now() WHERE id=a.id;
 IF a.status='approved' AND NOT coalesce(p_supplementary_pending,true) AND (NOT coalesce((a.cohort_snapshot->>'first_time')::boolean,false) OR p_progression)
 AND EXISTS(SELECT 1 FROM profiles WHERE id=a.applicant_id AND academic_verified_at IS NOT NULL AND is_active) THEN
 UPDATE mentor_appointments SET paused=false,pause_reason=NULL WHERE application_id=a.id AND ended_at IS NULL; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.extend_mentor_completion(p_application_id uuid,p_deadline timestamptz,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT fye_supervisor() THEN RAISE EXCEPTION 'Active supervisor access required.'; END IF;
 IF p_deadline IS NULL OR p_deadline<=now() OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Choose a future deadline and record the reason.'; END IF;
 UPDATE mentor_applications SET completion_extension=p_deadline,review_reason=btrim(p_reason),status=CASE WHEN status='closed' THEN 'pending' ELSE status END,updated_at=now()
 WHERE id=p_application_id AND submitted_at IS NOT NULL AND status IN ('pending','shortlisted','closed');
 IF NOT FOUND THEN RAISE EXCEPTION 'Application cannot receive an extension.'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.withdraw_mentor_application(p_application_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE mentor_applications SET status='withdrawn',updated_at=now() WHERE id=p_application_id AND applicant_id=auth.uid() AND status IN ('draft','pending','shortlisted');
 IF NOT FOUND THEN RAISE EXCEPTION 'Application cannot be withdrawn.'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.review_mentor_application(p_application_id uuid,p_decision text,p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a mentor_applications%ROWTYPE;
BEGIN
 IF NOT fye_supervisor() THEN RAISE EXCEPTION 'Active supervisor access required.'; END IF;
 SELECT * INTO a FROM mentor_applications WHERE id=p_application_id FOR UPDATE;
 IF NOT ((a.status='pending' AND p_decision IN ('shortlisted','declined')) OR (a.status='shortlisted' AND p_decision IN ('approved','declined')))
 THEN RAISE EXCEPTION 'Application is no longer at that review stage.'; END IF;
 IF p_decision='declined' AND nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A decline reason is required.'; END IF;
 IF p_decision='approved' THEN
  IF a.cycle_year IS NULL OR a.submitted_at IS NULL OR a.results_verified_at IS NULL OR a.registration_year IS DISTINCT FROM a.cycle_year+1
  OR a.supplementary_pending OR a.replacement_review_required OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=a.applicant_id AND is_active AND academic_verified_at IS NOT NULL)
  THEN RAISE EXCEPTION 'Verify academic details, published results and new-year registration before approval.'; END IF;
  IF coalesce((a.cohort_snapshot->>'first_time')::boolean,false) AND (fye_today()<make_date(a.cycle_year+1,1,1) OR NOT a.progression_confirmed OR a.results_year<>a.cycle_year)
  THEN RAISE EXCEPTION 'First-year applicants need verified progression in the following year.'; END IF;
  INSERT INTO mentor_appointments(mentor_id,application_id,starts_at,approved_by)
  VALUES(a.applicant_id,a.id,greatest(now(),make_timestamptz(a.cycle_year+1,1,1,0,0,0,'Africa/Johannesburg')),auth.uid());
 END IF;
 UPDATE mentor_applications SET status=p_decision,review_reason=nullif(btrim(p_reason),''),reviewed_at=now(),reviewed_by=auth.uid(),updated_at=now() WHERE id=a.id;
 IF p_decision='approved' THEN PERFORM reconcile_academic_lifecycle(); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.manage_mentor_appointment(p_mentor_id uuid,p_action text,p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT fye_supervisor() THEN RAISE EXCEPTION 'Active supervisor access required.'; END IF;
 IF p_action IS NULL OR p_action NOT IN ('pause','resume','end') OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Select an action and record the reason.'; END IF;
 IF p_action='resume' AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_mentor_id AND is_active AND academic_verified_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Verify current academic eligibility before resuming.'; END IF;
 UPDATE mentor_appointments SET paused=(p_action<>'resume'),pause_reason=CASE WHEN p_action='resume' THEN NULL ELSE p_reason END,
 ended_at=CASE WHEN p_action='end' THEN now() ELSE ended_at END,ended_reason=CASE WHEN p_action='end' THEN p_reason ELSE ended_reason END
 WHERE mentor_id=p_mentor_id AND ended_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'No open appointment found.'; END IF;
 IF p_action IN ('pause','end') THEN UPDATE mentor_assignments SET needs_reassignment=true WHERE mentor_id=p_mentor_id AND ended_at IS NULL; END IF;
 IF p_action='end' THEN UPDATE profiles SET role='student' WHERE id=p_mentor_id AND role='mentor'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.map_postgraduate_mentor(p_mentor_id uuid,p_programme_id bigint,p_remove boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT fye_supervisor() THEN RAISE EXCEPTION 'Active supervisor access required.'; END IF;
 IF p_remove THEN
 DELETE FROM mentor_programme_mappings WHERE mentor_id=p_mentor_id AND programme_id=p_programme_id;
 UPDATE mentor_assignments a SET needs_reassignment=true FROM profiles s WHERE a.student_id=s.id AND s.programme_id=p_programme_id AND a.mentor_id=p_mentor_id AND a.ended_at IS NULL;
 RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles p JOIN programmes own ON own.id=p.programme_id JOIN programmes target ON target.id=p_programme_id
 WHERE p.id=p_mentor_id AND own.qualification_level<>'undergraduate' AND target.qualification_level='undergraduate'
 AND p.faculty_id=target.faculty_id AND mentor_application_is_approved(p.id)) THEN RAISE EXCEPTION 'Map an active postgraduate mentor to an undergraduate programme in the same faculty.'; END IF;
 INSERT INTO mentor_programme_mappings(mentor_id,programme_id,approved_by) VALUES(p_mentor_id,p_programme_id,auth.uid())
 ON CONFLICT(mentor_id,programme_id) DO UPDATE SET approved_by=EXCLUDED.approved_by,approved_at=now();
END $$;
CREATE OR REPLACE FUNCTION public.review_legacy_assignment_year(p_assignment_id bigint,p_year integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT fye_supervisor() OR p_year IS NULL OR p_year NOT BETWEEN 2000 AND extract(year FROM fye_today()) THEN RAISE EXCEPTION 'Supervisor and a valid reviewed year required.'; END IF;
 -- A reviewed legacy backfill is an audit operation, not a new match.
 UPDATE mentor_assignments SET academic_year=p_year,effective_end_at=make_timestamptz(p_year+1,1,1,0,0,0,'Africa/Johannesburg'),
 ended_at=CASE WHEN p_year<extract(year FROM fye_today()) THEN make_timestamptz(p_year+1,1,1,0,0,0,'Africa/Johannesburg') ELSE ended_at END,
 needs_reassignment=NOT fye_eligible_mentee(student_id),
 end_reason=CASE WHEN p_year<extract(year FROM fye_today()) THEN 'Academic year ended; legacy year verified by supervisor.' ELSE end_reason END
 WHERE id=p_assignment_id AND academic_year IS NULL;
END $$;
CREATE OR REPLACE FUNCTION public.reconcile_academic_lifecycle() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NOT NULL AND NOT fye_supervisor() AND NOT is_admin() THEN RAISE EXCEPTION 'Supervisor or admin access required.'; END IF;
 UPDATE mentor_assignments SET ended_at=effective_end_at,end_reason='Academic year ended.' WHERE ended_at IS NULL AND effective_end_at<=now();
 UPDATE mentor_assignments a SET ended_at=greatest(a.assigned_at,m.starts_at),end_reason='Mentor appointment activated.'
 FROM mentor_appointments m WHERE m.mentor_id=a.student_id AND m.starts_at<=now() AND m.ended_at IS NULL AND a.ended_at IS NULL;
 UPDATE profiles p SET role='mentor' WHERE p.role='student' AND EXISTS(SELECT 1 FROM mentor_appointments m WHERE m.mentor_id=p.id AND m.starts_at<=now() AND m.ended_at IS NULL);
 UPDATE mentor_applications SET status='closed',review_reason='Results completion deadline passed.',updated_at=now()
 WHERE status IN ('pending','shortlisted') AND cycle_year IS NOT NULL AND (results_verified_at IS NULL OR supplementary_pending)
 AND now()>=coalesce(completion_extension,make_timestamptz(cycle_year+1,4,1,0,0,0,'Africa/Johannesburg'));
END $$;

-- Document access includes retained versions; applicants cannot delete evidence used in history.
DROP POLICY IF EXISTS "Applicants and supervisors read submitted academic records" ON storage.objects;
CREATE POLICY "Applicants and supervisors read submitted academic records" ON storage.objects FOR SELECT TO authenticated USING(
 bucket_id='mentor-academic-records' AND (public.fye_supervisor() OR (storage.foldername(name))[1]=auth.uid()::text));
DROP POLICY IF EXISTS "Applicants delete own mentor academic records" ON storage.objects;
CREATE POLICY "Applicants delete own mentor academic records" ON storage.objects FOR DELETE TO authenticated USING(
 bucket_id='mentor-academic-records' AND (storage.foldername(name))[1]=auth.uid()::text AND NOT EXISTS(
 SELECT 1 FROM public.mentor_application_history h WHERE h.snapshot->>'academic_record_path'=name OR h.snapshot->>'registration_record_path'=name));

-- All new mutating RPCs require explicit grants. Internal trigger/check helpers are private.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN ('fye_today','fye_cycle','fye_window_open','fye_supervisor','fye_eligible_mentee','fye_mentor_matches',
 'declare_academic_details','verify_academic_details','save_mentor_application','complete_mentor_documents','verify_mentor_documents',
 'extend_mentor_completion','withdraw_mentor_application','manage_mentor_appointment','map_postgraduate_mentor','review_legacy_assignment_year','reconcile_academic_lifecycle') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',r.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated,service_role',r.signature);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.fye_check_document(text,uuid),public.enforce_academic_assignment(),public.guard_academic_profile(),public.flag_changed_mentor(),public.record_application_history() FROM PUBLIC;




-- SOURCE: 20261019010000_demo_cohort_and_seeding.sql
-- Marked prototype data; all seed/cleanup RPCs below are service-role only.

CREATE TABLE IF NOT EXISTS public.fye_demo_batches(
 id text PRIMARY KEY CHECK(id ~ '^[a-z0-9][a-z0-9-]{2,39}$'),plan_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'loading'
);
CREATE TABLE IF NOT EXISTS public.fye_demo_records(
 batch_id text NOT NULL REFERENCES public.fye_demo_batches(id),table_name text NOT NULL,record_id text NOT NULL,
 seed_key text,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(batch_id,table_name,record_id)
);
ALTER TABLE public.fye_demo_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fye_demo_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fye_demo_batches,public.fye_demo_records FROM anon,authenticated;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS demo_batch text REFERENCES public.fye_demo_batches(id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['mentor_applications','mentor_appointments','mentor_assignments','calendar_events','event_requests',
 'event_attendance','event_activity_log','event_cancellation_requests','event_notifications','supervisor_notifications','system_notices',
 'system_notice_notifications','mentor_student_messages','mentor_student_conversations'] LOOP
 EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS demo_batch text REFERENCES public.fye_demo_batches(id)',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.fye_profile_batch(p_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public AS $$ SELECT demo_batch FROM profiles WHERE id=p_id $$;
CREATE OR REPLACE FUNCTION public.guard_demo_profile() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.demo_batch IS DISTINCT FROM OLD.demo_batch AND current_user IN ('authenticated','anon','authenticator')
 THEN RAISE EXCEPTION 'Demo cohort membership is protected.'; END IF;
 IF TG_OP='INSERT' AND NEW.demo_batch IS NOT NULL AND current_user IN ('authenticated','anon','authenticator')
 THEN RAISE EXCEPTION 'Demo cohort membership is protected.'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS demo_profile_guard ON public.profiles;
CREATE TRIGGER demo_profile_guard BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_demo_profile();

CREATE OR REPLACE FUNCTION public.stamp_demo_source() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE j jsonb:=to_jsonb(NEW); b text; participant uuid; other uuid; source_id bigint;
BEGIN
 IF TG_TABLE_NAME='mentor_applications' THEN participant:=(j->>'applicant_id')::uuid;
 ELSIF TG_TABLE_NAME IN ('mentor_appointments','event_requests') THEN participant:=(j->>'mentor_id')::uuid;
 ELSIF TG_TABLE_NAME IN ('mentor_assignments','mentor_student_messages','mentor_student_conversations') THEN
  participant:=(j->>'mentor_id')::uuid; other:=(j->>'student_id')::uuid;
  IF fye_profile_batch(participant) IS DISTINCT FROM fye_profile_batch(other) THEN RAISE EXCEPTION 'Demo pairs must remain within the same cohort.'; END IF;
 ELSIF TG_TABLE_NAME='system_notices' THEN participant:=(j->>'created_by')::uuid;
 ELSIF TG_TABLE_NAME='calendar_events' THEN participant:=coalesce((j->>'organizer_id')::uuid,(j->>'created_by')::uuid);
 ELSIF TG_TABLE_NAME IN ('event_attendance','event_cancellation_requests','event_activity_log') THEN
  source_id:=(j->>'calendar_event_id')::bigint;
  SELECT demo_batch INTO b FROM calendar_events WHERE id=source_id;
  IF TG_TABLE_NAME='event_attendance' AND b IS NOT NULL AND b IS DISTINCT FROM fye_profile_batch((j->>'attendee_id')::uuid)
  THEN RAISE EXCEPTION 'Attendance must remain within the event demo cohort.'; END IF;
 END IF;
 IF participant IS NOT NULL THEN b:=fye_profile_batch(participant); END IF;
 NEW.demo_batch:=b;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['mentor_applications','mentor_appointments','mentor_assignments','calendar_events','event_requests',
 'event_attendance','event_activity_log','event_cancellation_requests','system_notices','mentor_student_messages','mentor_student_conversations'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS a_demo_source ON public.%I',t);
 EXECUTE format('CREATE TRIGGER a_demo_source BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.stamp_demo_source()',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.scope_demo_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b text;
BEGIN
 IF TG_TABLE_NAME='event_notifications' THEN
  SELECT demo_batch INTO b FROM calendar_events WHERE id=NEW.calendar_event_id;
  IF b IS NULL THEN SELECT demo_batch INTO b FROM event_requests WHERE id=NEW.event_request_id; END IF;
 ELSIF TG_TABLE_NAME='system_notice_notifications' THEN SELECT demo_batch INTO b FROM system_notices WHERE id=NEW.system_notice_id;
 ELSE
  IF NEW.notification_type='mentor_application' THEN SELECT demo_batch INTO b FROM mentor_applications WHERE id::text=NEW.subject_id;
  ELSIF NEW.notification_type='admin_notice' THEN SELECT demo_batch INTO b FROM system_notices WHERE id::text=NEW.subject_id;
  ELSIF NEW.notification_type='mentor_contact_overdue' THEN SELECT demo_batch INTO b FROM profiles WHERE id::text=split_part(NEW.subject_id,':',1);
  ELSE
   SELECT demo_batch INTO b FROM event_requests WHERE id::text=NEW.subject_id;
   IF b IS NULL THEN SELECT demo_batch INTO b FROM event_cancellation_requests WHERE 'cancellation:'||id::text=NEW.subject_id; END IF;
  END IF;
 END IF;
 IF b IS NOT NULL AND b IS DISTINCT FROM fye_profile_batch(NEW.recipient_id) THEN RETURN NULL; END IF;
 NEW.demo_batch:=b; RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['event_notifications','system_notice_notifications','supervisor_notifications'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS zz_demo_notification ON public.%I',t);
 EXECUTE format('CREATE TRIGGER zz_demo_notification BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.scope_demo_notification()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.track_demo_record() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.demo_batch IS NOT NULL THEN INSERT INTO fye_demo_records(batch_id,table_name,record_id)
 VALUES(NEW.demo_batch,TG_TABLE_NAME,NEW.id::text) ON CONFLICT DO NOTHING; END IF; RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['profiles','mentor_applications','mentor_appointments','mentor_assignments','calendar_events','event_requests',
 'event_attendance','event_activity_log','event_cancellation_requests','event_notifications','supervisor_notifications','system_notices',
 'system_notice_notifications','mentor_student_messages','mentor_student_conversations'] LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS z_track_demo ON public.%I',t);
 EXECUTE format('CREATE TRIGGER z_track_demo AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.track_demo_record()',t);
 END LOOP;
END $$;
DROP POLICY IF EXISTS demo_calendar_boundary ON public.calendar_events;
CREATE POLICY demo_calendar_boundary ON public.calendar_events AS RESTRICTIVE FOR SELECT TO authenticated
USING(demo_batch IS NULL OR demo_batch=public.fye_profile_batch(auth.uid()) OR public.fye_supervisor() OR public.is_admin());
DROP POLICY IF EXISTS demo_notice_boundary ON public.system_notices;
CREATE POLICY demo_notice_boundary ON public.system_notices AS RESTRICTIVE FOR SELECT TO authenticated
USING(demo_batch IS NULL OR demo_batch=public.fye_profile_batch(auth.uid()) OR public.fye_supervisor() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.demo_seed_status() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('version',2,'academic_rules',EXISTS(SELECT 1 FROM fye_schema_versions WHERE version='academic-demo-v1'),'demo_isolation',true,'workflows',EXISTS(SELECT 1 FROM fye_schema_versions WHERE version='academic-demo-workflows-v1'),
 'schema_intact',EXISTS(SELECT 1 FROM fye_contract_baseline WHERE schema_hash=fye_contract_hash()),
 'faculties',(SELECT jsonb_agg(jsonb_build_object('id',id::text,'name',name) ORDER BY id) FROM faculties),
 'programmes',(SELECT jsonb_agg(jsonb_build_object('id',id::text,'faculty_id',faculty_id::text,'name',name,'qualification_level',qualification_level,'max_study_year',max_study_year,'first_time_entry',first_time_entry) ORDER BY id) FROM programmes))
$$;
CREATE OR REPLACE FUNCTION public.demo_start_batch(p_batch text,p_plan_hash text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO fye_demo_batches(id,plan_hash) VALUES(p_batch,p_plan_hash) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM fye_demo_batches WHERE id=p_batch AND plan_hash=p_plan_hash AND status<>'cleaned')
 THEN RAISE EXCEPTION 'Batch identity differs or was cleaned; do not overwrite it.'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.demo_seed_profile(p_batch text,p_key text,p_id uuid,p_details jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p profiles%ROWTYPE; intended text:=p_details->>'role';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM fye_demo_batches WHERE id=p_batch AND status='loading') THEN RAISE EXCEPTION 'Start a loading batch first.'; END IF;
 IF intended NOT IN ('student','mentor','supervisor','admin') OR intended IS NULL THEN RAISE EXCEPTION 'Invalid demo role.'; END IF;
 IF NOT coalesce(CASE WHEN intended IN ('student','mentor') THEN
  p_key=p_batch||'/programme/'||(p_details->>'programme_id')||'/'||intended||'/'||split_part(p_key,'/',5)
  AND split_part(p_key,'/',5) ~ '^[1-9][0-9]*$' AND (p_details->>'student_number') ~ '^[0-9]{9}$'
 ELSE p_key=p_batch||'/staff/'||intended END,false) THEN RAISE EXCEPTION 'Seed identity does not match its protected key.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_id AND raw_app_meta_data->>'fye_demo_batch'=p_batch
 AND raw_app_meta_data->>'fye_seed_key'=p_key AND email=p_details->>'email'
 AND (email LIKE 'demo.'||p_batch||'.%@example.test'
  OR (intended IN ('student','mentor') AND email=(p_details->>'student_number')||'@ump.ac.za')
  OR (intended IN ('admin','supervisor') AND email ~ '^[a-z][a-z0-9]*([.][a-z][a-z0-9]*)+@ump[.]ac[.]za$')))
 THEN RAISE EXCEPTION 'Auth account is not owned by this demo batch.'; END IF;
 SELECT * INTO p FROM profiles WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO profiles(id,email) SELECT id,email FROM auth.users WHERE id=p_id;
  SELECT * INTO p FROM profiles WHERE id=p_id FOR UPDATE;
 END IF;
 IF p.demo_batch IS NOT NULL THEN
  IF p.demo_batch<>p_batch THEN RAISE EXCEPTION 'Account belongs to a different batch.'; END IF;
  RETURN to_jsonb(p); -- Resume never overwrites manual demo edits.
 END IF;
 IF intended IN ('student','mentor') AND NOT EXISTS(SELECT 1 FROM programmes q WHERE q.id=(p_details->>'programme_id')::bigint
 AND q.faculty_id=(p_details->>'faculty_id')::bigint AND q.qualification_level=p_details->>'qualification_level'
 AND (p_details->>'study_year')::int BETWEEN 1 AND q.max_study_year
 AND ((p_details->>'entry_status')<>'first_time' OR (q.first_time_entry AND q.qualification_level='undergraduate' AND (p_details->>'study_year')::int=1 AND (p_details->>'first_entry_year')::int=extract(year FROM fye_today()))))
 THEN RAISE EXCEPTION 'Demo academic details do not match the reviewed catalogue.'; END IF;
 IF EXISTS(SELECT 1 FROM profiles WHERE student_number=p_details->>'student_number' AND id<>p_id) THEN RAISE EXCEPTION 'Student number collision.'; END IF;
 UPDATE profiles SET demo_batch=p_batch,full_name=p_details->>'full_name',first_name=p_details->>'first_name',last_name=p_details->>'last_name',
 role=CASE WHEN intended='mentor' THEN 'student' ELSE intended END,
 faculty_id=(p_details->>'faculty_id')::bigint,programme_id=(p_details->>'programme_id')::bigint,
 study_year=(p_details->>'study_year')::smallint,student_number=p_details->>'student_number',
 first_entry_year=(p_details->>'first_entry_year')::smallint,entry_status=p_details->>'entry_status',
 language_preference=p_details->>'language_preference',school=coalesce(nullif(btrim(p_details->>'school'),''),
  (SELECT name FROM faculties WHERE id=(p_details->>'faculty_id')::bigint),'Student Affairs') WHERE id=p_id;
 -- A separate update follows metadata invalidation, so only trusted seed data is preverified.
 UPDATE profiles SET academic_verified_at=CASE WHEN intended IN ('student','mentor') THEN now() END WHERE id=p_id;
 UPDATE fye_demo_records SET seed_key=p_key WHERE batch_id=p_batch AND table_name='profiles' AND record_id=p_id::text;
 SELECT * INTO p FROM profiles WHERE id=p_id; RETURN to_jsonb(p);
END $$;
CREATE OR REPLACE FUNCTION public.demo_historical_mentor(p_batch text,p_mentor_id uuid,p_supervisor_id uuid,p_academic_path text,p_registration_path text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE aid uuid; cy int:=extract(year FROM fye_today())::int-1;
BEGIN
 IF fye_profile_batch(p_mentor_id) IS DISTINCT FROM p_batch OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_supervisor_id AND role='supervisor' AND demo_batch=p_batch)
 THEN RAISE EXCEPTION 'Historical scenarios require demo participants in the same batch.'; END IF;
 IF EXISTS(SELECT 1 FROM mentor_appointments WHERE mentor_id=p_mentor_id) THEN SELECT application_id INTO aid FROM mentor_appointments WHERE mentor_id=p_mentor_id ORDER BY created_at DESC LIMIT 1; RETURN aid; END IF;
 PERFORM fye_check_document(p_academic_path,p_mentor_id); PERFORM fye_check_document(p_registration_path,p_mentor_id);
 INSERT INTO mentor_applications(applicant_id,student_number,study_year,school,cycle_year,submitted_at,cohort_snapshot,
 academic_record_path,registration_record_path,results_year,results_verified_at,results_verified_by,progression_confirmed,registration_year,status,reviewed_by,reviewed_at,created_at)
 SELECT id,student_number,CASE WHEN first_entry_year=cy AND study_year=2 THEN 1 ELSE study_year END,school,cy,make_timestamptz(cy,10,15,12,0,0,'Africa/Johannesburg'),
 jsonb_build_object('first_time',first_entry_year=cy AND study_year=2,'first_entry_year',first_entry_year,'qualification_level',(SELECT qualification_level FROM programmes WHERE id=programme_id)),
 p_academic_path,p_registration_path,cy,make_timestamptz(cy+1,2,1,12,0,0,'Africa/Johannesburg'),p_supervisor_id,true,cy+1,'approved',p_supervisor_id,
 make_timestamptz(cy+1,2,1,12,0,0,'Africa/Johannesburg'),make_timestamptz(cy,10,15,12,0,0,'Africa/Johannesburg') FROM profiles WHERE id=p_mentor_id RETURNING id INTO aid;
 INSERT INTO mentor_appointments(mentor_id,application_id,starts_at,approved_by) VALUES(p_mentor_id,aid,make_timestamptz(cy+1,2,1,12,0,0,'Africa/Johannesburg'),p_supervisor_id);
 PERFORM reconcile_academic_lifecycle(); RETURN aid;
END $$;
CREATE OR REPLACE FUNCTION public.demo_batch_report(p_batch text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('profiles',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'email',p.email,'role',p.role,'programme_id',p.programme_id::text,
 'faculty_id',p.faculty_id::text,'student_number',p.student_number,'study_year',p.study_year,'entry_status',p.entry_status,'first_entry_year',p.first_entry_year,
 'academic_verified',p.academic_verified_at IS NOT NULL,'auth_link',u.id IS NOT NULL,'email_confirmed',u.email_confirmed_at IS NOT NULL,'auth_owned',u.raw_app_meta_data->>'fye_demo_batch'=p_batch,
 'mentor_active',mentor_application_is_approved(p.id),'eligible_mentee',fye_eligible_mentee(p.id))),'[]'::jsonb)
 FROM profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE p.demo_batch=p_batch),
 'records',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM (SELECT table_name,count(*) AS count FROM fye_demo_records WHERE batch_id=p_batch GROUP BY table_name)c),
 'cross_batch_assignments',(SELECT count(*) FROM mentor_assignments a WHERE a.demo_batch=p_batch AND (fye_profile_batch(a.student_id) IS DISTINCT FROM p_batch OR fye_profile_batch(a.mentor_id) IS DISTINCT FROM p_batch)),
 'capacity_violations',(SELECT count(*) FROM (SELECT mentor_id FROM active_mentor_assignments GROUP BY mentor_id HAVING count(*)>20)c),
 'notification_leaks',(SELECT count(*) FROM (SELECT recipient_id FROM event_notifications WHERE demo_batch=p_batch UNION ALL SELECT recipient_id FROM system_notice_notifications WHERE demo_batch=p_batch UNION ALL SELECT recipient_id FROM supervisor_notifications WHERE demo_batch=p_batch)n WHERE fye_profile_batch(recipient_id) IS DISTINCT FROM p_batch),
 'scenario_counts',jsonb_build_object('applications',(SELECT count(*) FROM mentor_applications WHERE demo_batch=p_batch),
 'assignments',(SELECT count(*) FROM active_mentor_assignments WHERE fye_profile_batch(mentor_id)=p_batch),'events',(SELECT count(*) FROM calendar_events WHERE demo_batch=p_batch),
 'attendance',(SELECT count(*) FROM event_attendance WHERE demo_batch=p_batch AND is_valid),'cancellations',(SELECT count(*) FROM event_cancellation_requests WHERE demo_batch=p_batch),
 'messages',(SELECT count(*) FROM mentor_student_messages WHERE demo_batch=p_batch),'notices',(SELECT count(*) FROM system_notices WHERE demo_batch=p_batch)),
 'early_firstyear_approvals',(SELECT count(*) FROM mentor_applications WHERE demo_batch=p_batch AND status='approved' AND coalesce((cohort_snapshot->>'first_time')::boolean,false) AND reviewed_at<make_timestamptz(cycle_year+1,1,1,0,0,0,'Africa/Johannesburg')))
$$;
CREATE OR REPLACE FUNCTION public.demo_cleanup_batch(p_batch text,p_execute boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; r record; leaked boolean; t text;
BEGIN
 SELECT jsonb_build_object('batch',p_batch,'auth_ids',(SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM auth.users WHERE raw_app_meta_data->>'fye_demo_batch'=p_batch),
 'records',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM (SELECT table_name,count(*) FROM fye_demo_records WHERE batch_id=p_batch GROUP BY table_name)c)) INTO result;
 IF NOT coalesce(p_execute,false) THEN RETURN result; END IF;
 PERFORM 1 FROM fye_demo_batches WHERE id=p_batch FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown batch.'; END IF;
 -- Refuse cleanup when demo staff have since been used in existing people's records.
 FOR r IN SELECT n.nspname,c.relname,a.attname FROM pg_constraint fk JOIN pg_class c ON c.oid=fk.conrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=fk.conkey[1]
 WHERE fk.contype='f' AND fk.confrelid IN ('public.profiles'::regclass,'auth.users'::regclass) AND n.nspname='public' LOOP
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I child JOIN public.profiles p ON p.id=child.%I WHERE p.demo_batch=$1 AND coalesce(to_jsonb(child)->>''demo_batch'','''')<>$1)',r.nspname,r.relname,r.attname) INTO leaked USING p_batch;
 IF leaked THEN RAISE EXCEPTION 'Existing data references demo accounts in %.%; review before cleanup.',r.relname,r.attname; END IF;
 END LOOP;
 DELETE FROM mentor_contact_status WHERE fye_profile_batch(mentor_id)=p_batch AND fye_profile_batch(student_id)=p_batch;
 DELETE FROM mentor_programme_mappings WHERE fye_profile_batch(mentor_id)=p_batch;
 FOREACH t IN ARRAY ARRAY['event_cancellation_requests','event_attendance','event_activity_log','event_notifications','supervisor_notifications',
 'system_notice_notifications','event_requests','calendar_events','system_notices','mentor_student_messages','mentor_student_conversations','mentor_assignments','mentor_appointments','mentor_applications','profiles'] LOOP
 EXECUTE format('DELETE FROM public.%I WHERE demo_batch=$1 AND id::text IN (SELECT record_id FROM public.fye_demo_records WHERE batch_id=$1 AND table_name=$2)',t) USING p_batch,t;
 END LOOP;
 UPDATE fye_demo_batches SET status='cleaned' WHERE id=p_batch;
 RETURN result;
END $$;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND p.proname IN ('demo_seed_status','demo_start_batch','demo_seed_profile','demo_historical_mentor','demo_batch_report','demo_cleanup_batch') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.guard_demo_profile(),public.stamp_demo_source(),public.scope_demo_notification(),public.track_demo_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fye_profile_batch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fye_profile_batch(uuid) TO authenticated,service_role;
GRANT ALL ON public.fye_demo_batches,public.fye_demo_records TO service_role;




-- SOURCE: 20261019020000_academic_clients_and_analytics.sql

CREATE TABLE IF NOT EXISTS public.fye_schema_versions(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.fye_schema_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fye_schema_versions FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND role='admin' AND is_active) $$;
CREATE OR REPLACE FUNCTION public.is_supervisor() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT fye_supervisor() $$;
CREATE OR REPLACE FUNCTION public.review_mentor_approval(p_mentor_id uuid,p_decision text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Use the supervisor application and appointment workflow to review mentors.'; END $$;
CREATE OR REPLACE FUNCTION public.can_send_mentor_student_message(p_conversation_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM mentor_student_conversations c WHERE c.id=p_conversation_id AND auth.uid() IN(c.mentor_id,c.student_id) AND has_active_mentor_assignment(c.mentor_id,c.student_id)) $$;
-- Replace obsolete overloads that still referenced the retired conversation_id/content columns.
CREATE OR REPLACE FUNCTION public.send_mentor_student_message(p_mentor_id uuid,p_student_id uuid,p_content text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() NOT IN(p_mentor_id,p_student_id) OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Participants only.'; END IF;
 IF NOT has_active_mentor_assignment(p_mentor_id,p_student_id) THEN RAISE EXCEPTION 'No active assignment.'; END IF;
 RETURN send_mentor_student_message(CASE WHEN auth.uid()=p_mentor_id THEN p_student_id ELSE p_mentor_id END,p_content);
END $$;
CREATE OR REPLACE FUNCTION public.broadcast_mentor_message(p_content text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s uuid; n int:=0;
BEGIN
 IF NOT mentor_application_is_approved(auth.uid()) THEN RAISE EXCEPTION 'Active mentor appointment required.'; END IF;
 FOR s IN SELECT student_id FROM active_mentor_assignments WHERE mentor_id=auth.uid() LOOP
 PERFORM send_mentor_student_message(s,p_content); n:=n+1; END LOOP; RETURN n;
END $$;
CREATE OR REPLACE FUNCTION public.open_mentor_student_conversation(p_student_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE m uuid; s uuid; result uuid;
BEGIN
 IF mentor_application_is_approved(auth.uid()) THEN m:=auth.uid();s:=p_student_id;
 ELSIF auth.uid()=p_student_id THEN s:=auth.uid();SELECT mentor_id INTO m FROM active_mentor_assignments WHERE student_id=s ORDER BY assigned_at DESC LIMIT 1;
 ELSE RAISE EXCEPTION 'Assigned participants only.'; END IF;
 IF NOT has_active_mentor_assignment(m,s) THEN RAISE EXCEPTION 'An active assignment is required.'; END IF;
 INSERT INTO mentor_student_conversations(mentor_id,student_id) VALUES(m,s) ON CONFLICT(mentor_id,student_id) DO UPDATE SET last_message_at=mentor_student_conversations.last_message_at RETURNING id INTO result;
 RETURN result;
END $$;
DO $$ BEGIN
 IF to_regprocedure('public.get_admin_analytics_pre_lifecycle(integer)') IS NULL THEN ALTER FUNCTION public.get_admin_analytics(integer) RENAME TO get_admin_analytics_pre_lifecycle; END IF;
 IF to_regprocedure('public.get_admin_analytics_details_pre_lifecycle(text,integer)') IS NULL THEN ALTER FUNCTION public.get_admin_analytics_details(text,integer) RENAME TO get_admin_analytics_details_pre_lifecycle; END IF;
END $$;
REVOKE ALL ON FUNCTION public.get_admin_analytics_pre_lifecycle(integer),public.get_admin_analytics_details_pre_lifecycle(text,integer) FROM PUBLIC,authenticated;
CREATE OR REPLACE FUNCTION public.get_admin_analytics(p_period_days integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE base jsonb;
BEGIN
 base:=get_admin_analytics_pre_lifecycle(p_period_days);
 RETURN base||jsonb_build_object(
 'active_students',(SELECT count(*) FROM profiles WHERE role='student' AND is_active AND NOT mentor_application_is_approved(id)),
 'active_mentors',(SELECT count(*) FROM profiles p JOIN mentor_appointments a ON a.mentor_id=p.id AND a.ended_at IS NULL AND a.starts_at<=now() WHERE p.is_active AND NOT a.paused),
 'eligible_mentees',(SELECT count(*) FROM profiles WHERE fye_eligible_mentee(id)),
 'unassigned_mentees',(SELECT count(*) FROM profiles p WHERE fye_eligible_mentee(p.id) AND NOT EXISTS(SELECT 1 FROM mentor_assignments a WHERE a.student_id=p.id AND a.ended_at IS NULL AND (a.effective_end_at>now() OR a.effective_end_at IS NULL))),
 'awaiting_results',(SELECT count(*) FROM mentor_applications WHERE status IN ('pending','shortlisted') AND submitted_at IS NOT NULL AND (results_verified_at IS NULL OR supplementary_pending)),
 'active_assignments',(SELECT count(*) FROM active_mentor_assignments));
END $$;
CREATE OR REPLACE FUNCTION public.get_admin_analytics_details(p_metric text,p_period_days integer DEFAULT 90) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb;
BEGIN
 IF NOT is_admin() THEN RAISE EXCEPTION 'Active admin access required.'; END IF;
 IF p_period_days IS NULL OR p_period_days NOT IN(0,30,90,365) THEN RAISE EXCEPTION 'Unsupported period.'; END IF;
 IF p_metric='awaiting' THEN
 SELECT coalesce(jsonb_agg(jsonb_build_object('application_id',a.id,'cycle_year',a.cycle_year,'status',a.status,'profile_id',p.id,'name',p.full_name,'email',p.email,'faculty_id',p.faculty_id,'programme_id',p.programme_id)),'[]'::jsonb)
 INTO result FROM mentor_applications a JOIN profiles p ON p.id=a.applicant_id
 WHERE a.status IN ('pending','shortlisted') AND a.submitted_at IS NOT NULL AND (a.results_verified_at IS NULL OR a.supplementary_pending);
 ELSIF p_metric IN ('students','mentors','eligible','unassigned') THEN
 SELECT coalesce(jsonb_agg(jsonb_build_object('profile_id',p.id,'name',p.full_name,'email',p.email,'role',p.role,'faculty_id',p.faculty_id,'programme_id',p.programme_id,
 'study_year',p.study_year,'entry_status',p.entry_status,'first_entry_year',p.first_entry_year)),'[]'::jsonb) INTO result FROM profiles p WHERE
 (p_metric='students' AND p.role='student' AND p.is_active AND NOT mentor_application_is_approved(p.id)) OR
 (p_metric='mentors' AND p.is_active AND EXISTS(SELECT 1 FROM mentor_appointments a WHERE a.mentor_id=p.id AND a.starts_at<=now() AND a.ended_at IS NULL AND NOT a.paused)) OR
 (p_metric='eligible' AND fye_eligible_mentee(p.id)) OR
 (p_metric='unassigned' AND fye_eligible_mentee(p.id) AND NOT EXISTS(SELECT 1 FROM mentor_assignments a WHERE a.student_id=p.id AND a.ended_at IS NULL AND (a.effective_end_at>now() OR a.effective_end_at IS NULL))) OR
 (p_metric='awaiting' AND EXISTS(SELECT 1 FROM mentor_applications a WHERE a.applicant_id=p.id AND a.status IN ('pending','shortlisted') AND a.submitted_at IS NOT NULL AND (a.results_verified_at IS NULL OR a.supplementary_pending)));
 ELSIF p_metric='assignments' THEN
 SELECT coalesce(jsonb_agg(jsonb_build_object('student_id',a.student_id,'student',s.full_name,'mentor_id',a.mentor_id,'mentor',m.full_name,'assigned_at',a.assigned_at,'academic_year',a.academic_year,'needs_reassignment',a.needs_reassignment)),'[]'::jsonb)
 INTO result FROM active_mentor_assignments a JOIN profiles s ON s.id=a.student_id JOIN profiles m ON m.id=a.mentor_id;
 ELSE result:=get_admin_analytics_details_pre_lifecycle(p_metric,p_period_days); END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_admin_analytics(integer),public.get_admin_analytics_details(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics(integer),public.get_admin_analytics_details(text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_profile_for_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pid bigint; fid bigint;
BEGIN
 pid:=nullif(NEW.raw_user_meta_data->>'programme_id','')::bigint;
 SELECT faculty_id INTO fid FROM programmes WHERE id=pid;
 INSERT INTO profiles(id,email,full_name,first_name,last_name,role,faculty_id,programme_id,student_number,study_year,first_entry_year,entry_status)
 VALUES(NEW.id,NEW.email,coalesce(NEW.raw_user_meta_data->>'full_name',''),NEW.raw_user_meta_data->>'first_name',NEW.raw_user_meta_data->>'last_name','student',fid,pid,
 nullif(NEW.raw_user_meta_data->>'student_number',''),nullif(NEW.raw_user_meta_data->>'study_year','')::smallint,
 nullif(NEW.raw_user_meta_data->>'first_entry_year','')::smallint,nullif(NEW.raw_user_meta_data->>'entry_status',''));
 RETURN NEW;
END $$;
-- New programmes must be classified before they can participate in matching.
CREATE OR REPLACE FUNCTION public.set_programme_qualification(p_programme_id bigint,p_level text,p_max_year smallint,p_first_time_entry boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT is_admin() THEN RAISE EXCEPTION 'Active admin access required.'; END IF;
 IF p_level IS NULL OR p_level NOT IN ('undergraduate','honours','postgraduate_diploma','masters','doctorate') OR p_max_year IS NULL OR p_max_year NOT BETWEEN 1 AND 20 OR p_first_time_entry IS NULL
 OR (p_level<>'undergraduate' AND p_first_time_entry) THEN RAISE EXCEPTION 'Choose a valid qualification and duration.'; END IF;
 UPDATE programmes SET qualification_level=p_level,max_study_year=p_max_year,first_time_entry=p_first_time_entry WHERE id=p_programme_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Programme not found.'; END IF;
 UPDATE profiles SET academic_verified_at=NULL,academic_verified_by=NULL WHERE programme_id=p_programme_id;
END $$;
REVOKE ALL ON FUNCTION public.set_programme_qualification(bigint,text,smallint,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_programme_qualification(bigint,text,smallint,boolean) TO authenticated;
DROP POLICY IF EXISTS "Users can read related profiles" ON public.profiles;
CREATE POLICY "Users can read related profiles" ON public.profiles FOR SELECT TO authenticated USING(
 id=auth.uid() OR EXISTS(SELECT 1 FROM public.active_mentor_assignments a WHERE (a.student_id=auth.uid() AND a.mentor_id=profiles.id) OR (a.mentor_id=auth.uid() AND a.student_id=profiles.id)));
INSERT INTO public.fye_schema_versions(version) VALUES('academic-demo-v1') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.declare_student_registration(p_student_number text,p_first_entry_year integer,p_entry_status text,p_study_year smallint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM set_own_student_details(p_student_number,p_study_year);
 PERFORM declare_academic_details(p_first_entry_year,p_entry_status,p_study_year);
END $$;
REVOKE ALL ON FUNCTION public.declare_student_registration(text,integer,text,smallint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.declare_student_registration(text,integer,text,smallint) TO authenticated;
CREATE OR REPLACE FUNCTION public.end_mentee_assignment(p_assignment_id bigint,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT fye_supervisor() OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Supervisor and recorded reason required.'; END IF;
 UPDATE mentor_assignments SET ended_at=now(),end_reason=p_reason WHERE id=p_assignment_id AND ended_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.end_mentee_assignment(bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_mentee_assignment(bigint,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.refresh_mentor_contact_alerts()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'supervisor' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active supervisor access is required.';
  END IF;

  INSERT INTO public.supervisor_notifications (
    recipient_id, notification_type, subject_id, title, message
  )
  SELECT
    supervisor.id,
    'mentor_contact_overdue',
    assignment.mentor_id::TEXT || ':' || assignment.student_id::TEXT,
    'Mentee contact overdue',
    COALESCE(mentor.full_name, mentor.email, 'A mentor')
      || ' has not logged first contact with '
      || COALESCE(student.full_name, student.email, 'their assigned student')
      || ' within 7 days of assignment.'
  FROM public.active_mentor_assignments AS assignment
  JOIN public.profiles AS mentor ON mentor.id = assignment.mentor_id AND mentor.is_active
  JOIN public.profiles AS student ON student.id = assignment.student_id AND student.is_active
  CROSS JOIN public.profiles AS supervisor
  LEFT JOIN public.mentor_contact_status AS contact
    ON contact.mentor_id = assignment.mentor_id
    AND contact.student_id = assignment.student_id
  WHERE assignment.ended_at IS NULL
    AND assignment.assigned_at <= now() - INTERVAL '7 days'
    AND (contact.last_contact_at IS NULL OR contact.last_contact_at < assignment.assigned_at)
    AND supervisor.role = 'supervisor'
    AND supervisor.is_active = true
  ON CONFLICT (recipient_id, notification_type, subject_id) DO NOTHING;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.record_mentor_contact(p_student_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
BEGIN
  IF actor_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = actor_id AND public.mentor_application_is_approved(id) AND is_active = true
    )
    OR NOT public.has_active_mentor_assignment(actor_id, p_student_id) THEN
    RAISE EXCEPTION 'Only the assigned active mentor can record student contact.';
  END IF;

  INSERT INTO public.mentor_contact_status (mentor_id, student_id, last_contact_at)
  VALUES (actor_id, p_student_id, now())
  ON CONFLICT (mentor_id, student_id)
  DO UPDATE SET last_contact_at = EXCLUDED.last_contact_at;

  UPDATE public.supervisor_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE notification_type = 'mentor_contact_overdue'
    AND subject_id = actor_id::TEXT || ':' || p_student_id::TEXT;
END;
$function$
;




-- SOURCE: 20261019030000_reviewed_programme_qualifications.sql
-- Reviewed deployed catalogue only. No faculties/programmes are added or renamed.
-- Durations: UMP Almanac 2026 pp18-20. Medicine: explicit six-year prototype choice.

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM (VALUES
 (1::bigint,'Diploma in Agriculture in Plant Production'),
 (2::bigint,'Diploma in Animal Production'),
 (3::bigint,'Advanced Diploma in Agriculture in Post Harvest Technology'),
 (4::bigint,'Advanced Diploma in Agriculture in Agricultural Extension'),
 (5::bigint,'Advanced Diploma in Agriculture in Agricultural Production Management'),
 (6::bigint,'Advanced Diploma in Animal Production'),
 (7::bigint,'Bachelor of Agriculture in Agricultural Extension and Rural Resource Management'),
 (8::bigint,'Bachelor of Science in Agriculture'),
 (9::bigint,'Bachelor of Science in Forestry'),
 (10::bigint,'Diploma in Nature Conservation'),
 (11::bigint,'Advanced Diploma in Nature Conservation'),
 (12::bigint,'Bachelor of Science'),
 (13::bigint,'Bachelor of Science in Environmental Science'),
 (14::bigint,'Higher Certificate in Information Communication Technology in User Support'),
 (15::bigint,'Diploma in ICT in Application Development'),
 (16::bigint,'Advanced Diploma in ICT in Application Development'),
 (17::bigint,'Bachelor of Information and Communication Technology'),
 (18::bigint,'Bachelor of Administration'),
 (19::bigint,'Bachelor of Laws'),
 (20::bigint,'Bachelor of Commerce (General)'),
 (21::bigint,'Bachelor of Development Studies'),
 (22::bigint,'Diploma in Hospitality Management'),
 (23::bigint,'Diploma in Hospitality Management (Revised Curriculum)'),
 (24::bigint,'Higher Certificate in Event Management'),
 (25::bigint,'Diploma in Culinary Arts'),
 (26::bigint,'Advanced Diploma in Hospitality Management'),
 (27::bigint,'Bachelor of Arts'),
 (28::bigint,'Bachelor of Social Work'),
 (29::bigint,'Bachelor of Social Sciences'),
 (30::bigint,'Bachelor of Arts in Media, Communication and Culture'),
 (31::bigint,'Bachelor of Education in Foundation Phase Teaching'),
 (35::bigint,'medicine')) expected(id,name) LEFT JOIN public.programmes actual ON actual.id=expected.id WHERE actual.name IS DISTINCT FROM expected.name)
 THEN RAISE EXCEPTION 'Catalogue differs from the reviewed audit. Re-audit before classifying.'; END IF;
END $$;
UPDATE public.programmes p SET qualification_level=c.level,max_study_year=c.years,first_time_entry=c.first_time
FROM (VALUES
 (1::bigint,'undergraduate'::text,3::smallint,true),
 (2::bigint,'undergraduate'::text,3::smallint,true),
 (3::bigint,'undergraduate'::text,1::smallint,false),
 (4::bigint,'undergraduate'::text,1::smallint,false),
 (5::bigint,'undergraduate'::text,1::smallint,false),
 (6::bigint,'undergraduate'::text,1::smallint,false),
 (7::bigint,'undergraduate'::text,3::smallint,true),
 (8::bigint,'undergraduate'::text,4::smallint,true),
 (9::bigint,'undergraduate'::text,4::smallint,true),
 (10::bigint,'undergraduate'::text,3::smallint,true),
 (11::bigint,'undergraduate'::text,1::smallint,false),
 (12::bigint,'undergraduate'::text,3::smallint,true),
 (13::bigint,'undergraduate'::text,3::smallint,true),
 (14::bigint,'undergraduate'::text,1::smallint,true),
 (15::bigint,'undergraduate'::text,3::smallint,true),
 (16::bigint,'undergraduate'::text,1::smallint,false),
 (17::bigint,'undergraduate'::text,3::smallint,true),
 (18::bigint,'undergraduate'::text,3::smallint,true),
 (19::bigint,'undergraduate'::text,4::smallint,true),
 (20::bigint,'undergraduate'::text,3::smallint,true),
 (21::bigint,'undergraduate'::text,3::smallint,true),
 (22::bigint,'undergraduate'::text,3::smallint,true),
 (23::bigint,'undergraduate'::text,3::smallint,true),
 (24::bigint,'undergraduate'::text,1::smallint,true),
 (25::bigint,'undergraduate'::text,3::smallint,true),
 (26::bigint,'undergraduate'::text,1::smallint,false),
 (27::bigint,'undergraduate'::text,3::smallint,true),
 (28::bigint,'undergraduate'::text,4::smallint,true),
 (29::bigint,'undergraduate'::text,3::smallint,true),
 (30::bigint,'undergraduate'::text,3::smallint,true),
 (31::bigint,'undergraduate'::text,4::smallint,true),
 (35::bigint,'undergraduate'::text,6::smallint,true)) c(id,level,years,first_time) WHERE p.id=c.id;




-- SOURCE: 20261019040000_demo_workflows_and_schedule.sql

CREATE TABLE IF NOT EXISTS public.fye_demo_operations(
 batch_id text NOT NULL REFERENCES public.fye_demo_batches(id),operation_key text NOT NULL,actor_id uuid NOT NULL,
 rpc_name text NOT NULL,result jsonb,PRIMARY KEY(batch_id,operation_key)
);
ALTER TABLE public.fye_demo_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fye_demo_operations FROM anon,authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS demo_record_seed_key ON public.fye_demo_records(batch_id,table_name,seed_key) WHERE seed_key IS NOT NULL;
-- Atomic idempotency envelope. Every branch invokes the ordinary workflow and
-- retains its normal email, role, faculty, date, evidence and capacity checks.
CREATE OR REPLACE FUNCTION public.demo_workflow_once(p_key text,p_rpc text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b text:=fye_profile_batch(auth.uid()); answer jsonb; existing fye_demo_operations%ROWTYPE; target text; rid uuid;
BEGIN
 IF b IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND is_active) THEN RAISE EXCEPTION 'This workflow envelope is limited to active demo accounts.'; END IF;
 PERFORM 1 FROM fye_demo_batches WHERE id=b AND status='loading' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Demo batch is not loading.'; END IF;
 SELECT * INTO existing FROM fye_demo_operations WHERE batch_id=b AND operation_key=p_key;
 IF FOUND THEN
  IF existing.actor_id<>auth.uid() OR existing.rpc_name<>p_rpc THEN RAISE EXCEPTION 'Operation key already has a different actor or action.'; END IF;
  RETURN existing.result;
 END IF;
 IF p_args?'p_application_id' THEN SELECT demo_batch INTO target FROM mentor_applications WHERE id=(p_args->>'p_application_id')::uuid;
 ELSIF p_args?'p_request_id' THEN SELECT demo_batch INTO target FROM event_cancellation_requests WHERE id=(p_args->>'p_request_id')::uuid;
 ELSIF p_args?'p_event_id' THEN SELECT demo_batch INTO target FROM calendar_events WHERE id=(p_args->>'p_event_id')::bigint;
 ELSIF p_args?'p_event_request_id' THEN SELECT demo_batch INTO target FROM event_requests WHERE id=(p_args->>'p_event_request_id')::uuid;
 ELSIF p_args?'p_mentor_id' THEN target:=fye_profile_batch((p_args->>'p_mentor_id')::uuid);
 ELSIF p_args?'p_recipient_id' THEN target:=fye_profile_batch((p_args->>'p_recipient_id')::uuid);
 ELSE target:=b; END IF;
 IF target IS DISTINCT FROM b THEN RAISE EXCEPTION 'Demo workflow target must belong to the same cohort.'; END IF;
 CASE p_rpc
 WHEN 'save_mentor_application' THEN answer:=to_jsonb(save_mentor_application(p_args->'p_details',(p_args->>'p_submit')::boolean));
 WHEN 'complete_mentor_documents' THEN PERFORM complete_mentor_documents((p_args->>'p_application_id')::uuid,p_args->>'p_academic_path',p_args->>'p_registration_path',(p_args->>'p_results_year')::int);answer:='true';
 WHEN 'review_mentor_application' THEN PERFORM review_mentor_application((p_args->>'p_application_id')::uuid,p_args->>'p_decision',p_args->>'p_reason');answer:='true';
 WHEN 'assign_students_to_mentor' THEN PERFORM assign_students_to_mentor((p_args->>'p_mentor_id')::uuid,ARRAY(SELECT jsonb_array_elements_text(p_args->'p_student_ids')::uuid));answer:='true';
 WHEN 'create_event_request' THEN answer:=to_jsonb(create_event_request(p_args->>'p_title',p_args->>'p_purpose',(p_args->>'p_event_date')::date,(p_args->>'p_event_time')::time,p_args->>'p_venue'));
 WHEN 'review_event_request' THEN PERFORM review_event_request((p_args->>'p_event_request_id')::uuid,p_args->>'p_decision',p_args->>'p_note');answer:='true';
 WHEN 'request_event_cancellation' THEN PERFORM request_event_cancellation((p_args->>'p_event_id')::bigint,p_args->>'p_reason');answer:='true';
 WHEN 'review_event_cancellation' THEN PERFORM review_event_cancellation((p_args->>'p_request_id')::uuid,(p_args->>'p_approve')::boolean,p_args->>'p_note');answer:='true';
 WHEN 'cancel_supervisor_event' THEN PERFORM cancel_supervisor_event((p_args->>'p_event_id')::bigint,p_args->>'p_reason');answer:='true';
 WHEN 'send_mentor_student_message' THEN answer:=to_jsonb(send_mentor_student_message((p_args->>'p_recipient_id')::uuid,p_args->>'p_body'));
 WHEN 'create_notice' THEN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Active admin required.'; END IF;
  INSERT INTO system_notices(title,message,starts_at,ends_at,created_by) VALUES(p_args->>'title',p_args->>'message',(p_args->>'starts_at')::timestamptz,(p_args->>'ends_at')::timestamptz,auth.uid()) RETURNING id::text INTO target;
  answer:=to_jsonb(target);
 ELSE RAISE EXCEPTION 'Unsupported demo workflow.';
 END CASE;
 INSERT INTO fye_demo_operations(batch_id,operation_key,actor_id,rpc_name,result) VALUES(b,p_key,auth.uid(),p_rpc,answer);
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION public.demo_workflow_once(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.demo_workflow_once(text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.demo_historical_event(p_batch text,p_key text,p_mentor_id uuid,p_supervisor_id uuid,p_attendees uuid[]) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE eid bigint; fid bigint; attendee uuid;
BEGIN
 PERFORM 1 FROM fye_demo_batches WHERE id=p_batch AND status='loading' FOR UPDATE;
 IF NOT FOUND OR fye_profile_batch(p_mentor_id) IS DISTINCT FROM p_batch OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_supervisor_id AND role='supervisor' AND demo_batch=p_batch)
 THEN RAISE EXCEPTION 'Historical events require marked demo participants.'; END IF;
 SELECT record_id::bigint INTO eid FROM fye_demo_records WHERE batch_id=p_batch AND table_name='calendar_events' AND seed_key=p_key;
 IF eid IS NOT NULL THEN RETURN eid; END IF;
 SELECT faculty_id INTO fid FROM profiles WHERE id=p_mentor_id;
 INSERT INTO calendar_events(title,event_type,description,starts_at,ends_at,location,created_by,audience,organizer_id,faculty_id,faculty_only,event_status,completed_at,attendance_token)
 VALUES('Faculty study workshop','event','Study planning and academic support session for students in the faculty.',now()-interval '3 days',now()-interval '3 days'+interval '1 hour','Faculty seminar room',p_supervisor_id,'university',p_mentor_id,fid,true,'completed',now()-interval '3 days'+interval '1 hour',gen_random_uuid()::text) RETURNING id INTO eid;
 UPDATE fye_demo_records SET seed_key=p_key WHERE batch_id=p_batch AND table_name='calendar_events' AND record_id=eid::text;
 FOREACH attendee IN ARRAY p_attendees LOOP
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=attendee AND demo_batch=p_batch AND faculty_id=fid AND role='student') THEN RAISE EXCEPTION 'Historical attendance is limited to students from the same demo cohort and faculty.'; END IF;
  INSERT INTO event_attendance(calendar_event_id,attendee_id,attendance_method,recorded_by,correction_reason,checked_in_at)
  VALUES(eid,attendee,'manual',p_supervisor_id,'Attendance verified by the faculty supervisor.',now()-interval '3 days'+interval '10 minutes');
 END LOOP;
 RETURN eid;
END $$;
REVOKE ALL ON FUNCTION public.demo_historical_event(text,text,uuid,uuid,uuid[]) FROM PUBLIC,authenticated,anon;
GRANT EXECUTE ON FUNCTION public.demo_historical_event(text,text,uuid,uuid,uuid[]) TO service_role;
-- pg_cron is already installed in the audited prototype. Effective date checks
-- also apply immediately in RPCs/views while this reconciliation job is pending.
DO $$ BEGIN
 IF to_regnamespace('cron') IS NOT NULL THEN
  PERFORM cron.schedule('fye-academic-lifecycle','* * * * *','SELECT public.reconcile_academic_lifecycle();');
 ELSE RAISE EXCEPTION 'Enable pg_cron before installing the lifecycle scheduler.'; END IF;
END $$;
INSERT INTO public.fye_schema_versions(version) VALUES('academic-demo-workflows-v1') ON CONFLICT DO NOTHING;
INSERT INTO public.fye_contract_baseline(id,schema_hash) VALUES(true,public.fye_contract_hash()) ON CONFLICT(id) DO UPDATE SET schema_hash=EXCLUDED.schema_hash;




-- SOURCE: 20261019050000_dashboard_read_performance.sql
-- Keep full-cohort directory reads within the API statement timeout.

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




-- SOURCE: 20261020000000_update_titles.sql
-- Apply to an existing deployment after its current migrations.
-- Preserve the selected update title throughout supervisor notifications.


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





-- SOURCE: 20261020010000_natural_account_labels.sql
-- Apply after the current demo and update-title migrations.
-- Natural visible account/content labels retain protected batch ownership and cleanup.


CREATE OR REPLACE FUNCTION public.demo_seed_profile(p_batch text,p_key text,p_id uuid,p_details jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p profiles%ROWTYPE; intended text:=p_details->>'role';
BEGIN
 IF NOT EXISTS(SELECT 1 FROM fye_demo_batches WHERE id=p_batch AND status='loading') THEN RAISE EXCEPTION 'Start a loading batch first.'; END IF;
 IF intended NOT IN ('student','mentor','supervisor','admin') OR intended IS NULL THEN RAISE EXCEPTION 'Invalid demo role.'; END IF;
 IF NOT coalesce(CASE WHEN intended IN ('student','mentor') THEN
  p_key=p_batch||'/programme/'||(p_details->>'programme_id')||'/'||intended||'/'||split_part(p_key,'/',5)
  AND split_part(p_key,'/',5) ~ '^[1-9][0-9]*$' AND (p_details->>'student_number') ~ '^[0-9]{9}$'
 ELSE p_key=p_batch||'/staff/'||intended END,false) THEN RAISE EXCEPTION 'Seed identity does not match its protected key.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_id AND raw_app_meta_data->>'fye_demo_batch'=p_batch
 AND raw_app_meta_data->>'fye_seed_key'=p_key AND email=p_details->>'email'
 AND (email LIKE 'demo.'||p_batch||'.%@example.test'
  OR (intended IN ('student','mentor') AND email=(p_details->>'student_number')||'@ump.ac.za')
  OR (intended IN ('admin','supervisor') AND email ~ '^[a-z][a-z0-9]*([.][a-z][a-z0-9]*)+@ump[.]ac[.]za$')))
 THEN RAISE EXCEPTION 'Auth account is not owned by this demo batch.'; END IF;
 SELECT * INTO p FROM profiles WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO profiles(id,email) SELECT id,email FROM auth.users WHERE id=p_id;
  SELECT * INTO p FROM profiles WHERE id=p_id FOR UPDATE;
 END IF;
 IF p.demo_batch IS NOT NULL THEN
  IF p.demo_batch<>p_batch THEN RAISE EXCEPTION 'Account belongs to a different batch.'; END IF;
  RETURN to_jsonb(p); -- Resume never overwrites manual demo edits.
 END IF;
 IF intended IN ('student','mentor') AND NOT EXISTS(SELECT 1 FROM programmes q WHERE q.id=(p_details->>'programme_id')::bigint
 AND q.faculty_id=(p_details->>'faculty_id')::bigint AND q.qualification_level=p_details->>'qualification_level'
 AND (p_details->>'study_year')::int BETWEEN 1 AND q.max_study_year
 AND ((p_details->>'entry_status')<>'first_time' OR (q.first_time_entry AND q.qualification_level='undergraduate' AND (p_details->>'study_year')::int=1 AND (p_details->>'first_entry_year')::int=extract(year FROM fye_today()))))
 THEN RAISE EXCEPTION 'Demo academic details do not match the reviewed catalogue.'; END IF;
 IF EXISTS(SELECT 1 FROM profiles WHERE student_number=p_details->>'student_number' AND id<>p_id) THEN RAISE EXCEPTION 'Student number collision.'; END IF;
 UPDATE profiles SET demo_batch=p_batch,full_name=p_details->>'full_name',first_name=p_details->>'first_name',last_name=p_details->>'last_name',
 role=CASE WHEN intended='mentor' THEN 'student' ELSE intended END,
 faculty_id=(p_details->>'faculty_id')::bigint,programme_id=(p_details->>'programme_id')::bigint,
 study_year=(p_details->>'study_year')::smallint,student_number=p_details->>'student_number',
 first_entry_year=(p_details->>'first_entry_year')::smallint,entry_status=p_details->>'entry_status',
 language_preference=p_details->>'language_preference',school=coalesce(nullif(btrim(p_details->>'school'),''),
  (SELECT name FROM faculties WHERE id=(p_details->>'faculty_id')::bigint),'Student Affairs') WHERE id=p_id;
 -- A separate update follows metadata invalidation, so only trusted seed data is preverified.
 UPDATE profiles SET academic_verified_at=CASE WHEN intended IN ('student','mentor') THEN now() END WHERE id=p_id;
 UPDATE fye_demo_records SET seed_key=p_key WHERE batch_id=p_batch AND table_name='profiles' AND record_id=p_id::text;
 SELECT * INTO p FROM profiles WHERE id=p_id; RETURN to_jsonb(p);
END $$;

CREATE OR REPLACE FUNCTION public.demo_historical_event(p_batch text,p_key text,p_mentor_id uuid,p_supervisor_id uuid,p_attendees uuid[]) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE eid bigint; fid bigint; attendee uuid;
BEGIN
 PERFORM 1 FROM fye_demo_batches WHERE id=p_batch AND status='loading' FOR UPDATE;
 IF NOT FOUND OR fye_profile_batch(p_mentor_id) IS DISTINCT FROM p_batch OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_supervisor_id AND role='supervisor' AND demo_batch=p_batch)
 THEN RAISE EXCEPTION 'Historical events require marked demo participants.'; END IF;
 SELECT record_id::bigint INTO eid FROM fye_demo_records WHERE batch_id=p_batch AND table_name='calendar_events' AND seed_key=p_key;
 IF eid IS NOT NULL THEN RETURN eid; END IF;
 SELECT faculty_id INTO fid FROM profiles WHERE id=p_mentor_id;
 INSERT INTO calendar_events(title,event_type,description,starts_at,ends_at,location,created_by,audience,organizer_id,faculty_id,faculty_only,event_status,completed_at,attendance_token)
 VALUES('Faculty study workshop','event','Study planning and academic support session for students in the faculty.',now()-interval '3 days',now()-interval '3 days'+interval '1 hour','Faculty seminar room',p_supervisor_id,'university',p_mentor_id,fid,true,'completed',now()-interval '3 days'+interval '1 hour',gen_random_uuid()::text) RETURNING id INTO eid;
 UPDATE fye_demo_records SET seed_key=p_key WHERE batch_id=p_batch AND table_name='calendar_events' AND record_id=eid::text;
 FOREACH attendee IN ARRAY p_attendees LOOP
  IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=attendee AND demo_batch=p_batch AND faculty_id=fid AND role='student') THEN RAISE EXCEPTION 'Historical attendance is limited to students from the same demo cohort and faculty.'; END IF;
  INSERT INTO event_attendance(calendar_event_id,attendee_id,attendance_method,recorded_by,correction_reason,checked_in_at)
  VALUES(eid,attendee,'manual',p_supervisor_id,'Attendance verified by the faculty supervisor.',now()-interval '3 days'+interval '10 minutes');
 END LOOP;
 RETURN eid;
END $$;

REVOKE ALL ON FUNCTION public.demo_seed_profile(text,text,uuid,jsonb),public.demo_historical_event(text,text,uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.demo_seed_profile(text,text,uuid,jsonb),public.demo_historical_event(text,text,uuid,uuid,uuid[]) TO service_role;

-- Keep existing accounts, content, passwords and seed manifests unchanged.
-- Refresh the optional schema contract after replacing the routine definitions.
INSERT INTO public.fye_contract_baseline(id,schema_hash) VALUES(true,public.fye_contract_hash())
 ON CONFLICT(id) DO UPDATE SET schema_hash=EXCLUDED.schema_hash;



COMMIT;
NOTIFY pgrst,'reload schema';
