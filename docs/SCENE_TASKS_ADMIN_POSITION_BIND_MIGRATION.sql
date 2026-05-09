-- Scene tasks: bind to one scenario position (admin-created); sync only matches that position.
-- INSERT scene_tasks: admin only. UPDATE: scene_operator in same group (e.g. publish). DELETE draft: admin or scene_operator in group.
-- Prerequisite: SCENE_BUSINESS_ASSIGNMENT_MIGRATION.sql (scene_tasks.group_id, sync_scene_task_assignments, scenario_positions).

ALTER TABLE public.scene_tasks
  ADD COLUMN IF NOT EXISTS scenario_position_id uuid REFERENCES public.scenario_positions (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scene_tasks_scenario_position ON public.scene_tasks (scenario_position_id);

CREATE OR REPLACE FUNCTION public.scene_tasks_position_same_group_chk()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.scenario_position_id IS NOT NULL AND NEW.group_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.scenario_positions sp
      WHERE sp.id = NEW.scenario_position_id
        AND sp.group_id = NEW.group_id
    ) THEN
      RAISE EXCEPTION 'scenario_position_id must belong to the same work group as scene_tasks.group_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_scene_tasks_pos_group ON public.scene_tasks;
CREATE TRIGGER trg_scene_tasks_pos_group
  BEFORE INSERT OR UPDATE OF scenario_position_id, group_id ON public.scene_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.scene_tasks_position_same_group_chk();

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
  INNER JOIN public.scenario_positions p
    ON p.group_id = p_group_id
    AND (st.scenario_position_id IS NULL OR p.id = st.scenario_position_id)
  WHERE st.group_id = p_group_id
    AND st.status = 'published'
    AND d.group_id = p_group_id
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

DROP POLICY IF EXISTS "scene_tasks_insert_scene_or_admin" ON public.scene_tasks;
DROP POLICY IF EXISTS "scene_tasks_update_scene_or_admin" ON public.scene_tasks;
DROP POLICY IF EXISTS "scene_tasks_delete_scene_or_admin" ON public.scene_tasks;

CREATE POLICY "scene_tasks_insert_admin_only"
  ON public.scene_tasks FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.current_profile_role() = 'admin'
    AND group_id IS NOT NULL
  );

CREATE POLICY "scene_tasks_update_group_scope"
  ON public.scene_tasks FOR UPDATE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'scene_operator'
      AND group_id IS NOT NULL
      AND public.policy_work_group_accessible(group_id)
    )
  )
  WITH CHECK (true);

CREATE POLICY "scene_tasks_delete_draft_in_group_or_admin"
  ON public.scene_tasks FOR DELETE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'scene_operator'
      AND status = 'draft'::text
      AND group_id IS NOT NULL
      AND public.policy_work_group_accessible(group_id)
    )
  );

COMMENT ON COLUMN public.scene_tasks.scenario_position_id IS 'When set, auto-assignments only use this scenario position; NULL = legacy all positions in group.';
