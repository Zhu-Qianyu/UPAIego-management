-- 同工作群成员可互相读取 profiles（用于话题页展示群成员目录等）
-- 前置：已执行 docs/ROLE_SYSTEM_MIGRATION.sql
-- 在 Supabase SQL Editor 整段执行（可重复执行：先 DROP 再 CREATE）

DROP POLICY IF EXISTS "profiles_select_group_peers" ON public.profiles;

CREATE POLICY "profiles_select_group_peers"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.group_members me
      JOIN public.group_members peer
        ON peer.group_id = me.group_id
       AND peer.user_id = public.profiles.id
      WHERE me.user_id = auth.uid()
        AND me.membership_status = 'active'
    )
  );

-- 说明：与现有 profiles_select_self_or_admin 为并列 OR 关系，满足其一即可 SELECT。
