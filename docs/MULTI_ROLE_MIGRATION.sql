-- 身兼数职：profiles.roles + has_profile_role()；admin 仍独占
-- 执行后请再执行 docs/MULTI_ROLE_FUNCTIONS_PATCH.sql（由 scripts/generate_multi_role_patch.py 生成）

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS roles text[];

UPDATE public.profiles
SET roles = ARRAY[role]
WHERE roles IS NULL OR cardinality(roles) = 0;

ALTER TABLE public.profiles
  ALTER COLUMN roles SET DEFAULT '{device_operator}';

ALTER TABLE public.profiles
  ALTER COLUMN roles SET NOT NULL;

-- 同步 role 与 roles[1]
CREATE OR REPLACE FUNCTION public.profiles_roles_sync_chk()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  r text[];
BEGIN
  IF NEW.roles IS NULL OR cardinality(NEW.roles) = 0 THEN
    NEW.roles := ARRAY[COALESCE(NULLIF(trim(NEW.role), ''), 'device_operator')];
  END IF;

  NEW.roles := ARRAY(SELECT DISTINCT unnest(NEW.roles));

  IF 'admin' = ANY(NEW.roles) THEN
    IF cardinality(NEW.roles) <> 1 OR NEW.roles[1] <> 'admin' THEN
      RAISE EXCEPTION 'admin role must be exclusive';
    END IF;
    NEW.role := 'admin';
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(NEW.roles) u
    WHERE u NOT IN ('device_operator', 'scene_operator', 'collection_executor')
  ) THEN
    RAISE EXCEPTION 'invalid role in roles array';
  END IF;

  IF cardinality(NEW.roles) < 1 THEN
    RAISE EXCEPTION 'at least one operative role required';
  END IF;

  NEW.role := NEW.roles[1];
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_roles_sync ON public.profiles;
CREATE TRIGGER trg_profiles_roles_sync
  BEFORE INSERT OR UPDATE OF role, roles ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_roles_sync_chk();

CREATE OR REPLACE FUNCTION public.profile_roles_array()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p.roles, ARRAY[p.role])
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT 'admin' = ANY(COALESCE(p.roles, ARRAY[p.role]))
     FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.has_profile_role(p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(p.roles, ARRAY[p.role]) @> ARRAY[p_role]
     FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_profile_role(p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(p.roles, ARRAY[p.role]) && p_roles
     FROM public.profiles p WHERE p.id = auth.uid() LIMIT 1),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.profile_has_role(p_roles text[], p_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_roles @> ARRAY[p_role];
$$;

-- 展示/兼容：返回主职（roles[1]）
CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (COALESCE(p.roles, ARRAY[p.role]))[1]
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.profile_roles_array() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_profile_role(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_any_profile_role(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_roles_array() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_profile_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_profile_role(text[]) TO authenticated;

-- 注册：支持 metadata.roles 数组
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  r text;
  v_roles text[];
  v_real text;
  v_phone text;
  v_contact_email text;
  v_invite text;
  v_gid uuid;
  raw_roles jsonb;
BEGIN
  PERFORM set_config('row_security', 'off', true);

  raw_roles := NEW.raw_user_meta_data -> 'roles';
  IF raw_roles IS NOT NULL AND jsonb_typeof(raw_roles) = 'array' AND jsonb_array_length(raw_roles) > 0 THEN
    SELECT COALESCE(array_agg(DISTINCT trim(both from x)), ARRAY[]::text[])
    INTO v_roles
    FROM jsonb_array_elements_text(raw_roles) AS t(x)
    WHERE trim(both from x) <> '';
  END IF;

  IF v_roles IS NULL OR cardinality(v_roles) = 0 THEN
    r := COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'role'), ''), 'device_operator');
    IF r NOT IN ('admin', 'device_operator', 'scene_operator', 'collection_executor') THEN
      r := 'device_operator';
    END IF;
    v_roles := ARRAY[r];
  END IF;

  IF 'admin' = ANY(v_roles) THEN
    v_roles := ARRAY['admin'];
  ELSE
    v_roles := ARRAY(
      SELECT DISTINCT u FROM unnest(v_roles) u
      WHERE u IN ('device_operator', 'scene_operator', 'collection_executor')
    );
    IF cardinality(v_roles) = 0 THEN
      v_roles := ARRAY['device_operator'];
    END IF;
  END IF;

  r := v_roles[1];
  v_real := NULLIF(trim(NEW.raw_user_meta_data ->> 'real_name'), '');
  v_phone := NULLIF(trim(NEW.raw_user_meta_data ->> 'phone'), '');
  v_contact_email := NULLIF(trim(NEW.raw_user_meta_data ->> 'contact_email'), '');

  IF r <> 'admin' THEN
    v_invite := NULLIF(trim(NEW.raw_user_meta_data ->> 'invite_code'), '');
    IF v_invite IS NULL THEN
      RAISE EXCEPTION '非管理员注册必须填写群组号（入群代码）';
    END IF;
    SELECT w.id INTO v_gid
    FROM public.work_groups w
    WHERE upper(trim(w.invite_code)) = upper(v_invite);
    IF NOT FOUND THEN
      RAISE EXCEPTION '群组号无效，请向管理员确认';
    END IF;
  END IF;

  INSERT INTO public.profiles (id, role, roles, real_name, phone, contact_email)
  VALUES (NEW.id, r, v_roles, v_real, v_phone, v_contact_email)
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role,
    roles = EXCLUDED.roles,
    real_name = COALESCE(EXCLUDED.real_name, public.profiles.real_name),
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    contact_email = COALESCE(EXCLUDED.contact_email, public.profiles.contact_email),
    updated_at = now();

  IF r <> 'admin' AND v_gid IS NOT NULL THEN
    INSERT INTO public.group_members (group_id, user_id, membership_status, request_email, request_phone)
    VALUES (v_gid, NEW.id, 'pending', COALESCE(NEW.email, ''), v_phone)
    ON CONFLICT (group_id, user_id) DO UPDATE SET
      membership_status = 'pending',
      request_email = COALESCE(EXCLUDED.request_email, group_members.request_email),
      request_phone = COALESCE(EXCLUDED.request_phone, group_members.request_phone),
      created_at = now();
  END IF;

  RETURN NEW;
END;
$$;

-- profiles 策略：admin 判断改用 is_admin()
DROP POLICY IF EXISTS "profiles_admin_update" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_self_or_admin" ON public.profiles;

CREATE POLICY "profiles_admin_update"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (true);

CREATE POLICY "profiles_select_self_or_admin"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());

NOTIFY pgrst, 'reload schema';
