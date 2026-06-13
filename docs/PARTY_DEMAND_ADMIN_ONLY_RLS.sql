-- 甲方业务（party_demands）仅平台管理员可增删改；全员只读仍走 pd_select
-- 执行时机：MULTI_ROLE_RLS_PATCH.sql 之后；与前端 admin-only 维护一致

DROP POLICY IF EXISTS "pd_insert" ON public.party_demands;
CREATE POLICY "pd_insert" ON public.party_demands
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_profile_role('admin')
    AND created_by = auth.uid()
    AND group_id = public.user_active_group_id()
  );

DROP POLICY IF EXISTS "pd_update" ON public.party_demands;
CREATE POLICY "pd_update" ON public.party_demands
  FOR UPDATE TO authenticated
  USING (public.has_profile_role('admin'))
  WITH CHECK (public.has_profile_role('admin'));

DROP POLICY IF EXISTS "pd_delete" ON public.party_demands;
CREATE POLICY "pd_delete" ON public.party_demands
  FOR DELETE TO authenticated
  USING (public.has_profile_role('admin'));

NOTIFY pgrst, 'reload schema';
