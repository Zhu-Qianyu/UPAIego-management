-- 允许用户更新自己的豆小秘聊天记录（持久化 pending 确认状态）
DROP POLICY IF EXISTS "agent_chat_update_own" ON public.agent_chat_messages;

CREATE POLICY "agent_chat_update_own"
  ON public.agent_chat_messages FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND public.policy_work_group_accessible(group_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.policy_work_group_accessible(group_id)
  );

GRANT UPDATE ON public.agent_chat_messages TO authenticated;
