-- 场景分级：大场景 (scene_macro_sites) → 小岗位 (scenario_positions.macro_scene_id)
-- Prerequisite: work_groups, scenario_positions, policy_work_group_accessible, GROUP_TOPICS_BUSINESS_MIGRATION RLS patterns.
-- Run in Supabase SQL Editor as a single script.

CREATE TABLE IF NOT EXISTS public.scene_macro_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) >= 1),
  description text,
  address_province text NOT NULL DEFAULT '待补充',
  address_city text NOT NULL DEFAULT '待补充',
  address_district text NOT NULL DEFAULT '待补充',
  address_detail text,
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scene_macro_sites_group ON public.scene_macro_sites (group_id, created_at DESC);

ALTER TABLE public.scenario_positions
  ADD COLUMN IF NOT EXISTS macro_scene_id uuid REFERENCES public.scene_macro_sites (id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_scenario_positions_macro ON public.scenario_positions (macro_scene_id);

-- 为已有小岗位按工作群补一条默认大场景并回填
DO $$
DECLARE
  g record;
  mid uuid;
BEGIN
  FOR g IN
    SELECT DISTINCT sp.group_id
    FROM public.scenario_positions sp
    WHERE sp.macro_scene_id IS NULL
  LOOP
    INSERT INTO public.scene_macro_sites (
      group_id, title, description, address_province, address_city, address_district, created_by
    )
    SELECT
      g.group_id,
      '默认大场景',
      '系统自动为历史小岗位创建的大场景，可在前端改名或新建大场景后迁移小岗位。',
      '待补充',
      '待补充',
      '待补充',
      COALESCE(
        (SELECT wg.owner_user_id FROM public.work_groups wg WHERE wg.id = g.group_id),
        (SELECT sp2.created_by FROM public.scenario_positions sp2 WHERE sp2.group_id = g.group_id LIMIT 1)
      )
    RETURNING id INTO mid;

    UPDATE public.scenario_positions
    SET macro_scene_id = mid
    WHERE group_id = g.group_id AND macro_scene_id IS NULL;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.scenario_positions_macro_same_group_chk()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.macro_scene_id IS NULL THEN
    RAISE EXCEPTION 'macro_scene_id is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.scene_macro_sites m
    WHERE m.id = NEW.macro_scene_id AND m.group_id = NEW.group_id
  ) THEN
    RAISE EXCEPTION 'macro_scene_id must belong to the same work group';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sp_macro_group ON public.scenario_positions;
CREATE TRIGGER trg_sp_macro_group
  BEFORE INSERT OR UPDATE OF macro_scene_id, group_id ON public.scenario_positions
  FOR EACH ROW
  EXECUTE FUNCTION public.scenario_positions_macro_same_group_chk();

ALTER TABLE public.scene_macro_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scene_macro_sites_select" ON public.scene_macro_sites;
DROP POLICY IF EXISTS "scene_macro_sites_insert" ON public.scene_macro_sites;
DROP POLICY IF EXISTS "scene_macro_sites_update" ON public.scene_macro_sites;
DROP POLICY IF EXISTS "scene_macro_sites_delete" ON public.scene_macro_sites;

CREATE POLICY "scene_macro_sites_select"
  ON public.scene_macro_sites FOR SELECT TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.policy_work_group_accessible(group_id)
      AND public.current_profile_role() IN ('scene_operator', 'collection_executor')
    )
  );

CREATE POLICY "scene_macro_sites_insert"
  ON public.scene_macro_sites FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.current_profile_role() IN ('admin', 'scene_operator')
    AND (
      public.current_profile_role() = 'admin'
      OR public.policy_work_group_accessible(group_id)
    )
  );

CREATE POLICY "scene_macro_sites_update"
  ON public.scene_macro_sites FOR UPDATE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'scene_operator'
      AND public.policy_work_group_accessible(group_id)
    )
  )
  WITH CHECK (true);

CREATE POLICY "scene_macro_sites_delete"
  ON public.scene_macro_sites FOR DELETE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'scene_operator'
      AND public.policy_work_group_accessible(group_id)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scene_macro_sites TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON TABLE public.scene_macro_sites IS '大场景：小岗位 (scenario_positions) 的上级分组。';
COMMENT ON COLUMN public.scenario_positions.macro_scene_id IS '所属大场景；与 group_id 须同群。';
