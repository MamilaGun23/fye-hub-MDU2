-- Apply after the existing migrations, including 20261009000000.
BEGIN;
ALTER TABLE public.event_requests ADD COLUMN IF NOT EXISTS faculty_id BIGINT REFERENCES public.faculties(id);
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS faculty_id BIGINT REFERENCES public.faculties(id);
ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS faculty_only BOOLEAN NOT NULL DEFAULT false;
DROP TRIGGER IF EXISTS scope_mentor_event_request ON public.event_requests;
UPDATE public.event_requests r SET faculty_id = p.faculty_id
FROM public.profiles p WHERE p.id = r.mentor_id AND r.faculty_id IS NULL;
UPDATE public.calendar_events e SET faculty_id = r.faculty_id
FROM public.event_requests r WHERE r.calendar_event_id = e.id AND e.faculty_id IS NULL;
UPDATE public.calendar_events e SET faculty_only=true WHERE EXISTS(SELECT 1 FROM public.event_requests r WHERE r.calendar_event_id=e.id);

CREATE OR REPLACE FUNCTION public.scope_mentor_event_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE mentor_faculty BIGINT;
BEGIN
  SELECT faculty_id INTO mentor_faculty FROM public.profiles
  WHERE id = NEW.mentor_id AND is_active = true;
  IF mentor_faculty IS NULL THEN RAISE EXCEPTION 'Assign the mentor to a faculty before requesting an event.'; END IF;
  IF TG_OP = 'INSERT' THEN NEW.faculty_id := mentor_faculty;
  ELSIF NEW.faculty_id IS DISTINCT FROM OLD.faculty_id THEN
    RAISE EXCEPTION 'The faculty of an event request cannot be changed.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS scope_mentor_event_request ON public.event_requests;
CREATE TRIGGER scope_mentor_event_request BEFORE INSERT OR UPDATE OF faculty_id ON public.event_requests
FOR EACH ROW EXECUTE FUNCTION public.scope_mentor_event_request();

-- Keep the approved request, calendar, QR token and faculty on one event record.
CREATE OR REPLACE FUNCTION public.sync_event_request_to_calendar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.calendar_event_id IS NOT NULL THEN
    UPDATE public.calendar_events SET attendance_token = COALESCE(NEW.qr_token, attendance_token),
      organizer_id = NEW.mentor_id, faculty_id = NEW.faculty_id, faculty_only=true WHERE id = NEW.calendar_event_id;
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      INSERT INTO public.event_activity_log(calendar_event_id, actor_id, action_type, details)
      VALUES(NEW.calendar_event_id, NEW.approved_by, 'request_approved', jsonb_build_object('mentor_id',NEW.mentor_id,'title',NEW.title));
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.review_event_request(p_event_id UUID,p_decision TEXT,p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE req public.event_requests%ROWTYPE; event_id BIGINT; token TEXT; starts TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='supervisor' AND is_active=true) THEN RAISE EXCEPTION 'Active supervisor access is required.'; END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Choose approve or decline.'; END IF;
  IF p_decision='rejected' AND NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A decline reason is required.'; END IF;
  SELECT * INTO req FROM public.event_requests WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR req.status<>'pending' THEN RAISE EXCEPTION 'This request is no longer pending.'; END IF;
  IF p_decision='rejected' THEN
    UPDATE public.event_requests SET status='rejected',supervisor_note=btrim(p_reason),approved_by=auth.uid(),updated_at=now() WHERE id=req.id;
    INSERT INTO public.event_notifications(recipient_id,event_request_id,notification_type,title,message,scheduled_for)
    VALUES(req.mentor_id,req.id,'rejected',left('Event declined: '||req.title,200),btrim(p_reason),now());
    RETURN;
  END IF;
  starts:=(req.event_date+req.event_time) AT TIME ZONE 'Africa/Johannesburg';
  IF starts<=now() THEN RAISE EXCEPTION 'Only future events can be approved.'; END IF;
  IF req.faculty_id IS NULL THEN RAISE EXCEPTION 'The request needs an assigned faculty before approval.'; END IF;
  IF NOT public.mentor_application_is_approved(req.mentor_id) OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=req.mentor_id AND is_active=true AND faculty_id=req.faculty_id) THEN RAISE EXCEPTION 'The requesting mentor must still be active and assigned to the request faculty.'; END IF;
  token:=gen_random_uuid()::TEXT;
  INSERT INTO public.calendar_events(title,event_type,description,starts_at,ends_at,location,created_by,audience,organizer_id,attendance_token,event_status,faculty_id,faculty_only)
  VALUES(req.title,'event',req.purpose,starts,starts+INTERVAL '2 hours',req.venue,auth.uid(),'university',req.mentor_id,token,'scheduled',req.faculty_id,true) RETURNING id INTO event_id;
  UPDATE public.event_requests SET status='approved',supervisor_note=NULLIF(btrim(p_reason),''),approved_by=auth.uid(),qr_token=token,calendar_event_id=event_id,updated_at=now() WHERE id=req.id;
  INSERT INTO public.event_notifications(recipient_id,event_request_id,calendar_event_id,notification_type,title,message,scheduled_for)
  SELECT id,req.id,event_id,'approved',left('New approved event: '||req.title,200),
    req.title||' is on '||to_char(starts AT TIME ZONE 'Africa/Johannesburg','DD Mon YYYY HH24:MI')||' in '||req.venue,now()
  FROM public.profiles WHERE role IN ('student','mentor') AND is_active=true AND faculty_id=req.faculty_id AND id<>req.mentor_id;
  INSERT INTO public.event_notifications(recipient_id,event_request_id,calendar_event_id,notification_type,title,message,qr_token,scheduled_for)
  VALUES(req.mentor_id,req.id,event_id,'approved',left('Event approved: '||req.title,200),'Share the attendance QR code with students in your faculty.',token,now());
  INSERT INTO public.event_notifications(recipient_id,event_request_id,calendar_event_id,notification_type,title,message,scheduled_for)
  SELECT p.id,req.id,event_id,reminder.kind,req.title,reminder.message,reminder.due
  FROM public.profiles p CROSS JOIN LATERAL (VALUES
    ('one_day_reminder'::TEXT,req.title||' takes place tomorrow.',starts-INTERVAL '1 day'),
    ('one_hour_reminder'::TEXT,req.title||' starts in one hour.',starts-INTERVAL '1 hour')
  ) reminder(kind,message,due)
  WHERE p.role IN ('student','mentor') AND p.is_active=true AND p.faculty_id=req.faculty_id AND reminder.due>now();
