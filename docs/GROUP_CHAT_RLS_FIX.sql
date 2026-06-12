-- 群聊天 RLS 修复：active 成员可发言；bot/system 仅 RPC 写入
-- 在自建 Supabase（CVM）SQL Editor 或 psql 执行

CREATE OR REPLACE FUNCTION public.user_is_active_group_member(p_group_id uuid)
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
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
      AND gm.membership_status = 'active'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.user_is_active_group_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_is_active_group_member(uuid) TO authenticated;

DROP POLICY IF EXISTS "gcm_select_scope" ON public.group_chat_messages;
DROP POLICY IF EXISTS "gcm_insert_members" ON public.group_chat_messages;
DROP POLICY IF EXISTS "gcm_update_bot" ON public.group_chat_messages;

CREATE POLICY "gcm_select_scope"
  ON public.group_chat_messages FOR SELECT TO authenticated
  USING (
    public.user_is_active_group_member(group_id)
    OR public.current_profile_role() = 'admin'
    OR public.user_is_work_group_owner(group_id)
  );

CREATE POLICY "gcm_insert_members"
  ON public.group_chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    public.user_is_active_group_member(group_id)
    AND sender_type = 'user'
    AND sender_user_id = auth.uid()
    AND message_kind = 'chat'
  );

CREATE POLICY "gcm_update_bot"
  ON public.group_chat_messages FOR UPDATE TO authenticated
  USING (
    public.user_is_active_group_member(group_id)
    AND sender_type = 'bot'
  )
  WITH CHECK (public.user_is_active_group_member(group_id));

CREATE OR REPLACE FUNCTION public.insert_group_bot_message(
  p_group_id uuid,
  p_content text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS public.group_chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.group_chat_messages;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;
  IF NOT public.user_is_active_group_member(p_group_id) THEN
    RAISE EXCEPTION '非本群 active 成员，无法写入豆小秘回复';
  END IF;
  IF trim(coalesce(p_content, '')) = '' THEN
    RAISE EXCEPTION '内容不能为空';
  END IF;

  INSERT INTO public.group_chat_messages (
    group_id, sender_type, sender_user_id, content, message_kind, metadata
  ) VALUES (
    p_group_id, 'bot', NULL, left(trim(p_content), 16000), 'bot_action', coalesce(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.insert_group_bot_message(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.insert_group_bot_message(uuid, text, jsonb) TO authenticated;
