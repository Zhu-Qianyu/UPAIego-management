CREATE TABLE IF NOT EXISTS public.agent_group_rules (
  group_id uuid PRIMARY KEY REFERENCES public.work_groups (id) ON DELETE CASCADE,
  rules_text text NOT NULL DEFAULT '' CHECK (char_length(rules_text) <= 12000),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_group_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_group_rules_select_members" ON public.agent_group_rules;
DROP POLICY IF EXISTS "agent_group_rules_admin_write" ON public.agent_group_rules;

CREATE POLICY "agent_group_rules_select_members"
  ON public.agent_group_rules FOR SELECT TO authenticated
  USING (public.policy_work_group_accessible(group_id));


CREATE OR REPLACE FUNCTION public.upsert_agent_group_rules(
  p_group_id uuid,
  p_mode text,
  p_content text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_uid uuid;
  v_mode text;
  v_content text;
  v_prev text;
  v_next text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  v_role := public.current_profile_role();
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION '仅管理员可更新本群豆小秘规定';
  END IF;

  IF NOT public.policy_work_group_accessible(p_group_id) THEN
    RAISE EXCEPTION '无权访问该工作群';
  END IF;

  v_mode := lower(trim(coalesce(p_mode, '')));
  IF v_mode NOT IN ('append', 'replace', 'clear') THEN
    RAISE EXCEPTION '无效模式，应为 append / replace / clear';
  END IF;

  v_content := left(trim(coalesce(p_content, '')), 4000);

  SELECT rules_text INTO v_prev FROM public.agent_group_rules WHERE group_id = p_group_id;
  v_prev := coalesce(v_prev, '');

  IF v_mode = 'clear' THEN
    v_next := '';
  ELSIF v_mode = 'replace' THEN
    IF v_content = '' THEN
      RAISE EXCEPTION 'replace 模式须提供规定正文';
    END IF;
    v_next := v_content;
  ELSE
    IF v_content = '' THEN
      RAISE EXCEPTION 'append 模式须提供要追加的规定';
    END IF;
    IF v_prev = '' THEN
      v_next := v_content;
    ELSE
      v_next := v_prev || E'\n' || v_content;
    END IF;
  END IF;

  IF char_length(v_next) > 12000 THEN
    RAISE EXCEPTION '群规定总长不得超过 12000 字';
  END IF;

  INSERT INTO public.agent_group_rules (group_id, rules_text, updated_by, updated_at)
  VALUES (p_group_id, v_next, v_uid, now())
  ON CONFLICT (group_id) DO UPDATE
  SET rules_text = EXCLUDED.rules_text,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'rules_length', char_length(v_next),
    'preview', left(v_next, 200)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_agent_group_rules(uuid, text, text) TO authenticated;

GRANT SELECT ON public.agent_group_rules TO authenticated;
