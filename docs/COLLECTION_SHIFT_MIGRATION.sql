-- 采集排班：手动选场景岗位 + 数采执行员 + 设备数量；发布时自动分配离线设备编号；执行员打卡上下班。
-- Prerequisite: work_groups, scenario_positions, manual_tracked_devices (external_status), policy_work_group_accessible.
-- Run in Supabase SQL Editor as a single script.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.collection_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  scenario_position_id uuid NOT NULL REFERENCES public.scenario_positions (id) ON DELETE RESTRICT,
  executor_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  device_count integer NOT NULL CHECK (device_count >= 1 AND device_count <= 100),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  note text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  published_at timestamptz,
  closed_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collection_shifts_group ON public.collection_shifts (group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_shifts_executor ON public.collection_shifts (executor_id, status);

CREATE TABLE IF NOT EXISTS public.collection_shift_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.collection_shifts (id) ON DELETE CASCADE,
  manual_device_id uuid NOT NULL REFERENCES public.manual_tracked_devices (id) ON DELETE RESTRICT,
  public_code text NOT NULL,
  device_label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_id, manual_device_id),
  UNIQUE (shift_id, public_code)
);

CREATE INDEX IF NOT EXISTS idx_collection_shift_devices_shift ON public.collection_shift_devices (shift_id, sort_order);

