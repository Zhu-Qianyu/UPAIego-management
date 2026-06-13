-- 甲方业务批复小时数改为按大场景（scene_macro_sites）配置，不再按小岗位
-- 执行时机：PARTY_DEMAND_PER_SCENE_HOURS.sql 之后

CREATE TABLE IF NOT EXISTS public.party_demand_macro_caps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_demand_id uuid NOT NULL REFERENCES public.party_demands (id) ON DELETE CASCADE,
  macro_scene_id uuid NOT NULL REFERENCES public.scene_macro_sites (id) ON DELETE CASCADE,
  approved_hours numeric NOT NULL CHECK (approved_hours > 0 AND approved_hours = floor(approved_hours)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_demand_id, macro_scene_id)
);

CREATE INDEX IF NOT EXISTS idx_pdmc_demand ON public.party_demand_macro_caps (party_demand_id);
CREATE INDEX IF NOT EXISTS idx_pdmc_macro ON public.party_demand_macro_caps (macro_scene_id);

ALTER TABLE public.party_demand_macro_caps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pdmc_select" ON public.party_demand_macro_caps;
CREATE POLICY "pdmc_select"
  ON public.party_demand_macro_caps FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.party_demands d
      WHERE d.id = party_demand_macro_caps.party_demand_id
        AND (
          public.has_profile_role('admin')
          OR public.policy_work_group_accessible(d.group_id)
        )
    )
  );

DROP POLICY IF EXISTS "pdmc_insert" ON public.party_demand_macro_caps;
CREATE POLICY "pdmc_insert"
  ON public.party_demand_macro_caps FOR INSERT TO authenticated
  WITH CHECK (
    public.has_profile_role('admin')
    AND EXISTS (
      SELECT 1
      FROM public.party_demands d
      JOIN public.scene_macro_sites m ON m.id = party_demand_macro_caps.macro_scene_id
      WHERE d.id = party_demand_macro_caps.party_demand_id
        AND d.group_id = m.group_id
        AND d.group_id = public.user_active_group_id()
    )
  );

DROP POLICY IF EXISTS "pdmc_update" ON public.party_demand_macro_caps;
CREATE POLICY "pdmc_update"
  ON public.party_demand_macro_caps FOR UPDATE TO authenticated
  USING (public.has_profile_role('admin'))
  WITH CHECK (public.has_profile_role('admin'));

DROP POLICY IF EXISTS "pdmc_delete" ON public.party_demand_macro_caps;
CREATE POLICY "pdmc_delete"
  ON public.party_demand_macro_caps FOR DELETE TO authenticated
  USING (public.has_profile_role('admin'));

-- 从小岗位表聚合迁移（同一大场景取 MAX，通常一致）
INSERT INTO public.party_demand_macro_caps (party_demand_id, macro_scene_id, approved_hours)
SELECT cap.party_demand_id, p.macro_scene_id, MAX(cap.approved_hours)
FROM public.party_demand_position_caps cap
INNER JOIN public.scenario_positions p ON p.id = cap.scenario_position_id
WHERE p.macro_scene_id IS NOT NULL
GROUP BY cap.party_demand_id, p.macro_scene_id
ON CONFLICT (party_demand_id, macro_scene_id) DO NOTHING;

-- 无小岗位记录时，按工作群大场景 + max_hours_per_scene 补全
INSERT INTO public.party_demand_macro_caps (party_demand_id, macro_scene_id, approved_hours)
SELECT d.id, m.id, d.max_hours_per_scene
FROM public.party_demands d
INNER JOIN public.scene_macro_sites m ON m.group_id = d.group_id
ON CONFLICT (party_demand_id, macro_scene_id) DO NOTHING;

DROP TABLE IF EXISTS public.party_demand_position_caps;

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
        FROM public.party_demand_macro_caps cap
        WHERE cap.party_demand_id = d.id
          AND cap.macro_scene_id = p.macro_scene_id
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
  FROM public.party_demand_macro_caps cap, public.scene_tasks st, public.scenario_positions p
  WHERE sta.party_demand_id = cap.party_demand_id
    AND sta.scenario_position_id = p.id
    AND p.macro_scene_id = cap.macro_scene_id
    AND sta.scene_task_id = st.id
    AND st.group_id = p_group_id;
END;
$$;

NOTIFY pgrst, 'reload schema';
