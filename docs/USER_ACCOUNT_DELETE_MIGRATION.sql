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


REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;
