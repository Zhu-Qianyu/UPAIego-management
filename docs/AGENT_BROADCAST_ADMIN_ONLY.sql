-- 群发通知改为仅管理员可发起（移除场景业务员权限）
-- Run in Supabase SQL Editor as a single script.

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
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION '仅管理员可发起群发通知';
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

  INSERT INTO public.agent_inbox_messages (
    group_id, recipient_user_id, sender_user_id, broadcast_id, title, body, category
  )
  SELECT
    p_group_id, gm.user_id, v_uid, v_broadcast_id, v_title, v_body, v_category
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

  RETURN jsonb_build_object(
    'broadcast_id', v_broadcast_id,
    'sent_count', v_sent,
    'target_roles', to_jsonb(v_targets)
  );
END;
$$;
