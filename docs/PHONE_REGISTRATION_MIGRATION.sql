ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS contact_email text;

ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS request_phone text;

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
BEGIN
  r := COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'role'), ''), 'device_operator');
  IF r NOT IN ('admin', 'device_operator', 'scene_operator', 'collection_executor') THEN
    r := 'device_operator';
  END IF;
  v_real := NULLIF(trim(NEW.raw_user_meta_data ->> 'real_name'), '');
  v_phone := NULLIF(trim(NEW.raw_user_meta_data ->> 'phone'), '');
  v_contact_email := NULLIF(trim(NEW.raw_user_meta_data ->> 'contact_email'), '');
  INSERT INTO public.profiles (id, role, real_name, phone, contact_email)
  VALUES (NEW.id, r, v_real, v_phone, v_contact_email)
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role,
    real_name = COALESCE(EXCLUDED.real_name, public.profiles.real_name),
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    contact_email = COALESCE(EXCLUDED.contact_email, public.profiles.contact_email),
    updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._insert_group_join_request(p_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT phone INTO v_phone FROM public.profiles WHERE id = auth.uid();
  v_email := COALESCE((auth.jwt() ->> 'email')::text, '');
  INSERT INTO public.group_members (group_id, user_id, membership_status, request_email, request_phone)
  VALUES (p_group_id, auth.uid(), 'pending', v_email, v_phone)
  ON CONFLICT (group_id, user_id)
  DO UPDATE SET
    membership_status = CASE
      WHEN group_members.membership_status = 'rejected' THEN 'pending'::text
      ELSE group_members.membership_status
    END,
    request_email = COALESCE(EXCLUDED.request_email, group_members.request_email),
    request_phone = COALESCE(EXCLUDED.request_phone, group_members.request_phone),
    created_at = CASE WHEN group_members.membership_status = 'rejected' THEN now() ELSE group_members.created_at END;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_group_join_request(p_invite_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE gid uuid;
BEGIN
  SELECT id INTO gid FROM public.work_groups WHERE upper(trim(invite_code)) = upper(trim(p_invite_code));
  IF gid IS NULL THEN
    RAISE EXCEPTION '入群代码无效' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._insert_group_join_request(gid);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_signup_group_request(p_invite_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gid uuid;
  v_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;
  v_role := public.current_profile_role();
  IF v_role = 'admin' THEN
    RETURN;
  END IF;
  IF p_invite_code IS NULL OR trim(p_invite_code) = '' THEN
    RAISE EXCEPTION '请填写群组号（入群代码）';
  END IF;
  SELECT id INTO gid FROM public.work_groups WHERE upper(trim(invite_code)) = upper(trim(p_invite_code));
  IF gid IS NULL THEN
    RAISE EXCEPTION '群组号无效，请向管理员确认' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._insert_group_join_request(gid);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_signup_group_request(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_signup_group_request(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
