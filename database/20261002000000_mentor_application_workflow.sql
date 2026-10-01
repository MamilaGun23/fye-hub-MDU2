CREATE TABLE IF NOT EXISTS public.mentor_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_number TEXT,
  study_year SMALLINT,
  previous_academic_year TEXT,
  academic_record_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined')),
  review_reason TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  is_legacy BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mentor_applications_study_year_check
    CHECK (study_year IS NULL OR study_year >= 2)
);

CREATE UNIQUE INDEX IF NOT EXISTS mentor_applications_student_number_uidx
  ON public.mentor_applications(student_number)
  WHERE student_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS mentor_applications_status_created_idx
  ON public.mentor_applications(status, created_at DESC);

ALTER TABLE public.mentor_applications ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.mentor_applications TO authenticated;

DROP POLICY IF EXISTS "Applicants and supervisors read mentor applications"
  ON public.mentor_applications;
CREATE POLICY "Applicants and supervisors read mentor applications"
  ON public.mentor_applications FOR SELECT TO authenticated
  USING (
    applicant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'supervisor'
    )
  );

INSERT INTO public.mentor_applications (applicant_id, status, is_legacy)
SELECT
  profile.id,
  CASE profile.mentor_approval_status
    WHEN 'rejected' THEN 'declined'
    ELSE profile.mentor_approval_status
  END,
  true
FROM public.profiles AS profile
WHERE profile.role = 'mentor'
  AND profile.mentor_approval_status IN ('pending', 'approved', 'rejected')
ON CONFLICT (applicant_id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mentor-academic-records',
  'mentor-academic-records',
  false,
  10485760,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Applicants upload own mentor academic record"
  ON storage.objects;
CREATE POLICY "Applicants upload own mentor academic record"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'mentor-academic-records'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Applicants and supervisors read submitted academic records"
  ON storage.objects;
CREATE POLICY "Applicants and supervisors read submitted academic records"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'mentor-academic-records'
    AND EXISTS (
      SELECT 1 FROM public.mentor_applications AS application
      WHERE application.academic_record_path = name
        AND (
          application.applicant_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'supervisor'
          )
        )
    )
  );

DROP POLICY IF EXISTS "Applicants delete own mentor academic records"
  ON storage.objects;
CREATE POLICY "Applicants delete own mentor academic records"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'mentor-academic-records'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT EXISTS (
      SELECT 1 FROM public.mentor_applications AS application
      WHERE application.academic_record_path = name
    )
  );

CREATE OR REPLACE FUNCTION public.submit_mentor_application(
  p_student_number TEXT,
  p_study_year SMALLINT,
  p_previous_academic_year TEXT,
  p_academic_record_path TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.submit_mentor_application(TEXT, SMALLINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_mentor_application(TEXT, SMALLINT, TEXT, TEXT) TO authenticated;

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
    WHERE id = actor_id AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;

  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'declined') THEN
    RAISE EXCEPTION 'Choose approve or decline.';
  END IF;

  IF p_decision = 'declined' AND NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when declining an application.';
  END IF;

  UPDATE public.mentor_applications
  SET status = p_decision,
      review_reason = CASE WHEN p_decision = 'declined' THEN btrim(p_reason) ELSE NULL END,
      reviewed_by = actor_id,
      reviewed_at = now(),
      updated_at = now()
  WHERE id = p_application_id
    AND status = 'pending'
  RETURNING id INTO updated_application_id;

  IF updated_application_id IS NULL THEN
    RAISE EXCEPTION 'This application is no longer waiting for review.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_mentor_application(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_mentor_application(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.mentor_application_is_approved(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    EXISTS (
    SELECT 1 FROM public.mentor_applications
    WHERE applicant_id = p_profile_id AND status = 'approved'
  ) OR EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_profile_id
      AND role = 'mentor'
      AND mentor_approval_status = 'approved'
    )
  ) AND (
    p_profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'supervisor'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.mentor_application_is_approved(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mentor_application_is_approved(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_approved_mentor_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.mentor_application_is_approved(NEW.mentor_id) THEN
    RAISE EXCEPTION 'Only approved mentors can receive student assignments.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_approved_mentor_assignment() FROM PUBLIC;

DROP TRIGGER IF EXISTS mentor_assignments_require_approval
  ON public.mentor_assignments;
CREATE TRIGGER mentor_assignments_require_approval
  BEFORE INSERT OR UPDATE OF mentor_id ON public.mentor_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_approved_mentor_assignment();

CREATE OR REPLACE FUNCTION public.create_event_request(
  p_title TEXT,
  p_purpose TEXT,
  p_event_date DATE,
  p_event_time TIME,
  p_venue TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.create_event_request(TEXT, TEXT, DATE, TIME, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_event_request(TEXT, TEXT, DATE, TIME, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';