-- 设备分发 / 数采登记支持离线设备（manual_tracked_devices）
-- 使用 device_id = 'offline:' || public_code；解除对 devices 表的外键。
-- 前置：BOUNTY_OPERATOR_AUDIT_MIGRATION.sql、MANUAL_TRACKED_DEVICES_MIGRATION.sql
-- 在 Supabase SQL Editor 整段执行

ALTER TABLE public.device_executor_assignments
  DROP CONSTRAINT IF EXISTS device_executor_assignments_device_id_fkey;

ALTER TABLE public.device_data_hour_logs
  DROP CONSTRAINT IF EXISTS device_data_hour_logs_device_id_fkey;

CREATE OR REPLACE FUNCTION public._assert_operator_owns_assignable_device(p_device_id text, p_group uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_code text;
BEGIN
  IF p_group IS NULL THEN
    RAISE EXCEPTION 'no active work group';
  END IF;
  IF p_device_id LIKE 'offline:%' THEN
    v_code := upper(trim(substring(p_device_id from 9)));
    IF v_code IS NULL OR v_code = '' THEN
      RAISE EXCEPTION 'invalid offline device id';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.manual_tracked_devices m
      WHERE m.public_code = v_code
        AND m.group_id = p_group
    ) THEN
      RAISE EXCEPTION 'offline device not found in your group';
    END IF;
    RETURN;
  END IF;
  SELECT d.user_id INTO v_owner FROM public.devices d WHERE d.device_id = p_device_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'device not found';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'only owner device_operator can assign this device';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_device_to_executor(p_device_id text, p_executor_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  v_id uuid;
BEGIN
  IF public.current_profile_role() <> 'device_operator' THEN
    RAISE EXCEPTION 'device_operator only';
  END IF;
  v_group := public.user_active_group_id();
  PERFORM public._assert_operator_owns_assignable_device(p_device_id, v_group);
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.group_members gm ON gm.user_id = p.id
    WHERE p.id = p_executor_id
      AND p.role = 'collection_executor'
      AND gm.group_id = v_group
      AND gm.membership_status = 'active'
  ) THEN
    RAISE EXCEPTION 'executor must be active collection_executor in your group';
  END IF;
  UPDATE public.device_executor_assignments
  SET status = 'revoked', revoked_at = now()
  WHERE device_id = p_device_id AND status = 'active';
  INSERT INTO public.device_executor_assignments (group_id, device_id, executor_id, assigned_by, status)
  VALUES (v_group, p_device_id, p_executor_id, auth.uid(), 'active')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_device_data_hours(
  p_device_id text,
  p_registered_hours numeric,
  p_bounty_claim_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid;
  v_id uuid;
BEGIN
  IF public.current_profile_role() <> 'device_operator' THEN
    RAISE EXCEPTION 'device_operator only';
  END IF;
  IF p_registered_hours IS NULL OR p_registered_hours <= 0 THEN
    RAISE EXCEPTION 'hours must be positive';
  END IF;
  v_group := public.user_active_group_id();
  PERFORM public._assert_operator_owns_assignable_device(p_device_id, v_group);
  IF p_bounty_claim_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.bounty_claims c
      JOIN public.bounties b ON b.id = c.bounty_id
      WHERE c.id = p_bounty_claim_id AND b.group_id = v_group
    ) THEN
      RAISE EXCEPTION 'claim not in your group';
    END IF;
  END IF;
  INSERT INTO public.device_data_hour_logs (
    group_id, device_id, bounty_claim_id, registered_hours, registered_by, note
  )
  VALUES (
    v_group, p_device_id, p_bounty_claim_id,
    p_registered_hours, auth.uid(), NULLIF(trim(p_note), '')
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_operator_owns_assignable_device(text, uuid) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public._assert_operator_owns_assignable_device(text, uuid) IS
  'Validates联网 devices owned by operator, or offline:PUBLIC_CODE in active work group.';
