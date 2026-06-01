-- Bounty × device operator audit workflow (independent of scene_tasks).
-- Prerequisite: BOUNTY_MIGRATION.sql, GROUP_TOPICS_BUSINESS_MIGRATION.sql, ROLE_SYSTEM_MIGRATION.sql
-- Run ENTIRE script in Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Profiles: real name + phone
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS real_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
  v_real text;
  v_phone text;
BEGIN
  r := COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'role'), ''), 'device_operator');
  IF r NOT IN ('admin', 'device_operator', 'scene_operator', 'collection_executor') THEN
    r := 'device_operator';
  END IF;
  v_real := NULLIF(trim(NEW.raw_user_meta_data ->> 'real_name'), '');
  v_phone := NULLIF(trim(NEW.raw_user_meta_data ->> 'phone'), '');
  INSERT INTO public.profiles (id, role, real_name, phone)
  VALUES (NEW.id, r, v_real, v_phone)
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role,
    real_name = COALESCE(EXCLUDED.real_name, public.profiles.real_name),
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Bounties: assigned device operator (contact for executors)
-- ---------------------------------------------------------------------------
ALTER TABLE public.bounties
  ADD COLUMN IF NOT EXISTS assigned_operator_id uuid REFERENCES public.profiles (id);

CREATE INDEX IF NOT EXISTS idx_bounties_assigned_operator ON public.bounties (assigned_operator_id);

