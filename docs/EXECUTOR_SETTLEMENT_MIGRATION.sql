-- 数采执行员现金结算（元/小时，基于 bounties.hourly_rate）
-- 前置：BOUNTY_MIGRATION.sql、BOUNTY_OPERATOR_AUDIT_MIGRATION.sql
-- 在 Supabase SQL Editor 整段执行

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.executor_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  available_balance numeric(12, 2) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  pending_balance numeric(12, 2) NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
  total_settled numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total_settled >= 0),
  total_withdrawn numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total_withdrawn >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.executor_settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  bounty_claim_id uuid NOT NULL REFERENCES public.bounty_claims (id) ON DELETE CASCADE,
  bounty_id uuid NOT NULL REFERENCES public.bounties (id) ON DELETE CASCADE,
  confirmed_hours numeric(8, 2) NOT NULL CHECK (confirmed_hours > 0),
  registered_hours_sum numeric(10, 2) NOT NULL DEFAULT 0 CHECK (registered_hours_sum >= 0),
  hourly_rate_snapshot numeric(12, 2) NOT NULL CHECK (hourly_rate_snapshot >= 0),
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'settled'
    CHECK (status IN ('pending', 'settled', 'reversed')),
  operator_note text,
  approved_by uuid REFERENCES auth.users (id),
  settled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS executor_settlement_lines_claim_settled_uidx
  ON public.executor_settlement_lines (bounty_claim_id)
  WHERE status = 'settled';

CREATE INDEX IF NOT EXISTS idx_executor_settlement_lines_user
  ON public.executor_settlement_lines (user_id, settled_at DESC);

