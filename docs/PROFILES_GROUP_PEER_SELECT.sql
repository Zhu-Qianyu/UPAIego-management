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
