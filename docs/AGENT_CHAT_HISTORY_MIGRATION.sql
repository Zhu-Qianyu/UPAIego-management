CREATE TABLE IF NOT EXISTS public.agent_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.work_groups (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_chat_user_group
  ON public.agent_chat_messages (user_id, group_id, created_at ASC);

ALTER TABLE public.agent_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_chat_select_own" ON public.agent_chat_messages;
DROP POLICY IF EXISTS "agent_chat_insert_own" ON public.agent_chat_messages;
DROP POLICY IF EXISTS "agent_chat_delete_own" ON public.agent_chat_messages;

CREATE POLICY "agent_chat_select_own"
  ON public.agent_chat_messages FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND public.policy_work_group_accessible(group_id)
  );

CREATE POLICY "agent_chat_insert_own"
  ON public.agent_chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.policy_work_group_accessible(group_id)
  );

CREATE POLICY "agent_chat_delete_own"
  ON public.agent_chat_messages FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND public.policy_work_group_accessible(group_id)
  );

GRANT SELECT, INSERT, DELETE ON public.agent_chat_messages TO authenticated;
