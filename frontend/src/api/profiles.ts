import { supabase } from "./supabase";
import type { UserRole } from "../types/roles";
import { isUserRole } from "../types/roles";

export interface Profile {
  id: string;
  role: UserRole;
  display_name: string | null;
  real_name: string | null;
  phone: string | null;
  created_at: string;
}

export type ProfileContact = Pick<Profile, "id" | "real_name" | "phone" | "display_name" | "role">;

/** 批量读取用户资料（需 DB 策略允许，如同群 peer 策略） */
export async function fetchProfilesByIds(
  userIds: string[]
): Promise<ProfileContact[]> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, role, real_name, phone")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProfileContact[];
}

export function profileDisplayName(p: ProfileContact): string {
  return p.real_name?.trim() || p.display_name?.trim() || p.id.slice(0, 8);
}

/** 悬赏联系人、群内协作等要求已登记真名与手机 */
export function isProfileContactComplete(p: Pick<Profile, "real_name" | "phone"> | null): boolean {
  return Boolean(p?.real_name?.trim() && p?.phone?.trim());
}

export async function updateMyProfileContact(realName: string, phone: string): Promise<void> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");
  const name = realName.trim();
  const tel = phone.trim();
  if (!name) throw new Error("请填写真实姓名");
  if (!tel) throw new Error("请填写手机号");
  const { error } = await supabase
    .from("profiles")
    .update({ real_name: name, phone: tel, updated_at: new Date().toISOString() })
    .eq("id", u.id);
  if (error) throw new Error(error.message);
}

/** false = 库表尚无 real_name/phone 列（未跑迁移），不应拦截全站 */
export async function profileContactColumnsExist(): Promise<boolean> {
  const { error } = await supabase.from("profiles").select("real_name").limit(1);
  if (!error) return true;
  const msg = error.message ?? "";
  return !(error.code === "42703" || /real_name|does not exist|column/i.test(msg));
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, display_name, real_name, phone, created_at, updated_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    const msg = error.message ?? "";
    if (error.code === "42703" || /real_name|does not exist|column/i.test(msg)) {
      const { data: fallback, error: err2 } = await supabase
        .from("profiles")
        .select("id, role, display_name, created_at, updated_at")
        .eq("id", userId)
        .maybeSingle();
      if (err2) {
        console.error("fetchProfile", err2);
        return null;
      }
      if (!fallback?.role || !isUserRole(fallback.role)) return null;
      return { ...fallback, real_name: null, phone: null } as Profile;
    }
    console.error("fetchProfile", error);
    return null;
  }
  if (!data?.role || !isUserRole(data.role)) return null;
  return data as Profile;
}

/** Call after signup if DB trigger is not yet applied — inserts own profile once. */
export async function ensureProfileRow(
  userId: string,
  role: UserRole,
  contact?: { realName: string; phone: string }
): Promise<string | null> {
  const { error } = await supabase.from("profiles").upsert(
    {
      id: userId,
      role,
      real_name: contact?.realName.trim() ?? null,
      phone: contact?.phone.trim() ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) {
    console.error("ensureProfileRow", error);
    return error.message;
  }
  return null;
}
