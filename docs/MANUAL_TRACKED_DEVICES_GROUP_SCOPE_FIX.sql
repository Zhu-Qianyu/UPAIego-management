-- 离线设备（manual_tracked_devices）仅本工作群可见/可改（设备运维员）
-- 管理员仍可看全平台。前置：MANUAL_TRACKED_DEVICES_MIGRATION.sql
-- 在 Supabase SQL Editor 整段执行

DROP POLICY IF EXISTS "mtd_select" ON public.manual_tracked_devices;
DROP POLICY IF EXISTS "mtd_insert" ON public.manual_tracked_devices;
DROP POLICY IF EXISTS "mtd_update" ON public.manual_tracked_devices;
DROP POLICY IF EXISTS "mtd_delete" ON public.manual_tracked_devices;

CREATE POLICY "mtd_select"
  ON public.manual_tracked_devices FOR SELECT TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      group_id IS NOT NULL
      AND group_id = public.user_active_group_id()
    )
  );

CREATE POLICY "mtd_insert"
  ON public.manual_tracked_devices FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.current_profile_role() IN ('admin', 'device_operator')
    AND group_id IS NOT NULL
    AND (
      public.current_profile_role() = 'admin'
      OR group_id = public.user_active_group_id()
    )
  );

CREATE POLICY "mtd_update"
  ON public.manual_tracked_devices FOR UPDATE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'device_operator'
      AND group_id IS NOT NULL
      AND group_id = public.user_active_group_id()
    )
  )
  WITH CHECK (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'device_operator'
      AND group_id IS NOT NULL
      AND group_id = public.user_active_group_id()
    )
  );

CREATE POLICY "mtd_delete"
  ON public.manual_tracked_devices FOR DELETE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'device_operator'
      AND group_id IS NOT NULL
      AND group_id = public.user_active_group_id()
    )
  );

COMMENT ON TABLE public.manual_tracked_devices IS '离线设备（无法连接本站心跳）：运维维护状态与贴签登记编号(QR)。';

NOTIFY pgrst, 'reload schema';
