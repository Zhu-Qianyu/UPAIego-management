CREATE OR REPLACE FUNCTION public.scene_categories_overlap(d text[], p text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(d, '{}') && COALESCE(p, '{}');
$$;

ALTER TABLE public.party_demands ADD COLUMN IF NOT EXISTS device_snapshot_bucket text;
ALTER TABLE public.party_demands ADD COLUMN IF NOT EXISTS device_snapshot_path text;
ALTER TABLE public.party_demands ADD COLUMN IF NOT EXISTS total_hours_required numeric;
ALTER TABLE public.party_demands ADD COLUMN IF NOT EXISTS max_hours_per_scene numeric NOT NULL DEFAULT 8;
ALTER TABLE public.party_demands ADD COLUMN IF NOT EXISTS scene_categories text[] NOT NULL DEFAULT ARRAY['industrial']::text[];

UPDATE public.party_demands SET max_hours_per_scene = 8 WHERE max_hours_per_scene IS NULL OR max_hours_per_scene <= 0;

ALTER TABLE public.party_demands DROP CONSTRAINT IF EXISTS party_demands_scene_categories_chk;
ALTER TABLE public.party_demands ADD CONSTRAINT party_demands_scene_categories_chk CHECK (
  cardinality(scene_categories) >= 1
  AND scene_categories <@ ARRAY['industrial', 'home', 'special']::text[]
);

ALTER TABLE public.scenario_positions ADD COLUMN IF NOT EXISTS scene_categories text[] NOT NULL DEFAULT ARRAY['industrial']::text[];
ALTER TABLE public.scenario_positions ADD COLUMN IF NOT EXISTS address_province text NOT NULL DEFAULT '待补充';
ALTER TABLE public.scenario_positions ADD COLUMN IF NOT EXISTS address_city text NOT NULL DEFAULT '待补充';
ALTER TABLE public.scenario_positions ADD COLUMN IF NOT EXISTS address_district text NOT NULL DEFAULT '待补充';
ALTER TABLE public.scenario_positions ADD COLUMN IF NOT EXISTS address_detail text;

ALTER TABLE public.scenario_positions DROP CONSTRAINT IF EXISTS scenario_positions_scene_categories_chk;
ALTER TABLE public.scenario_positions ADD CONSTRAINT scenario_positions_scene_categories_chk CHECK (
  cardinality(scene_categories) >= 1
  AND cardinality(scene_categories) <= 3
  AND scene_categories <@ ARRAY['industrial', 'home', 'special']::text[]
);

CREATE OR REPLACE FUNCTION public.scenario_positions_scene_categories_distinct()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE d int;
BEGIN
  SELECT count(DISTINCT u)::int INTO d FROM unnest(NEW.scene_categories) AS t(u);
  IF d IS DISTINCT FROM cardinality(NEW.scene_categories) THEN
    RAISE EXCEPTION 'scenario_positions.scene_categories: duplicate category not allowed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sp_scene_cat_distinct ON public.scenario_positions;
CREATE TRIGGER trg_sp_scene_cat_distinct
  BEFORE INSERT OR UPDATE OF scene_categories ON public.scenario_positions
  FOR EACH ROW
  EXECUTE FUNCTION public.scenario_positions_scene_categories_distinct();

ALTER TABLE public.scene_tasks ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.work_groups (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_scene_tasks_group_id ON public.scene_tasks (group_id);

CREATE TABLE IF NOT EXISTS public.scene_task_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_task_id uuid NOT NULL REFERENCES public.scene_tasks (id) ON DELETE CASCADE,
  scenario_position_id uuid NOT NULL REFERENCES public.scenario_positions (id) ON DELETE CASCADE,
  party_demand_id uuid NOT NULL REFERENCES public.party_demands (id) ON DELETE CASCADE,
  max_hours_cap numeric NOT NULL CHECK (max_hours_cap > 0),
  executed_hours numeric NOT NULL DEFAULT 0 CHECK (executed_hours >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scene_task_id, scenario_position_id, party_demand_id)
);

CREATE INDEX IF NOT EXISTS idx_sta_task ON public.scene_task_assignments (scene_task_id);
CREATE INDEX IF NOT EXISTS idx_sta_position ON public.scene_task_assignments (scenario_position_id);
CREATE INDEX IF NOT EXISTS idx_sta_demand ON public.scene_task_assignments (party_demand_id);

ALTER TABLE public.scene_task_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sta_select" ON public.scene_task_assignments;
DROP POLICY IF EXISTS "sta_update_hours" ON public.scene_task_assignments;

CREATE POLICY "sta_select"
  ON public.scene_task_assignments FOR SELECT TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.scene_tasks st
      WHERE st.id = scene_task_assignments.scene_task_id
        AND st.group_id IS NOT NULL
        AND public.policy_work_group_accessible(st.group_id)
    )
  );