CREATE TABLE IF NOT EXISTS public.executor_wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  delta numeric(12, 2) NOT NULL,
  balance_after numeric(12, 2) NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL CHECK (reason IN ('settlement', 'withdraw_hold', 'withdraw_paid', 'admin_adjust', 'reversal')),
  ref_settlement_line_id uuid REFERENCES public.executor_settlement_lines (id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_executor_wallet_ledger_user
  ON public.executor_wallet_ledger (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._settlement_policy_drop(tbl text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE pol text;
BEGIN
  FOR pol IN
    SELECT p.polname::text
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = tbl
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, tbl);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._sum_registered_hours_for_claim(p_claim_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(l.registered_hours), 0)::numeric
  FROM public.device_data_hour_logs l
  WHERE l.bounty_claim_id = p_claim_id;
$$;

CREATE OR REPLACE FUNCTION public._ensure_executor_wallet(p_user_id uuid)
RETURNS public.executor_wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.executor_wallets;
BEGIN
  INSERT INTO public.executor_wallets (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO w FROM public.executor_wallets WHERE user_id = p_user_id FOR UPDATE;
  RETURN w;
END;
$$;

CREATE OR REPLACE FUNCTION public._apply_wallet_delta(
  p_user_id uuid,
  p_delta numeric,
  p_reason text,
  p_ref_settlement_line_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w public.executor_wallets;
  v_new numeric;
BEGIN
  IF p_reason NOT IN ('settlement', 'withdraw_hold', 'withdraw_paid', 'admin_adjust', 'reversal') THEN
    RAISE EXCEPTION 'invalid wallet ledger reason';
  END IF;
  w := public._ensure_executor_wallet(p_user_id);
  v_new := GREATEST(0, w.available_balance + p_delta);
  UPDATE public.executor_wallets
  SET
    available_balance = v_new,
    total_settled = CASE WHEN p_reason = 'settlement' AND p_delta > 0 THEN total_settled + p_delta ELSE total_settled END,
    total_withdrawn = CASE WHEN p_reason = 'withdraw_paid' THEN total_withdrawn + ABS(p_delta) ELSE total_withdrawn END,
    updated_at = now()
  WHERE user_id = p_user_id;
  INSERT INTO public.executor_wallet_ledger (user_id, delta, balance_after, reason, ref_settlement_line_id, note)
  VALUES (p_user_id, p_delta, v_new, p_reason, p_ref_settlement_line_id, p_note);
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public._assert_operator_can_settle_claim(p_claim_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
BEGIN
  IF public.current_profile_role() NOT IN ('device_operator', 'admin') THEN
    RAISE EXCEPTION 'device_operator or admin only';
  END IF;
  v_group := public._bounty_group_id_for_claim(p_claim_id);
  IF v_group IS NULL OR NOT public.policy_work_group_accessible(v_group) THEN
    RAISE EXCEPTION 'claim not in accessible group';
  END IF;
  IF public.current_profile_role() = 'device_operator'
     AND NOT public._profile_is_device_operator_in_group(auth.uid(), v_group) THEN
    RAISE EXCEPTION 'not a device operator in this group';
  END IF;
  RETURN v_group;
END;
$$;

-- ---------------------------------------------------------------------------
-- Preview settlement (operator / admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_settlement_for_claim(p_claim_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.bounty_claims;
  v_bounty public.bounties;
  v_reg numeric;
  v_already boolean;
BEGIN
  PERFORM public._assert_operator_can_settle_claim(p_claim_id);
  SELECT * INTO v_claim FROM public.bounty_claims WHERE id = p_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found';
  END IF;
  SELECT * INTO v_bounty FROM public.bounties WHERE id = v_claim.bounty_id;
  v_reg := public._sum_registered_hours_for_claim(p_claim_id);
  SELECT EXISTS (
    SELECT 1 FROM public.executor_settlement_lines sl
    WHERE sl.bounty_claim_id = p_claim_id AND sl.status = 'settled'
  ) INTO v_already;
  RETURN jsonb_build_object(
    'claim_id', v_claim.id,
    'claim_status', v_claim.status,
    'claimed_hours', v_claim.claimed_hours,
    'registered_hours_sum', v_reg,
    'hourly_rate', v_bounty.hourly_rate,
    'bounty_title', v_bounty.title,
    'already_settled', v_already,
    'estimated_amount',
      CASE
        WHEN v_bounty.hourly_rate > 0 THEN
          round(LEAST(v_claim.claimed_hours::numeric, GREATEST(v_reg, 0)) * v_bounty.hourly_rate, 2)
        ELSE 0
      END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Settle: cash ledger + complete claim (points)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_bounty_claim(
  p_claim_id uuid,
  p_confirmed_hours numeric,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  v_claim public.bounty_claims;
  v_bounty public.bounties;
  v_reg numeric;
  v_conf numeric;
  v_amount numeric;
  v_line_id uuid;
  v_exec_int integer;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  v_group := public._assert_operator_can_settle_claim(p_claim_id);

  IF p_confirmed_hours IS NULL OR p_confirmed_hours <= 0 THEN
    RAISE EXCEPTION 'confirmed hours must be positive';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.executor_settlement_lines sl
    WHERE sl.bounty_claim_id = p_claim_id AND sl.status = 'settled'
  ) THEN
    RAISE EXCEPTION '该接单已结算，不可重复入账';
  END IF;

  SELECT * INTO v_claim FROM public.bounty_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found';
  END IF;
  IF v_claim.status <> 'active' THEN
    RAISE EXCEPTION 'claim not active';
  END IF;

  SELECT * INTO v_bounty FROM public.bounties WHERE id = v_claim.bounty_id;
  v_reg := public._sum_registered_hours_for_claim(p_claim_id);
  v_conf := LEAST(v_claim.claimed_hours::numeric, GREATEST(p_confirmed_hours, 0));
  IF v_conf <= 0 THEN
    RAISE EXCEPTION 'confirmed hours must be positive';
  END IF;

  v_amount := round(v_conf * COALESCE(v_bounty.hourly_rate, 0), 2);
  v_exec_int := LEAST(v_claim.claimed_hours, GREATEST(ceil(v_conf)::integer, 1));

  IF v_amount > 0 THEN
    INSERT INTO public.executor_settlement_lines (
      user_id, group_id, bounty_claim_id, bounty_id,
      confirmed_hours, registered_hours_sum, hourly_rate_snapshot, amount,
      status, operator_note, approved_by
    )
    VALUES (
      v_claim.executor_id, v_group, p_claim_id, v_bounty.id,
      v_conf, v_reg, v_bounty.hourly_rate, v_amount,
      'settled', NULLIF(trim(p_note), ''), auth.uid()
    )
    RETURNING id INTO v_line_id;

    PERFORM public._apply_wallet_delta(
      v_claim.executor_id,
      v_amount,
      'settlement',
      v_line_id,
      COALESCE(NULLIF(trim(p_note), ''), '悬赏结算')
    );
  END IF;

  PERFORM public._complete_bounty_claim_core(
    p_claim_id,
    v_exec_int,
    COALESCE(NULLIF(trim(p_note), ''), 'settled with payout')
  );

  RETURN v_line_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Executor wallet summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_wallet_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  w public.executor_wallets;
  v_pending numeric;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  w := public._ensure_executor_wallet(v_uid);

  SELECT COALESCE(SUM(
    round(
      LEAST(c.claimed_hours::numeric, GREATEST(public._sum_registered_hours_for_claim(c.id), 0))
      * b.hourly_rate,
      2
    )
  ), 0)
  INTO v_pending
  FROM public.bounty_claims c
  JOIN public.bounties b ON b.id = c.bounty_id
  WHERE c.executor_id = v_uid
    AND c.status = 'active'
    AND b.hourly_rate > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.executor_settlement_lines sl
      WHERE sl.bounty_claim_id = c.id AND sl.status = 'settled'
    );

  UPDATE public.executor_wallets
  SET pending_balance = v_pending, updated_at = now()
  WHERE user_id = v_uid;

  SELECT * INTO w FROM public.executor_wallets WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'available_balance', w.available_balance,
    'pending_balance', w.pending_balance,
    'total_settled', w.total_settled,
    'total_withdrawn', w.total_withdrawn
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.executor_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executor_settlement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executor_wallet_ledger ENABLE ROW LEVEL SECURITY;

SELECT public._settlement_policy_drop('executor_wallets');
SELECT public._settlement_policy_drop('executor_settlement_lines');
SELECT public._settlement_policy_drop('executor_wallet_ledger');

CREATE POLICY "executor_wallets_select_own_or_admin"
  ON public.executor_wallets FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_profile_role() = 'admin');

CREATE POLICY "executor_settlement_lines_select"
  ON public.executor_settlement_lines FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'device_operator'
      AND public.policy_work_group_accessible(group_id)
    )
  );

CREATE POLICY "executor_wallet_ledger_select_own_or_admin"
  ON public.executor_wallet_ledger FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.current_profile_role() = 'admin');

REVOKE INSERT, UPDATE, DELETE ON public.executor_wallets FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.executor_settlement_lines FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.executor_wallet_ledger FROM authenticated;

REVOKE ALL ON FUNCTION public.preview_settlement_for_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_settlement_for_claim(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.settle_bounty_claim(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_bounty_claim(uuid, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_my_wallet_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_wallet_summary() TO authenticated;

GRANT SELECT ON public.executor_wallets TO authenticated;
GRANT SELECT ON public.executor_settlement_lines TO authenticated;
GRANT SELECT ON public.executor_wallet_ledger TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON TABLE public.executor_wallets IS 'Executor CNY wallet; balance mutated only via SECURITY DEFINER RPCs.';
COMMENT ON TABLE public.executor_settlement_lines IS 'Per-claim cash settlement; one settled row per bounty_claim_id.';
COMMENT ON COLUMN public.executor_settlement_lines.hourly_rate_snapshot IS 'Frozen bounties.hourly_rate at settlement time (元/小时).';
