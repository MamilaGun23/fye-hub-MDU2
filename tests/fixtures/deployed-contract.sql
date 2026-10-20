-- Sanitised schema-only deployed contract. No user records or credentials.
CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb DEFAULT '{}',raw_app_meta_data jsonb DEFAULT '{}');
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid,metadata jsonb);
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;
CREATE TABLE public."calendar_events"("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,"title" text NOT NULL,"event_type" text NOT NULL,"description" text,"starts_at" timestamp with time zone NOT NULL,"location" text,"created_by" uuid NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"audience" text DEFAULT 'university'::text NOT NULL,"event_status" text DEFAULT 'scheduled'::text NOT NULL,"ends_at" timestamp with time zone,"attendance_token" text,"cancelled_at" timestamp with time zone,"cancellation_reason" text,"completed_at" timestamp with time zone,"completion_note" text,"mentor_outcome" text,"organizer_id" uuid,"faculty_id" bigint,"faculty_only" boolean DEFAULT false NOT NULL);
CREATE TABLE public."event_activity_log"("id" uuid DEFAULT gen_random_uuid() NOT NULL,"calendar_event_id" bigint NOT NULL,"actor_id" uuid,"action_type" text NOT NULL,"details" jsonb DEFAULT '{}'::jsonb NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public."event_attendance"("id" uuid DEFAULT gen_random_uuid() NOT NULL,"event_request_id" uuid,"attendee_id" uuid NOT NULL,"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,"calendar_event_id" bigint,"attendance_method" text DEFAULT 'qr'::text NOT NULL,"recorded_by" uuid,"correction_reason" text,"is_valid" boolean DEFAULT true NOT NULL,"invalidated_at" timestamp with time zone,"invalidated_by" uuid,"invalidation_reason" text);
CREATE TABLE public."event_cancellation_requests"("id" uuid DEFAULT gen_random_uuid() NOT NULL,"calendar_event_id" bigint NOT NULL,"mentor_id" uuid NOT NULL,"reason" text NOT NULL,"status" text DEFAULT 'pending'::text NOT NULL,"review_note" text,"reviewed_by" uuid,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"reviewed_at" timestamp with time zone);
CREATE TABLE public."event_notifications"("id" uuid DEFAULT gen_random_uuid() NOT NULL,"recipient_id" uuid NOT NULL,"event_request_id" uuid,"notification_type" text NOT NULL,"title" character varying(200) NOT NULL,"message" text NOT NULL,"qr_token" text,"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,"read_at" timestamp with time zone,"calendar_event_id" bigint);
CREATE TABLE public."event_requests"("id" uuid DEFAULT gen_random_uuid() NOT NULL,"mentor_id" uuid NOT NULL,"title" character varying(200) NOT NULL,"purpose" text NOT NULL,"event_date" date NOT NULL,"event_time" time without time zone NOT NULL,"venue" character varying(200) NOT NULL,"status" text DEFAULT 'pending'::text NOT NULL,"supervisor_note" text,"approved_by" uuid,"qr_token" text,"calendar_event_id" bigint,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL,"faculty_id" bigint);
CREATE TABLE public."faculties"("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,"name" text NOT NULL);
CREATE TABLE public."mentor_applications"("id" uuid DEFAULT gen_random_uuid() NOT NULL,"applicant_id" uuid NOT NULL,"student_number" text,"study_year" smallint,"previous_academic_year" text,"academic_record_path" text,"status" text DEFAULT 'pending'::text NOT NULL,"review_reason" text,"reviewed_by" uuid,"reviewed_at" timestamp with time zone,"is_legacy" boolean DEFAULT false NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"updated_at" timestamp with time zone DEFAULT now() NOT NULL,"school" text);
CREATE TABLE public."mentor_assignments"("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,"student_id" uuid NOT NULL,"mentor_id" uuid NOT NULL,"assigned_by" uuid NOT NULL,"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,"ended_at" timestamp with time zone);
CREATE TABLE public."mentor_contact_status"("mentor_id" uuid NOT NULL,"student_id" uuid NOT NULL,"last_contact_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public."mentor_student_conversations"("id" uuid DEFAULT gen_random_uuid() NOT NULL,"mentor_id" uuid NOT NULL,"student_id" uuid NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"last_message_at" timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public."mentor_student_messages"("id" uuid DEFAULT gen_random_uuid() NOT NULL,"mentor_id" uuid NOT NULL,"student_id" uuid NOT NULL,"sender_id" uuid NOT NULL,"body" text NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"read_at" timestamp with time zone);
CREATE TABLE public."profiles"("id" uuid NOT NULL,"email" text,"full_name" text DEFAULT ''::text NOT NULL,"role" text DEFAULT 'student'::text NOT NULL,"faculty_id" bigint,"programme_id" bigint,"bio" text,"avatar_path" text,"whatsapp_group_link" text,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"mentor_approval_status" text,"is_active" boolean DEFAULT true NOT NULL,"first_name" text,"last_name" text,"school" text,"study_year" smallint,"student_number" text);
CREATE TABLE public."programmes"("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,"faculty_id" bigint NOT NULL,"name" text NOT NULL);
CREATE TABLE public."supervisor_notifications"("id" uuid DEFAULT gen_random_uuid() NOT NULL,"recipient_id" uuid NOT NULL,"notification_type" text NOT NULL,"subject_id" text NOT NULL,"title" text NOT NULL,"message" text NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"read_at" timestamp with time zone);
CREATE TABLE public."system_notice_notifications"("id" uuid DEFAULT gen_random_uuid() NOT NULL,"system_notice_id" bigint NOT NULL,"recipient_id" uuid NOT NULL,"title" text NOT NULL,"message" text NOT NULL,"scheduled_for" timestamp with time zone NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL,"read_at" timestamp with time zone);
CREATE TABLE public."system_notices"("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,"title" text NOT NULL,"message" text NOT NULL,"starts_at" timestamp with time zone NOT NULL,"ends_at" timestamp with time zone,"is_active" boolean DEFAULT true NOT NULL,"created_by" uuid NOT NULL,"created_at" timestamp with time zone DEFAULT now() NOT NULL);
ALTER TABLE public."calendar_events" ADD CONSTRAINT "calendar_events_audience_check" CHECK ((audience = ANY (ARRAY['university'::text, 'mentor_group'::text])));
ALTER TABLE public."calendar_events" ADD CONSTRAINT "calendar_events_event_status_check" CHECK ((event_status = ANY (ARRAY['scheduled'::text, 'cancelled'::text, 'completed'::text])));
ALTER TABLE public."calendar_events" ADD CONSTRAINT "calendar_events_event_type_check" CHECK ((event_type = ANY (ARRAY['event'::text, 'test'::text, 'exam'::text])));
ALTER TABLE public."calendar_events" ADD CONSTRAINT "calendar_events_pkey" PRIMARY KEY (id);
ALTER TABLE public."event_activity_log" ADD CONSTRAINT "event_activity_log_action_type_check" CHECK ((action_type = ANY (ARRAY['request_approved'::text, 'event_created'::text, 'event_updated'::text, 'event_cancelled'::text, 'event_completed'::text, 'outcome_submitted'::text, 'attendance_added'::text, 'attendance_corrected'::text])));
ALTER TABLE public."event_activity_log" ADD CONSTRAINT "event_activity_log_pkey" PRIMARY KEY (id);
ALTER TABLE public."event_attendance" ADD CONSTRAINT "event_attendance_event_reference_check" CHECK (((event_request_id IS NOT NULL) OR (calendar_event_id IS NOT NULL)));
ALTER TABLE public."event_attendance" ADD CONSTRAINT "event_attendance_event_request_id_attendee_id_key" UNIQUE (event_request_id, attendee_id);
ALTER TABLE public."event_attendance" ADD CONSTRAINT "event_attendance_method_check" CHECK ((attendance_method = ANY (ARRAY['qr'::text, 'manual'::text])));
ALTER TABLE public."event_attendance" ADD CONSTRAINT "event_attendance_pkey" PRIMARY KEY (id);
ALTER TABLE public."event_cancellation_requests" ADD CONSTRAINT "event_cancellation_requests_pkey" PRIMARY KEY (id);
ALTER TABLE public."event_cancellation_requests" ADD CONSTRAINT "event_cancellation_requests_reason_check" CHECK (((length(btrim(reason)) >= 1) AND (length(btrim(reason)) <= 1000)));
ALTER TABLE public."event_cancellation_requests" ADD CONSTRAINT "event_cancellation_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'completed'::text])));
ALTER TABLE public."event_notifications" ADD CONSTRAINT "event_notifications_event_reference_check" CHECK (((event_request_id IS NOT NULL) OR (calendar_event_id IS NOT NULL)));
ALTER TABLE public."event_notifications" ADD CONSTRAINT "event_notifications_notification_type_check" CHECK ((notification_type = ANY (ARRAY['approved'::text, 'rejected'::text, 'one_day_reminder'::text, 'one_hour_reminder'::text, 'event_updated'::text, 'event_cancelled'::text, 'event_completed'::text])));
ALTER TABLE public."event_notifications" ADD CONSTRAINT "event_notifications_pkey" PRIMARY KEY (id);
ALTER TABLE public."event_notifications" ADD CONSTRAINT "event_notifications_recipient_id_event_request_id_notificat_key" UNIQUE (recipient_id, event_request_id, notification_type);
ALTER TABLE public."event_requests" ADD CONSTRAINT "event_requests_calendar_event_id_key" UNIQUE (calendar_event_id);
ALTER TABLE public."event_requests" ADD CONSTRAINT "event_requests_pkey" PRIMARY KEY (id);
ALTER TABLE public."event_requests" ADD CONSTRAINT "event_requests_qr_token_key" UNIQUE (qr_token);
ALTER TABLE public."event_requests" ADD CONSTRAINT "event_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE public."faculties" ADD CONSTRAINT "faculties_name_key" UNIQUE (name);
ALTER TABLE public."faculties" ADD CONSTRAINT "faculties_pkey" PRIMARY KEY (id);
ALTER TABLE public."mentor_applications" ADD CONSTRAINT "mentor_applications_applicant_id_key" UNIQUE (applicant_id);
ALTER TABLE public."mentor_applications" ADD CONSTRAINT "mentor_applications_pkey" PRIMARY KEY (id);
ALTER TABLE public."mentor_applications" ADD CONSTRAINT "mentor_applications_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'shortlisted'::text, 'approved'::text, 'declined'::text])));
ALTER TABLE public."mentor_applications" ADD CONSTRAINT "mentor_applications_study_year_check" CHECK (((study_year IS NULL) OR (study_year >= 2)));
ALTER TABLE public."mentor_assignments" ADD CONSTRAINT "mentor_assignments_check" CHECK ((student_id <> mentor_id));
ALTER TABLE public."mentor_assignments" ADD CONSTRAINT "mentor_assignments_pkey" PRIMARY KEY (id);
ALTER TABLE public."mentor_contact_status" ADD CONSTRAINT "mentor_contact_status_pkey" PRIMARY KEY (mentor_id, student_id);
ALTER TABLE public."mentor_student_conversations" ADD CONSTRAINT "mentor_student_conversations_different_users" CHECK ((mentor_id <> student_id));
ALTER TABLE public."mentor_student_conversations" ADD CONSTRAINT "mentor_student_conversations_pkey" PRIMARY KEY (id);
ALTER TABLE public."mentor_student_conversations" ADD CONSTRAINT "mentor_student_conversations_unique_pair" UNIQUE (mentor_id, student_id);
ALTER TABLE public."mentor_student_messages" ADD CONSTRAINT "mentor_student_messages_body_check" CHECK (((length(btrim(body)) >= 1) AND (length(btrim(body)) <= 2000)));
ALTER TABLE public."mentor_student_messages" ADD CONSTRAINT "mentor_student_messages_pkey" PRIMARY KEY (id);
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_email_key" UNIQUE (email);
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_mentor_approval_status_check" CHECK (((mentor_approval_status IS NULL) OR (mentor_approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))));
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY (id);
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_role_check" CHECK ((role = ANY (ARRAY['student'::text, 'mentor'::text, 'supervisor'::text, 'admin'::text])));
ALTER TABLE public."programmes" ADD CONSTRAINT "programmes_faculty_id_name_key" UNIQUE (faculty_id, name);
ALTER TABLE public."programmes" ADD CONSTRAINT "programmes_pkey" PRIMARY KEY (id);
ALTER TABLE public."supervisor_notifications" ADD CONSTRAINT "supervisor_notifications_notification_type_check" CHECK ((notification_type = ANY (ARRAY['event_request'::text, 'mentor_application'::text, 'admin_notice'::text, 'mentor_contact_overdue'::text])));
ALTER TABLE public."supervisor_notifications" ADD CONSTRAINT "supervisor_notifications_pkey" PRIMARY KEY (id);
ALTER TABLE public."supervisor_notifications" ADD CONSTRAINT "supervisor_notifications_recipient_id_notification_type_sub_key" UNIQUE (recipient_id, notification_type, subject_id);
ALTER TABLE public."system_notice_notifications" ADD CONSTRAINT "system_notice_notifications_pkey" PRIMARY KEY (id);
ALTER TABLE public."system_notice_notifications" ADD CONSTRAINT "system_notice_notifications_system_notice_id_recipient_id_key" UNIQUE (system_notice_id, recipient_id);
ALTER TABLE public."system_notices" ADD CONSTRAINT "system_notices_message_check" CHECK (((length(TRIM(BOTH FROM message)) >= 1) AND (length(TRIM(BOTH FROM message)) <= 1000)));
ALTER TABLE public."system_notices" ADD CONSTRAINT "system_notices_pkey" PRIMARY KEY (id);
ALTER TABLE public."system_notices" ADD CONSTRAINT "system_notices_title_check" CHECK (((length(TRIM(BOTH FROM title)) >= 1) AND (length(TRIM(BOTH FROM title)) <= 120)));
ALTER TABLE public."system_notices" ADD CONSTRAINT "system_notices_valid_period" CHECK (((ends_at IS NULL) OR (ends_at > starts_at)));
ALTER TABLE public."calendar_events" ADD CONSTRAINT "calendar_events_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id);
ALTER TABLE public."calendar_events" ADD CONSTRAINT "calendar_events_faculty_id_fkey" FOREIGN KEY (faculty_id) REFERENCES faculties(id);
ALTER TABLE public."calendar_events" ADD CONSTRAINT "calendar_events_organizer_id_fkey" FOREIGN KEY (organizer_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."event_activity_log" ADD CONSTRAINT "event_activity_log_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."event_activity_log" ADD CONSTRAINT "event_activity_log_calendar_event_id_fkey" FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(id) ON DELETE RESTRICT;
ALTER TABLE public."event_attendance" ADD CONSTRAINT "event_attendance_attendee_id_fkey" FOREIGN KEY (attendee_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."event_attendance" ADD CONSTRAINT "event_attendance_calendar_event_id_fkey" FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;
ALTER TABLE public."event_attendance" ADD CONSTRAINT "event_attendance_event_request_id_fkey" FOREIGN KEY (event_request_id) REFERENCES event_requests(id) ON DELETE CASCADE;
ALTER TABLE public."event_attendance" ADD CONSTRAINT "event_attendance_invalidated_by_fkey" FOREIGN KEY (invalidated_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."event_attendance" ADD CONSTRAINT "event_attendance_recorded_by_fkey" FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."event_cancellation_requests" ADD CONSTRAINT "event_cancellation_requests_calendar_event_id_fkey" FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(id);
ALTER TABLE public."event_cancellation_requests" ADD CONSTRAINT "event_cancellation_requests_mentor_id_fkey" FOREIGN KEY (mentor_id) REFERENCES profiles(id);
ALTER TABLE public."event_cancellation_requests" ADD CONSTRAINT "event_cancellation_requests_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES profiles(id);
ALTER TABLE public."event_notifications" ADD CONSTRAINT "event_notifications_calendar_event_id_fkey" FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(id) ON DELETE CASCADE;
ALTER TABLE public."event_notifications" ADD CONSTRAINT "event_notifications_event_request_id_fkey" FOREIGN KEY (event_request_id) REFERENCES event_requests(id) ON DELETE CASCADE;
ALTER TABLE public."event_notifications" ADD CONSTRAINT "event_notifications_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."event_requests" ADD CONSTRAINT "event_requests_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."event_requests" ADD CONSTRAINT "event_requests_calendar_event_id_fkey" FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(id) ON DELETE SET NULL;
ALTER TABLE public."event_requests" ADD CONSTRAINT "event_requests_faculty_id_fkey" FOREIGN KEY (faculty_id) REFERENCES faculties(id);
ALTER TABLE public."event_requests" ADD CONSTRAINT "event_requests_mentor_id_fkey" FOREIGN KEY (mentor_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."mentor_applications" ADD CONSTRAINT "mentor_applications_applicant_id_fkey" FOREIGN KEY (applicant_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."mentor_applications" ADD CONSTRAINT "mentor_applications_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public."mentor_assignments" ADD CONSTRAINT "mentor_assignments_assigned_by_fkey" FOREIGN KEY (assigned_by) REFERENCES profiles(id);
ALTER TABLE public."mentor_assignments" ADD CONSTRAINT "mentor_assignments_mentor_id_fkey" FOREIGN KEY (mentor_id) REFERENCES profiles(id);
ALTER TABLE public."mentor_assignments" ADD CONSTRAINT "mentor_assignments_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id);
ALTER TABLE public."mentor_contact_status" ADD CONSTRAINT "mentor_contact_status_mentor_id_fkey" FOREIGN KEY (mentor_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."mentor_contact_status" ADD CONSTRAINT "mentor_contact_status_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."mentor_student_conversations" ADD CONSTRAINT "mentor_student_conversations_mentor_id_fkey" FOREIGN KEY (mentor_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."mentor_student_conversations" ADD CONSTRAINT "mentor_student_conversations_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."mentor_student_messages" ADD CONSTRAINT "mentor_student_messages_mentor_id_fkey" FOREIGN KEY (mentor_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."mentor_student_messages" ADD CONSTRAINT "mentor_student_messages_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."mentor_student_messages" ADD CONSTRAINT "mentor_student_messages_student_id_fkey" FOREIGN KEY (student_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_faculty_id_fkey" FOREIGN KEY (faculty_id) REFERENCES faculties(id);
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."profiles" ADD CONSTRAINT "profiles_programme_id_fkey" FOREIGN KEY (programme_id) REFERENCES programmes(id);
ALTER TABLE public."programmes" ADD CONSTRAINT "programmes_faculty_id_fkey" FOREIGN KEY (faculty_id) REFERENCES faculties(id);
ALTER TABLE public."supervisor_notifications" ADD CONSTRAINT "supervisor_notifications_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."system_notice_notifications" ADD CONSTRAINT "system_notice_notifications_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public."system_notice_notifications" ADD CONSTRAINT "system_notice_notifications_system_notice_id_fkey" FOREIGN KEY (system_notice_id) REFERENCES system_notices(id) ON DELETE CASCADE;
ALTER TABLE public."system_notices" ADD CONSTRAINT "system_notices_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX calendar_events_attendance_token_uidx ON public.calendar_events USING btree (attendance_token) WHERE (attendance_token IS NOT NULL);
CREATE INDEX calendar_events_status_starts_idx ON public.calendar_events USING btree (event_status, starts_at);
CREATE INDEX event_activity_log_event_created_idx ON public.event_activity_log USING btree (calendar_event_id, created_at DESC);
CREATE UNIQUE INDEX event_attendance_calendar_event_attendee_uidx ON public.event_attendance USING btree (calendar_event_id, attendee_id) WHERE (calendar_event_id IS NOT NULL);
CREATE UNIQUE INDEX event_cancellation_open_idx ON public.event_cancellation_requests USING btree (calendar_event_id) WHERE (status = ANY (ARRAY['pending'::text, 'approved'::text]));
CREATE INDEX event_notifications_calendar_due_idx ON public.event_notifications USING btree (recipient_id, calendar_event_id, scheduled_for);
CREATE INDEX event_notifications_recipient_due_idx ON public.event_notifications USING btree (recipient_id, scheduled_for DESC);
CREATE INDEX event_requests_mentor_created_idx ON public.event_requests USING btree (mentor_id, created_at DESC);
CREATE INDEX event_requests_status_created_idx ON public.event_requests USING btree (status, created_at DESC);
CREATE INDEX mentor_applications_status_created_idx ON public.mentor_applications USING btree (status, created_at DESC);
CREATE UNIQUE INDEX mentor_applications_student_number_uidx ON public.mentor_applications USING btree (student_number) WHERE (student_number IS NOT NULL);
CREATE UNIQUE INDEX one_active_mentor_per_student ON public.mentor_assignments USING btree (student_id) WHERE (ended_at IS NULL);
CREATE INDEX idx_ms_conversations_mentor ON public.mentor_student_conversations USING btree (mentor_id);
CREATE INDEX idx_ms_conversations_student ON public.mentor_student_conversations USING btree (student_id);
CREATE INDEX mentor_student_messages_thread_idx ON public.mentor_student_messages USING btree (mentor_id, student_id, created_at DESC);
CREATE INDEX profiles_role_is_active_idx ON public.profiles USING btree (role, is_active);
CREATE INDEX supervisor_notifications_inbox_idx ON public.supervisor_notifications USING btree (recipient_id, created_at DESC);
CREATE INDEX system_notice_notifications_inbox_idx ON public.system_notice_notifications USING btree (recipient_id, scheduled_for DESC);
CREATE OR REPLACE FUNCTION public.admin_delete_mentor_account(p_mentor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active admin access is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_mentor_id AND role = 'mentor'
  ) THEN
    RAISE EXCEPTION 'Only mentor accounts can be deleted here.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mentor_assignments
    WHERE mentor_id = p_mentor_id AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Reassign or close this mentor’s active student assignments before deleting the account.';
  END IF;

  DELETE FROM auth.users WHERE id = p_mentor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected mentor account could not be deleted.';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.admin_update_mentor_profile(p_mentor_id uuid, p_first_name text, p_last_name text, p_school text, p_faculty_id bigint, p_programme_id bigint, p_bio text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active admin access is required.';
  END IF;

  IF NULLIF(btrim(p_first_name), '') IS NULL
    OR NULLIF(btrim(p_last_name), '') IS NULL
    OR NULLIF(btrim(p_school), '') IS NULL
    OR p_faculty_id IS NULL
    OR p_programme_id IS NULL
    OR length(COALESCE(p_bio, '')) > 1000
    OR NOT EXISTS (
      SELECT 1 FROM public.programmes
      WHERE id = p_programme_id AND faculty_id = p_faculty_id
    ) THEN
    RAISE EXCEPTION 'Complete the mentor profile and choose a programme from the selected faculty.';
  END IF;

  UPDATE public.profiles
  SET first_name = btrim(p_first_name),
      last_name = btrim(p_last_name),
      full_name = btrim(p_first_name) || ' ' || btrim(p_last_name),
      school = btrim(p_school),
      faculty_id = p_faculty_id,
      programme_id = p_programme_id,
      bio = NULLIF(btrim(p_bio), '')
  WHERE id = p_mentor_id AND role = 'mentor';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected mentor account no longer exists.';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_students_evenly(p_faculty_id bigint, p_programme_id bigint, p_student_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  student_profile_id UUID;
  mentor_profile_id UUID;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'supervisor' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active supervisor access is required.';
  END IF;

  IF p_faculty_id IS NULL OR p_programme_id IS NULL
    OR p_student_ids IS NULL OR cardinality(p_student_ids) = 0 THEN
    RAISE EXCEPTION 'Choose a faculty, programme, and at least one student.';
  END IF;

  FOR student_profile_id IN
    SELECT DISTINCT requested.student_id
    FROM unnest(p_student_ids) AS requested(student_id)
    ORDER BY requested.student_id
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles AS student
      WHERE student.id = student_profile_id
        AND student.role = 'student'
        AND student.is_active = true
        AND student.faculty_id = p_faculty_id
        AND student.programme_id = p_programme_id
        AND NOT EXISTS (
          SELECT 1 FROM public.mentor_assignments AS assignment
          WHERE assignment.student_id = student.id
            AND assignment.ended_at IS NULL
        )
    ) THEN
      RAISE EXCEPTION 'One or more selected students are no longer eligible for assignment.';
    END IF;

    SELECT mentor.id INTO mentor_profile_id
    FROM public.profiles AS mentor
    LEFT JOIN LATERAL (
      SELECT count(*)::INTEGER AS assigned_count
      FROM public.mentor_assignments AS assignment
      WHERE assignment.mentor_id = mentor.id
        AND assignment.ended_at IS NULL
    ) AS load ON true
    WHERE mentor.role = 'mentor'
      AND mentor.is_active = true
      AND mentor.faculty_id = p_faculty_id
      AND mentor.programme_id = p_programme_id
      AND public.mentor_application_is_approved(mentor.id)
      AND load.assigned_count < 20
    ORDER BY load.assigned_count, mentor.id
    FOR UPDATE OF mentor SKIP LOCKED
    LIMIT 1;

    IF mentor_profile_id IS NULL THEN
      RAISE EXCEPTION 'There is not enough approved mentor capacity for all selected students.';
    END IF;

    INSERT INTO public.mentor_assignments (student_id, mentor_id)
    VALUES (student_profile_id, mentor_profile_id);
  END LOOP;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.assign_students_to_mentor(p_mentor_id uuid, p_student_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  mentor_row public.profiles%ROWTYPE;
  student_id_item UUID;
  student_row public.profiles%ROWTYPE;
  current_assigned_count INTEGER;
  student_count INTEGER;
BEGIN
  -- Verify supervisor access
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role = 'supervisor' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active supervisor access is required.';
  END IF;

  -- Validate inputs
  IF p_mentor_id IS NULL OR p_student_ids IS NULL OR cardinality(p_student_ids) = 0 THEN
    RAISE EXCEPTION 'Choose a mentor and at least one student.';
  END IF;

  student_count := cardinality(p_student_ids);

  -- Verify mentor exists, is active, has approved mentor status
  SELECT * INTO mentor_row
  FROM public.profiles
  WHERE id = p_mentor_id
    AND role = 'mentor'
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND OR NOT public.mentor_application_is_approved(p_mentor_id) THEN
    RAISE EXCEPTION 'The selected mentor is not eligible for student assignments.';
  END IF;

  -- Check current caseload capacity
  SELECT count(*)::INTEGER INTO current_assigned_count
  FROM public.mentor_assignments
  WHERE mentor_id = p_mentor_id
    AND ended_at IS NULL;

  IF (current_assigned_count + student_count) > 20 THEN
    RAISE EXCEPTION 'This mentor can only take % more student(s); % were selected.',
      GREATEST(0, 20 - current_assigned_count), student_count;
  END IF;

  -- Verify each student is eligible and assign them
  FOR student_id_item IN
    SELECT DISTINCT unnest(p_student_ids)
  LOOP
    SELECT * INTO student_row
    FROM public.profiles
    WHERE id = student_id_item
      AND role = 'student'
      AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'One or more selected students are no longer active student accounts.';
    END IF;

    -- Check matching faculty and programme
    IF student_row.faculty_id IS DISTINCT FROM mentor_row.faculty_id
      OR student_row.programme_id IS DISTINCT FROM mentor_row.programme_id THEN
      RAISE EXCEPTION 'Student % belongs to a different faculty or programme.',
        COALESCE(student_row.full_name, student_row.email, student_id_item::TEXT);
    END IF;

    -- Check if student already has an active assignment
    IF EXISTS (
      SELECT 1 FROM public.mentor_assignments
      WHERE student_id = student_id_item
        AND ended_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Student % is already assigned to a mentor.',
        COALESCE(student_row.full_name, student_row.email, student_id_item::TEXT);
    END IF;

    -- Insert active assignment
    INSERT INTO public.mentor_assignments (student_id, mentor_id)
    VALUES (student_id_item, p_mentor_id);
  END LOOP;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.broadcast_mentor_message(p_content text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_user_id UUID;
    v_content TEXT;
    v_student_id UUID;
    v_conversation_id UUID;
    v_sent_count INTEGER := 0;
BEGIN
    v_user_id := auth.uid();
    v_content := pg_catalog.btrim(p_content);

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'You must be logged in to send messages.';
    END IF;

    IF v_content IS NULL OR v_content = '' THEN
        RAISE EXCEPTION 'Message content cannot be empty.';
    END IF;

    IF pg_catalog.length(v_content) > 5000 THEN
        RAISE EXCEPTION 'Messages cannot exceed 5000 characters.';
    END IF;

    -- Only registered mentors can broadcast.
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = v_user_id
          AND p.role = 'mentor'
    ) THEN
        RAISE EXCEPTION 'Only mentors can broadcast messages.';
    END IF;

    -- Process each currently assigned student separately.
    FOR v_student_id IN
        SELECT DISTINCT a.student_id
        FROM public.mentor_assignments AS a
        JOIN public.profiles AS p
          ON p.id = a.student_id
        WHERE a.mentor_id = v_user_id
          AND a.ended_at IS NULL
          AND p.role = 'student'
          AND p.is_active = TRUE
    LOOP
        -- Create the student's private conversation if needed.
        INSERT INTO public.mentor_student_conversations (
            mentor_id,
            student_id
        )
        VALUES (
            v_user_id,
            v_student_id
        )
        ON CONFLICT (mentor_id, student_id)
        DO NOTHING;

        SELECT c.id
        INTO v_conversation_id
        FROM public.mentor_student_conversations AS c
        WHERE c.mentor_id = v_user_id
          AND c.student_id = v_student_id;

        -- Save a separate copy in this student's conversation.
        INSERT INTO public.mentor_student_messages (
            conversation_id,
            sender_id,
            content
        )
        VALUES (
            v_conversation_id,
            v_user_id,
            v_content
        );

        UPDATE public.mentor_student_conversations
        SET last_message_at = pg_catalog.now()
        WHERE id = v_conversation_id;

        v_sent_count := v_sent_count + 1;
    END LOOP;

    RETURN v_sent_count;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.can_access_mentor_student_conversation(p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.mentor_student_conversations c
    WHERE c.id = p_conversation_id
      AND auth.uid() IN (c.mentor_id, c.student_id)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.can_send_mentor_student_message(p_conversation_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.mentor_student_conversations c
    JOIN public.mentor_assignments a
      ON a.mentor_id = c.mentor_id AND a.student_id = c.student_id AND a.ended_at IS NULL
    JOIN public.profiles mentor ON mentor.id = c.mentor_id AND mentor.role = 'mentor' AND mentor.is_active = true
    JOIN public.profiles student ON student.id = c.student_id AND student.role = 'student' AND student.is_active = true
    WHERE c.id = p_conversation_id
      AND auth.uid() IN (c.mentor_id, c.student_id)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.cancel_supervisor_event(p_event_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='supervisor' AND is_active=true) THEN RAISE EXCEPTION 'Active supervisor access is required.'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'A cancellation reason is required.'; END IF;
  PERFORM 1 FROM public.calendar_events WHERE id=p_event_id AND event_type='event' AND event_status='scheduled' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Only scheduled events can be cancelled.'; END IF;
  UPDATE public.calendar_events SET event_status='cancelled',cancelled_at=now(),cancellation_reason=btrim(p_reason) WHERE id=p_event_id;
  INSERT INTO public.event_activity_log(calendar_event_id,actor_id,action_type,details)
  VALUES(p_event_id,auth.uid(),'event_cancelled',jsonb_build_object('reason',btrim(p_reason)));
END; $function$
;
CREATE OR REPLACE FUNCTION public.complete_supervisor_event(p_event_id bigint, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  event_row public.calendar_events%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor_id AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;
  SELECT * INTO event_row FROM public.calendar_events
  WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR event_row.event_type <> 'event' OR event_row.event_status <> 'scheduled' THEN
    RAISE EXCEPTION 'Only scheduled events can be completed.';
  END IF;
  IF now() < event_row.ends_at THEN
    RAISE EXCEPTION 'This event cannot be completed before its scheduled end time.';
  END IF;
  UPDATE public.calendar_events
  SET event_status = 'completed', completed_at = now(), completion_note = NULLIF(btrim(p_note), '')
  WHERE id = p_event_id;
  INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
  VALUES (p_event_id, actor_id, 'event_completed', jsonb_build_object('note', NULLIF(btrim(p_note), '')));
  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT id, p_event_id, 'event_completed', 'Event completed: ' || event_row.title,
    event_row.title || ' has been marked complete.', now()
  FROM public.profiles WHERE role = 'student';

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT event_row.organizer_id, p_event_id, 'event_completed', 'Event completed: ' || event_row.title,
    event_row.title || ' has been marked complete.', now()
  WHERE event_row.organizer_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = event_row.organizer_id AND role = 'mentor');
END;
$function$
;
CREATE OR REPLACE FUNCTION public.copy_student_event_notifications_to_mentors()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$
;
CREATE OR REPLACE FUNCTION public.create_event_request(p_title text, p_purpose text, p_event_date date, p_event_time time without time zone, p_venue text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  request_id UUID;
BEGIN
  IF actor_id IS NULL OR NOT public.mentor_application_is_approved(actor_id) THEN
    RAISE EXCEPTION 'Only approved mentors can submit event requests.';
  END IF;

  IF NULLIF(btrim(p_title), '') IS NULL
    OR NULLIF(btrim(p_purpose), '') IS NULL
    OR p_event_date IS NULL
    OR p_event_time IS NULL
    OR NULLIF(btrim(p_venue), '') IS NULL THEN
    RAISE EXCEPTION 'Complete all event request fields.';
  END IF;

  INSERT INTO public.event_requests (
    mentor_id, title, purpose, event_date, event_time, venue
  ) VALUES (
    actor_id, btrim(p_title), btrim(p_purpose), p_event_date, p_event_time, btrim(p_venue)
  ) RETURNING id INTO request_id;

  RETURN request_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.create_profile_for_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  new_role text;
begin
  new_role :=
    case
      when new.raw_user_meta_data ->> 'role' = 'mentor'
        then 'mentor'
      else 'student'
    end;

  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    faculty_id,
    programme_id
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new_role,
    case
      when new_role = 'student'
        then nullif(new.raw_user_meta_data ->> 'faculty_id', '')::bigint
      else null
    end,
    case
      when new_role = 'student'
        then nullif(new.raw_user_meta_data ->> 'programme_id', '')::bigint
      else null
    end
  );

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_supervisor_event(p_title text, p_description text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_venue text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  event_id BIGINT;
  event_end TIMESTAMPTZ;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor_id AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;
  IF NULLIF(btrim(p_title), '') IS NULL
    OR NULLIF(btrim(p_description), '') IS NULL
    OR NULLIF(btrim(p_venue), '') IS NULL
    OR p_starts_at IS NULL THEN
    RAISE EXCEPTION 'Complete all event fields.';
  END IF;

  event_end := COALESCE(p_ends_at, p_starts_at + INTERVAL '2 hours');
  IF p_starts_at <= now() OR event_end <= p_starts_at THEN
    RAISE EXCEPTION 'Choose a future start time and an end time after it.';
  END IF;

  INSERT INTO public.calendar_events (
    title, event_type, description, starts_at, location, created_by, audience,
    ends_at, attendance_token, organizer_id, event_status
  ) VALUES (
    btrim(p_title), 'event', btrim(p_description), p_starts_at, btrim(p_venue),
    actor_id, 'university', event_end, gen_random_uuid()::TEXT, actor_id, 'scheduled'
  ) RETURNING id INTO event_id;

    INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
    VALUES (event_id, actor_id, 'event_created', jsonb_build_object(
      'title', btrim(p_title), 'starts_at', p_starts_at, 'ends_at', event_end, 'venue', btrim(p_venue)
    ));

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT id, event_id, 'approved', 'New FYE event: ' || btrim(p_title),
    btrim(p_title) || ' is on ' || to_char(p_starts_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY at HH24:MI')
      || ' in ' || btrim(p_venue) || '.', now()
  FROM public.profiles WHERE role = 'student';

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT id, event_id, reminder.notification_type, reminder.title,
    reminder.message, reminder.reminder_at
  FROM public.profiles
  CROSS JOIN LATERAL (VALUES
    ('one_day_reminder'::TEXT, 'Event tomorrow: ' || btrim(p_title),
      btrim(p_title) || ' is tomorrow at ' || to_char(p_starts_at AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')
        || ' in ' || btrim(p_venue) || '.', p_starts_at - INTERVAL '1 day'),
    ('one_hour_reminder'::TEXT, 'Event starting soon: ' || btrim(p_title),
      btrim(p_title) || ' starts in one hour at ' || btrim(p_venue) || '.', p_starts_at - INTERVAL '1 hour')
  ) AS reminder(notification_type, title, message, reminder_at)
  WHERE role = 'student' AND reminder.reminder_at > now();

  RETURN event_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.create_system_notice_notifications()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT NEW.is_active OR (
    TG_OP = 'UPDATE' AND OLD.is_active = true
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.system_notice_notifications (
    system_notice_id,
    recipient_id,
    title,
    message,
    scheduled_for
  )
  SELECT
    NEW.id,
    profile.id,
    NEW.title,
    NEW.message,
    NEW.starts_at
  FROM public.profiles AS profile
  WHERE profile.role IN ('student', 'mentor')
  ON CONFLICT (system_notice_id, recipient_id) DO NOTHING;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.current_user_is_mentor()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'mentor'
  );
$function$
;
CREATE OR REPLACE FUNCTION public.delete_faculty_and_programmes(p_faculty_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  in_use_count INTEGER;
BEGIN
  -- Verify admin access
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active admin access is required.';
  END IF;

  IF p_faculty_id IS NULL THEN
    RAISE EXCEPTION 'Choose a faculty to delete.';
  END IF;

  -- Check if any profile is using this faculty or any of its programmes
  SELECT count(*)::INTEGER INTO in_use_count
  FROM public.profiles
  WHERE faculty_id = p_faculty_id
     OR programme_id IN (
       SELECT id FROM public.programmes WHERE faculty_id = p_faculty_id
     );

  IF in_use_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete this faculty because it or its programmes are associated with % active user profile(s). Reassign these users before deleting.', in_use_count;
  END IF;

  -- Delete associated programmes first, then the faculty
  DELETE FROM public.programmes WHERE faculty_id = p_faculty_id;
  DELETE FROM public.faculties WHERE id = p_faculty_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected faculty no longer exists.';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_approved_mentor_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.mentor_application_is_approved(NEW.mentor_id) THEN
    RAISE EXCEPTION 'Only approved mentors can receive student assignments.';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.enforce_attendance_faculty()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE event_faculty BIGINT; attendee_faculty BIGINT; faculty_event BOOLEAN;
BEGIN
  SELECT faculty_id,faculty_only INTO event_faculty,faculty_event FROM public.calendar_events WHERE id=NEW.calendar_event_id;
  SELECT faculty_id INTO attendee_faculty FROM public.profiles WHERE id=NEW.attendee_id;
  IF (faculty_event AND event_faculty IS NULL) OR (event_faculty IS NOT NULL AND attendee_faculty IS DISTINCT FROM event_faculty) THEN
    RAISE EXCEPTION 'Only attendees from the event faculty can check in.';
  END IF;
  RETURN NEW;
END; $function$
;
CREATE OR REPLACE FUNCTION public.expire_system_notices()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active=true) THEN RAISE EXCEPTION 'Active admin access is required.'; END IF;
  UPDATE public.system_notices SET is_active=false WHERE is_active=true AND ends_at IS NOT NULL AND ends_at<=now();
END; $function$
;
CREATE OR REPLACE FUNCTION public.finish_event_cancellation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$
;
CREATE OR REPLACE FUNCTION public.get_admin_analytics(p_period_days integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.get_admin_analytics_details(p_metric text, p_period_days integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$
;
CREATE OR REPLACE FUNCTION public.get_admin_event_attendance(p_event_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='admin' AND is_active=true) THEN RAISE EXCEPTION 'Active admin access is required.'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('profile_id',p.id,'name',p.full_name,'email',p.email,'role',p.role,'checked_in_at',a.checked_in_at,'method',a.attendance_method) ORDER BY a.checked_in_at),'[]'::JSONB)
  INTO result FROM public.event_attendance a JOIN public.profiles p ON p.id=a.attendee_id WHERE a.calendar_event_id=p_event_id AND a.is_valid=true;
  RETURN result;
END; $function$
;
CREATE OR REPLACE FUNCTION public.get_approved_event_for_attendance(p_qr_token text)
 RETURNS TABLE(title character varying, purpose text, event_date date, event_time time without time zone, venue character varying, can_check_in boolean, check_in_message text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.guard_mentor_approval_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if lower(coalesce(new.role, '')) = 'mentor' then
    if tg_op = 'INSERT' then
      new.mentor_approval_status := 'pending';
    elsif lower(coalesce(old.role, '')) <> 'mentor' then
      new.mentor_approval_status := 'pending';
    elsif new.mentor_approval_status is distinct from old.mentor_approval_status
      and not public.is_admin() then
      raise exception 'Only an admin can change mentor approval status.';
    elsif new.mentor_approval_status is null then
      new.mentor_approval_status := 'pending';
    end if;
  else
    new.mentor_approval_status := null;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.has_active_mentor_assignment(p_mentor_id uuid, p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.mentor_assignments AS assignment
    JOIN public.profiles AS mentor ON mentor.id = assignment.mentor_id
    JOIN public.profiles AS student ON student.id = assignment.student_id
    WHERE assignment.mentor_id = p_mentor_id
      AND assignment.student_id = p_student_id
      AND assignment.ended_at IS NULL
      AND mentor.is_active = true
      AND student.is_active = true
  );
$function$
;
CREATE OR REPLACE FUNCTION public.invalidate_event_attendance(p_event_id bigint, p_attendee_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  attendance_row public.event_attendance%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor_id AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to correct attendance.';
  END IF;
  SELECT * INTO attendance_row FROM public.event_attendance
  WHERE calendar_event_id = p_event_id AND attendee_id = p_attendee_id AND is_valid = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active attendance record was found for this student.';
  END IF;
  UPDATE public.event_attendance
  SET is_valid = false, invalidated_at = now(), invalidated_by = actor_id,
      invalidation_reason = btrim(p_reason)
  WHERE calendar_event_id = p_event_id AND attendee_id = p_attendee_id AND is_valid = true;
  INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
  VALUES (p_event_id, actor_id, 'attendance_corrected', jsonb_build_object(
    'attendee_id', p_attendee_id, 'reason', btrim(p_reason),
    'previous_checked_in_at', attendance_row.checked_in_at,
    'previous_method', attendance_row.attendance_method,
    'previous_correction_reason', attendance_row.correction_reason
  ));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_fye_student(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_profile_id
      AND role IN ('student', 'mentor')
      AND is_active = true
  ) AND (
    p_profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'supervisor' AND is_active = true
    )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.is_supervisor()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'supervisor'
  );
$function$
;
CREATE OR REPLACE FUNCTION public.link_notification_to_calendar_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.notification_type IN ('one_day_reminder', 'one_hour_reminder')
    AND NEW.scheduled_for <= now() THEN
    RETURN NULL;
  END IF;
  IF NEW.calendar_event_id IS NULL AND NEW.event_request_id IS NOT NULL THEN
    SELECT calendar_event_id INTO NEW.calendar_event_id
    FROM public.event_requests
    WHERE id = NEW.event_request_id;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_all_supervisor_notifications_read()
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

  UPDATE public.supervisor_notifications
  SET read_at = now()
  WHERE recipient_id = auth.uid() AND read_at IS NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_event_attendance(p_qr_token text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$
;
CREATE OR REPLACE FUNCTION public.mark_event_notification_read(p_notification_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.event_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id
    AND recipient_id = auth.uid();
END;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_event_notification_unread(p_notification_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.event_notifications
  SET read_at = NULL
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_supervisor_notification_read(p_notification_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;

  UPDATE public.supervisor_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_supervisor_notification_unread(p_notification_id uuid)
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

  UPDATE public.supervisor_notifications
  SET read_at = NULL
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_system_notice_notification_read(p_notification_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.system_notice_notifications
  SET read_at = COALESCE(read_at, now())
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$function$
;
CREATE OR REPLACE FUNCTION public.mark_system_notice_notification_unread(p_notification_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.system_notice_notifications
  SET read_at = NULL
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$function$
;
CREATE OR REPLACE FUNCTION public.mentor_application_is_approved(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = p_profile_id
      AND profile.is_active = true
      AND (
        EXISTS (
          SELECT 1 FROM public.mentor_applications AS application
          WHERE application.applicant_id = profile.id
            AND application.status = 'approved'
        )
        OR (
          profile.role = 'mentor'
          AND profile.mentor_approval_status = 'approved'
        )
      )
  ) AND (
    p_profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'supervisor' AND is_active = true
    )
  );
$function$
;
CREATE OR REPLACE FUNCTION public.notify_supervisors_of_admin_notice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'Admin published a notice',
    NEW.title || ': ' || NEW.message
  FROM public.profiles AS supervisor
  WHERE supervisor.role = 'supervisor'
  ON CONFLICT (recipient_id, notification_type, subject_id) DO NOTHING;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_supervisors_of_event_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.supervisor_notifications (
    recipient_id, notification_type, subject_id, title, message
  )
  SELECT
    supervisor.id,
    'event_request',
    NEW.id::TEXT,
    'New mentor event request',
    COALESCE(mentor.full_name, mentor.email, 'A mentor')
      || ' requested approval for “' || NEW.title || '”.'
  FROM public.profiles AS supervisor
  LEFT JOIN public.profiles AS mentor ON mentor.id = NEW.mentor_id
  WHERE supervisor.role = 'supervisor'
  ON CONFLICT (recipient_id, notification_type, subject_id) DO NOTHING;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.notify_supervisors_of_mentor_application()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  applicant_name TEXT;
BEGIN
  IF NEW.status <> 'pending' OR (
    TG_OP = 'UPDATE'
    AND OLD.status = 'pending'
    AND OLD.is_legacy = NEW.is_legacy
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(full_name, email, 'A student') INTO applicant_name
  FROM public.profiles
  WHERE id = NEW.applicant_id;

  INSERT INTO public.supervisor_notifications (
    recipient_id, notification_type, subject_id, title, message
  )
  SELECT
    supervisor.id,
    'mentor_application',
    NEW.id::TEXT,
    'New mentor application',
    COALESCE(applicant_name, 'A student') || ' submitted a mentor application for review.'
  FROM public.profiles AS supervisor
  WHERE supervisor.role = 'supervisor'
  ON CONFLICT (recipient_id, notification_type, subject_id) DO NOTHING;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.open_mentor_student_conversation(p_student_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor UUID := auth.uid();
  actor_role TEXT;
  mentor UUID;
  student UUID;
  conversation UUID;
BEGIN
  IF actor IS NULL OR p_student_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before opening a chat.';
  END IF;
  SELECT role INTO actor_role FROM public.profiles
    WHERE id = actor AND is_active = true;
  IF actor_role = 'mentor' THEN
    mentor := actor;
    student := p_student_id;
  ELSIF actor_role = 'student' AND actor = p_student_id THEN
    student := actor;
    SELECT a.mentor_id INTO mentor
      FROM public.mentor_assignments a
      WHERE a.student_id = student AND a.ended_at IS NULL
      ORDER BY a.assigned_at DESC LIMIT 1;
  ELSE
    RAISE EXCEPTION 'Only an assigned mentor or student can open this chat.';
  END IF;
  IF mentor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.mentor_assignments a
    JOIN public.profiles m ON m.id = a.mentor_id AND m.role = 'mentor' AND m.is_active = true
    JOIN public.profiles s ON s.id = a.student_id AND s.role = 'student' AND s.is_active = true
    WHERE a.mentor_id = mentor AND a.student_id = student AND a.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active mentor-student assignment is required for chat.';
  END IF;
  INSERT INTO public.mentor_student_conversations (mentor_id, student_id)
    VALUES (mentor, student)
    ON CONFLICT (mentor_id, student_id) DO UPDATE SET updated_at = now()
    RETURNING id INTO conversation;
  RETURN conversation;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.record_manual_event_attendance(p_event_id bigint, p_attendee_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  request_id UUID;
  inserted_id UUID;
  event_row public.calendar_events%ROWTYPE;
  previous_attendance public.event_attendance%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor_id AND role = 'supervisor' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active supervisor access is required.';
  END IF;

  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required for a manual attendance change.';
  END IF;

  SELECT * INTO event_row FROM public.calendar_events
  WHERE id = p_event_id AND event_type = 'event' AND event_status IN ('scheduled', 'completed');

  IF NOT FOUND OR NOT public.is_fye_student(p_attendee_id) THEN
    RAISE EXCEPTION 'Choose a valid event and student.';
  END IF;

  IF event_row.event_status = 'scheduled'
    AND (now() < event_row.starts_at - INTERVAL '1 hour' OR now() > event_row.ends_at + INTERVAL '2 hours') THEN
    RAISE EXCEPTION 'Manual check-in is only available during the event check-in window.';
  END IF;

  SELECT id INTO request_id FROM public.event_requests
  WHERE calendar_event_id = p_event_id LIMIT 1;

  SELECT * INTO previous_attendance FROM public.event_attendance
  WHERE calendar_event_id = p_event_id AND attendee_id = p_attendee_id FOR UPDATE;

  INSERT INTO public.event_attendance (
    event_request_id, calendar_event_id, attendee_id, attendance_method,
    recorded_by, correction_reason, is_valid, checked_in_at
  ) VALUES (request_id, p_event_id, p_attendee_id, 'manual', actor_id, btrim(p_reason), true, now())
  ON CONFLICT (calendar_event_id, attendee_id) WHERE calendar_event_id IS NOT NULL
  DO UPDATE SET is_valid = true, invalidated_at = NULL, invalidated_by = NULL,
    invalidation_reason = NULL, attendance_method = 'manual', recorded_by = actor_id,
    correction_reason = btrim(p_reason), checked_in_at = now()
  WHERE public.event_attendance.is_valid = false
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    RAISE EXCEPTION 'This student is already checked in.';
  END IF;

  INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
  VALUES (p_event_id, actor_id, 'attendance_added', jsonb_build_object(
    'attendee_id', p_attendee_id, 'method', 'manual', 'reason', btrim(p_reason),
    'restored', previous_attendance.id IS NOT NULL
  ));
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
      WHERE id = actor_id AND role = 'mentor' AND is_active = true
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
  FROM public.mentor_assignments AS assignment
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
CREATE OR REPLACE FUNCTION public.request_event_cancellation(p_event_id bigint, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$
;
CREATE OR REPLACE FUNCTION public.require_active_mentor_applicant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  applicant_year SMALLINT;
BEGIN
  SELECT study_year INTO applicant_year
  FROM public.profiles
  WHERE id = NEW.applicant_id
    AND role IN ('student', 'mentor')
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active student account is required to submit a mentor application.';
  END IF;

  IF applicant_year IS NULL OR applicant_year < 2 OR NEW.study_year <> applicant_year THEN
    RAISE EXCEPTION 'Mentor applications are available only to students in year 2 or above; confirm your saved year of study.';
  END IF;

  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.require_approved_mentor_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  approval_status text;
begin
  select p.mentor_approval_status
  into approval_status
  from public.profiles p
  where p.id = new.mentor_id
    and p.role = 'mentor';

  if not found or approval_status is distinct from 'approved' then
    raise exception 'Only an admin-approved mentor can receive assignments.';
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.review_event_cancellation(p_request_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$
;
CREATE OR REPLACE FUNCTION public.review_event_request(p_event_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$
;
CREATE OR REPLACE FUNCTION public.review_mentor_application(p_application_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  updated_application_id UUID;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role = 'supervisor' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Active supervisor access is required.';
  END IF;

  IF p_decision IS NULL OR p_decision NOT IN ('shortlisted', 'approved', 'declined') THEN
    RAISE EXCEPTION 'Choose shortlist, approve, or decline.';
  END IF;
  IF p_decision = 'declined' AND NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when declining an application.';
  END IF;

  UPDATE public.mentor_applications
  SET status = p_decision,
      review_reason = CASE
        WHEN p_decision IN ('shortlisted', 'declined') THEN NULLIF(btrim(p_reason), '')
        ELSE NULL
      END,
      reviewed_by = actor_id,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_application_id
    AND (
      (status = 'pending' AND p_decision IN ('shortlisted', 'declined'))
      OR (status = 'shortlisted' AND p_decision IN ('approved', 'declined'))
    )
  RETURNING id INTO updated_application_id;

  IF updated_application_id IS NULL THEN
    RAISE EXCEPTION 'This application is no longer at the selected review stage.';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.review_mentor_approval(p_mentor_id uuid, p_decision text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can review mentors.';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Choose approved or rejected.';
  end if;

  update public.profiles
  set mentor_approval_status = p_decision
  where id = p_mentor_id
    and role = 'mentor';

  if not found then
    raise exception 'Mentor profile not found.';
  end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.scope_event_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE event_faculty BIGINT; target_faculty BIGINT; target_role TEXT;
BEGIN
  SELECT faculty_id INTO event_faculty FROM public.calendar_events
  WHERE id = COALESCE(NEW.calendar_event_id, (SELECT calendar_event_id FROM public.event_requests WHERE id = NEW.event_request_id));
  SELECT faculty_id, role INTO target_faculty,target_role FROM public.profiles WHERE id = NEW.recipient_id;
  IF event_faculty IS NOT NULL AND target_role IN ('student','mentor') AND target_faculty IS DISTINCT FROM event_faculty THEN RETURN NULL; END IF;
  RETURN NEW;
END; $function$
;
CREATE OR REPLACE FUNCTION public.scope_mentor_event_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$
;
CREATE OR REPLACE FUNCTION public.send_mentor_student_message(p_mentor_id uuid, p_student_id uuid, p_content text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_user_id UUID;
    v_conversation_id UUID;
    v_message_id UUID;
    v_content TEXT;
    v_sender_role TEXT;
BEGIN
    v_user_id := auth.uid();
    v_content := pg_catalog.btrim(p_content);

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'You must be logged in to send messages.';
    END IF;

    IF v_content IS NULL OR v_content = '' THEN
        RAISE EXCEPTION 'Message content cannot be empty.';
    END IF;

    IF pg_catalog.length(v_content) > 5000 THEN
        RAISE EXCEPTION 'Messages cannot exceed 5000 characters.';
    END IF;

    IF p_mentor_id IS NULL OR p_student_id IS NULL THEN
        RAISE EXCEPTION 'Mentor and student IDs are required.';
    END IF;

    -- Confirm that the sender has a valid role.
    SELECT p.role
    INTO v_sender_role
    FROM public.profiles AS p
    WHERE p.id = v_user_id;

    IF v_sender_role IS NULL THEN
        RAISE EXCEPTION 'User profile not found.';
    END IF;

    IF v_sender_role NOT IN ('mentor', 'student') THEN
        RAISE EXCEPTION 'Only mentors and students can use this chat.';
    END IF;

    -- The logged-in user must be one of the two participants.
    IF v_user_id <> p_mentor_id
       AND v_user_id <> p_student_id THEN
        RAISE EXCEPTION 'You are not a participant in this conversation.';
    END IF;

    -- Confirm the mentor-student assignment is currently active.
    IF NOT EXISTS (
        SELECT 1
        FROM public.mentor_assignments AS a
        WHERE a.mentor_id = p_mentor_id
          AND a.student_id = p_student_id
          AND a.ended_at IS NULL
    ) THEN
        RAISE EXCEPTION 'No active assignment exists for this mentor and student.';
    END IF;

    -- Ensure the participant's role matches their position.
    IF v_user_id = p_mentor_id AND v_sender_role <> 'mentor' THEN
        RAISE EXCEPTION 'The sender is not registered as a mentor.';
    END IF;

    IF v_user_id = p_student_id AND v_sender_role <> 'student' THEN
        RAISE EXCEPTION 'The sender is not registered as a student.';
    END IF;

    -- Create the conversation if necessary.
    INSERT INTO public.mentor_student_conversations (
        mentor_id,
        student_id
    )
    VALUES (
        p_mentor_id,
        p_student_id
    )
    ON CONFLICT (mentor_id, student_id)
    DO NOTHING;

    SELECT c.id
    INTO v_conversation_id
    FROM public.mentor_student_conversations AS c
    WHERE c.mentor_id = p_mentor_id
      AND c.student_id = p_student_id;

    IF v_conversation_id IS NULL THEN
        RAISE EXCEPTION 'Unable to create or retrieve the conversation.';
    END IF;

    -- Save the message.
    INSERT INTO public.mentor_student_messages (
        conversation_id,
        sender_id,
        content
    )
    VALUES (
        v_conversation_id,
        v_user_id,
        v_content
    )
    RETURNING id INTO v_message_id;

    -- Update the conversation's latest activity timestamp.
    UPDATE public.mentor_student_conversations
    SET last_message_at = pg_catalog.now()
    WHERE id = v_conversation_id;

    RETURN v_message_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.send_mentor_student_message(p_recipient_id uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  mentor_profile_id UUID;
  student_profile_id UUID;
  message_id UUID;
BEGIN
  IF actor_id IS NULL OR NULLIF(btrim(p_body), '') IS NULL OR length(btrim(p_body)) > 2000 THEN
    RAISE EXCEPTION 'Enter a message of no more than 2000 characters.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role = 'mentor' AND is_active = true
  ) THEN
    mentor_profile_id := actor_id;
    student_profile_id := p_recipient_id;
  ELSIF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role IN ('student', 'mentor') AND is_active = true
  ) THEN
    mentor_profile_id := p_recipient_id;
    student_profile_id := actor_id;
  ELSE
    RAISE EXCEPTION 'An active student or mentor account is required.';
  END IF;

  IF NOT public.has_active_mentor_assignment(mentor_profile_id, student_profile_id) THEN
    RAISE EXCEPTION 'Messages are available only between currently assigned mentor pairs.';
  END IF;

  INSERT INTO public.mentor_student_messages (mentor_id, student_id, sender_id, body)
  VALUES (mentor_profile_id, student_profile_id, actor_id, btrim(p_body))
  RETURNING id INTO message_id;

  RETURN message_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_calendar_event_lifecycle_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.event_type = 'event' THEN
    NEW.ends_at := COALESCE(NEW.ends_at, NEW.starts_at + INTERVAL '2 hours');
    NEW.attendance_token := COALESCE(NEW.attendance_token, gen_random_uuid()::TEXT);
    NEW.event_status := COALESCE(NEW.event_status, 'scheduled');
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_own_student_details(p_student_number text, p_study_year smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL
    OR NULLIF(btrim(p_student_number), '') IS NULL
    OR length(btrim(p_student_number)) > 40
    OR p_study_year IS NULL
    OR p_study_year NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Enter a valid student number and year of study.';
  END IF;

  UPDATE public.profiles
  SET student_number = btrim(p_student_number),
      study_year = p_study_year
  WHERE id = auth.uid()
    AND role IN ('student', 'mentor')
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active student account is required.';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_own_study_year(p_study_year smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR p_study_year IS NULL OR p_study_year NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Choose a valid year of study.';
  END IF;

  UPDATE public.profiles
  SET study_year = p_study_year
  WHERE id = auth.uid()
    AND role IN ('student', 'mentor')
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'An active student account is required.';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.set_profile_active(p_profile_id uuid, p_is_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  updated_profile_id UUID;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role = 'admin' AND is_active
  ) THEN
    RAISE EXCEPTION 'Active admin access is required.';
  END IF;

  IF p_is_active IS NULL THEN
    RAISE EXCEPTION 'Choose whether to activate or disable this account.';
  END IF;

  UPDATE public.profiles
  SET is_active = p_is_active
  WHERE id = p_profile_id
    AND role IN ('student', 'mentor')
  RETURNING id INTO updated_profile_id;

  IF updated_profile_id IS NULL THEN
    RAISE EXCEPTION 'Only student and mentor profiles can be disabled or reactivated.';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.stop_expired_notice_on_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.ends_at IS NOT NULL AND NEW.ends_at<=now() THEN NEW.is_active:=false; END IF;
  RETURN NEW;
END; $function$
;
CREATE OR REPLACE FUNCTION public.submit_event_outcome(p_event_id bigint, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  request_id UUID;
BEGIN
  IF actor_id IS NULL OR NULLIF(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'A signed-in mentor and an outcome note are required.';
  END IF;
  SELECT request.id INTO request_id
  FROM public.event_requests AS request
  JOIN public.calendar_events AS published ON published.id = request.calendar_event_id
  WHERE published.id = p_event_id
    AND request.mentor_id = actor_id
    AND request.status = 'approved'
    AND published.event_status IN ('scheduled', 'completed');
  IF request_id IS NULL THEN
    RAISE EXCEPTION 'Only the requesting mentor can submit this event outcome.';
  END IF;
  UPDATE public.calendar_events SET mentor_outcome = btrim(p_note)
  WHERE id = p_event_id;
  INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
  VALUES (p_event_id, actor_id, 'outcome_submitted', jsonb_build_object('note', btrim(p_note)));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.submit_mentor_application(p_student_number text, p_study_year smallint, p_previous_academic_year text, p_academic_record_path text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  existing_status TEXT;
  existing_is_legacy BOOLEAN;
  application_id UUID;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = actor_id AND email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Verify your university email before applying.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor_id AND role IN ('student', 'mentor')
  ) THEN
    RAISE EXCEPTION 'A student account is required to apply.';
  END IF;

  IF NULLIF(btrim(p_student_number), '') IS NULL
    OR p_study_year IS NULL OR p_study_year < 2
    OR NULLIF(btrim(p_previous_academic_year), '') IS NULL
    OR p_academic_record_path IS NULL
    OR split_part(p_academic_record_path, '/', 1) <> actor_id::text
    OR p_academic_record_path !~ '\.pdf$'
    OR p_academic_record_path ~ '(^|/)\.\.?(/|$)'
    OR NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE bucket_id = 'mentor-academic-records'
        AND name = p_academic_record_path
    ) THEN
    RAISE EXCEPTION 'Complete the application details and upload a PDF academic record.';
  END IF;

  SELECT status, is_legacy INTO existing_status, existing_is_legacy
  FROM public.mentor_applications
  WHERE applicant_id = actor_id
  FOR UPDATE;

  IF existing_status = 'approved' THEN
    RAISE EXCEPTION 'Your mentor application is already approved.';
  END IF;

  IF existing_status = 'pending' AND NOT COALESCE(existing_is_legacy, false) THEN
    RAISE EXCEPTION 'Your mentor application is already awaiting review.';
  END IF;

  INSERT INTO public.mentor_applications (
    applicant_id,
    student_number,
    study_year,
    previous_academic_year,
    academic_record_path,
    status,
    review_reason,
    reviewed_by,
    reviewed_at,
    is_legacy,
    updated_at
  ) VALUES (
    actor_id,
    btrim(p_student_number),
    p_study_year,
    btrim(p_previous_academic_year),
    p_academic_record_path,
    'pending',
    NULL,
    NULL,
    NULL,
    false,
    now()
  )
  ON CONFLICT (applicant_id) DO UPDATE
  SET student_number = EXCLUDED.student_number,
      study_year = EXCLUDED.study_year,
      previous_academic_year = EXCLUDED.previous_academic_year,
      academic_record_path = EXCLUDED.academic_record_path,
      status = 'pending',
      review_reason = NULL,
      reviewed_by = NULL,
      reviewed_at = NULL,
      is_legacy = false,
      updated_at = now()
    WHERE public.mentor_applications.status = 'declined'
      OR (public.mentor_applications.status = 'pending' AND public.mentor_applications.is_legacy)
  RETURNING id INTO application_id;

  IF application_id IS NULL THEN
    RAISE EXCEPTION 'This student number already has an application.';
  END IF;

  RETURN application_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.submit_mentor_application(p_student_number text, p_study_year smallint, p_previous_academic_year text, p_academic_record_path text, p_school text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  application_id UUID;
BEGIN
  IF NULLIF(btrim(p_school), '') IS NULL THEN
    RAISE EXCEPTION 'Enter the school you belong to.';
  END IF;

  application_id := public.submit_mentor_application(
    p_student_number,
    p_study_year,
    p_previous_academic_year,
    p_academic_record_path
  );

  UPDATE public.mentor_applications
  SET school = btrim(p_school)
  WHERE id = application_id AND applicant_id = auth.uid();

  UPDATE public.profiles
  SET school = btrim(p_school)
  WHERE id = auth.uid();

  RETURN application_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_event_request_to_calendar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$
;
CREATE OR REPLACE FUNCTION public.update_supervisor_event(p_event_id bigint, p_title text, p_description text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_venue text, p_change_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  event_row public.calendar_events%ROWTYPE;
  event_end TIMESTAMPTZ;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = actor_id AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;
  IF NULLIF(btrim(p_title), '') IS NULL
    OR NULLIF(btrim(p_description), '') IS NULL
    OR NULLIF(btrim(p_venue), '') IS NULL
    OR p_starts_at IS NULL OR NULLIF(btrim(p_change_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Complete all event fields and provide a reason for the change.';
  END IF;
  event_end := COALESCE(p_ends_at, p_starts_at + INTERVAL '2 hours');
  IF p_starts_at <= now() OR event_end <= p_starts_at THEN
    RAISE EXCEPTION 'Choose a future start time and an end time after it.';
  END IF;

  SELECT * INTO event_row FROM public.calendar_events
  WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND OR event_row.event_type <> 'event' OR event_row.event_status <> 'scheduled' THEN
    RAISE EXCEPTION 'Only scheduled events can be edited.';
  END IF;

  UPDATE public.calendar_events
  SET title = btrim(p_title), description = btrim(p_description),
      starts_at = p_starts_at, ends_at = event_end, location = btrim(p_venue)
  WHERE id = p_event_id;

  INSERT INTO public.event_activity_log (calendar_event_id, actor_id, action_type, details)
  VALUES (p_event_id, actor_id, 'event_updated', jsonb_build_object(
    'reason', btrim(p_change_reason),
    'before', jsonb_build_object('title', event_row.title, 'description', event_row.description,
      'starts_at', event_row.starts_at, 'ends_at', event_row.ends_at, 'venue', event_row.location),
    'after', jsonb_build_object('title', btrim(p_title), 'description', btrim(p_description),
      'starts_at', p_starts_at, 'ends_at', event_end, 'venue', btrim(p_venue))
  ));

  DELETE FROM public.event_notifications
  WHERE calendar_event_id = p_event_id
    AND notification_type IN ('one_day_reminder', 'one_hour_reminder')
    AND scheduled_for > now();

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT id, p_event_id, reminder.notification_type, reminder.title,
    reminder.message, reminder.reminder_at
  FROM public.profiles
  CROSS JOIN LATERAL (VALUES
    ('one_day_reminder'::TEXT, 'Event tomorrow: ' || btrim(p_title),
      btrim(p_title) || ' is tomorrow at ' || to_char(p_starts_at AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI')
        || ' in ' || btrim(p_venue) || '.', p_starts_at - INTERVAL '1 day'),
    ('one_hour_reminder'::TEXT, 'Event starting soon: ' || btrim(p_title),
      btrim(p_title) || ' starts in one hour at ' || btrim(p_venue) || '.', p_starts_at - INTERVAL '1 hour')
  ) AS reminder(notification_type, title, message, reminder_at)
  WHERE role = 'student' AND reminder.reminder_at > now();

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT id, p_event_id, 'event_updated', 'Event updated: ' || btrim(p_title),
    btrim(p_title) || ' has updated event details. It is now on '
      || to_char(p_starts_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY at HH24:MI')
      || ' in ' || btrim(p_venue) || '.', now()
  FROM public.profiles WHERE role = 'student';

  INSERT INTO public.event_notifications (
    recipient_id, calendar_event_id, notification_type, title, message, scheduled_for
  )
  SELECT event_row.organizer_id, p_event_id, 'event_updated', 'Event updated: ' || btrim(p_title),
    btrim(p_title) || ' has updated event details. It is now on '
      || to_char(p_starts_at AT TIME ZONE 'Africa/Johannesburg', 'DD Mon YYYY at HH24:MI')
      || ' in ' || btrim(p_venue) || '.', now()
  WHERE event_row.organizer_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = event_row.organizer_id AND role = 'mentor');
END;
$function$
;
CREATE OR REPLACE FUNCTION public.validate_future_mentor_event_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.event_date + NEW.event_time) <= (now() AT TIME ZONE 'Africa/Johannesburg') THEN
    RAISE EXCEPTION 'Choose a future event date and time.';
  END IF;
  IF NULLIF(btrim(NEW.title), '') IS NULL
    OR NULLIF(btrim(NEW.purpose), '') IS NULL
    OR NULLIF(btrim(NEW.venue), '') IS NULL THEN
    RAISE EXCEPTION 'Event title, purpose, and venue are required.';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION create_profile_for_new_user();
CREATE TRIGGER calendar_event_lifecycle_defaults BEFORE INSERT OR UPDATE OF starts_at, ends_at ON calendar_events FOR EACH ROW EXECUTE FUNCTION set_calendar_event_lifecycle_defaults();
CREATE TRIGGER finish_event_cancellation AFTER UPDATE OF event_status ON calendar_events FOR EACH ROW EXECUTE FUNCTION finish_event_cancellation();
CREATE TRIGGER enforce_attendance_faculty BEFORE INSERT OR UPDATE OF attendee_id, calendar_event_id ON event_attendance FOR EACH ROW EXECUTE FUNCTION enforce_attendance_faculty();
CREATE TRIGGER copy_student_event_notifications_to_mentors AFTER INSERT ON event_notifications FOR EACH ROW EXECUTE FUNCTION copy_student_event_notifications_to_mentors();
CREATE TRIGGER event_notification_calendar_link BEFORE INSERT OR UPDATE OF event_request_id, calendar_event_id ON event_notifications FOR EACH ROW EXECUTE FUNCTION link_notification_to_calendar_event();
CREATE TRIGGER z_scope_event_notification BEFORE INSERT ON event_notifications FOR EACH ROW EXECUTE FUNCTION scope_event_notification();
CREATE TRIGGER event_request_calendar_sync AFTER INSERT OR UPDATE OF status, calendar_event_id, qr_token ON event_requests FOR EACH ROW EXECUTE FUNCTION sync_event_request_to_calendar();
CREATE TRIGGER notify_supervisors_of_event_request AFTER INSERT ON event_requests FOR EACH ROW EXECUTE FUNCTION notify_supervisors_of_event_request();
CREATE TRIGGER scope_mentor_event_request BEFORE INSERT OR UPDATE OF faculty_id ON event_requests FOR EACH ROW EXECUTE FUNCTION scope_mentor_event_request();
CREATE TRIGGER validate_future_mentor_event_request BEFORE INSERT OR UPDATE OF event_date, event_time, title, purpose, venue ON event_requests FOR EACH ROW EXECUTE FUNCTION validate_future_mentor_event_request();
CREATE TRIGGER mentor_applications_require_active_applicant BEFORE INSERT OR UPDATE OF student_number, study_year, previous_academic_year, academic_record_path ON mentor_applications FOR EACH ROW EXECUTE FUNCTION require_active_mentor_applicant();
CREATE TRIGGER notify_supervisors_of_mentor_application AFTER INSERT OR UPDATE OF status, is_legacy ON mentor_applications FOR EACH ROW EXECUTE FUNCTION notify_supervisors_of_mentor_application();
CREATE TRIGGER mentor_assignments_require_approval BEFORE INSERT OR UPDATE OF mentor_id ON mentor_assignments FOR EACH ROW EXECUTE FUNCTION enforce_approved_mentor_assignment();
CREATE TRIGGER mentor_assignments_require_approved_mentor_insert BEFORE INSERT ON mentor_assignments FOR EACH ROW EXECUTE FUNCTION require_approved_mentor_assignment();
CREATE TRIGGER mentor_assignments_require_approved_mentor_update BEFORE UPDATE OF mentor_id ON mentor_assignments FOR EACH ROW EXECUTE FUNCTION require_approved_mentor_assignment();
CREATE TRIGGER profiles_guard_mentor_approval_status BEFORE INSERT OR UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION guard_mentor_approval_status();
CREATE TRIGGER create_system_notice_notifications AFTER INSERT OR UPDATE OF is_active ON system_notices FOR EACH ROW EXECUTE FUNCTION create_system_notice_notifications();
CREATE TRIGGER notify_supervisors_of_admin_notice AFTER INSERT OR UPDATE OF is_active ON system_notices FOR EACH ROW EXECUTE FUNCTION notify_supervisors_of_admin_notice();
CREATE TRIGGER stop_expired_notice_on_write BEFORE INSERT OR UPDATE OF is_active, ends_at ON system_notices FOR EACH ROW EXECUTE FUNCTION stop_expired_notice_on_write();
ALTER TABLE public."calendar_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."event_activity_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."event_attendance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."event_cancellation_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."event_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."event_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."faculties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."mentor_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."mentor_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."mentor_contact_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."mentor_student_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."mentor_student_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."programmes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."supervisor_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."system_notice_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."system_notices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Calendar events visible to their audience" ON public."calendar_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((((audience = 'university'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['student'::text, 'mentor'::text, 'supervisor'::text, 'admin'::text])))))) OR ((audience = 'mentor_group'::text) AND (((created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'mentor'::text))))) OR (EXISTS ( SELECT 1
   FROM mentor_assignments a
  WHERE ((a.student_id = auth.uid()) AND (a.mentor_id = calendar_events.created_by) AND (a.ended_at IS NULL))))))));
CREATE POLICY "Enforce faculty event visibility" ON public."calendar_events" AS RESTRICTIVE FOR SELECT TO "public" USING (((event_type <> 'event'::text) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_active = true) AND ((p.role = ANY (ARRAY['admin'::text, 'supervisor'::text])) OR ((p.role = ANY (ARRAY['student'::text, 'mentor'::text])) AND (calendar_events.event_status <> 'cancelled'::text) AND (((NOT calendar_events.faculty_only) AND (calendar_events.faculty_id IS NULL)) OR (p.faculty_id = calendar_events.faculty_id)))))))));
CREATE POLICY "FYE event audience" ON public."calendar_events" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((event_type = 'event'::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_active = true) AND ((p.role = ANY (ARRAY['admin'::text, 'supervisor'::text])) OR ((p.role = ANY (ARRAY['student'::text, 'mentor'::text])) AND (calendar_events.event_status <> 'cancelled'::text) AND (((NOT calendar_events.faculty_only) AND (calendar_events.faculty_id IS NULL)) OR (p.faculty_id = calendar_events.faculty_id)))))))));
CREATE POLICY "Mentors can add educational events" ON public."calendar_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((audience = 'mentor_group'::text) AND (created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'mentor'::text)))) AND (EXISTS ( SELECT 1
   FROM mentor_assignments a
  WHERE ((a.mentor_id = auth.uid()) AND (a.ended_at IS NULL))))));
CREATE POLICY "Only supervisors change events" ON public."calendar_events" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'supervisor'::text) AND (profiles.is_active = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'supervisor'::text) AND (profiles.is_active = true)))));
CREATE POLICY "Only supervisors publish events" ON public."calendar_events" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'supervisor'::text) AND (profiles.is_active = true)))));
CREATE POLICY "Supervisors can add university events" ON public."calendar_events" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((audience = 'university'::text) AND (created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'supervisor'::text))))));
CREATE POLICY "Supervisors read event activity" ON public."event_activity_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'supervisor'::text)))));
CREATE POLICY "Users read own event attendance" ON public."event_attendance" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((attendee_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'supervisor'::text))))));
CREATE POLICY "Read event cancellation requests" ON public."event_cancellation_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.is_active = true) AND ((p.role = 'supervisor'::text) OR (p.id = event_cancellation_requests.mentor_id))))));
CREATE POLICY "Recipients read due event notifications" ON public."event_notifications" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((recipient_id = auth.uid()) AND (scheduled_for <= now())));
CREATE POLICY "Users read their event requests" ON public."event_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((mentor_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'supervisor'::text))))));
CREATE POLICY "Admins can add faculties" ON public."faculties" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (is_admin());
CREATE POLICY "Admins can rename faculties" ON public."faculties" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Allow registration to read faculties" ON public."faculties" AS PERMISSIVE FOR SELECT TO "anon","authenticated" USING (true);
CREATE POLICY "Signed-in users can read faculties" ON public."faculties" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Applicants and supervisors read mentor applications" ON public."mentor_applications" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((applicant_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'supervisor'::text))))));
CREATE POLICY "Participants can read mentor assignments" ON public."mentor_assignments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((student_id = auth.uid()) OR (mentor_id = auth.uid()) OR (assigned_by = auth.uid())));
CREATE POLICY "Supervisors can read all mentor assignments" ON public."mentor_assignments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_supervisor());
CREATE POLICY "Mentors students and supervisors read contact status" ON public."mentor_contact_status" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((((auth.uid() = mentor_id) OR (auth.uid() = student_id)) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'supervisor'::text) AND (profiles.is_active = true))))));
CREATE POLICY "Participants can read assigned conversations" ON public."mentor_student_conversations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((((auth.uid() = mentor_id) AND (EXISTS ( SELECT 1
   FROM mentor_assignments a
  WHERE ((a.mentor_id = mentor_student_conversations.mentor_id) AND (a.student_id = mentor_student_conversations.student_id) AND (a.ended_at IS NULL))))) OR ((auth.uid() = student_id) AND (EXISTS ( SELECT 1
   FROM mentor_assignments a
  WHERE ((a.mentor_id = mentor_student_conversations.mentor_id) AND (a.student_id = mentor_student_conversations.student_id) AND (a.ended_at IS NULL)))))));
