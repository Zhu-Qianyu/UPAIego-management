-- Groups, approvals, group-scoped topics, Party-A demands, scenario workstations + Storage bucket.
-- Prerequisite: docs/ROLE_SYSTEM_MIGRATION.sql (uses public.current_profile_role()).
-- Run the ENTIRE script in Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public._grp_policy_drop(tbl text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE pol text;
BEGIN FOR pol IN
  SELECT p.polname::text FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = tbl LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, tbl);
END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.work_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code text NOT NULL DEFAULT ''::text,
  display_name text NOT NULL DEFAULT '我的工作群',
  owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS work_groups_invite_code_uidx ON public.work_groups (invite_code);

CREATE OR REPLACE FUNCTION public._work_group_invite_default()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.invite_code IS NULL OR trim(NEW.invite_code) = '' THEN
    NEW.invite_code := upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 8));
  ELSE
    NEW.invite_code := upper(trim(NEW.invite_code));
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_groups w WHERE w.invite_code = NEW.invite_code AND w.id IS DISTINCT FROM NEW.id) THEN
    NEW.invite_code := upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 8));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wg_invite ON public.work_groups;
CREATE TRIGGER trg_wg_invite
  BEFORE INSERT OR UPDATE OF invite_code ON public.work_groups
  FOR EACH ROW EXECUTE FUNCTION public._work_group_invite_default();

CREATE TABLE IF NOT EXISTS public.group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  membership_status text NOT NULL CHECK (membership_status IN ('pending', 'active', 'rejected')) DEFAULT 'pending',
  request_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES auth.users (id),
  UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_g_status ON public.group_members (group_id, membership_status);

-- Must be defined AFTER work_groups + group_members exist (Postgres validates SQL function bodies).
-- RLS-safe helpers: policies on work_groups <-> group_members must NOT query each other through RLS
-- (Postgres reports "infinite recursion detected in policy for relation work_groups").
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

CREATE TABLE IF NOT EXISTS public.group_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  title text NOT NULL,
  body text DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_topics_g ON public.group_topics (group_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.party_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  title text NOT NULL,
  client_company text,
  requirement_summary text,
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.scenario_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  party_demand_id uuid REFERENCES public.party_demands (id) ON DELETE SET NULL,
  title text NOT NULL,
  process_description text,
  snapshot_bucket text NOT NULL DEFAULT 'scenario-workstation-snapshots',
  snapshot_path text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public._after_work_group_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.group_members (group_id, user_id, membership_status, request_email)
  VALUES (NEW.id, NEW.owner_user_id, 'active', NULL)
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET membership_status = 'active';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_after_work_group_created ON public.work_groups;
CREATE TRIGGER trg_after_work_group_created
  AFTER INSERT ON public.work_groups
  FOR EACH ROW EXECUTE FUNCTION public._after_work_group_created();

ALTER TABLE public.work_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_demands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_positions ENABLE ROW LEVEL SECURITY;

SELECT public._grp_policy_drop('work_groups');
SELECT public._grp_policy_drop('group_members');
SELECT public._grp_policy_drop('group_topics');
SELECT public._grp_policy_drop('party_demands');
SELECT public._grp_policy_drop('scenario_positions');

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

CREATE POLICY "gt_select_scope"
  ON public.group_topics FOR SELECT TO authenticated
  USING (
    group_id = public.user_active_group_id()
    OR public.current_profile_role() = 'admin'
  );

CREATE POLICY "gt_insert_active_members"
  ON public.group_topics FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND group_id = public.user_active_group_id()
    AND public.user_active_group_id() IS NOT NULL
  );

CREATE POLICY "gt_update_own_or_admin"
  ON public.group_topics FOR UPDATE TO authenticated
  USING (
    (
      created_by = auth.uid()
      AND group_id = public.user_active_group_id()
    )
    OR public.current_profile_role() = 'admin'
  )
  WITH CHECK (
    public.current_profile_role() = 'admin'
    OR (
      group_id = public.user_active_group_id()
      AND created_by = auth.uid()
    )
  );

CREATE POLICY "gt_delete_own_or_admin"
  ON public.group_topics FOR DELETE TO authenticated
  USING (
    (
      created_by = auth.uid()
      AND group_id = public.user_active_group_id()
    )
    OR public.current_profile_role() = 'admin'
  );

CREATE POLICY "pd_select"
  ON public.party_demands FOR SELECT TO authenticated
  USING (
    group_id = public.user_active_group_id()
    OR public.current_profile_role() = 'admin'
  );