END; $$;

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.calendar_events TO authenticated;
DROP POLICY IF EXISTS "FYE event audience" ON public.calendar_events;
CREATE POLICY "FYE event audience" ON public.calendar_events FOR SELECT TO authenticated USING (
  event_type = 'event' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
    AND (p.role IN ('admin','supervisor') OR (p.role IN ('student','mentor') AND event_status <> 'cancelled'
      AND ((NOT calendar_events.faculty_only AND calendar_events.faculty_id IS NULL) OR p.faculty_id = calendar_events.faculty_id))))
);
-- A restrictive policy also constrains any broader policies in the original schema.
DROP POLICY IF EXISTS "Enforce faculty event visibility" ON public.calendar_events;
CREATE POLICY "Enforce faculty event visibility" ON public.calendar_events AS RESTRICTIVE FOR SELECT TO public USING (
  event_type <> 'event' OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_active = true
    AND (p.role IN ('admin','supervisor') OR (p.role IN ('student','mentor') AND event_status <> 'cancelled'
      AND ((NOT calendar_events.faculty_only AND calendar_events.faculty_id IS NULL) OR p.faculty_id = calendar_events.faculty_id))))
);
DROP POLICY IF EXISTS "Only supervisors publish events" ON public.calendar_events;
CREATE POLICY "Only supervisors publish events" ON public.calendar_events AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (
  EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='supervisor' AND is_active=true)
);
DROP POLICY IF EXISTS "Only supervisors change events" ON public.calendar_events;
CREATE POLICY "Only supervisors change events" ON public.calendar_events AS RESTRICTIVE FOR UPDATE TO authenticated USING (
  EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='supervisor' AND is_active=true)
) WITH CHECK (EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='supervisor' AND is_active=true));

