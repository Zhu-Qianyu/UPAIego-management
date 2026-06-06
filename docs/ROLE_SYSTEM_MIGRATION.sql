CREATE OR REPLACE FUNCTION public._role_migration_drop_policies(tbl text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE pol text;
BEGIN
  FOR pol IN
    SELECT p.polname::text
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = tbl
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, tbl);
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'device_operator'
    CHECK (role IN ('admin', 'device_operator', 'scene_operator', 'collection_executor')),
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.current_profile_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_profile_role() TO authenticated;

SELECT public._role_migration_drop_policies('profiles');

CREATE POLICY "profiles_select_self_or_admin"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.current_profile_role() = 'admin'
  );

CREATE POLICY "profiles_insert_self"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_self"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_admin_update"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.current_profile_role() = 'admin')
  WITH CHECK (true);

INSERT INTO public.profiles (id, role)
SELECT u.id, 'device_operator'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
BEGIN
  r := COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'role'), ''), 'device_operator');
  IF r NOT IN ('admin', 'device_operator', 'scene_operator', 'collection_executor') THEN
    r := 'device_operator';
  END IF;
  INSERT INTO public.profiles (id, role) VALUES (NEW.id, r)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS map_lat double precision;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS map_lng double precision;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS storage_used_mb numeric NOT NULL DEFAULT 0;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS storage_capacity_mb numeric NOT NULL DEFAULT 1024;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS last_data_pickup_at timestamptz;

CREATE TABLE IF NOT EXISTS public.admin_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  target_value numeric,
  unit text,
  notes text,
  updated_by uuid REFERENCES auth.users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_messages ENABLE ROW LEVEL SECURITY;

SELECT public._role_migration_drop_policies('admin_kpis');
SELECT public._role_migration_drop_policies('admin_messages');

CREATE POLICY "admin_kpis_read_authenticated"
  ON public.admin_kpis FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin_kpis_insert_admin"
  ON public.admin_kpis FOR INSERT TO authenticated
  WITH CHECK (public.current_profile_role() = 'admin');

CREATE POLICY "admin_kpis_update_admin"
  ON public.admin_kpis FOR UPDATE TO authenticated
  USING (public.current_profile_role() = 'admin')
  WITH CHECK (public.current_profile_role() = 'admin');

CREATE POLICY "admin_kpis_delete_admin"
  ON public.admin_kpis FOR DELETE TO authenticated
  USING (public.current_profile_role() = 'admin');

CREATE POLICY "admin_messages_read_authenticated"
  ON public.admin_messages FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin_messages_write_admin"
  ON public.admin_messages FOR INSERT TO authenticated
  WITH CHECK (public.current_profile_role() = 'admin');

CREATE POLICY "admin_messages_delete_admin"
  ON public.admin_messages FOR DELETE TO authenticated
  USING (public.current_profile_role() = 'admin');

CREATE TABLE IF NOT EXISTS public.scene_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.collection_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_task_id uuid NOT NULL REFERENCES public.scene_tasks (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  priority int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scene_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_requirements ENABLE ROW LEVEL SECURITY;

SELECT public._role_migration_drop_policies('scene_tasks');
SELECT public._role_migration_drop_policies('collection_requirements');

CREATE POLICY "scene_tasks_select"
  ON public.scene_tasks FOR SELECT TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR public.current_profile_role() = 'scene_operator'
    OR (public.current_profile_role() = 'collection_executor' AND status = 'published')
  );

CREATE POLICY "scene_tasks_insert_scene_or_admin"
  ON public.scene_tasks FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.current_profile_role() IN ('admin', 'scene_operator')
  );

CREATE POLICY "scene_tasks_update_scene_or_admin"
  ON public.scene_tasks FOR UPDATE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (public.current_profile_role() = 'scene_operator' AND created_by = auth.uid())
  )
  WITH CHECK (true);

CREATE POLICY "scene_tasks_delete_scene_or_admin"
  ON public.scene_tasks FOR DELETE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (public.current_profile_role() = 'scene_operator' AND created_by = auth.uid())
  );

CREATE POLICY "collection_req_select"
  ON public.collection_requirements FOR SELECT TO authenticated
  USING (
    public.current_profile_role() IN ('admin', 'scene_operator')
    OR (
      public.current_profile_role() = 'collection_executor'
      AND EXISTS (
        SELECT 1 FROM public.scene_tasks t
        WHERE t.id = scene_task_id AND t.status = 'published'
      )
    )
  );

CREATE POLICY "collection_req_insert_scene_or_admin"
  ON public.collection_requirements FOR INSERT TO authenticated
  WITH CHECK (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'scene_operator'
      AND EXISTS (
        SELECT 1 FROM public.scene_tasks t
        WHERE t.id = scene_task_id AND t.created_by = auth.uid()
      )
      AND created_by = auth.uid()
    )
  );

CREATE POLICY "collection_req_update_scene_or_admin"
  ON public.collection_requirements FOR UPDATE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'scene_operator'
      AND EXISTS (
        SELECT 1 FROM public.scene_tasks t
        WHERE t.id = scene_task_id AND t.created_by = auth.uid()
      )
    )
  )
  WITH CHECK (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'scene_operator'
      AND EXISTS (
        SELECT 1 FROM public.scene_tasks t
        WHERE t.id = scene_task_id AND t.created_by = auth.uid()
      )
    )
  );

CREATE POLICY "collection_req_delete_scene_or_admin"
  ON public.collection_requirements FOR DELETE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (
      public.current_profile_role() = 'scene_operator'
      AND EXISTS (
        SELECT 1 FROM public.scene_tasks t
        WHERE t.id = scene_task_id AND t.created_by = auth.uid()
      )
    )
  );

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

SELECT public._role_migration_drop_policies('devices');

CREATE POLICY "devices_select"
  ON public.devices FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.current_profile_role() IN ('admin', 'collection_executor')
  );

CREATE POLICY "devices_insert_ops_or_admin"
  ON public.devices FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.current_profile_role() IN ('admin', 'device_operator')
  );

CREATE POLICY "devices_update_ops_or_admin"
  ON public.devices FOR UPDATE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (user_id = auth.uid() AND public.current_profile_role() = 'device_operator')
  )
  WITH CHECK (
    public.current_profile_role() = 'admin'
    OR (user_id = auth.uid() AND public.current_profile_role() = 'device_operator')
  );

CREATE POLICY "devices_delete_ops_or_admin"
  ON public.devices FOR DELETE TO authenticated
  USING (
    public.current_profile_role() = 'admin'
    OR (user_id = auth.uid() AND public.current_profile_role() = 'device_operator')
  );

CREATE OR REPLACE FUNCTION public.harvest_device(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(public.current_profile_role(), '') NOT IN ('collection_executor', 'admin') THEN
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

DROP FUNCTION IF EXISTS public._role_migration_drop_policies(text);
