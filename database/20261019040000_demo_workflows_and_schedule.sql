BEGIN;
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
COMMIT;
NOTIFY pgrst,'reload schema';
