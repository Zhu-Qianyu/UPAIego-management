-- 甲方业务按场景岗位分别批复采集小时数（替代 party_demands.max_hours_per_scene 单一上限）
-- 执行时机：PARTY_DEMAND_ADMIN_ONLY_RLS.sql 之后

CREATE TABLE IF NOT EXISTS public.party_demand_position_caps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_demand_id uuid NOT NULL REFERENCES public.party_demands (id) ON DELETE CASCADE,
  scenario_position_id uuid NOT NULL REFERENCES public.scenario_positions (id) ON DELETE CASCADE,
  approved_hours numeric NOT NULL CHECK (approved_hours > 0 AND approved_hours = floor(approved_hours)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_demand_id, scenario_position_id)
);

CREATE INDEX IF NOT EXISTS idx_pdpc_demand ON public.party_demand_position_caps (party_demand_id);
CREATE INDEX IF NOT EXISTS idx_pdpc_position ON public.party_demand_position_caps (scenario_position_id);

ALTER TABLE public.party_demand_position_caps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdpc_select" ON public.party_demand_position_caps;
CREATE POLICY "pdpc_select"
  ON public.party_demand_position_caps FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.party_demands d
      WHERE d.id = party_demand_position_caps.party_demand_id
        AND (
          public.has_profile_role('admin')
          OR public.policy_work_group_accessible(d.group_id)
        )
    )
  );

DROP POLICY IF EXISTS "pdpc_insert" ON public.party_demand_position_caps;
CREATE POLICY "pdpc_insert"
  ON public.party_demand_position_caps FOR INSERT TO authenticated
  WITH CHECK (
    public.has_profile_role('admin')
    AND EXISTS (
      SELECT 1
      FROM public.party_demands d
      JOIN public.scenario_positions p ON p.id = party_demand_position_caps.scenario_position_id
      WHERE d.id = party_demand_position_caps.party_demand_id
        AND d.group_id = p.group_id
        AND d.group_id = public.user_active_group_id()
    )
  );

DROP POLICY IF EXISTS "pdpc_update" ON public.party_demand_position_caps;
CREATE POLICY "pdpc_update"
  ON public.party_demand_position_caps FOR UPDATE TO authenticated
  USING (public.has_profile_role('admin'))
  WITH CHECK (public.has_profile_role('admin'));

DROP POLICY IF EXISTS "pdpc_delete" ON public.party_demand_position_caps;
CREATE POLICY "pdpc_delete"
  ON public.party_demand_position_caps FOR DELETE TO authenticated
  USING (public.has_profile_role('admin'));

-- 从旧字段 max_hours_per_scene 回填各场景岗位批复小时
INSERT INTO public.party_demand_position_caps (party_demand_id, scenario_position_id, approved_hours)
SELECT d.id, p.id, d.max_hours_per_scene
FROM public.party_demands d
INNER JOIN public.scenario_positions p ON p.group_id = d.group_id
WHERE public.scene_categories_overlap(d.scene_categories, p.scene_categories)
ON CONFLICT (party_demand_id, scenario_position_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_scene_task_assignments(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.policy_work_group_accessible(p_group_id) THEN
    RAISE EXCEPTION '无权同步该工作群的场景任务子项';
  END IF;

  DELETE FROM public.scene_task_assignments sta
  USING public.scene_tasks st, public.party_demands d, public.scenario_positions p
  WHERE sta.scene_task_id = st.id
    AND sta.party_demand_id = d.id
    AND sta.scenario_position_id = p.id
    AND st.group_id = p_group_id
    AND st.status <> 'published';

  DELETE FROM public.scene_task_assignments sta
  USING public.scene_tasks st, public.party_demands d, public.scenario_positions p
  WHERE sta.scene_task_id = st.id
    AND sta.party_demand_id = d.id
    AND sta.scenario_position_id = p.id
    AND st.group_id = p_group_id
    AND st.status = 'published'
    AND NOT public.scene_categories_overlap(d.scene_categories, p.scene_categories);

  INSERT INTO public.scene_task_assignments (scene_task_id, scenario_position_id, party_demand_id, max_hours_cap)
  SELECT st.id, p.id, d.id,
    COALESCE(
      (
        SELECT cap.approved_hours
        FROM public.party_demand_position_caps cap
        WHERE cap.party_demand_id = d.id
          AND cap.scenario_position_id = p.id
      ),
      d.max_hours_per_scene
    )
  FROM public.scene_tasks st
  CROSS JOIN public.party_demands d
  INNER JOIN public.scenario_positions p
    ON p.group_id = p_group_id
    AND (st.scenario_position_id IS NULL OR p.id = st.scenario_position_id)
  WHERE st.group_id = p_group_id
    AND st.status = 'published'
    AND d.group_id = p_group_id
    AND public.scene_categories_overlap(d.scene_categories, p.scene_categories)
  ON CONFLICT (scene_task_id, scenario_position_id, party_demand_id) DO NOTHING;

  UPDATE public.scene_task_assignments sta
  SET max_hours_cap = cap.approved_hours
  FROM public.party_demand_position_caps cap, public.scene_tasks st
  WHERE sta.party_demand_id = cap.party_demand_id
    AND sta.scenario_position_id = cap.scenario_position_id
    AND sta.scene_task_id = st.id
    AND st.group_id = p_group_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
