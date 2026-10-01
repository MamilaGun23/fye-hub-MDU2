ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS profiles_role_is_active_idx
  ON public.profiles(role, is_active);

CREATE OR REPLACE FUNCTION public.set_profile_active(
  p_profile_id UUID,
  p_is_active BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.set_profile_active(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_profile_active(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_fye_student(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.is_fye_student(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_fye_student(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mentor_application_is_approved(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.mentor_application_is_approved(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mentor_application_is_approved(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.require_active_mentor_applicant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.applicant_id
      AND role IN ('student', 'mentor')
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'An active student account is required to submit a mentor application.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.require_active_mentor_applicant() FROM PUBLIC;

DROP TRIGGER IF EXISTS mentor_applications_require_active_applicant
  ON public.mentor_applications;
CREATE TRIGGER mentor_applications_require_active_applicant
  BEFORE INSERT OR UPDATE OF student_number, study_year, previous_academic_year, academic_record_path
  ON public.mentor_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.require_active_mentor_applicant();

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
  WHERE is_active = true;

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

REVOKE ALL ON FUNCTION public.get_admin_analytics(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_admin_analytics(INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';