CREATE POLICY "mentor_student_conversations_participant_read" ON public."mentor_student_conversations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((auth.uid() = mentor_id) OR (auth.uid() = student_id)));
CREATE POLICY "Assigned mentor and student read their messages" ON public."mentor_student_messages" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((((auth.uid() = mentor_id) OR (auth.uid() = student_id)) AND has_active_mentor_assignment(mentor_id, student_id)));
CREATE POLICY "Admins can read all profiles" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_admin());
CREATE POLICY "Mentors can update own profile" ON public."profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (((id = auth.uid()) AND (role = 'mentor'::text))) WITH CHECK (((id = auth.uid()) AND (role = 'mentor'::text)));
CREATE POLICY "Mentors cannot delete profiles" ON public."profiles" AS RESTRICTIVE FOR DELETE TO "authenticated" USING ((NOT current_user_is_mentor()));
CREATE POLICY "Mentors cannot insert profiles" ON public."profiles" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK ((NOT current_user_is_mentor()));
CREATE POLICY "Mentors cannot update other profiles" ON public."profiles" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (((NOT current_user_is_mentor()) OR (id = auth.uid()))) WITH CHECK (((NOT current_user_is_mentor()) OR (id = auth.uid())));
CREATE POLICY "Supervisors can read all profiles" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_supervisor());
CREATE POLICY "Users can read related profiles" ON public."profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM mentor_assignments a
  WHERE ((a.ended_at IS NULL) AND (((a.student_id = auth.uid()) AND (a.mentor_id = profiles.id)) OR ((a.mentor_id = auth.uid()) AND (a.student_id = profiles.id))))))));
