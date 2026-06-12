-- 设备管理：离线登记设备分配给采集执行员（含管理员代操作）

CREATE OR REPLACE FUNCTION public.assign_manual_tracked_device_to_executor(
  p_public_code text,
  p_executor_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_group uuid;
  v_device_id text;
  v_id uuid;
  v_role text;
BEGIN
  v_role := public.current_profile_role();
  IF v_role NOT IN ('admin', 'device_operator') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_code := upper(trim(p_public_code));
  IF v_code IS NULL OR v_code = '' THEN
    RAISE EXCEPTION 'invalid public_code';
  END IF;

  SELECT m.group_id
  INTO v_group
  FROM public.manual_tracked_devices m
  WHERE m.public_code = v_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'device not found';
  END IF;

  IF v_role = 'device_operator' THEN
    IF v_group IS DISTINCT FROM public.user_active_group_id() THEN
      RAISE EXCEPTION 'device not in your active work group';
    END IF;
  ELSIF NOT public.policy_work_group_accessible(v_group) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.manual_tracked_devices m
    WHERE m.public_code = v_code
      AND m.external_status = 'normal'
  ) THEN
    RAISE EXCEPTION 'only normal devices can be assigned';
  END IF;

  v_device_id := 'offline:' || v_code;

  IF EXISTS (
    SELECT 1
    FROM public.device_executor_assignments a
    WHERE a.device_id = v_device_id
      AND a.status = 'active'
      AND a.bounty_claim_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'device is checked out for a bounty claim';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.group_members gm ON gm.user_id = p.id
    WHERE p.id = p_executor_id
      AND p.role = 'collection_executor'
      AND gm.group_id = v_group
      AND gm.membership_status = 'active'
  ) THEN
    RAISE EXCEPTION 'executor must be active collection_executor in device group';
  END IF;

  UPDATE public.device_executor_assignments
  SET status = 'revoked', revoked_at = now()
  WHERE device_id = v_device_id
    AND status = 'active'
    AND bounty_claim_id IS NULL;

  INSERT INTO public.device_executor_assignments (
    group_id, device_id, executor_id, assigned_by, status
  )
  VALUES (v_group, v_device_id, p_executor_id, auth.uid(), 'active')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_manual_tracked_device_assignment(p_public_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_group uuid;
  v_device_id text;
  v_role text;
BEGIN
  v_role := public.current_profile_role();
  IF v_role NOT IN ('admin', 'device_operator') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_code := upper(trim(p_public_code));
  IF v_code IS NULL OR v_code = '' THEN
    RAISE EXCEPTION 'invalid public_code';
  END IF;

  SELECT m.group_id
  INTO v_group
  FROM public.manual_tracked_devices m
  WHERE m.public_code = v_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'device not found';
  END IF;

  IF v_role = 'device_operator' THEN
    IF v_group IS DISTINCT FROM public.user_active_group_id() THEN
      RAISE EXCEPTION 'device not in your active work group';
    END IF;
  ELSIF NOT public.policy_work_group_accessible(v_group) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_device_id := 'offline:' || v_code;

  IF EXISTS (
    SELECT 1
    FROM public.device_executor_assignments a
    WHERE a.device_id = v_device_id
      AND a.status = 'active'
      AND a.bounty_claim_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'device is checked out for a bounty claim';
  END IF;

  UPDATE public.device_executor_assignments
  SET status = 'revoked', revoked_at = now()
  WHERE device_id = v_device_id
    AND status = 'active'
    AND bounty_claim_id IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_manual_tracked_device_to_executor(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_manual_tracked_device_to_executor(text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.release_manual_tracked_device_assignment(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_manual_tracked_device_assignment(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
