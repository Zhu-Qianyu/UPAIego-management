CREATE OR REPLACE FUNCTION public._bounty_policy_drop(tbl text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE pol text;
BEGIN FOR pol IN
  SELECT p.polname::text FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = tbl LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, tbl);
END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.executor_tiers (
  tier_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  min_points integer NOT NULL CHECK (min_points >= 0),
  max_concurrent_claims integer NOT NULL CHECK (max_concurrent_claims >= 1),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (min_points)
);

CREATE INDEX IF NOT EXISTS idx_executor_tiers_min_points ON public.executor_tiers (min_points DESC);

CREATE TABLE IF NOT EXISTS public.executor_stats (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  points_balance integer NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  tier_id uuid NOT NULL REFERENCES public.executor_tiers (tier_id),
  active_claim_count integer NOT NULL DEFAULT 0 CHECK (active_claim_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.executor_point_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  delta integer NOT NULL,
  reason text NOT NULL CHECK (reason IN ('complete', 'penalty', 'admin_adjust', 'abandon')),
  ref_claim_id uuid,
  note text,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_executor_point_ledger_user ON public.executor_point_ledger (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bounties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '悬赏单',
  description text,
  total_hours integer NOT NULL CHECK (total_hours > 0),
  remaining_hours integer NOT NULL CHECK (remaining_hours >= 0),
  hourly_rate numeric(12, 2) NOT NULL CHECK (hourly_rate >= 0),
  completion_days integer NOT NULL CHECK (completion_days IN (1, 2, 3)),
  points_per_hour numeric(8, 2) NOT NULL DEFAULT 1 CHECK (points_per_hour > 0),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'fulfilled', 'closed')),
  created_by uuid NOT NULL REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CHECK (remaining_hours <= total_hours)
);

CREATE INDEX IF NOT EXISTS idx_bounties_group_status ON public.bounties (group_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bounty_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bounty_id uuid NOT NULL REFERENCES public.bounties (id) ON DELETE CASCADE,
  executor_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  claimed_hours integer NOT NULL CHECK (claimed_hours > 0),
  executed_hours integer NOT NULL DEFAULT 0 CHECK (executed_hours >= 0),
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'failed', 'expired', 'abandoned')),
  completed_at timestamptz,
  closed_at timestamptz,
  close_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (executed_hours <= claimed_hours OR status = 'active')
);

CREATE INDEX IF NOT EXISTS idx_bounty_claims_bounty ON public.bounty_claims (bounty_id, status);
CREATE INDEX IF NOT EXISTS idx_bounty_claims_executor ON public.bounty_claims (executor_id, status);
CREATE INDEX IF NOT EXISTS idx_bounty_claims_due ON public.bounty_claims (status, due_at)
  WHERE status = 'active';

ALTER TABLE public.executor_point_ledger
  DROP CONSTRAINT IF EXISTS executor_point_ledger_ref_claim_id_fkey;
ALTER TABLE public.executor_point_ledger
  ADD CONSTRAINT executor_point_ledger_ref_claim_id_fkey
  FOREIGN KEY (ref_claim_id) REFERENCES public.bounty_claims (id) ON DELETE SET NULL;

INSERT INTO public.executor_tiers (tier_id, name, min_points, max_concurrent_claims, sort_order)
VALUES
  ('11111111-1111-1111-1111-111111111101'::uuid, '新手', 0, 1, 1),
  ('11111111-1111-1111-1111-111111111102'::uuid, '入门玩家', 10, 3, 2),
  ('11111111-1111-1111-1111-111111111103'::uuid, '进阶', 50, 5, 3),
  ('11111111-1111-1111-1111-111111111104'::uuid, '资深', 150, 8, 4),
  ('11111111-1111-1111-1111-111111111105'::uuid, '大师', 1000, 15, 5)
ON CONFLICT (min_points) DO UPDATE SET
  name = EXCLUDED.name,
  max_concurrent_claims = EXCLUDED.max_concurrent_claims,
  sort_order = EXCLUDED.sort_order;

CREATE OR REPLACE FUNCTION public._bounty_default_tier_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tier_id FROM public.executor_tiers ORDER BY min_points ASC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._ensure_executor_stats(p_user_id uuid)
RETURNS public.executor_stats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stats public.executor_stats;
  v_tier uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user required';
  END IF;
  SELECT * INTO v_stats FROM public.executor_stats WHERE user_id = p_user_id;
  IF FOUND THEN
    RETURN v_stats;
  END IF;
  v_tier := public._bounty_default_tier_id();
  INSERT INTO public.executor_stats (user_id, points_balance, tier_id, active_claim_count)
  VALUES (p_user_id, 0, v_tier, 0)
  RETURNING * INTO v_stats;
  RETURN v_stats;
END;
$$;

