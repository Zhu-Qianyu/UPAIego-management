CREATE OR REPLACE FUNCTION public.lookup_invite_code(p_invite_code text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_name text;
BEGIN
  IF p_invite_code IS NULL OR trim(p_invite_code) = '' THEN
    RETURN json_build_object('valid', false, 'message', '请填写群组号');
  END IF;
  SELECT w.id, w.display_name INTO v_id, v_name
  FROM public.work_groups w
  WHERE upper(trim(w.invite_code)) = upper(trim(p_invite_code));
  IF NOT FOUND THEN
    RETURN json_build_object('valid', false, 'message', '群组号无效');
  END IF;
  RETURN json_build_object(
    'valid', true,
    'group_id', v_id,
    'display_name', v_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_invite_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_invite_code(text) TO anon, authenticated;

  'Resolve invite code to work group; each platform admin owns one group — user joins the group matching the code they enter at signup.';

NOTIFY pgrst, 'reload schema';
