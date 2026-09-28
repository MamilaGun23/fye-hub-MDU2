CREATE OR REPLACE FUNCTION public.review_mentor_approval(
  p_mentor_id UUID,
  p_decision TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID := auth.uid();
  updated_mentor_id UUID;
BEGIN
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = actor_id
      AND role = 'supervisor'
  ) THEN
    RAISE EXCEPTION 'Supervisor access is required.';
  END IF;

  IF p_decision IS NULL OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Choose approve or decline.';
  END IF;

  UPDATE public.profiles
  SET mentor_approval_status = p_decision
  WHERE id = p_mentor_id
    AND role = 'mentor'
    AND mentor_approval_status IN ('pending', 'rejected')
  RETURNING id INTO updated_mentor_id;

  IF updated_mentor_id IS NULL THEN
    RAISE EXCEPTION 'This mentor is not waiting for review.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_mentor_approval(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_mentor_approval(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
