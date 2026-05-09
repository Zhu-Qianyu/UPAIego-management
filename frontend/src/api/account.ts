import { supabase } from "./supabase";

/** 永久删除当前登录用户及数据库中级联数据；需先在 Supabase 执行 USER_ACCOUNT_DELETE_MIGRATION.sql */
export async function deleteOwnAccount(): Promise<void> {
  const { error } = await supabase.rpc("delete_own_account");
  if (error) throw error;
}
