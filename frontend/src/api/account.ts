import { supabase } from "./supabase";

/** 永久删除当前登录用户及数据库中级联数据；需服务器已部署 delete_own_account RPC */
export async function deleteOwnAccount(): Promise<void> {
  const { error } = await supabase.rpc("delete_own_account");
  if (error) throw error;
}
