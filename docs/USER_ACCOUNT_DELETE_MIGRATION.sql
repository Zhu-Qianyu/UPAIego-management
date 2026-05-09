-- 用户自行注销：删除 auth 用户并级联清理业务数据。
-- 前置：已执行 docs/ROLE_SYSTEM_MIGRATION.sql 与 docs/GROUP_TOPICS_BUSINESS_MIGRATION.sql。
-- 在 Supabase SQL Editor 中整段执行。若报权限错误，请确认以有足够权限的角色执行（通常为 postgres）。

-- ---------------------------------------------------------------------------
-- 注销当前登录用户（仅可删自己）
-- ---------------------------------------------------------------------------
-- 说明：
-- - profiles / devices / scene_tasks / collection_requirements / work_groups（群主）等
--   对 auth.users 多为 ON DELETE CASCADE，删除用户即可级联。
-- - admin_kpis.updated_by、admin_messages.created_by、group_members.decided_by
--   默认无外键级联，需先置空以免阻塞 DELETE。
-- - Storage 桶内对象若需一并物理删除，请在 Dashboard Storage 或 Edge Function 中另行处理。

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  UPDATE public.admin_kpis SET updated_by = NULL WHERE updated_by = uid;
  UPDATE public.admin_messages SET created_by = NULL WHERE created_by = uid;
  UPDATE public.group_members SET decided_by = NULL WHERE decided_by = uid;

  DELETE FROM auth.users WHERE id = uid;
END;
$$;

-- 在 Dashboard SQL Editor 中创建时属主一般为 postgres，SECURITY DEFINER 即以该身份删除 auth 用户。
-- 若执行 DELETE 报权限错误，请联系项目管理员用具备 auth 写权限的角色部署本函数。

REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
