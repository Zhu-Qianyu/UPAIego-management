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


NOTIFY pgrst, 'reload schema';
