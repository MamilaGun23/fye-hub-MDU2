ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS school TEXT,
  ADD COLUMN IF NOT EXISTS study_year SMALLINT,
  ADD COLUMN IF NOT EXISTS student_number TEXT;

UPDATE public.profiles
SET first_name = split_part(btrim(full_name), ' ', 1),
    last_name = NULLIF(btrim(substr(btrim(full_name), length(split_part(btrim(full_name), ' ', 1)) + 1)), '')
WHERE full_name IS NOT NULL
  AND first_name IS NULL
  AND last_name IS NULL;

ALTER TABLE public.mentor_applications
  ADD COLUMN IF NOT EXISTS school TEXT;

CREATE OR REPLACE FUNCTION public.current_user_is_mentor()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'mentor'
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_is_mentor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_is_mentor() TO authenticated;

DROP POLICY IF EXISTS "Mentors cannot update other profiles" ON public.profiles;
CREATE POLICY "Mentors cannot update other profiles"
  ON public.profiles AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (NOT public.current_user_is_mentor() OR id = auth.uid())
  WITH CHECK (NOT public.current_user_is_mentor() OR id = auth.uid());

DROP POLICY IF EXISTS "Mentors cannot insert profiles" ON public.profiles;
CREATE POLICY "Mentors cannot insert profiles"
  ON public.profiles AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (NOT public.current_user_is_mentor());

DROP POLICY IF EXISTS "Mentors cannot delete profiles" ON public.profiles;
CREATE POLICY "Mentors cannot delete profiles"
  ON public.profiles AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (NOT public.current_user_is_mentor());

CREATE OR REPLACE FUNCTION public.validate_future_mentor_event_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
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
$$;

DROP TRIGGER IF EXISTS validate_future_mentor_event_request
  ON public.event_requests;
CREATE TRIGGER validate_future_mentor_event_request
  BEFORE INSERT OR UPDATE OF event_date, event_time, title, purpose, venue
  ON public.event_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_future_mentor_event_request();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.mentor_applications'::regclass
      AND conname = 'mentor_applications_status_check'
  ) THEN
    ALTER TABLE public.mentor_applications
      DROP CONSTRAINT mentor_applications_status_check;
  END IF;
  ALTER TABLE public.mentor_applications
    ADD CONSTRAINT mentor_applications_status_check
    CHECK (status IN ('pending', 'shortlisted', 'approved', 'declined'));
END;
$$;

CREATE OR REPLACE FUNCTION public.review_mentor_application(
  p_application_id UUID,
  p_decision TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.review_mentor_application(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_mentor_application(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_mentor_profile(
  p_mentor_id UUID,
  p_first_name TEXT,
  p_last_name TEXT,
  p_school TEXT,
  p_faculty_id BIGINT,
  p_programme_id BIGINT,
  p_bio TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_mentor_account(p_mentor_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.admin_update_mentor_profile(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_mentor_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_mentor_profile(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_mentor_account(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_own_study_year(p_study_year SMALLINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.set_own_study_year(SMALLINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_own_study_year(SMALLINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_own_student_details(
  p_student_number TEXT,
  p_study_year SMALLINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.set_own_student_details(TEXT, SMALLINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_own_student_details(TEXT, SMALLINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.require_active_mentor_applicant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.submit_mentor_application(
  p_student_number TEXT,
  p_study_year SMALLINT,
  p_previous_academic_year TEXT,
  p_academic_record_path TEXT,
  p_school TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.submit_mentor_application(TEXT, SMALLINT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_mentor_application(TEXT, SMALLINT, TEXT, TEXT, TEXT) TO authenticated;

DROP TABLE IF EXISTS public.mentor_student_messages CASCADE;

CREATE TABLE public.mentor_student_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS mentor_student_messages_thread_idx
  ON public.mentor_student_messages(mentor_id, student_id, created_at DESC);

ALTER TABLE public.mentor_student_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.mentor_student_messages TO authenticated;

CREATE OR REPLACE FUNCTION public.has_active_mentor_assignment(
  p_mentor_id UUID,
  p_student_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.has_active_mentor_assignment(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_mentor_assignment(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "Assigned mentor and student read their messages"
  ON public.mentor_student_messages;
CREATE POLICY "Assigned mentor and student read their messages"
  ON public.mentor_student_messages FOR SELECT TO authenticated
  USING (
    auth.uid() IN (mentor_id, student_id)
    AND public.has_active_mentor_assignment(mentor_id, student_id)
  );

CREATE OR REPLACE FUNCTION public.send_mentor_student_message(
  p_recipient_id UUID,
  p_body TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.send_mentor_student_message(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_mentor_student_message(UUID, TEXT) TO authenticated;

DROP TABLE IF EXISTS public.mentor_contact_status CASCADE;

CREATE TABLE public.mentor_contact_status (
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_contact_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (mentor_id, student_id)
);

ALTER TABLE public.mentor_contact_status ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.mentor_contact_status TO authenticated;

DROP POLICY IF EXISTS "Mentors students and supervisors read contact status"
  ON public.mentor_contact_status;
CREATE POLICY "Mentors students and supervisors read contact status"
  ON public.mentor_contact_status FOR SELECT TO authenticated
  USING (
    auth.uid() IN (mentor_id, student_id)
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'supervisor' AND is_active = true
    )
  );

CREATE OR REPLACE FUNCTION public.record_mentor_contact(p_student_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.record_mentor_contact(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_mentor_contact(UUID) TO authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.supervisor_notifications'::regclass
      AND conname = 'supervisor_notifications_notification_type_check'
  ) THEN
    ALTER TABLE public.supervisor_notifications
      DROP CONSTRAINT supervisor_notifications_notification_type_check;
  END IF;
  ALTER TABLE public.supervisor_notifications
    ADD CONSTRAINT supervisor_notifications_notification_type_check
    CHECK (notification_type IN (
      'event_request', 'mentor_application', 'admin_notice', 'mentor_contact_overdue'
    ));
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_mentor_contact_alerts()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.refresh_mentor_contact_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_mentor_contact_alerts() TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_students_evenly(
  p_faculty_id BIGINT,
  p_programme_id BIGINT,
  p_student_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.assign_students_evenly(BIGINT, BIGINT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_students_evenly(BIGINT, BIGINT, UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_event_notification_unread(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.event_notifications
  SET read_at = NULL
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_system_notice_notification_unread(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.system_notice_notifications
  SET read_at = NULL
  WHERE id = p_notification_id AND recipient_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_supervisor_notification_unread(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.mark_event_notification_unread(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_system_notice_notification_unread(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_supervisor_notification_unread(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_event_notification_unread(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_system_notice_notification_unread(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_supervisor_notification_unread(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
