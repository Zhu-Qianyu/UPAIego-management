-- 非 admin 角色注册时必须带有效群组号，否则 signup 事务整体回滚
-- 前置：PHONE_REGISTRATION_MIGRATION.sql
-- 在 Supabase SQL Editor 整段执行

CREATE OR REPLACE FUNCTION public.validate_invite_code(p_invite_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.work_groups w
    WHERE upper(trim(w.invite_code)) = upper(trim(p_invite_code))
  );
$$;

REVOKE ALL ON FUNCTION public.validate_invite_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_invite_code(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text;
  v_real text;
  v_phone text;
  v_contact_email text;
  v_invite text;
  v_gid uuid;
BEGIN
  r := COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'role'), ''), 'device_operator');
  IF r NOT IN ('admin', 'device_operator', 'scene_operator', 'collection_executor') THEN
    r := 'device_operator';
  END IF;
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

  INSERT INTO public.profiles (id, role, real_name, phone, contact_email)
  VALUES (NEW.id, r, v_real, v_phone, v_contact_email)
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role,
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

NOTIFY pgrst, 'reload schema';
