-- Daily claim cap per executor: tier max_concurrent_claims (台) × 8 hours per slot per day (Asia/Shanghai).
-- Run in Supabase SQL Editor on databases that already have the bounty module.

CREATE OR REPLACE FUNCTION public.bounty_hours_per_slot_per_day()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 8;
$$;

CREATE OR REPLACE FUNCTION public.executor_claimed_hours_on_date(p_user_id uuid, p_on_date date)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(c.claimed_hours), 0)::integer
  FROM public.bounty_claims c
  WHERE c.executor_id = p_user_id
    AND (c.created_at AT TIME ZONE 'Asia/Shanghai')::date = p_on_date;
$$;

CREATE OR REPLACE FUNCTION public.get_my_daily_claim_usage()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stats public.executor_stats;
  v_tier public.executor_tiers;
  v_today date;
  v_claimed integer;
  v_cap integer;
  v_per_slot integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  v_per_slot := public.bounty_hours_per_slot_per_day();
  v_stats := public._ensure_executor_stats(auth.uid());
  SELECT t.* INTO v_tier FROM public.executor_tiers t WHERE t.tier_id = v_stats.tier_id;
  v_today := (now() AT TIME ZONE 'Asia/Shanghai')::date;
  v_claimed := public.executor_claimed_hours_on_date(auth.uid(), v_today);
  v_cap := v_tier.max_concurrent_claims * v_per_slot;
  RETURN jsonb_build_object(
    'claimed_today', v_claimed,
    'daily_limit', v_cap,
    'remaining_today', GREATEST(0, v_cap - v_claimed),
    'slots', v_tier.max_concurrent_claims,
    'hours_per_slot', v_per_slot,
    'claim_date', v_today::text,
    'timezone', 'Asia/Shanghai'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_bounty(p_bounty_id uuid, p_hours integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounty public.bounties;
  v_stats public.executor_stats;
  v_tier public.executor_tiers;
  v_claim_id uuid;
  v_due timestamptz;
  v_today date;
  v_claimed_today integer;
  v_daily_cap integer;
  v_per_slot integer;
BEGIN
  IF public.current_profile_role() <> 'collection_executor' THEN
    RAISE EXCEPTION 'collection_executor only';
  END IF;
  IF p_hours IS NULL OR p_hours <= 0 THEN
    RAISE EXCEPTION 'hours must be positive';
  END IF;
  PERFORM public.process_overdue_bounty_claims();
  SELECT * INTO v_bounty FROM public.bounties WHERE id = p_bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty not found';
  END IF;
  IF v_bounty.status <> 'open' THEN
    RAISE EXCEPTION 'bounty not open for claims';
  END IF;
  IF NOT public.policy_work_group_accessible(v_bounty.group_id) THEN
    RAISE EXCEPTION 'group not accessible';
  END IF;
  IF p_hours > v_bounty.remaining_hours THEN
    RAISE EXCEPTION 'insufficient remaining hours';
  END IF;
  v_stats := public._ensure_executor_stats(auth.uid());
  SELECT t.* INTO v_tier FROM public.executor_tiers t WHERE t.tier_id = v_stats.tier_id;
  IF v_stats.active_claim_count >= v_tier.max_concurrent_claims THEN
    RAISE EXCEPTION 'concurrent claim limit reached (%)', v_tier.max_concurrent_claims;
  END IF;
  v_per_slot := public.bounty_hours_per_slot_per_day();
  v_today := (now() AT TIME ZONE 'Asia/Shanghai')::date;
  v_claimed_today := public.executor_claimed_hours_on_date(auth.uid(), v_today);
  v_daily_cap := v_tier.max_concurrent_claims * v_per_slot;
  IF v_claimed_today + p_hours > v_daily_cap THEN
    RAISE EXCEPTION
      'daily claim limit exceeded: claimed % h today, requesting % h, limit % h (% slots x % h/day per slot)',
      v_claimed_today, p_hours, v_daily_cap, v_tier.max_concurrent_claims, v_per_slot;
  END IF;
  v_due := now() + (v_bounty.completion_days || ' days')::interval;
  INSERT INTO public.bounty_claims (bounty_id, executor_id, claimed_hours, due_at)
  VALUES (p_bounty_id, auth.uid(), p_hours, v_due)
  RETURNING id INTO v_claim_id;
  UPDATE public.bounties
  SET remaining_hours = remaining_hours - p_hours,
      updated_at = now(),
      status = CASE WHEN remaining_hours - p_hours <= 0 THEN 'fulfilled' ELSE status END
  WHERE id = p_bounty_id;
  UPDATE public.executor_stats
  SET active_claim_count = active_claim_count + 1, updated_at = now()
  WHERE user_id = auth.uid();
  RETURN v_claim_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bounty_hours_per_slot_per_day() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bounty_hours_per_slot_per_day() TO authenticated;

REVOKE ALL ON FUNCTION public.executor_claimed_hours_on_date(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.executor_claimed_hours_on_date(uuid, date) TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_daily_claim_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_daily_claim_usage() TO authenticated;

REVOKE ALL ON FUNCTION public.claim_bounty(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_bounty(uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
