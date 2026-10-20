-- Apply after 20261011000000. Preserves existing users, applications and matches.
BEGIN;
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
COMMIT;
NOTIFY pgrst,'reload schema';
