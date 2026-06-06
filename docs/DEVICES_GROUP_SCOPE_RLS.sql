CREATE OR REPLACE FUNCTION public.device_visible_to_fleet_roles(p_device_owner_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
VOLATILE
AS $$
DECLARE
  gid uuid;
BEGIN
  IF p_device_owner_id IS NULL OR auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  IF p_device_owner_id = auth.uid() THEN
    RETURN true;
  END IF;

  gid := COALESCE(public.user_owned_group_id(), public.user_active_group_id());
  IF gid IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = gid
      AND gm.user_id = p_device_owner_id
      AND gm.membership_status IN ('pending', 'active')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.device_visible_to_fleet_roles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.device_visible_to_fleet_roles(uuid) TO authenticated;

DROP POLICY IF EXISTS "devices_select" ON public.devices;
DROP POLICY IF EXISTS "devices_update_ops_or_admin" ON public.devices;
DROP POLICY IF EXISTS "devices_delete_ops_or_admin" ON public.devices;

CREATE POLICY "devices_select"
  ON public.devices FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      public.current_profile_role() IN ('admin', 'collection_executor')
      AND public.device_visible_to_fleet_roles(user_id)
    )
  );

CREATE POLICY "devices_update_ops_or_admin"
  ON public.devices FOR UPDATE TO authenticated
  USING (
    (
      public.current_profile_role() = 'admin'
      AND public.device_visible_to_fleet_roles(user_id)
    )
    OR (
      user_id = auth.uid()
      AND public.current_profile_role() = 'device_operator'
    )
  )
  WITH CHECK (
    (
      public.current_profile_role() = 'admin'
      AND public.device_visible_to_fleet_roles(user_id)
    )
    OR (
      user_id = auth.uid()
      AND public.current_profile_role() = 'device_operator'
    )
  );

CREATE POLICY "devices_delete_ops_or_admin"
  ON public.devices FOR DELETE TO authenticated
  USING (
    (
      public.current_profile_role() = 'admin'
      AND public.device_visible_to_fleet_roles(user_id)
    )
    OR (
      user_id = auth.uid()
      AND public.current_profile_role() = 'device_operator'
    )
  );

CREATE OR REPLACE FUNCTION public.harvest_device(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF coalesce(public.current_profile_role(), '') NOT IN ('collection_executor', 'admin') THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT d.user_id INTO v_owner FROM public.devices d WHERE d.device_id = p_device_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'device not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_owner = auth.uid()
    OR public.device_visible_to_fleet_roles(v_owner)
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  UPDATE public.devices
  SET storage_used_mb = 0,
      last_data_pickup_at = now(),
      last_seen = now()
  WHERE device_id = p_device_id;
END;
$$;

REVOKE ALL ON FUNCTION public.harvest_device(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.harvest_device(text) TO authenticated;
