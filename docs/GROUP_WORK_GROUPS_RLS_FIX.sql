CREATE OR REPLACE FUNCTION public.user_active_group_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
VOLATILE
AS $$
DECLARE r uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('row_security', 'off', true);
  SELECT gm.group_id INTO r
  FROM public.group_members gm
  WHERE gm.user_id = auth.uid() AND gm.membership_status = 'active'
  ORDER BY gm.created_at ASC
  LIMIT 1;
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.user_active_group_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_active_group_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.user_owned_group_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
VOLATILE
AS $$
DECLARE r uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  PERFORM set_config('row_security', 'off', true);
  SELECT w.id INTO r FROM public.work_groups w WHERE w.owner_user_id = auth.uid() LIMIT 1;
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION public.user_owned_group_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_owned_group_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.policy_work_group_accessible(p_group_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
VOLATILE
AS $$
BEGIN
  IF p_group_id IS NULL OR auth.uid() IS NULL THEN RETURN false; END IF;
  PERFORM set_config('row_security', 'off', true);
  RETURN EXISTS (
    SELECT 1
    FROM public.work_groups w
    WHERE w.id = p_group_id
      AND (
        w.owner_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.group_members m
          WHERE m.group_id = w.id AND m.user_id = auth.uid()
        )
      )
  );
END;
$$;
REVOKE ALL ON FUNCTION public.policy_work_group_accessible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.policy_work_group_accessible(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_is_work_group_owner(p_group_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
VOLATILE
AS $$
BEGIN
  IF p_group_id IS NULL OR auth.uid() IS NULL THEN RETURN false; END IF;
  PERFORM set_config('row_security', 'off', true);
  RETURN EXISTS (
    SELECT 1 FROM public.work_groups w
    WHERE w.id = p_group_id AND w.owner_user_id = auth.uid()
  );
END;
$$;
REVOKE ALL ON FUNCTION public.user_is_work_group_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_work_group_owner(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_owns_any_work_group()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
VOLATILE
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  PERFORM set_config('row_security', 'off', true);
  RETURN EXISTS (SELECT 1 FROM public.work_groups w WHERE w.owner_user_id = auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.user_owns_any_work_group() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_owns_any_work_group() TO authenticated;

DROP POLICY IF EXISTS "wg_select_related" ON public.work_groups;
DROP POLICY IF EXISTS "wg_insert_one_owned" ON public.work_groups;
DROP POLICY IF EXISTS "wg_update_owner" ON public.work_groups;

CREATE POLICY "wg_select_related"
  ON public.work_groups FOR SELECT TO authenticated
  USING (
    public.policy_work_group_accessible(work_groups.id)
    OR public.current_profile_role() = 'admin'
  );

CREATE POLICY "wg_insert_one_owned"
  ON public.work_groups FOR INSERT TO authenticated
  WITH CHECK (
    public.current_profile_role() = 'admin'
    AND auth.uid() = owner_user_id
    AND NOT public.user_owns_any_work_group()
  );

CREATE POLICY "wg_update_owner"
  ON public.work_groups FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "gm_select" ON public.group_members;
DROP POLICY IF EXISTS "gm_update_group_owner_review" ON public.group_members;
DROP POLICY IF EXISTS "gm_admin_update_any" ON public.group_members;

CREATE POLICY "gm_select"
  ON public.group_members FOR SELECT TO authenticated
  USING (
    public.policy_work_group_accessible(group_members.group_id)
    OR public.current_profile_role() = 'admin'
  );

CREATE POLICY "gm_update_group_owner_review"
  ON public.group_members FOR UPDATE TO authenticated
  USING (public.user_is_work_group_owner(group_members.group_id))
  WITH CHECK (public.user_is_work_group_owner(group_members.group_id));

CREATE POLICY "gm_admin_update_any"
  ON public.group_members FOR UPDATE TO authenticated
  USING (public.current_profile_role() = 'admin')
  WITH CHECK (public.current_profile_role() = 'admin');
