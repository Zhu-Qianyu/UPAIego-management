-- Batch-generate draft scene_tasks for every scenario_position in a work group that does not yet have a task bound to it.
-- Prerequisite: SCENE_TASKS_ADMIN_POSITION_BIND_MIGRATION.sql (scenario_position_id, insert admin-only).
-- Run in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.batch_generate_scene_tasks_for_group(p_group_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;
  IF public.current_profile_role() <> 'admin' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.scene_tasks (title, description, status, group_id, scenario_position_id, created_by)
  SELECT
    format('【%s】场景采集任务', sp.title),
    concat_ws(
      E'\n\n',
      '本任务由后台按场景岗位批量生成（草稿）；发布后仅在该岗位下与甲方业务大类匹配生成子任务。',
      CASE
        WHEN coalesce(trim(sp.process_description), '') <> '' THEN '岗位说明：' || trim(sp.process_description)
        ELSE NULL
      END,
      '厂区：' || trim(both ' ' FROM concat_ws(
        ' ',
        nullif(trim(sp.address_province), ''),
        nullif(trim(sp.address_city), ''),
        nullif(trim(sp.address_district), '')
      ))
        || CASE
          WHEN coalesce(trim(sp.address_detail), '') <> '' THEN ' ' || trim(sp.address_detail)
          ELSE ''
        END
    ),
    'draft',
    p_group_id,
    sp.id,
    auth.uid()
  FROM public.scenario_positions sp
  WHERE sp.group_id = p_group_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.scene_tasks st
      WHERE st.group_id = p_group_id
        AND st.scenario_position_id = sp.id
    );

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.batch_generate_scene_tasks_for_group(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.batch_generate_scene_tasks_for_group(uuid) TO authenticated;

COMMENT ON FUNCTION public.batch_generate_scene_tasks_for_group(uuid) IS 'Admin-only: insert one draft scene_task per scenario_position in the group when missing (same binding rules as manual create).';