CREATE OR REPLACE FUNCTION public.scope_event_notification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE event_faculty BIGINT; target_faculty BIGINT; target_role TEXT;
BEGIN
  SELECT faculty_id INTO event_faculty FROM public.calendar_events
  WHERE id = COALESCE(NEW.calendar_event_id, (SELECT calendar_event_id FROM public.event_requests WHERE id = NEW.event_request_id));
  SELECT faculty_id, role INTO target_faculty,target_role FROM public.profiles WHERE id = NEW.recipient_id;
  IF event_faculty IS NOT NULL AND target_role IN ('student','mentor') AND target_faculty IS DISTINCT FROM event_faculty THEN RETURN NULL; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS z_scope_event_notification ON public.event_notifications;
CREATE TRIGGER z_scope_event_notification BEFORE INSERT ON public.event_notifications
FOR EACH ROW EXECUTE FUNCTION public.scope_event_notification();

-- Scoped approval and cancellation own their complete recipient lists. The
-- legacy copying trigger must not duplicate them or consume the QR notice.
CREATE OR REPLACE FUNCTION public.copy_student_event_notifications_to_mentors()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE event_row public.calendar_events%ROWTYPE;
BEGIN
  IF NEW.notification_type='event_cancelled' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.recipient_id AND role='student') THEN RETURN NEW; END IF;
  SELECT * INTO event_row FROM public.calendar_events WHERE id=COALESCE(NEW.calendar_event_id,(SELECT calendar_event_id FROM public.event_requests WHERE id=NEW.event_request_id));
  IF event_row.faculty_only THEN RETURN NEW; END IF;
  INSERT INTO public.event_notifications(recipient_id,event_request_id,calendar_event_id,notification_type,title,message,qr_token,scheduled_for)
  SELECT p.id,NEW.event_request_id,NEW.calendar_event_id,NEW.notification_type,NEW.title,NEW.message,NULL,NEW.scheduled_for
  FROM public.profiles p WHERE p.role='mentor' AND p.is_active=true AND p.id IS DISTINCT FROM event_row.organizer_id
    AND (event_row.faculty_id IS NULL OR p.faculty_id=event_row.faculty_id)
    AND NOT EXISTS(SELECT 1 FROM public.event_notifications n WHERE n.recipient_id=p.id AND n.notification_type=NEW.notification_type
      AND ((NEW.event_request_id IS NOT NULL AND n.event_request_id=NEW.event_request_id) OR (NEW.calendar_event_id IS NOT NULL AND n.calendar_event_id=NEW.calendar_event_id)))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
-- Remove old notifications that previously advertised faculty events to other faculties.
DELETE FROM public.event_notifications n USING public.calendar_events e, public.profiles p
WHERE n.calendar_event_id=e.id AND n.recipient_id=p.id AND e.faculty_id IS NOT NULL
AND p.role IN ('student','mentor') AND p.faculty_id IS DISTINCT FROM e.faculty_id;

CREATE OR REPLACE FUNCTION public.enforce_attendance_faculty()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE event_faculty BIGINT; attendee_faculty BIGINT; faculty_event BOOLEAN;
BEGIN
  SELECT faculty_id,faculty_only INTO event_faculty,faculty_event FROM public.calendar_events WHERE id=NEW.calendar_event_id;
  SELECT faculty_id INTO attendee_faculty FROM public.profiles WHERE id=NEW.attendee_id;
  IF (faculty_event AND event_faculty IS NULL) OR (event_faculty IS NOT NULL AND attendee_faculty IS DISTINCT FROM event_faculty) THEN
    RAISE EXCEPTION 'Only attendees from the event faculty can check in.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS enforce_attendance_faculty ON public.event_attendance;
CREATE TRIGGER enforce_attendance_faculty BEFORE INSERT OR UPDATE OF attendee_id, calendar_event_id ON public.event_attendance
FOR EACH ROW EXECUTE FUNCTION public.enforce_attendance_faculty();

