-- 群聊天室：人类消息 + 豆小秘回复 + 群发公告同时间线
-- 在 Supabase SQL Editor 执行；并更新 send_agent_group_broadcast 写入聊天室

CREATE TABLE IF NOT EXISTS public.group_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('user', 'bot', 'system')),
  sender_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  content text NOT NULL,
  message_kind text NOT NULL DEFAULT 'chat'
    CHECK (message_kind IN ('chat', 'broadcast', 'system', 'bot_action')),
  reply_to_id uuid REFERENCES public.group_chat_messages (id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_chat_group_created
  ON public.group_chat_messages (group_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_group_chat_group_kind
  ON public.group_chat_messages (group_id, message_kind, created_at DESC);

ALTER TABLE public.group_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gcm_select_scope" ON public.group_chat_messages;
DROP POLICY IF EXISTS "gcm_insert_members" ON public.group_chat_messages;
DROP POLICY IF EXISTS "gcm_update_bot" ON public.group_chat_messages;

CREATE POLICY "gcm_select_scope"
  ON public.group_chat_messages FOR SELECT TO authenticated
  USING (
    group_id = public.user_active_group_id()
    OR public.current_profile_role() = 'admin'
  );

CREATE POLICY "gcm_insert_members"
  ON public.group_chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    group_id = public.user_active_group_id()
    AND public.user_active_group_id() IS NOT NULL
    AND (
      (
        sender_type = 'user'
        AND sender_user_id = auth.uid()
        AND message_kind = 'chat'
      )
      OR (
        sender_type = 'bot'
        AND sender_user_id IS NULL
        AND message_kind = 'bot_action'
      )
    )
  );

CREATE POLICY "gcm_update_bot"
  ON public.group_chat_messages FOR UPDATE TO authenticated
  USING (
    group_id = public.user_active_group_id()
    AND sender_type = 'bot'
  )
  WITH CHECK (group_id = public.user_active_group_id());


-- 群发时同步写入群聊天室公告气泡
CREATE OR REPLACE FUNCTION public.send_agent_group_broadcast(
  p_group_id uuid,
  p_title text,
  p_body text,
  p_target_roles text[] DEFAULT NULL,
  p_category text DEFAULT 'notice'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_uid uuid;
  v_broadcast_id uuid := gen_random_uuid();
  v_title text;
  v_body text;
  v_category text;
  v_targets text[];
  v_sent integer := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  v_role := public.current_profile_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION '无用户角色';
  END IF;

  IF NOT public.policy_work_group_accessible(p_group_id) THEN
    RAISE EXCEPTION '无权访问该工作群';
  END IF;

  v_title := left(trim(coalesce(p_title, '')), 120);
  v_body := left(trim(coalesce(p_body, '')), 4000);
  IF v_title = '' OR v_body = '' THEN
    RAISE EXCEPTION '标题与正文不能为空';
  END IF;

  v_category := coalesce(nullif(trim(p_category), ''), 'notice');
  IF v_category NOT IN ('notice', 'task', 'workflow', 'holiday') THEN
    v_category := 'notice';
  END IF;

  IF p_target_roles IS NULL OR array_length(p_target_roles, 1) IS NULL THEN
    v_targets := ARRAY['admin', 'device_operator', 'scene_operator', 'collection_executor'];
  ELSE
    v_targets := ARRAY(
      SELECT DISTINCT r
      FROM unnest(p_target_roles) AS r
      WHERE r IN ('admin', 'device_operator', 'scene_operator', 'collection_executor', 'all')
    );
    IF 'all' = ANY (v_targets) OR array_length(v_targets, 1) IS NULL THEN
      v_targets := ARRAY['admin', 'device_operator', 'scene_operator', 'collection_executor'];
    END IF;
  END IF;

  IF v_role = 'admin' THEN
    NULL;
  ELSIF v_role = 'scene_operator' THEN
    IF v_targets <> ARRAY['collection_executor']::text[] THEN
      RAISE EXCEPTION '场景业务员仅可向数采执行员群发通知';
    END IF;
  ELSE
    RAISE EXCEPTION '仅管理员或场景业务员可发起群发';
  END IF;

  INSERT INTO public.agent_inbox_messages (
    group_id,
    recipient_user_id,
    sender_user_id,
    broadcast_id,
    title,
    body,
    category
  )
  SELECT
    p_group_id,
    gm.user_id,
    v_uid,
    v_broadcast_id,
    v_title,
    v_body,
    v_category
  FROM public.group_members gm
  JOIN public.profiles p ON p.id = gm.user_id
  WHERE gm.group_id = p_group_id
    AND gm.membership_status = 'active'
    AND p.role = ANY (v_targets)
    AND gm.user_id <> v_uid;

  GET DIAGNOSTICS v_sent = ROW_COUNT;

  IF v_role = ANY (v_targets) AND NOT EXISTS (
    SELECT 1 FROM public.agent_inbox_messages m
    WHERE m.broadcast_id = v_broadcast_id AND m.recipient_user_id = v_uid
  ) THEN
    INSERT INTO public.agent_inbox_messages (
      group_id, recipient_user_id, sender_user_id, broadcast_id, title, body, category
    ) VALUES (
      p_group_id, v_uid, v_uid, v_broadcast_id, v_title, v_body, v_category
    );
    v_sent := v_sent + 1;
  END IF;

  IF to_regclass('public.group_chat_messages') IS NOT NULL THEN
    INSERT INTO public.group_chat_messages (
      group_id,
      sender_type,
      sender_user_id,
      content,
      message_kind,
      metadata
    ) VALUES (
      p_group_id,
      'system',
      v_uid,
      v_title || E'\n\n' || v_body,
      'broadcast',
      jsonb_build_object(
        'broadcast_title', v_title,
        'broadcast_body', v_body,
        'broadcast_id', v_broadcast_id,
        'broadcast_category', v_category,
        'target_roles', to_jsonb(v_targets)
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'broadcast_id', v_broadcast_id,
    'sent_count', v_sent,
    'target_roles', to_jsonb(v_targets)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.send_agent_group_broadcast(uuid, text, text, text[], text) TO authenticated;

-- Realtime（若 Dashboard 已开 Realtime，执行本句；否则在 Database → Replication 勾选 group_chat_messages）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.group_chat_messages;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;
