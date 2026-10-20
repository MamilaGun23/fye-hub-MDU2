-- Apply after the current demo and update-title migrations.
-- Natural visible account/content labels retain protected batch ownership and cleanup.
BEGIN;

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
