-- Marked prototype data; all seed/cleanup RPCs below are service-role only.
BEGIN;
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
COMMIT;
NOTIFY pgrst,'reload schema';
