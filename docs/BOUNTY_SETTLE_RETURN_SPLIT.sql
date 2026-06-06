ALTER TABLE public.bounty_claims
  ADD COLUMN IF NOT EXISTS device_returned_at timestamptz;

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
  RAISE EXCEPTION '已拆分为 settle_claim_session 与 return_device_for_claim，请分别调用';
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

REVOKE ALL ON FUNCTION public._claim_assignment_for_settle(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_claim_session(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.return_device_for_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_claim_session(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_device_for_claim(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

  'Partial settlement: log hours, wallet, points; repeatable until claim fully settled.';
  'Physical device return: release device to pool once per claim; does not settle hours.';
