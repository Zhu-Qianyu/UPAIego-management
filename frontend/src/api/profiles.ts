import { supabase } from "./supabase";
import type { UserRole } from "../types/roles";
import { isUserRole } from "../types/roles";
import { isValidChinaMobile, normalizePhone } from "../utils/phoneAuth";

export interface Profile {
  id: string;
  role: UserRole;
  display_name: string | null;
  real_name: string | null;
  phone: string | null;
  contact_email: string | null;
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

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, display_name, real_name, phone, contact_email, created_at, updated_at")
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
      return { ...fallback, real_name: null, phone: null, contact_email: null } as Profile;
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
  contact?: { realName?: string; phone?: string; contactEmail?: string }
): Promise<string | null> {
  const row: Record<string, unknown> = {
    id: userId,
    role,
    updated_at: new Date().toISOString(),
  };
  if (contact?.realName?.trim()) row.real_name = contact.realName.trim();
  if (contact?.phone?.trim()) row.phone = contact.phone.trim();
  if (contact?.contactEmail?.trim()) row.contact_email = contact.contactEmail.trim();
  const { error } = await supabase.from("profiles").upsert(row, { onConflict: "id" });
  if (error) {
    console.error("ensureProfileRow", error);
    return error.message;
  }
  return null;
}

export interface ProfileUpdateInput {
  realName?: string;
  displayName?: string;
  phone?: string;
  contactEmail?: string;
}

export async function updateMyProfile(input: ProfileUpdateInput): Promise<void> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");
  const payload: Record<string, string | null> = {
    updated_at: new Date().toISOString(),
  };
  if (input.realName !== undefined) payload.real_name = input.realName.trim() || null;
  if (input.displayName !== undefined) payload.display_name = input.displayName.trim() || null;
  if (input.phone !== undefined) {
    const p = input.phone.trim();
    if (p && !isValidChinaMobile(p)) throw new Error("手机号须为 11 位中国大陆号码");
    payload.phone = p ? normalizePhone(p) : null;
  }
  if (input.contactEmail !== undefined) {
    const e = input.contactEmail.trim();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error("联系邮箱格式不正确");
    payload.contact_email = e || null;
  }
  const { error } = await supabase.from("profiles").update(payload).eq("id", u.id);
  if (error) throw new Error(error.message);
}

export async function updateMyAuthEmail(newEmail: string): Promise<void> {
  const email = newEmail.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("登录邮箱格式不正确");
  const { error } = await supabase.auth.updateUser({ email });
  if (error) throw new Error(error.message);
}

export async function updateMyPassword(newPassword: string): Promise<void> {
  if (newPassword.length < 6) throw new Error("密码至少 6 位");
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}