CREATE OR REPLACE FUNCTION public.mark_event_attendance(p_qr_token TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE attendee UUID:=auth.uid(); event_row public.calendar_events%ROWTYPE; request_id UUID; attendance_id UUID;
BEGIN
  IF attendee IS NULL OR NOT public.is_fye_student(attendee) THEN RAISE EXCEPTION 'Sign in with an active student or mentor account.'; END IF;
  SELECT * INTO event_row FROM public.calendar_events WHERE attendance_token=p_qr_token AND event_type='event' AND event_status='scheduled' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This attendance code is invalid, cancelled, or no longer active.'; END IF;
  IF (event_row.faculty_only OR event_row.faculty_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=attendee AND faculty_id=event_row.faculty_id) THEN RAISE EXCEPTION 'This event is restricted to its faculty.'; END IF;
  IF now()<event_row.starts_at-INTERVAL '1 hour' OR now()>event_row.ends_at+INTERVAL '2 hours' THEN RAISE EXCEPTION 'The check-in window is closed.'; END IF;
  SELECT id INTO request_id FROM public.event_requests WHERE calendar_event_id=event_row.id LIMIT 1;
  INSERT INTO public.event_attendance(event_request_id,calendar_event_id,attendee_id,attendance_method,recorded_by)
  VALUES(request_id,event_row.id,attendee,'qr',attendee) ON CONFLICT DO NOTHING RETURNING id INTO attendance_id;
  IF attendance_id IS NOT NULL THEN
    INSERT INTO public.event_activity_log(calendar_event_id,actor_id,action_type,details) VALUES(event_row.id,attendee,'attendance_added',jsonb_build_object('method','qr'));
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.get_approved_event_for_attendance(p_qr_token TEXT)
RETURNS TABLE(title VARCHAR,purpose TEXT,event_date DATE,event_time TIME,venue VARCHAR,can_check_in BOOLEAN,check_in_message TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.title::VARCHAR,COALESCE(r.purpose,e.description)::TEXT,
    (e.starts_at AT TIME ZONE 'Africa/Johannesburg')::DATE,(e.starts_at AT TIME ZONE 'Africa/Johannesburg')::TIME,e.location::VARCHAR,
    e.event_status='scheduled' AND now() BETWEEN e.starts_at-INTERVAL '1 hour' AND e.ends_at+INTERVAL '2 hours',
    CASE WHEN e.event_status<>'scheduled' THEN 'This event is no longer active.'
      WHEN now()<e.starts_at-INTERVAL '1 hour' THEN 'Check-in opens one hour before the event.'
      WHEN now()>e.ends_at+INTERVAL '2 hours' THEN 'The check-in window has closed.' ELSE 'Check in to record your attendance.' END
  FROM public.calendar_events e LEFT JOIN public.event_requests r ON r.calendar_event_id=e.id
  WHERE e.attendance_token=p_qr_token AND e.event_type='event'
  AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active=true
    AND (p.role IN ('admin','supervisor') OR (p.role IN ('student','mentor') AND ((NOT e.faculty_only AND e.faculty_id IS NULL) OR p.faculty_id=e.faculty_id)))) LIMIT 1;
$$;

CREATE TABLE IF NOT EXISTS public.event_cancellation_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_event_id BIGINT NOT NULL REFERENCES public.calendar_events(id),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id),
  reason TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','declined','completed')),
  review_note TEXT, reviewed_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), reviewed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS event_cancellation_open_idx ON public.event_cancellation_requests(calendar_event_id)
WHERE status IN ('pending','approved');
ALTER TABLE public.event_cancellation_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.event_cancellation_requests TO authenticated;
DROP POLICY IF EXISTS "Read event cancellation requests" ON public.event_cancellation_requests;
CREATE POLICY "Read event cancellation requests" ON public.event_cancellation_requests FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active=true
    AND (p.role='supervisor' OR p.id=mentor_id))
);