CREATE POLICY "Admins can add programmes" ON public."programmes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (is_admin());
CREATE POLICY "Admins can rename programmes" ON public."programmes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Allow registration to read programmes" ON public."programmes" AS PERMISSIVE FOR SELECT TO "anon","authenticated" USING (true);
CREATE POLICY "Signed-in users can read programmes" ON public."programmes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Supervisors read their own notifications" ON public."supervisor_notifications" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((recipient_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'supervisor'::text))))));
CREATE POLICY "Users read their own system notice notifications" ON public."system_notice_notifications" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((recipient_id = auth.uid()));
CREATE POLICY "Admins manage system notices" ON public."system_notices" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Users read current system notices" ON public."system_notices" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((is_active AND (starts_at <= now()) AND ((ends_at IS NULL) OR (ends_at > now()))));
CREATE POLICY "Applicants and supervisors read submitted academic records" ON storage."objects" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'mentor-academic-records'::text) AND (EXISTS ( SELECT 1
   FROM mentor_applications application
  WHERE ((application.academic_record_path = objects.name) AND ((application.applicant_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM profiles
          WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'supervisor'::text))))))))));
CREATE POLICY "Applicants delete own mentor academic records" ON storage."objects" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((bucket_id = 'mentor-academic-records'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND (NOT (EXISTS ( SELECT 1
   FROM mentor_applications application
  WHERE (application.academic_record_path = objects.name))))));
CREATE POLICY "Applicants upload own mentor academic record" ON storage."objects" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'mentor-academic-records'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));
CREATE POLICY "Mentors can upload own profile photos" ON storage."objects" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((bucket_id = 'mentor-photos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = 'mentor'::text))))));
CREATE POLICY "Related users can read mentor profile photos" ON storage."objects" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((bucket_id = 'mentor-photos'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM mentor_assignments a
  WHERE ((a.ended_at IS NULL) AND ((a.mentor_id)::text = (storage.foldername(objects.name))[1]) AND (a.student_id = auth.uid())))))));
GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated; GRANT ALL ON ALL TABLES IN SCHEMA public,storage,auth TO service_role; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT UPDATE ON profiles TO authenticated;
