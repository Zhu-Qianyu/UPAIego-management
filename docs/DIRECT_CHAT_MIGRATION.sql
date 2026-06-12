-- 同工作群 active 成员 1:1 私聊
-- 在自建 Supabase（CVM）执行
-- 若尚未执行，请先运行 docs/GROUP_CHAT_RLS_FIX.sql（含 user_is_active_group_member）

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

CREATE TABLE IF NOT EXISTS public.direct_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  user_low uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_conversations_users_ordered CHECK (user_low < user_high),
  CONSTRAINT direct_conversations_distinct_users CHECK (user_low <> user_high),
  UNIQUE (group_id, user_low, user_high)
);

CREATE INDEX IF NOT EXISTS idx_direct_conv_group_last
  ON public.direct_conversations (group_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.direct_conversations (id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  content text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_direct_msg_conv_created
  ON public.direct_messages (conversation_id, created_at ASC);

ALTER TABLE public.direct_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.direct_conversation_participant(p_conversation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
VOLATILE
AS $$
BEGIN
  IF p_conversation_id IS NULL OR auth.uid() IS NULL THEN RETURN false; END IF;
  PERFORM set_config('row_security', 'off', true);
  RETURN EXISTS (
    SELECT 1 FROM public.direct_conversations c
    WHERE c.id = p_conversation_id
      AND (c.user_low = auth.uid() OR c.user_high = auth.uid())
      AND public.user_is_active_group_member(c.group_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.direct_conversation_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.direct_conversation_participant(uuid) TO authenticated;

DROP POLICY IF EXISTS "dc_select_participant" ON public.direct_conversations;
DROP POLICY IF EXISTS "dc_insert_participant" ON public.direct_conversations;
DROP POLICY IF EXISTS "dc_update_participant" ON public.direct_conversations;

CREATE POLICY "dc_select_participant"
  ON public.direct_conversations FOR SELECT TO authenticated
  USING (
    (user_low = auth.uid() OR user_high = auth.uid())
    AND public.user_is_active_group_member(group_id)
  );

CREATE POLICY "dc_insert_participant"
  ON public.direct_conversations FOR INSERT TO authenticated
  WITH CHECK (
    (user_low = auth.uid() OR user_high = auth.uid())
    AND public.user_is_active_group_member(group_id)
    AND EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = direct_conversations.group_id
        AND gm.user_id IN (direct_conversations.user_low, direct_conversations.user_high)
        AND gm.membership_status = 'active'
    )
  );

CREATE POLICY "dc_update_participant"
  ON public.direct_conversations FOR UPDATE TO authenticated
  USING (
    (user_low = auth.uid() OR user_high = auth.uid())
    AND public.user_is_active_group_member(group_id)
  )
  WITH CHECK (
    (user_low = auth.uid() OR user_high = auth.uid())
    AND public.user_is_active_group_member(group_id)
  );

DROP POLICY IF EXISTS "dm_select_participant" ON public.direct_messages;
DROP POLICY IF EXISTS "dm_insert_participant" ON public.direct_messages;
DROP POLICY IF EXISTS "dm_update_read" ON public.direct_messages;

CREATE POLICY "dm_select_participant"
  ON public.direct_messages FOR SELECT TO authenticated
  USING (public.direct_conversation_participant(conversation_id));

CREATE POLICY "dm_insert_participant"
  ON public.direct_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_user_id = auth.uid()
    AND public.direct_conversation_participant(conversation_id)
  );

CREATE POLICY "dm_update_read"
  ON public.direct_messages FOR UPDATE TO authenticated
  USING (public.direct_conversation_participant(conversation_id))
  WITH CHECK (public.direct_conversation_participant(conversation_id));

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation(
  p_group_id uuid,
  p_other_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_low uuid;
  v_high uuid;
  v_id uuid;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION '未登录'; END IF;
  IF p_other_user_id IS NULL OR p_other_user_id = v_me THEN
    RAISE EXCEPTION '无效的私聊对象';
  END IF;
  IF NOT public.user_is_active_group_member(p_group_id) THEN
    RAISE EXCEPTION '非本群 active 成员';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = p_other_user_id
      AND gm.membership_status = 'active'
  ) THEN
    RAISE EXCEPTION '对方不是本群 active 成员';
  END IF;

  IF v_me < p_other_user_id THEN
    v_low := v_me;
    v_high := p_other_user_id;
  ELSE
    v_low := p_other_user_id;
    v_high := v_me;
  END IF;

  SELECT id INTO v_id
  FROM public.direct_conversations
  WHERE group_id = p_group_id AND user_low = v_low AND user_high = v_high;

  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.direct_conversations (group_id, user_low, user_high)
  VALUES (p_group_id, v_low, v_high)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.get_or_create_direct_conversation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_conversation(uuid, uuid) TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.direct_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.direct_messages TO authenticated;