CREATE OR REPLACE FUNCTION public.request_event_cancellation(p_event_id BIGINT,p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE request_id UUID; event_row public.calendar_events%ROWTYPE;
BEGIN
  SELECT * INTO event_row FROM public.calendar_events WHERE id=p_event_id FOR UPDATE;
  IF NOT FOUND OR event_row.event_status<>'scheduled' OR event_row.organizer_id IS DISTINCT FROM auth.uid()
    OR NOT public.mentor_application_is_approved(auth.uid()) THEN RAISE EXCEPTION 'Only the event mentor can request cancellation of a scheduled event.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active=true) THEN RAISE EXCEPTION 'Active account required.'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL OR length(btrim(p_reason))>1000 THEN RAISE EXCEPTION 'Enter a reason of 1 to 1000 characters.'; END IF;
  INSERT INTO public.event_cancellation_requests(calendar_event_id,mentor_id,reason)
  VALUES(p_event_id,auth.uid(),btrim(p_reason)) RETURNING id INTO request_id;
  -- Use the existing event-request notification category to retain compatibility.
  INSERT INTO public.supervisor_notifications(recipient_id,notification_type,subject_id,title,message)
  SELECT id,'event_request','cancellation:'||request_id::TEXT,'Cancellation requested: '||event_row.title,btrim(p_reason)
  FROM public.profiles WHERE role='supervisor' AND is_active=true;
END; $$;

CREATE OR REPLACE FUNCTION public.review_event_cancellation(p_request_id UUID,p_approve BOOLEAN,p_note TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE req public.event_cancellation_requests%ROWTYPE; event_row public.calendar_events%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='supervisor' AND is_active=true) THEN RAISE EXCEPTION 'Active supervisor access is required.'; END IF;
  IF p_approve IS NULL THEN RAISE EXCEPTION 'Choose approve or decline.'; END IF;
  IF NOT p_approve AND NULLIF(btrim(p_note),'') IS NULL THEN RAISE EXCEPTION 'Provide a reason when declining.'; END IF;
  SELECT * INTO req FROM public.event_cancellation_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR req.status<>'pending' THEN RAISE EXCEPTION 'This cancellation request is no longer pending.'; END IF;
  SELECT * INTO event_row FROM public.calendar_events WHERE id=req.calendar_event_id;
  IF event_row.event_status<>'scheduled' THEN RAISE EXCEPTION 'The event is no longer scheduled.'; END IF;
  UPDATE public.event_cancellation_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
    review_note=p_note,reviewed_by=auth.uid(),reviewed_at=now() WHERE id=req.id;
  INSERT INTO public.event_notifications(recipient_id,calendar_event_id,notification_type,title,message,scheduled_for)
  VALUES(req.mentor_id,req.calendar_event_id,'event_updated',
    left(CASE WHEN p_approve THEN 'Cancellation approved: ' ELSE 'Cancellation declined: ' END||event_row.title,200),
    CASE WHEN p_approve THEN 'Your supervisor approved the cancellation request. The event remains scheduled until removed from the calendar.'
      ELSE 'The event remains scheduled. '||p_note END,now());
END; $$;

-- All cancellation paths notify the full affected student/mentor audience, remove
-- reminders, and close any cancellation request without deleting attendance history.
CREATE OR REPLACE FUNCTION public.finish_event_cancellation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.event_status='cancelled' AND OLD.event_status IS DISTINCT FROM NEW.event_status THEN
    UPDATE public.event_cancellation_requests SET status='completed' WHERE calendar_event_id=NEW.id AND status IN ('pending','approved');
    DELETE FROM public.event_notifications WHERE calendar_event_id=NEW.id AND notification_type IN ('one_day_reminder','one_hour_reminder') AND scheduled_for>now();
    INSERT INTO public.event_notifications(recipient_id,calendar_event_id,notification_type,title,message,scheduled_for)
    SELECT p.id,NEW.id,'event_cancelled',left('Event cancelled: '||NEW.title,200),NEW.title||' was cancelled. Reason: '||COALESCE(NEW.cancellation_reason,'Contact your supervisor.'),now()
    FROM public.profiles p WHERE p.is_active=true AND p.role IN ('student','mentor')
      AND (NEW.faculty_id IS NULL OR p.faculty_id=NEW.faculty_id)
      AND NOT EXISTS(SELECT 1 FROM public.event_notifications n WHERE n.calendar_event_id=NEW.id AND n.recipient_id=p.id AND n.notification_type='event_cancelled');
  END IF;
  IF NEW.event_status='completed' AND OLD.event_status IS DISTINCT FROM NEW.event_status THEN
    UPDATE public.event_cancellation_requests SET status='declined',review_note='The event was marked complete before cancellation.',reviewed_by=auth.uid(),reviewed_at=now()
    WHERE calendar_event_id=NEW.id AND status IN ('pending','approved');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS finish_event_cancellation ON public.calendar_events;
CREATE TRIGGER finish_event_cancellation AFTER UPDATE OF event_status ON public.calendar_events
FOR EACH ROW EXECUTE FUNCTION public.finish_event_cancellation();

CREATE OR REPLACE FUNCTION public.cancel_supervisor_event(p_event_id BIGINT,p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='supervisor' AND is_active=true) THEN RAISE EXCEPTION 'Active supervisor access is required.'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A cancellation reason is required.'; END IF;
  PERFORM 1 FROM public.calendar_events WHERE id=p_event_id AND event_type='event' AND event_status='scheduled' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only scheduled events can be cancelled.'; END IF;
  UPDATE public.calendar_events SET event_status='cancelled',cancelled_at=now(),cancellation_reason=btrim(p_reason) WHERE id=p_event_id;
  INSERT INTO public.event_activity_log(calendar_event_id,actor_id,action_type,details)
  VALUES(p_event_id,auth.uid(),'event_cancelled',jsonb_build_object('reason',btrim(p_reason)));
END; $$;

-- Admin detail views and reports share a single authorised source of truth.
CREATE OR REPLACE FUNCTION public.get_admin_analytics_details(p_metric TEXT,p_period_days INTEGER DEFAULT 90)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result JSONB; period_start TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active=true) THEN RAISE EXCEPTION 'Active admin access is required.'; END IF;
  IF p_period_days IS NULL OR p_period_days NOT IN (0,30,90,365) THEN RAISE EXCEPTION 'Unsupported period.'; END IF;
  period_start:=CASE WHEN p_period_days=0 THEN NULL ELSE now()-make_interval(days=>p_period_days) END;
  IF p_metric IN ('students','mentors','disabled') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('profile_id',id,'name',full_name,'email',email,'role',role,'faculty_id',faculty_id,'programme_id',programme_id,'active',is_active) ORDER BY full_name),'[]'::JSONB) INTO result
    FROM public.profiles WHERE (p_metric='students' AND role IN ('student','mentor') AND is_active=true)
      OR (p_metric='mentors' AND role='mentor' AND is_active=true)
      OR (p_metric='disabled' AND role IN ('student','mentor') AND is_active=false);
  ELSIF p_metric IN ('events','upcoming') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('event_id',e.id,'title',e.title,'starts_at',e.starts_at,'status',e.event_status,'faculty_id',e.faculty_id,
      'students_attended',(SELECT count(*) FROM public.event_attendance a JOIN public.profiles p ON p.id=a.attendee_id WHERE a.calendar_event_id=e.id AND a.is_valid=true AND p.role='student'),
      'total_attendance',(SELECT count(*) FROM public.event_attendance a WHERE a.calendar_event_id=e.id AND a.is_valid=true)) ORDER BY e.starts_at DESC),'[]'::JSONB) INTO result
    FROM public.calendar_events e WHERE e.event_type='event' AND
      ((p_metric='events' AND (period_start IS NULL OR e.starts_at>=period_start)) OR (p_metric='upcoming' AND e.event_status='scheduled' AND e.starts_at>=now()));
  ELSIF p_metric='assignments' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('student_id',a.student_id,'student',s.full_name,'mentor_id',a.mentor_id,'mentor',m.full_name,'assigned_at',a.assigned_at)),'[]'::JSONB) INTO result
    FROM public.mentor_assignments a LEFT JOIN public.profiles s ON s.id=a.student_id LEFT JOIN public.profiles m ON m.id=a.mentor_id WHERE a.ended_at IS NULL;
  ELSIF p_metric='notices' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('title',title,'starts_at',starts_at,'ends_at',ends_at,'status',CASE WHEN starts_at>now() THEN 'Scheduled' ELSE 'Showing' END)),'[]'::JSONB) INTO result
    FROM public.system_notices WHERE is_active=true AND (ends_at IS NULL OR ends_at>now());
  ELSE RAISE EXCEPTION 'Unsupported analytics metric.'; END IF;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_admin_event_attendance(p_event_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active=true) THEN RAISE EXCEPTION 'Active admin access is required.'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('profile_id',p.id,'name',p.full_name,'email',p.email,'role',p.role,'checked_in_at',a.checked_in_at,'method',a.attendance_method) ORDER BY a.checked_in_at),'[]'::JSONB)
  INTO result FROM public.event_attendance a JOIN public.profiles p ON p.id=a.attendee_id WHERE a.calendar_event_id=p_event_id AND a.is_valid=true;
  RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.expire_system_notices()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active=true) THEN RAISE EXCEPTION 'Active admin access is required.'; END IF;
  UPDATE public.system_notices SET is_active=false WHERE is_active=true AND ends_at IS NOT NULL AND ends_at<=now();
