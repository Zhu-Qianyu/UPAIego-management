-- 修复大场景无法删除：统一走 SECURITY DEFINER RPC，级联清理小岗位与草稿排班
-- 执行时机：MULTI_ROLE_RLS_PATCH.sql 之后

CREATE OR REPLACE FUNCTION public.delete_scene_macro_site(p_macro_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_blocking int;
  v_deleted int;
BEGIN
  SELECT group_id INTO v_group_id
  FROM public.scene_macro_sites
  WHERE id = p_macro_id;

  IF v_group_id IS NULL THEN
    RAISE EXCEPTION '大场景不存在或已删除';
  END IF;

  IF NOT (
    public.has_profile_role('admin')
    OR (public.has_profile_role('scene_operator') AND public.policy_work_group_accessible(v_group_id))
  ) THEN
    RAISE EXCEPTION '无权删除该大场景';
  END IF;

  DELETE FROM public.collection_shifts cs
  USING public.scenario_positions sp
  WHERE cs.scenario_position_id = sp.id
    AND sp.macro_scene_id = p_macro_id
    AND cs.status = 'draft';

  SELECT count(*)::int INTO v_blocking
  FROM public.collection_shifts cs
  INNER JOIN public.scenario_positions sp ON sp.id = cs.scenario_position_id
  WHERE sp.macro_scene_id = p_macro_id;

  IF v_blocking > 0 THEN
    RAISE EXCEPTION '该大场景下仍有 % 条采集排班（已发布或已关闭），请先处理后再删除', v_blocking;
  END IF;

  DELETE FROM public.scenario_positions WHERE macro_scene_id = p_macro_id;

  DELETE FROM public.scene_macro_sites WHERE id = p_macro_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RAISE EXCEPTION '删除大场景失败';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_scene_macro_site(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_scene_macro_site(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
