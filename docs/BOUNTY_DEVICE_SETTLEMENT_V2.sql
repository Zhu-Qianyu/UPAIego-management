CREATE TABLE IF NOT EXISTS public.bounty_allowed_party_demands (
  bounty_id uuid NOT NULL REFERENCES public.bounties (id) ON DELETE CASCADE,
  party_demand_id uuid NOT NULL REFERENCES public.party_demands (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bounty_id, party_demand_id)
);

CREATE INDEX IF NOT EXISTS idx_bapd_party ON public.bounty_allowed_party_demands (party_demand_id);

ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS party_demand_id uuid REFERENCES public.party_demands (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_devices_party_demand ON public.devices (party_demand_id);

ALTER TABLE public.device_executor_assignments
  ADD COLUMN IF NOT EXISTS bounty_claim_id uuid REFERENCES public.bounty_claims (id) ON DELETE CASCADE;

ALTER TABLE public.device_executor_assignments
  DROP CONSTRAINT IF EXISTS device_executor_assignments_device_id_fkey;

ALTER TABLE public.device_data_hour_logs
  DROP CONSTRAINT IF EXISTS device_data_hour_logs_device_id_fkey;

ALTER TABLE public.device_data_hour_logs
  ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES public.device_executor_assignments (id) ON DELETE SET NULL;

ALTER TABLE public.executor_settlement_lines
  ADD COLUMN IF NOT EXISTS assignment_id uuid REFERENCES public.device_executor_assignments (id) ON DELETE SET NULL;

DROP INDEX IF EXISTS public.executor_settlement_lines_claim_settled_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS dea_device_active_uidx
  ON public.device_executor_assignments (device_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS dea_claim_active_uidx
  ON public.device_executor_assignments (bounty_claim_id)
  WHERE status = 'active' AND bounty_claim_id IS NOT NULL;

ALTER TABLE public.bounty_claims
  ALTER COLUMN executed_hours TYPE numeric(10, 2) USING executed_hours::numeric(10, 2);

ALTER TABLE public.bounty_claims
  ADD COLUMN IF NOT EXISTS device_returned_at timestamptz;

ALTER TABLE public.bounty_claims DROP CONSTRAINT IF EXISTS bounty_claims_executed_hours_check;
ALTER TABLE public.bounty_claims ADD CONSTRAINT bounty_claims_executed_hours_check CHECK (
  executed_hours <= claimed_hours::numeric OR status = 'active'
);

CREATE OR REPLACE FUNCTION public._release_assignments_for_claim(p_claim_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.device_executor_assignments
  SET status = 'revoked', revoked_at = now()
  WHERE bounty_claim_id = p_claim_id AND status = 'active';
END;
$$;

CREATE OR REPLACE FUNCTION public._device_party_demand_id(p_device_id text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_id uuid;
BEGIN
  IF p_device_id LIKE 'offline:%' THEN
    v_code := upper(trim(substring(p_device_id from 9)));
    SELECT m.party_demand_id INTO v_id
    FROM public.manual_tracked_devices m
    WHERE m.public_code = v_code
    LIMIT 1;
    RETURN v_id;
  END IF;
  SELECT d.party_demand_id INTO v_id FROM public.devices d WHERE d.device_id = p_device_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._device_is_normal_for_bounty(p_device_id text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  IF p_device_id LIKE 'offline:%' THEN
    v_code := upper(trim(substring(p_device_id from 9)));
    RETURN EXISTS (
      SELECT 1 FROM public.manual_tracked_devices m
      WHERE m.public_code = v_code AND m.external_status = 'normal'
    );
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.device_id = p_device_id AND d.status = 'active'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._device_in_group(p_device_id text, p_group uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_pd uuid;
BEGIN
  IF p_group IS NULL THEN
    RETURN false;
  END IF;
  v_pd := public._device_party_demand_id(p_device_id);
  IF v_pd IS NULL THEN
    RETURN false;
  END IF;
  IF p_device_id LIKE 'offline:%' THEN
    v_code := upper(trim(substring(p_device_id from 9)));
    RETURN EXISTS (
      SELECT 1 FROM public.manual_tracked_devices m
      WHERE m.public_code = v_code AND m.group_id = p_group
    );
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.party_demands pd
    WHERE pd.id = v_pd AND pd.group_id = p_group
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._bounty_allows_device(p_bounty_id uuid, p_device_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.bounty_allowed_party_demands bap
    WHERE bap.bounty_id = p_bounty_id
      AND bap.party_demand_id = public._device_party_demand_id(p_device_id)
  );
$$;

CREATE OR REPLACE FUNCTION public._device_is_assignable(
  p_device_id text,
  p_group uuid,
  p_bounty_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._device_in_group(p_device_id, p_group) THEN
    RETURN false;
  END IF;
  IF NOT public._device_is_normal_for_bounty(p_device_id) THEN
    RETURN false;
  END IF;
  IF NOT public._bounty_allows_device(p_bounty_id, p_device_id) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.device_executor_assignments a
    WHERE a.device_id = p_device_id AND a.status = 'active'
  ) THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public._assert_operator_in_claim_group(p_claim_id uuid)
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

CREATE OR REPLACE FUNCTION public._apply_claim_session_progress(
  p_claim_id uuid,
  p_session_hours numeric,
  p_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.bounty_claims;
  v_bounty public.bounties;
  v_new_exec numeric;
  v_points integer;
  v_rate numeric;
  v_completed boolean := false;
BEGIN
  SELECT * INTO v_claim FROM public.bounty_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found';
  END IF;
  IF v_claim.status <> 'active' THEN
    RAISE EXCEPTION 'claim not active';
  END IF;
  SELECT * INTO v_bounty FROM public.bounties WHERE id = v_claim.bounty_id FOR UPDATE;
  v_new_exec := LEAST(
    v_claim.claimed_hours::numeric,
    COALESCE(v_claim.executed_hours, 0) + GREATEST(p_session_hours, 0)
  );
  IF v_new_exec <= COALESCE(v_claim.executed_hours, 0) THEN
    RAISE EXCEPTION 'session hours must increase executed total';
  END IF;
  v_rate := v_bounty.points_per_hour;
  v_points := CEIL(p_session_hours * v_rate)::integer;
  UPDATE public.bounty_claims
  SET executed_hours = v_new_exec
  WHERE id = p_claim_id;
  IF v_points > 0 THEN
    PERFORM public._apply_executor_point_delta(
      v_claim.executor_id, v_points, 'complete', p_claim_id,
      COALESCE(p_note, 'session settle')
    );
  ELSE
    PERFORM public.recalc_executor_tier(v_claim.executor_id);
  END IF;
  IF v_new_exec >= v_claim.claimed_hours::numeric THEN
    UPDATE public.bounty_claims
    SET status = 'completed',
        completed_at = now(),
        approved_by = auth.uid(),
        approved_at = now(),
        close_reason = COALESCE(p_note, 'fully settled')
    WHERE id = p_claim_id;
    UPDATE public.executor_stats
    SET active_claim_count = GREATEST(0, active_claim_count - 1), updated_at = now()
    WHERE user_id = v_claim.executor_id;
    v_completed := true;
  END IF;
  RETURN v_completed;
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
  v_uncompleted numeric;
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
  PERFORM public._release_assignments_for_claim(p_claim_id);
  SELECT * INTO v_bounty FROM public.bounties WHERE id = v_claim.bounty_id FOR UPDATE;
  v_uncompleted := GREATEST(v_claim.claimed_hours::numeric - COALESCE(v_claim.executed_hours, 0), 0);
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
    SET remaining_hours = remaining_hours + ceil(v_uncompleted)::integer,
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
DROP FUNCTION IF EXISTS public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric, uuid);
DROP FUNCTION IF EXISTS public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric, uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.publish_bounty(
  p_group_id uuid,
  p_title text,
  p_total_hours integer,
  p_hourly_rate numeric,
  p_completion_days integer,
  p_description text DEFAULT NULL,
  p_points_per_hour numeric DEFAULT 1,
  p_assigned_operator_id uuid DEFAULT NULL,
  p_party_demand_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_pd uuid;
BEGIN
  IF public.current_profile_role() <> 'admin' THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  IF NOT public.policy_work_group_accessible(p_group_id) THEN
    RAISE EXCEPTION 'group not accessible';
  END IF;
  IF p_assigned_operator_id IS NULL THEN
    RAISE EXCEPTION 'assigned operator required';
  END IF;
  IF NOT public._profile_is_device_operator_in_group(p_assigned_operator_id, p_group_id) THEN
    RAISE EXCEPTION 'assigned operator must be active device_operator in this group';
  END IF;
  IF p_party_demand_ids IS NULL OR array_length(p_party_demand_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'at least one party demand (device type) required';
  END IF;
  FOREACH v_pd IN ARRAY p_party_demand_ids LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.party_demands pd
      WHERE pd.id = v_pd AND pd.group_id = p_group_id
    ) THEN
      RAISE EXCEPTION 'party demand % not in group', v_pd;
    END IF;
  END LOOP;
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
    hourly_rate, completion_days, points_per_hour, status, created_by, assigned_operator_id
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
    auth.uid(),
    p_assigned_operator_id
  )
  RETURNING id INTO v_id;
  FOREACH v_pd IN ARRAY p_party_demand_ids LOOP
    INSERT INTO public.bounty_allowed_party_demands (bounty_id, party_demand_id)
    VALUES (v_id, v_pd)
    ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._claim_assignment_for_settle(p_claim_id uuid)
RETURNS public.device_executor_assignments
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asg public.device_executor_assignments;
BEGIN
  SELECT * INTO v_asg
  FROM public.device_executor_assignments a
  WHERE a.bounty_claim_id = p_claim_id
  ORDER BY
    CASE WHEN a.status = 'active' THEN 0 ELSE 1 END,
    COALESCE(a.revoked_at, a.created_at) DESC
  LIMIT 1;
  RETURN v_asg;
END;
$$;

CREATE OR REPLACE FUNCTION public.checkout_device_for_claim(
  p_claim_id uuid,
  p_device_id text
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
  v_id uuid;
BEGIN
  v_group := public._assert_operator_in_claim_group(p_claim_id);
  SELECT * INTO v_claim FROM public.bounty_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'active' THEN
    RAISE EXCEPTION 'claim not active';
  END IF;
  IF v_claim.device_returned_at IS NOT NULL THEN
    RAISE EXCEPTION 'device already returned for this claim';
  END IF;
  SELECT * INTO v_bounty FROM public.bounties WHERE id = v_claim.bounty_id;
  IF EXISTS (
    SELECT 1 FROM public.device_executor_assignments a
    WHERE a.bounty_claim_id = p_claim_id AND a.status = 'active'
  ) THEN
    RAISE EXCEPTION 'claim already has checked-out device';
  END IF;
  IF NOT public._device_is_assignable(p_device_id, v_group, v_bounty.id) THEN
    RAISE EXCEPTION 'device not assignable (type, status, or already in use)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.group_members gm ON gm.user_id = p.id
    WHERE p.id = v_claim.executor_id
      AND p.role = 'collection_executor'
      AND gm.group_id = v_group
      AND gm.membership_status = 'active'
  ) THEN
    RAISE EXCEPTION 'executor not active in group';
  END IF;
  INSERT INTO public.device_executor_assignments (
    group_id, device_id, executor_id, assigned_by, status, bounty_claim_id
  )
  VALUES (
    v_group, p_device_id, v_claim.executor_id, auth.uid(), 'active', p_claim_id
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_claim_session(
  p_claim_id uuid,
  p_session_hours numeric,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  v_claim public.bounty_claims;
  v_bounty public.bounties;
  v_asg public.device_executor_assignments;
  v_remaining numeric;
  v_conf numeric;
  v_amount numeric;
  v_log_id uuid;
  v_line_id uuid;
  v_completed boolean;
BEGIN
  PERFORM set_config('row_security', 'off', true);
  v_group := public._assert_operator_in_claim_group(p_claim_id);
  IF p_session_hours IS NULL OR p_session_hours <= 0 THEN
    RAISE EXCEPTION 'session hours must be positive';
  END IF;
  SELECT * INTO v_claim FROM public.bounty_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'active' THEN
    RAISE EXCEPTION 'claim not active';
  END IF;
  v_asg := public._claim_assignment_for_settle(p_claim_id);
  IF v_asg.id IS NULL THEN
    RAISE EXCEPTION '请先借出设备后再结算';
  END IF;
  SELECT * INTO v_bounty FROM public.bounties WHERE id = v_claim.bounty_id;
  v_remaining := v_claim.claimed_hours::numeric - COALESCE(v_claim.executed_hours, 0);
  IF p_session_hours > v_remaining THEN
    RAISE EXCEPTION 'session hours exceed remaining (%)', v_remaining;
  END IF;
  v_conf := p_session_hours;
  v_amount := round(v_conf * COALESCE(v_bounty.hourly_rate, 0), 2);

  INSERT INTO public.device_data_hour_logs (
    group_id, device_id, bounty_claim_id, registered_hours, registered_by, note, assignment_id
  )
  VALUES (
    v_group, v_asg.device_id, p_claim_id, v_conf, auth.uid(),
    NULLIF(trim(p_note), ''), v_asg.id
  )
  RETURNING id INTO v_log_id;

  IF v_amount > 0 THEN
    INSERT INTO public.executor_settlement_lines (
      user_id, group_id, bounty_claim_id, bounty_id,
      confirmed_hours, registered_hours_sum, hourly_rate_snapshot, amount,
      status, operator_note, approved_by, assignment_id
    )
    VALUES (
      v_claim.executor_id, v_group, v_claim.id, v_bounty.id,
      v_conf, v_conf, v_bounty.hourly_rate, v_amount,
      'settled', NULLIF(trim(p_note), ''), auth.uid(), v_asg.id
    )
    RETURNING id INTO v_line_id;
    PERFORM public._apply_wallet_delta(
      v_claim.executor_id, v_amount, 'settlement', v_line_id,
      COALESCE(NULLIF(trim(p_note), ''), '悬赏结算')
    );
  END IF;

  v_completed := public._apply_claim_session_progress(
    p_claim_id, v_conf, COALESCE(NULLIF(trim(p_note), ''), 'settle session')
  );

  RETURN jsonb_build_object(
    'claim_id', p_claim_id,
    'hour_log_id', v_log_id,
    'settlement_line_id', v_line_id,
    'session_hours', v_conf,
    'amount', v_amount,
    'executed_hours', (SELECT executed_hours FROM public.bounty_claims WHERE id = p_claim_id),
    'claimed_hours', v_claim.claimed_hours,
    'claim_completed', v_completed
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.return_device_for_claim(p_claim_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  v_claim public.bounty_claims;
  v_asg public.device_executor_assignments;
BEGIN
  v_group := public._assert_operator_in_claim_group(p_claim_id);
  SELECT * INTO v_claim FROM public.bounty_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'active' THEN
    RAISE EXCEPTION 'claim not active';
  END IF;
  IF v_claim.device_returned_at IS NOT NULL THEN
    RAISE EXCEPTION '该接单已归还过设备，不可重复归还';
  END IF;
  SELECT * INTO v_asg
  FROM public.device_executor_assignments a
  WHERE a.bounty_claim_id = p_claim_id AND a.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '当前无借出设备，无法归还';
  END IF;
  UPDATE public.device_executor_assignments
  SET status = 'revoked', revoked_at = now()
  WHERE id = v_asg.id;
  UPDATE public.bounty_claims
  SET device_returned_at = now()
  WHERE id = p_claim_id;
  RETURN jsonb_build_object(
    'claim_id', p_claim_id,
    'assignment_id', v_asg.id,
    'device_id', v_asg.device_id,
    'returned_at', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.return_and_settle_session(
  p_assignment_id uuid,
  p_session_hours numeric,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '已拆分为 settle_claim_session 与 return_device_for_claim';
END;
$$;

CREATE OR REPLACE FUNCTION public.list_assignable_devices_for_claim(p_claim_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  v_bounty_id uuid;
  v_items jsonb := '[]'::jsonb;
BEGIN
  v_group := public._assert_operator_in_claim_group(p_claim_id);
  SELECT c.bounty_id INTO v_bounty_id
  FROM public.bounty_claims c WHERE c.id = p_claim_id;
  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.kind, x.label), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      'offline:' || m.public_code AS device_id,
      'offline' AS kind,
      trim(COALESCE(pd.client_company, pd.title, '甲方')) || ' · ' || trim(m.device_short_label) AS label,
      pd.device_type AS device_type
    FROM public.manual_tracked_devices m
    JOIN public.party_demands pd ON pd.id = m.party_demand_id
    JOIN public.bounty_allowed_party_demands bap ON bap.party_demand_id = pd.id AND bap.bounty_id = v_bounty_id
    WHERE m.group_id = v_group
      AND m.external_status = 'normal'
      AND public._device_is_assignable('offline:' || m.public_code, v_group, v_bounty_id)
    UNION ALL
    SELECT
      d.device_id,
      'online' AS kind,
      COALESCE(d.readable_name, d.device_id) AS label,
      pd.device_type AS device_type
    FROM public.devices d
    JOIN public.party_demands pd ON pd.id = d.party_demand_id
    JOIN public.bounty_allowed_party_demands bap ON bap.party_demand_id = pd.id AND bap.bounty_id = v_bounty_id
    WHERE pd.group_id = v_group
      AND d.status = 'active'
      AND d.party_demand_id IS NOT NULL
      AND public._device_is_assignable(d.device_id, v_group, v_bounty_id)
  ) x;
  RETURN v_items;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_checkout_for_claim(p_claim_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asg public.device_executor_assignments;
BEGIN
  PERFORM public._assert_operator_in_claim_group(p_claim_id);
  SELECT * INTO v_asg
  FROM public.device_executor_assignments a
  WHERE a.bounty_claim_id = p_claim_id AND a.status = 'active'
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id', v_asg.id,
    'device_id', v_asg.device_id,
    'executor_id', v_asg.executor_id,
    'created_at', v_asg.created_at
  );
END;
$$;

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
BEGIN
  RAISE EXCEPTION '请使用 settle_claim_session 进行多次结算';
END;
$$;

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
      GREATEST(c.claimed_hours::numeric - COALESCE(c.executed_hours, 0), 0) * b.hourly_rate,
      2
    )
  ), 0)
  INTO v_pending
  FROM public.bounty_claims c
  JOIN public.bounties b ON b.id = c.bounty_id
  WHERE c.executor_id = v_uid
    AND c.status = 'active'
    AND b.hourly_rate > 0;
  RETURN jsonb_build_object(
    'available_balance', w.available_balance,
    'pending_balance', v_pending,
    'total_settled', w.total_settled,
    'total_withdrawn', w.total_withdrawn
  );
END;
$$;

ALTER TABLE public.bounty_allowed_party_demands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bapd_select" ON public.bounty_allowed_party_demands;
CREATE POLICY "bapd_select"
  ON public.bounty_allowed_party_demands FOR SELECT TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.bounties b
      WHERE b.id = bounty_id AND public.policy_work_group_accessible(b.group_id)
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.bounty_allowed_party_demands FROM authenticated;

REVOKE ALL ON FUNCTION public._release_assignments_for_claim(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._claim_assignment_for_settle(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_claim_session(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.return_device_for_claim(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.return_and_settle_session(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_assignable_devices_for_claim(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_active_checkout_for_claim(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.checkout_device_for_claim(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_claim_session(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_device_for_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_assignable_devices_for_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_checkout_for_claim(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric);
DROP FUNCTION IF EXISTS public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric, uuid);
GRANT EXECUTE ON FUNCTION public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric, uuid, uuid[]) TO authenticated;

GRANT SELECT ON public.bounty_allowed_party_demands TO authenticated;

CREATE OR REPLACE FUNCTION public._complete_bounty_claim_core(
  p_claim_id uuid,
  p_executed_hours integer,
  p_note text DEFAULT NULL
)
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
  v_exec numeric;
BEGIN
  SELECT * INTO v_claim FROM public.bounty_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found';
  END IF;
  IF v_claim.status <> 'active' THEN
    RAISE EXCEPTION 'claim not active';
  END IF;
  PERFORM public._release_assignments_for_claim(p_claim_id);
  v_exec := LEAST(v_claim.claimed_hours::numeric, GREATEST(p_executed_hours, 0));
  IF v_exec <= 0 THEN
    RAISE EXCEPTION 'confirmed hours must be positive';
  END IF;
  SELECT * INTO v_bounty FROM public.bounties WHERE id = v_claim.bounty_id;
  v_rate := v_bounty.points_per_hour;
  v_points := CEIL(v_exec * v_rate)::integer;
  UPDATE public.bounty_claims
  SET executed_hours = v_exec,
      status = 'completed',
      completed_at = now(),
      approved_by = auth.uid(),
      approved_at = now(),
      close_reason = p_note
  WHERE id = p_claim_id;
  IF v_points > 0 THEN
    PERFORM public._apply_executor_point_delta(
      v_claim.executor_id, v_points, 'complete', p_claim_id,
      COALESCE(p_note, 'operator approved')
    );
  ELSE
    PERFORM public.recalc_executor_tier(v_claim.executor_id);
  END IF;
  UPDATE public.executor_stats
  SET active_claim_count = GREATEST(0, active_claim_count - 1), updated_at = now()
  WHERE user_id = v_claim.executor_id;
  IF v_exec < v_claim.claimed_hours::numeric THEN
    UPDATE public.bounties
    SET remaining_hours = remaining_hours + ceil(v_claim.claimed_hours::numeric - v_exec)::integer,
        updated_at = now()
    WHERE id = v_bounty.id;
    PERFORM public._bounty_reopen_if_hours_returned(v_bounty.id);
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

  'Partial settlement: log hours, wallet, points; repeatable until claim fully settled.';
  'Physical device return: release device to pool once per claim; does not settle hours.';