CREATE POLICY "sta_update_hours"
  ON public.scene_task_assignments FOR UPDATE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.scene_tasks st
      WHERE st.id = scene_task_assignments.scene_task_id
        AND st.group_id IS NOT NULL
        AND st.status = 'published'
        AND public.policy_work_group_accessible(st.group_id)
        AND public.current_profile_role() = 'collection_executor'
    )
    OR EXISTS (
      SELECT 1
      FROM public.scene_tasks st
      WHERE st.id = scene_task_assignments.scene_task_id
        AND st.group_id IS NOT NULL
        AND public.policy_work_group_accessible(st.group_id)
        AND public.current_profile_role() IN ('scene_operator', 'admin')
    )
  )
  WITH CHECK (
    public.current_profile_role() = 'admin'
    OR EXISTS (
      SELECT 1
      FROM public.scene_tasks st
      WHERE st.id = scene_task_assignments.scene_task_id
        AND st.group_id IS NOT NULL
        AND public.policy_work_group_accessible(st.group_id)
    )
  );

CREATE OR REPLACE FUNCTION public.sync_scene_task_assignments(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.policy_work_group_accessible(p_group_id) AND public.current_profile_role() <> 'admin' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.scene_task_assignments sta
  USING public.scene_tasks st
  WHERE sta.scene_task_id = st.id
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
  SELECT st.id, p.id, d.id, d.max_hours_per_scene
  FROM public.scene_tasks st
  CROSS JOIN public.party_demands d
  CROSS JOIN public.scenario_positions p
  WHERE st.group_id = p_group_id
    AND st.status = 'published'
    AND d.group_id = p_group_id
    AND p.group_id = p_group_id
    AND public.scene_categories_overlap(d.scene_categories, p.scene_categories)
  ON CONFLICT (scene_task_id, scenario_position_id, party_demand_id) DO NOTHING;

  UPDATE public.scene_task_assignments sta
  SET max_hours_cap = d.max_hours_per_scene
  FROM public.party_demands d, public.scene_tasks st
  WHERE sta.party_demand_id = d.id
    AND sta.scene_task_id = st.id
    AND st.group_id = p_group_id
    AND d.group_id = p_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_scene_task_assignments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_scene_task_assignments(uuid) TO authenticated;

DROP POLICY IF EXISTS "scene_tasks_select" ON public.scene_tasks;
DROP POLICY IF EXISTS "scene_tasks_insert_scene_or_admin" ON public.scene_tasks;
DROP POLICY IF EXISTS "scene_tasks_update_scene_or_admin" ON public.scene_tasks;
DROP POLICY IF EXISTS "scene_tasks_delete_scene_or_admin" ON public.scene_tasks;

CREATE POLICY "scene_tasks_select"
  ON public.scene_tasks FOR SELECT TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      group_id IS NOT NULL
      AND public.policy_work_group_accessible(group_id)
      AND (
        public.current_profile_role() = 'scene_operator'
        OR (public.current_profile_role() = 'collection_executor' AND status = 'published')
      )
    )
  );

CREATE POLICY "scene_tasks_insert_scene_or_admin"
  ON public.scene_tasks FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.current_profile_role() IN ('admin', 'scene_operator')
    AND group_id IS NOT NULL
    AND (
      public.current_profile_role() = 'admin'
      OR public.policy_work_group_accessible(group_id)
    )
  );

CREATE POLICY "scene_tasks_update_scene_or_admin"
  ON public.scene_tasks FOR UPDATE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'scene_operator'
      AND created_by = auth.uid()
      AND group_id IS NOT NULL
      AND public.policy_work_group_accessible(group_id)
    )
  )
  WITH CHECK (true);

CREATE POLICY "scene_tasks_delete_scene_or_admin"
  ON public.scene_tasks FOR DELETE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'scene_operator'
      AND created_by = auth.uid()
    )
  );