CREATE POLICY "pd_insert"
  ON public.party_demands FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND group_id = public.user_active_group_id()
    AND public.current_profile_role() IN ('scene_operator', 'admin')
  );

CREATE POLICY "pd_update"
  ON public.party_demands FOR UPDATE TO authenticated
  USING (
    (
      created_by = auth.uid()
      AND group_id = public.user_active_group_id()
      AND public.current_profile_role() IN ('scene_operator', 'admin')
    )
    OR public.current_profile_role() = 'admin'
  )
  WITH CHECK (
    public.current_profile_role() = 'admin'
    OR (
      group_id = public.user_active_group_id()
      AND created_by = auth.uid()
    )
  );

CREATE POLICY "pd_delete"
  ON public.party_demands FOR DELETE TO authenticated
  USING (
    (
      created_by = auth.uid()
      AND group_id = public.user_active_group_id()
    )
    OR public.current_profile_role() = 'admin'
  );

CREATE POLICY "sp_select"
  ON public.scenario_positions FOR SELECT TO authenticated
  USING (
    group_id = public.user_active_group_id()
    OR public.current_profile_role() = 'admin'
  );

CREATE POLICY "sp_insert"
  ON public.scenario_positions FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND group_id = public.user_active_group_id()
    AND public.current_profile_role() IN ('scene_operator', 'admin')
  );

CREATE POLICY "sp_update"
  ON public.scenario_positions FOR UPDATE TO authenticated
  USING (
    (
      created_by = auth.uid()
      AND group_id = public.user_active_group_id()
      AND public.current_profile_role() IN ('scene_operator', 'admin')
    )
    OR public.current_profile_role() = 'admin'
  )
  WITH CHECK (
    public.current_profile_role() = 'admin'
    OR (
      group_id = public.user_active_group_id()
      AND created_by = auth.uid()
    )
  );

CREATE POLICY "sp_delete"
  ON public.scenario_positions FOR DELETE TO authenticated
  USING (
    (
      created_by = auth.uid()
      AND group_id = public.user_active_group_id()
    )
    OR public.current_profile_role() = 'admin'
  );

CREATE OR REPLACE FUNCTION public.submit_group_join_request(p_invite_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE gid uuid;
BEGIN
  SELECT id INTO gid FROM public.work_groups WHERE upper(trim(invite_code)) = upper(trim(p_invite_code));
  IF gid IS NULL THEN RAISE EXCEPTION 'invalid invite code' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO public.group_members (group_id, user_id, membership_status, request_email)
  VALUES (gid, auth.uid(), 'pending', COALESCE((auth.jwt() ->> 'email')::text, ''))
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET
    membership_status = CASE
      WHEN group_members.membership_status = 'rejected' THEN 'pending'::text
      ELSE group_members.membership_status
    END,
    request_email = COALESCE(EXCLUDED.request_email, group_members.request_email),
    created_at = CASE WHEN group_members.membership_status = 'rejected' THEN now() ELSE group_members.created_at END;
END $$;

REVOKE ALL ON FUNCTION public.submit_group_join_request(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_group_join_request(text) TO authenticated;

INSERT INTO storage.buckets (id, name, public)
VALUES ('scenario-workstation-snapshots', 'scenario-workstation-snapshots', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "scenario_snap_select" ON storage.objects;
DROP POLICY IF EXISTS "scenario_snap_insert" ON storage.objects;
DROP POLICY IF EXISTS "scenario_snap_update" ON storage.objects;
DROP POLICY IF EXISTS "scenario_snap_delete" ON storage.objects;

CREATE POLICY "scenario_snap_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'scenario-workstation-snapshots'
    AND split_part(name, '/', 1) = public.user_active_group_id()::text
  );

CREATE POLICY "scenario_snap_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'scenario-workstation-snapshots'
    AND split_part(name, '/', 1) = public.user_active_group_id()::text
    AND public.current_profile_role() IN ('scene_operator', 'admin')
  );

CREATE POLICY "scenario_snap_update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'scenario-workstation-snapshots'
    AND split_part(name, '/', 1) = public.user_active_group_id()::text
  )
  WITH CHECK (
    bucket_id = 'scenario-workstation-snapshots'
    AND split_part(name, '/', 1) = public.user_active_group_id()::text
  );

CREATE POLICY "scenario_snap_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'scenario-workstation-snapshots'
    AND split_part(name, '/', 1) = public.user_active_group_id()::text
    AND public.current_profile_role() IN ('scene_operator', 'admin')
  );

DROP FUNCTION IF EXISTS public._grp_policy_drop(text);