CREATE OR REPLACE FUNCTION public.recalc_executor_tier(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
  v_tier uuid;
BEGIN
  PERFORM public._ensure_executor_stats(p_user_id);
  SELECT points_balance INTO v_balance FROM public.executor_stats WHERE user_id = p_user_id FOR UPDATE;
  SELECT t.tier_id INTO v_tier
  FROM public.executor_tiers t
  WHERE v_balance >= t.min_points
  ORDER BY t.min_points DESC
  LIMIT 1;
  IF v_tier IS NULL THEN
    v_tier := public._bounty_default_tier_id();
  END IF;
  UPDATE public.executor_stats
  SET tier_id = v_tier, updated_at = now()
  WHERE user_id = p_user_id;
  RETURN v_tier;
END;
$$;

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

CREATE OR REPLACE FUNCTION public._apply_executor_point_delta(
  p_user_id uuid,
  p_delta integer,
  p_reason text,
  p_ref_claim_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  IF p_reason NOT IN ('complete', 'penalty', 'admin_adjust', 'abandon') THEN
    RAISE EXCEPTION 'invalid ledger reason';
  END IF;
  PERFORM public._ensure_executor_stats(p_user_id);
  UPDATE public.executor_stats
  SET points_balance = GREATEST(0, points_balance + p_delta),
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING points_balance INTO v_new_balance;
  INSERT INTO public.executor_point_ledger (user_id, delta, reason, ref_claim_id, note, balance_after)
  VALUES (p_user_id, p_delta, p_reason, p_ref_claim_id, p_note, v_new_balance);
  PERFORM public.recalc_executor_tier(p_user_id);
  RETURN v_new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public._bounty_reopen_if_hours_returned(p_bounty_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.bounties b
  SET status = 'open', updated_at = now()
  WHERE b.id = p_bounty_id
    AND b.status = 'fulfilled'
    AND b.remaining_hours > 0
    AND b.closed_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._finalize_bounty_claim_failure(
  p_claim_id uuid,
  p_new_status text,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.bounty_claims;
  v_bounty public.bounties;
  v_uncompleted integer;
  v_deduct integer;
  v_rate numeric;
BEGIN
  IF p_new_status NOT IN ('failed', 'expired', 'abandoned') THEN
    RAISE EXCEPTION 'invalid failure status';
  END IF;
  SELECT * INTO v_claim FROM public.bounty_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found';
  END IF;
  IF v_claim.status <> 'active' THEN
    RETURN;
  END IF;
  SELECT * INTO v_bounty FROM public.bounties WHERE id = v_claim.bounty_id FOR UPDATE;
  v_uncompleted := GREATEST(v_claim.claimed_hours - v_claim.executed_hours, 0);
  v_rate := v_bounty.points_per_hour;
  v_deduct := CEIL(v_uncompleted * v_rate)::integer;
  IF v_deduct > 0 THEN
    PERFORM public._apply_executor_point_delta(
      v_claim.executor_id,
      -v_deduct,
      CASE WHEN p_new_status = 'abandoned' THEN 'abandon' ELSE 'penalty' END,
      p_claim_id,
      p_reason
    );
  END IF;
  IF v_uncompleted > 0 THEN
    UPDATE public.bounties
    SET remaining_hours = remaining_hours + v_uncompleted,
        updated_at = now()
    WHERE id = v_bounty.id;
    PERFORM public._bounty_reopen_if_hours_returned(v_bounty.id);
  END IF;
  UPDATE public.bounty_claims
  SET status = p_new_status,
      closed_at = now(),
      close_reason = p_reason
  WHERE id = p_claim_id;
  UPDATE public.executor_stats
  SET active_claim_count = GREATEST(0, active_claim_count - 1),
      updated_at = now()
  WHERE user_id = v_claim.executor_id;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.close_bounty(p_bounty_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bounty public.bounties;
BEGIN
  IF public.current_profile_role() <> 'admin' THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  SELECT * INTO v_bounty FROM public.bounties WHERE id = p_bounty_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bounty not found';
  END IF;
  IF NOT public.policy_work_group_accessible(v_bounty.group_id) THEN
    RAISE EXCEPTION 'group not accessible';
  END IF;
  UPDATE public.bounties
  SET status = 'closed', closed_at = now(), updated_at = now()
  WHERE id = p_bounty_id;
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
    RAISE EXCEPTION '已达进行中接单上限（% 台），请先完成或处理现有订单', v_tier.max_concurrent_claims;
  END IF;
  v_per_slot := public.bounty_hours_per_slot_per_day();
  v_today := (now() AT TIME ZONE 'Asia/Shanghai')::date;
  v_claimed_today := public.executor_claimed_hours_on_date(auth.uid(), v_today);
  v_daily_cap := v_tier.max_concurrent_claims * v_per_slot;
  IF v_claimed_today + p_hours > v_daily_cap THEN
    RAISE EXCEPTION
      '超过今日领取上限：今日已领 % 小时，本次领取 % 小时，上限 % 小时（% 台 × 每台每天 % 小时）',
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

CREATE OR REPLACE FUNCTION public.complete_bounty_claim(p_claim_id uuid, p_executed_hours integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.bounty_claims;
  v_bounty public.bounties;
  v_points integer;
  v_rate numeric;
BEGIN
  SELECT * INTO v_claim FROM public.bounty_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found';
  END IF;
  IF v_claim.status <> 'active' THEN
    RAISE EXCEPTION 'claim not active';
  END IF;
  IF public.current_profile_role() = 'collection_executor' AND v_claim.executor_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your claim';
  END IF;
  IF public.current_profile_role() NOT IN ('collection_executor', 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_executed_hours IS NULL OR p_executed_hours < v_claim.claimed_hours THEN
    RAISE EXCEPTION 'executed_hours must be >= claimed_hours (%)', v_claim.claimed_hours;
  END IF;
  SELECT * INTO v_bounty FROM public.bounties WHERE id = v_claim.bounty_id;
  v_rate := v_bounty.points_per_hour;
  v_points := CEIL(v_claim.claimed_hours * v_rate)::integer;
  UPDATE public.bounty_claims
  SET executed_hours = v_claim.claimed_hours,
      status = 'completed',
      completed_at = now()
  WHERE id = p_claim_id;
  IF v_points > 0 THEN
    PERFORM public._apply_executor_point_delta(
      v_claim.executor_id, v_points, 'complete', p_claim_id, 'claim completed'
    );
  ELSE
    PERFORM public.recalc_executor_tier(v_claim.executor_id);
  END IF;
  UPDATE public.executor_stats
  SET active_claim_count = GREATEST(0, active_claim_count - 1), updated_at = now()
  WHERE user_id = v_claim.executor_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.abandon_bounty_claim(p_claim_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.bounty_claims;
BEGIN
  SELECT * INTO v_claim FROM public.bounty_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found';
  END IF;
  IF v_claim.executor_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your claim';
  END IF;
  IF public.current_profile_role() <> 'collection_executor' THEN
    RAISE EXCEPTION 'collection_executor only';
  END IF;
  PERFORM public._finalize_bounty_claim_failure(p_claim_id, 'abandoned', 'executor abandoned');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_fail_bounty_claim(p_claim_id uuid, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.bounty_claims;
  v_bounty public.bounties;
BEGIN
  IF public.current_profile_role() <> 'admin' THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  SELECT c.* INTO v_claim FROM public.bounty_claims c WHERE c.id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found';
  END IF;
  SELECT * INTO v_bounty FROM public.bounties WHERE id = v_claim.bounty_id;
  IF NOT public.policy_work_group_accessible(v_bounty.group_id) THEN
    RAISE EXCEPTION 'group not accessible';
  END IF;
  PERFORM public._finalize_bounty_claim_failure(
    p_claim_id, 'failed', COALESCE(NULLIF(trim(p_note), ''), 'admin marked incomplete')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_overdue_bounty_claims()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT id FROM public.bounty_claims
    WHERE status = 'active' AND due_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public._finalize_bounty_claim_failure(v_row.id, 'expired', 'past due_at');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.recalc_executor_tier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalc_executor_tier(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.close_bounty(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_bounty(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_bounty(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_bounty(uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_bounty_claim(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_bounty_claim(uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.abandon_bounty_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abandon_bounty_claim(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_fail_bounty_claim(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_fail_bounty_claim(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.process_overdue_bounty_claims() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_overdue_bounty_claims() TO authenticated;

REVOKE ALL ON FUNCTION public.bounty_hours_per_slot_per_day() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bounty_hours_per_slot_per_day() TO authenticated;

REVOKE ALL ON FUNCTION public.executor_claimed_hours_on_date(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.executor_claimed_hours_on_date(uuid, date) TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_daily_claim_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_daily_claim_usage() TO authenticated;

ALTER TABLE public.executor_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executor_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executor_point_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bounties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bounty_claims ENABLE ROW LEVEL SECURITY;

SELECT public._bounty_policy_drop('executor_tiers');
SELECT public._bounty_policy_drop('executor_stats');
SELECT public._bounty_policy_drop('executor_point_ledger');
SELECT public._bounty_policy_drop('bounties');
SELECT public._bounty_policy_drop('bounty_claims');

CREATE POLICY "executor_tiers_select_authenticated"
  ON public.executor_tiers FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "executor_stats_select_own_or_admin"
  ON public.executor_stats FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_profile_role() = 'admin'
  );

CREATE POLICY "executor_point_ledger_select_own_or_admin"
  ON public.executor_point_ledger FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_profile_role() = 'admin'
  );

CREATE POLICY "bounties_select_group_or_admin"
  ON public.bounties FOR SELECT TO authenticated
  USING (
    public.policy_work_group_accessible(group_id)
    OR public.current_profile_role() = 'admin'
  );


CREATE POLICY "bounty_claims_select_own_or_admin"
  ON public.bounty_claims FOR SELECT TO authenticated
  USING (
    executor_id = auth.uid()
    OR public.current_profile_role() = 'admin'
  );

REVOKE INSERT, UPDATE, DELETE ON public.bounties FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.executor_stats FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.executor_point_ledger FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.bounty_claims FROM authenticated;
GRANT SELECT ON public.executor_tiers TO authenticated;
GRANT SELECT ON public.executor_stats TO authenticated;
GRANT SELECT ON public.executor_point_ledger TO authenticated;
GRANT SELECT ON public.bounties TO authenticated;
GRANT SELECT ON public.bounty_claims TO authenticated;


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