CREATE TABLE IF NOT EXISTS public.collection_shift_clock_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.collection_shifts (id) ON DELETE CASCADE,
  executor_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  clock_in_at timestamptz NOT NULL DEFAULT now(),
  clock_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collection_shift_clock_shift ON public.collection_shift_clock_sessions (shift_id, clock_in_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS collection_shift_clock_open_uidx
  ON public.collection_shift_clock_sessions (shift_id)
  WHERE clock_out_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._collection_shift_group_id(p_shift_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cs.group_id FROM public.collection_shifts cs WHERE cs.id = p_shift_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._assert_shift_operator(p_shift_id uuid)
RETURNS public.collection_shifts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.collection_shifts;
  v_role text;
BEGIN
  v_role := public.current_profile_role();
  SELECT * INTO v_shift FROM public.collection_shifts WHERE id = p_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shift not found';
  END IF;
  IF v_role = 'admin' THEN
    RETURN v_shift;
  END IF;
  IF v_role = 'scene_operator' AND public.policy_work_group_accessible(v_shift.group_id) THEN
    RETURN v_shift;
  END IF;
  RAISE EXCEPTION 'not allowed';
END;
$$;

CREATE OR REPLACE FUNCTION public._manual_device_busy_in_published_shift(p_manual_device_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.collection_shift_devices csd
    JOIN public.collection_shifts cs ON cs.id = csd.shift_id
    WHERE csd.manual_device_id = p_manual_device_id
      AND cs.status = 'published'
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_collection_shift(
  p_group_id uuid,
  p_scenario_position_id uuid,
  p_executor_id uuid,
  p_device_count integer,
  p_scheduled_start timestamptz DEFAULT NULL,
  p_scheduled_end timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_id uuid;
BEGIN
  v_role := public.current_profile_role();
  IF v_role NOT IN ('admin', 'scene_operator') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF v_role <> 'admin' AND NOT public.policy_work_group_accessible(p_group_id) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF p_device_count IS NULL OR p_device_count < 1 OR p_device_count > 100 THEN
    RAISE EXCEPTION 'device_count must be between 1 and 100';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.scenario_positions sp
    WHERE sp.id = p_scenario_position_id AND sp.group_id = p_group_id
  ) THEN
    RAISE EXCEPTION 'scenario position not in group';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = p_executor_id
      AND gm.membership_status = 'active'
  ) THEN
    RAISE EXCEPTION 'executor must be active group member';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_executor_id AND p.role = 'collection_executor'
  ) THEN
    RAISE EXCEPTION 'executor must be collection_executor role';
  END IF;

  INSERT INTO public.collection_shifts (
    group_id, scenario_position_id, executor_id, device_count,
    status, note, scheduled_start, scheduled_end, created_by
  )
  VALUES (
    p_group_id, p_scenario_position_id, p_executor_id, p_device_count,
    'draft', NULLIF(trim(p_note), ''), p_scheduled_start, p_scheduled_end, auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_collection_shift(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.collection_shifts;
  v_need int;
  v_have int;
  v_devices jsonb := '[]'::jsonb;
  r record;
  v_ord int := 0;
BEGIN
  v_shift := public._assert_shift_operator(p_shift_id);
  IF v_shift.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft shift can be published';
  END IF;
  v_need := v_shift.device_count;

  SELECT count(*)::int INTO v_have
  FROM public.manual_tracked_devices m
  WHERE m.group_id = v_shift.group_id
    AND m.external_status = 'normal'
    AND NOT public._manual_device_busy_in_published_shift(m.id);

  IF v_have < v_need THEN
    RAISE EXCEPTION 'not enough available devices (need %, have %)', v_need, v_have;
  END IF;

  FOR r IN
    SELECT m.id, m.public_code, m.device_short_label, pd.client_company, pd.title
    FROM public.manual_tracked_devices m
    JOIN public.party_demands pd ON pd.id = m.party_demand_id
    WHERE m.group_id = v_shift.group_id
      AND m.external_status = 'normal'
      AND NOT public._manual_device_busy_in_published_shift(m.id)
    ORDER BY m.created_at ASC
    LIMIT v_need
    FOR UPDATE OF m
  LOOP
    v_ord := v_ord + 1;
    INSERT INTO public.collection_shift_devices (
      shift_id, manual_device_id, public_code, device_label, sort_order
    )
    VALUES (
      p_shift_id,
      r.id,
      r.public_code,
      COALESCE(NULLIF(trim(r.client_company), ''), NULLIF(trim(r.title), ''), '甲方') || ' · ' || trim(r.device_short_label),
      v_ord
    );
    v_devices := v_devices || jsonb_build_array(
      jsonb_build_object(
        'public_code', r.public_code,
        'device_label', COALESCE(NULLIF(trim(r.client_company), ''), NULLIF(trim(r.title), ''), '甲方') || ' · ' || trim(r.device_short_label),
        'sort_order', v_ord
      )
    );
  END LOOP;

  UPDATE public.collection_shifts
  SET status = 'published', published_at = now()
  WHERE id = p_shift_id;

  RETURN jsonb_build_object('shift_id', p_shift_id, 'devices', v_devices);
END;
$$;

CREATE OR REPLACE FUNCTION public.close_collection_shift(p_shift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.collection_shifts;
BEGIN
  v_shift := public._assert_shift_operator(p_shift_id);
  IF v_shift.status <> 'published' THEN
    RAISE EXCEPTION 'only published shift can be closed';
  END IF;
  UPDATE public.collection_shift_clock_sessions
  SET clock_out_at = COALESCE(clock_out_at, now())
  WHERE shift_id = p_shift_id AND clock_out_at IS NULL;
  UPDATE public.collection_shifts
  SET status = 'closed', closed_at = now()
  WHERE id = p_shift_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.clock_in_collection_shift(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.collection_shifts;
  v_sess_id uuid;
BEGIN
  IF public.current_profile_role() <> 'collection_executor' THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT * INTO v_shift FROM public.collection_shifts WHERE id = p_shift_id FOR UPDATE;
  IF NOT FOUND OR v_shift.status <> 'published' THEN
    RAISE EXCEPTION 'shift not available';
  END IF;
  IF v_shift.executor_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your shift';
  END IF;
  IF NOT public.policy_work_group_accessible(v_shift.group_id) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.collection_shift_clock_sessions s
    WHERE s.shift_id = p_shift_id AND s.clock_out_at IS NULL
  ) THEN
    RAISE EXCEPTION 'already clocked in';
  END IF;
  INSERT INTO public.collection_shift_clock_sessions (shift_id, executor_id)
  VALUES (p_shift_id, auth.uid())
  RETURNING id INTO v_sess_id;
  RETURN jsonb_build_object('session_id', v_sess_id, 'clock_in_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.clock_out_collection_shift(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.collection_shifts;
  v_sess public.collection_shift_clock_sessions;
BEGIN
  IF public.current_profile_role() <> 'collection_executor' THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT * INTO v_shift FROM public.collection_shifts WHERE id = p_shift_id;
  IF NOT FOUND OR v_shift.executor_id <> auth.uid() THEN
    RAISE EXCEPTION 'not your shift';
  END IF;
  SELECT * INTO v_sess
  FROM public.collection_shift_clock_sessions s
  WHERE s.shift_id = p_shift_id AND s.clock_out_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not clocked in';
  END IF;
  UPDATE public.collection_shift_clock_sessions
  SET clock_out_at = now()
  WHERE id = v_sess.id;
  RETURN jsonb_build_object('session_id', v_sess.id, 'clock_out_at', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_collection_shift_draft(p_shift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift public.collection_shifts;
BEGIN
  v_shift := public._assert_shift_operator(p_shift_id);
  IF v_shift.status <> 'draft' THEN
    RAISE EXCEPTION 'only draft can be deleted';
  END IF;
  DELETE FROM public.collection_shifts WHERE id = p_shift_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.collection_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_shift_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_shift_clock_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "collection_shifts_select" ON public.collection_shifts;
DROP POLICY IF EXISTS "collection_shift_devices_select" ON public.collection_shift_devices;
DROP POLICY IF EXISTS "collection_shift_clock_select" ON public.collection_shift_clock_sessions;

CREATE POLICY "collection_shifts_select"
  ON public.collection_shifts FOR SELECT TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.policy_work_group_accessible(group_id)
      AND (
        public.current_profile_role() = 'scene_operator'
        OR (public.current_profile_role() = 'collection_executor' AND executor_id = auth.uid() AND status IN ('published', 'closed'))
      )
    )
  );

CREATE POLICY "collection_shift_devices_select"
  ON public.collection_shift_devices FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.collection_shifts cs
      WHERE cs.id = collection_shift_devices.shift_id
        AND (
          public.current_profile_role() = 'admin'
          OR (
            public.policy_work_group_accessible(cs.group_id)
            AND (
              public.current_profile_role() = 'scene_operator'
              OR (public.current_profile_role() = 'collection_executor' AND cs.executor_id = auth.uid())
            )
          )
        )
    )
  );

CREATE POLICY "collection_shift_clock_select"
  ON public.collection_shift_clock_sessions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.collection_shifts cs
      WHERE cs.id = collection_shift_clock_sessions.shift_id
        AND (
          public.current_profile_role() = 'admin'
          OR (
            public.policy_work_group_accessible(cs.group_id)
            AND (
              public.current_profile_role() = 'scene_operator'
              OR (public.current_profile_role() = 'collection_executor' AND cs.executor_id = auth.uid())
            )
          )
        )
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.collection_shifts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collection_shift_devices FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.collection_shift_clock_sessions FROM authenticated;

REVOKE ALL ON FUNCTION public.create_collection_shift(uuid, uuid, uuid, integer, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_collection_shift(uuid, uuid, uuid, integer, timestamptz, timestamptz, text) TO authenticated;

REVOKE ALL ON FUNCTION public.publish_collection_shift(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_collection_shift(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.close_collection_shift(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_collection_shift(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.clock_in_collection_shift(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clock_in_collection_shift(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.clock_out_collection_shift(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clock_out_collection_shift(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_collection_shift_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_collection_shift_draft(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON TABLE public.collection_shifts IS '采集排班：手动指定场景岗位、执行员与设备数量；发布时分配离线设备编号。';
COMMENT ON TABLE public.collection_shift_devices IS '排班发布时自动分配的离线设备批次（public_code 为执行员可见编号）。';
COMMENT ON TABLE public.collection_shift_clock_sessions IS '数采执行员上下班打卡记录。';