END; $$;
SELECT public.expire_system_notices();

CREATE OR REPLACE FUNCTION public.stop_expired_notice_on_write()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.ends_at IS NOT NULL AND NEW.ends_at<=now() THEN NEW.is_active:=false; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS stop_expired_notice_on_write ON public.system_notices;
CREATE TRIGGER stop_expired_notice_on_write BEFORE INSERT OR UPDATE OF is_active,ends_at ON public.system_notices
FOR EACH ROW EXECUTE FUNCTION public.stop_expired_notice_on_write();

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
    AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='calendar_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_events;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime')
    AND NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='event_notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_notifications;
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.request_event_cancellation(BIGINT,TEXT),public.review_event_cancellation(UUID,BOOLEAN,TEXT),public.get_admin_analytics_details(TEXT,INTEGER),public.get_admin_event_attendance(BIGINT),public.expire_system_notices() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_event_request(UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_event_request(UUID,TEXT,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_event_attendance(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_event_attendance(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.get_approved_event_for_attendance(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_approved_event_for_attendance(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_event_cancellation(BIGINT,TEXT),public.review_event_cancellation(UUID,BOOLEAN,TEXT),public.get_admin_analytics_details(TEXT,INTEGER),public.get_admin_event_attendance(BIGINT),public.expire_system_notices() TO authenticated;
REVOKE ALL ON FUNCTION public.scope_mentor_event_request(),public.scope_event_notification(),public.enforce_attendance_faculty(),public.finish_event_cancellation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.copy_student_event_notifications_to_mentors() FROM PUBLIC;
NOTIFY pgrst,'reload schema';

-- Expired notices are excluded immediately, even between scheduled sweeps.
CREATE OR REPLACE FUNCTION public.get_admin_analytics(p_period_days INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  period_start TIMESTAMPTZ;
  event_total BIGINT;
  upcoming_total BIGINT;
  student_total BIGINT;
  mentor_total BIGINT;
  disabled_total BIGINT;
  assignment_total BIGINT;
  notice_total BIGINT;
  monthly_events JSONB;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active admin access is required.';
  END IF;

  IF p_period_days IS NULL OR p_period_days NOT IN (0, 30, 90, 365) THEN
    RAISE EXCEPTION 'Choose a supported analytics period.';
  END IF;

  period_start := CASE
    WHEN p_period_days = 0 THEN NULL
    ELSE now() - make_interval(days => p_period_days)
  END;

  SELECT count(*) INTO student_total
  FROM public.profiles
  WHERE role IN ('student', 'mentor') AND is_active = true;

  SELECT count(*) INTO mentor_total
  FROM public.profiles
  WHERE role = 'mentor' AND is_active = true;

  SELECT count(*) INTO disabled_total
  FROM public.profiles
  WHERE role IN ('student', 'mentor') AND is_active = false;

  SELECT count(*) INTO event_total
  FROM public.calendar_events
  WHERE event_type = 'event'
    AND (period_start IS NULL OR starts_at >= period_start);

  SELECT count(*) INTO upcoming_total
  FROM public.calendar_events
  WHERE event_type = 'event'
    AND event_status = 'scheduled'
    AND starts_at >= now();

  SELECT count(*) INTO assignment_total
  FROM public.mentor_assignments
  WHERE ended_at IS NULL;

  SELECT count(*) INTO notice_total
  FROM public.system_notices
  WHERE is_active = true AND (ends_at IS NULL OR ends_at > now());

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('month', monthly.month_start, 'count', monthly.event_count)
      ORDER BY monthly.month_start),
    '[]'::JSONB
  ) INTO monthly_events
  FROM (
    SELECT date_trunc('month', starts_at)::DATE AS month_start, count(*) AS event_count
    FROM public.calendar_events
    WHERE event_type = 'event'
      AND (period_start IS NULL OR starts_at >= period_start)
    GROUP BY date_trunc('month', starts_at)::DATE
  ) AS monthly;

  RETURN jsonb_build_object(
    'active_students', student_total,
    'active_mentors', mentor_total,
    'disabled_profiles', disabled_total,
    'events_in_period', event_total,
    'upcoming_events', upcoming_total,
    'active_assignments', assignment_total,
    'active_notices', notice_total,
    'events_by_month', monthly_events
  );
END;
$$;

COMMIT;
