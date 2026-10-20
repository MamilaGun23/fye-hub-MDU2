BEGIN;
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
COMMIT;
NOTIFY pgrst,'reload schema';
