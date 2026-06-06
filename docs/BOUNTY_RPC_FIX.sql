DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bounties' AND column_name = 'total_reward'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bounties' AND column_name = 'hourly_rate'
  ) THEN
    ALTER TABLE public.bounties RENAME COLUMN total_reward TO hourly_rate;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric);

CREATE OR REPLACE FUNCTION public.publish_bounty(
  p_group_id uuid,
  p_title text,
  p_total_hours integer,
  p_hourly_rate numeric,
  p_completion_days integer,
  p_description text DEFAULT NULL,
  p_points_per_hour numeric DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF public.current_profile_role() <> 'admin' THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF NOT public.policy_work_group_accessible(p_group_id) THEN
    RAISE EXCEPTION 'group not accessible';
  END IF;
  IF p_total_hours IS NULL OR p_total_hours <= 0 THEN
    RAISE EXCEPTION 'total_hours must be positive';
  END IF;
  IF p_completion_days NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'completion_days must be 1, 2, or 3';
  END IF;
  IF p_points_per_hour IS NULL OR p_points_per_hour <= 0 THEN
    p_points_per_hour := 1;
  END IF;
  INSERT INTO public.bounties (
    group_id, title, description, total_hours, remaining_hours,
    hourly_rate, completion_days, points_per_hour, status, created_by
  )
  VALUES (
    p_group_id,
    COALESCE(NULLIF(trim(p_title), ''), '悬赏单'),
    NULLIF(trim(p_description), ''),
    p_total_hours,
    p_total_hours,
    COALESCE(p_hourly_rate, 0),
    p_completion_days,
    p_points_per_hour,
    'open',
    auth.uid()
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