-- ---------------------------------------------------------------------------
-- 3. Device ↔ executor assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_executor_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES public.devices (device_id) ON DELETE CASCADE,
  executor_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES auth.users (id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_device_executor_assignments_device
  ON public.device_executor_assignments (device_id, status);
CREATE INDEX IF NOT EXISTS idx_device_executor_assignments_executor
  ON public.device_executor_assignments (executor_id, status);

-- ---------------------------------------------------------------------------
-- 4. Operator hour registration logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_data_hour_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES public.devices (device_id) ON DELETE CASCADE,
  bounty_claim_id uuid REFERENCES public.bounty_claims (id) ON DELETE SET NULL,
  registered_hours numeric(8, 2) NOT NULL CHECK (registered_hours > 0),
  registered_by uuid NOT NULL REFERENCES auth.users (id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_data_hour_logs_device ON public.device_data_hour_logs (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_data_hour_logs_claim ON public.device_data_hour_logs (bounty_claim_id);

-- ---------------------------------------------------------------------------
-- 5. Claims: approval audit
-- ---------------------------------------------------------------------------
ALTER TABLE public.bounty_claims ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users (id);
ALTER TABLE public.bounty_claims ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._bounty_group_id_for_claim(p_claim_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.group_id
  FROM public.bounty_claims c
  JOIN public.bounties b ON b.id = c.bounty_id
  WHERE c.id = p_claim_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._profile_is_device_operator_in_group(p_user_id uuid, p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.group_members gm ON gm.user_id = p.id
    WHERE p.id = p_user_id
      AND p.role = 'device_operator'
      AND gm.group_id = p_group_id
      AND gm.membership_status = 'active'
  );
$$;

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
  v_exec integer;
BEGIN
  SELECT * INTO v_claim FROM public.bounty_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim not found';
  END IF;
  IF v_claim.status <> 'active' THEN
    RAISE EXCEPTION 'claim not active';
  END IF;
  v_exec := LEAST(v_claim.claimed_hours, GREATEST(p_executed_hours, 0));
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
  IF v_exec < v_claim.claimed_hours THEN
    UPDATE public.bounties
    SET remaining_hours = remaining_hours + (v_claim.claimed_hours - v_exec),
        updated_at = now()
    WHERE id = v_bounty.id;
    PERFORM public._bounty_reopen_if_hours_returned(v_bounty.id);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- publish_bounty (+ assigned operator)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric);
DROP FUNCTION IF EXISTS public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric, uuid);

CREATE OR REPLACE FUNCTION public.publish_bounty(
  p_group_id uuid,
  p_title text,
  p_total_hours integer,
  p_hourly_rate numeric,
  p_completion_days integer,
  p_description text DEFAULT NULL,
  p_points_per_hour numeric DEFAULT 1,
  p_assigned_operator_id uuid DEFAULT NULL
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
  IF p_assigned_operator_id IS NULL THEN
    RAISE EXCEPTION 'assigned operator required';
  END IF;
  IF NOT public._profile_is_device_operator_in_group(p_assigned_operator_id, p_group_id) THEN
    RAISE EXCEPTION 'assigned operator must be active device_operator in this group';
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
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.operator_approve_bounty_claim(p_claim_id uuid, p_confirmed_hours integer)
RETURNS void
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
  PERFORM public._complete_bounty_claim_core(
    p_claim_id, p_confirmed_hours, 'operator approved'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.operator_reject_bounty_claim(p_claim_id uuid, p_note text DEFAULT NULL)
RETURNS void
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
  PERFORM public._finalize_bounty_claim_failure(
    p_claim_id, 'failed', COALESCE(NULLIF(trim(p_note), ''), 'operator rejected')
  );
END;
$$;

-- Executors can no longer self-complete; operators/admins approve instead.
CREATE OR REPLACE FUNCTION public.complete_bounty_claim(p_claim_id uuid, p_executed_hours integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_profile_role() = 'collection_executor' THEN
    RAISE EXCEPTION '任务完成须由设备运维员审核，执行员无法自行标记完成';
  END IF;
  IF public.current_profile_role() NOT IN ('admin', 'device_operator') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF public.current_profile_role() = 'device_operator' THEN
    PERFORM public.operator_approve_bounty_claim(p_claim_id, p_executed_hours);
    RETURN;
  END IF;
  PERFORM public._complete_bounty_claim_core(p_claim_id, p_executed_hours, 'admin approved');
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
  v_owner uuid;
  v_id uuid;
BEGIN
  IF public.current_profile_role() <> 'device_operator' THEN
    RAISE EXCEPTION 'device_operator only';
  END IF;
  SELECT d.user_id INTO v_owner FROM public.devices d WHERE d.device_id = p_device_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'device not found';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'only owner device_operator can assign this device';
  END IF;
  v_group := public.user_active_group_id();
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'no active work group';
  END IF;
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

CREATE OR REPLACE FUNCTION public.revoke_device_assignment(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.device_executor_assignments;
BEGIN
  IF public.current_profile_role() <> 'device_operator' THEN
    RAISE EXCEPTION 'device_operator only';
  END IF;
  SELECT * INTO v_row FROM public.device_executor_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment not found';
  END IF;
  IF v_row.assigned_by <> auth.uid() AND public.current_profile_role() <> 'admin' THEN
    RAISE EXCEPTION 'only assigner can revoke';
  END IF;
  UPDATE public.device_executor_assignments
  SET status = 'revoked', revoked_at = now()
  WHERE id = p_assignment_id;
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
  v_owner uuid;
  v_id uuid;
BEGIN
  IF public.current_profile_role() <> 'device_operator' THEN
    RAISE EXCEPTION 'device_operator only';
  END IF;
  IF p_registered_hours IS NULL OR p_registered_hours <= 0 THEN
    RAISE EXCEPTION 'hours must be positive';
  END IF;
  SELECT d.user_id INTO v_owner FROM public.devices d WHERE d.device_id = p_device_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'device not found';
  END IF;
  IF v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'only owner device_operator can register hours';
  END IF;
  v_group := public.user_active_group_id();
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'no active work group';
  END IF;
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

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.device_executor_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_data_hour_logs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._bounty_op_policy_drop(tbl text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE pol text;
BEGIN FOR pol IN
  SELECT p.polname::text FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = tbl LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, tbl);
END LOOP;
END $$;

SELECT public._bounty_op_policy_drop('bounty_claims');

CREATE POLICY "bounty_claims_select_executor_admin_or_operator"
  ON public.bounty_claims FOR SELECT TO authenticated
  USING (
    executor_id = auth.uid()
    OR public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'device_operator'
      AND public.policy_work_group_accessible(public._bounty_group_id_for_claim(id))
    )
  );

CREATE POLICY "dea_select_group"
  ON public.device_executor_assignments FOR SELECT TO authenticated
  USING (
    executor_id = auth.uid()
    OR assigned_by = auth.uid()
    OR public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'device_operator'
      AND public.policy_work_group_accessible(group_id)
    )
  );

CREATE POLICY "ddhl_select_group"
  ON public.device_data_hour_logs FOR SELECT TO authenticated
  USING (
    registered_by = auth.uid()
    OR public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() IN ('device_operator', 'collection_executor')
      AND public.policy_work_group_accessible(group_id)
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.device_executor_assignments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.device_data_hour_logs FROM authenticated;

REVOKE ALL ON FUNCTION public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_bounty(uuid, text, integer, numeric, integer, text, numeric, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.operator_approve_bounty_claim(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_approve_bounty_claim(uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.operator_reject_bounty_claim(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operator_reject_bounty_claim(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_device_to_executor(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_device_to_executor(text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_device_assignment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_device_assignment(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.register_device_data_hours(text, numeric, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_device_data_hours(text, numeric, uuid, text) TO authenticated;

GRANT SELECT ON public.device_executor_assignments TO authenticated;
GRANT SELECT ON public.device_data_hour_logs TO authenticated;

NOTIFY pgrst, 'reload schema';
