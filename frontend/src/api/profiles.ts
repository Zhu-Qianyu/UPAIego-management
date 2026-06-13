import { supabase } from "./supabase";
import type { UserRole } from "../types/roles";
import { isUserRole } from "../types/roles";
import { normalizeRoles, primaryRole } from "../auth/roleUtils";
import { isValidChinaMobile, normalizePhone } from "../utils/phoneAuth";

export interface Profile {
  id: string;
  /** 主职（与 roles[0] 同步，兼容旧逻辑） */
  role: UserRole;
  /** 身兼数职；admin 时仅为 ['admin'] */
  roles: UserRole[];
  display_name: string | null;
  real_name: string | null;
  phone: string | null;
  contact_email: string | null;
  created_at: string;
}

export type ProfileContact = Pick<Profile, "id" | "real_name" | "phone" | "display_name" | "role" | "roles">;

function parseProfileRow(data: Record<string, unknown>): Profile | null {
  const roleRaw = data.role;
  if (typeof roleRaw !== "string" || !isUserRole(roleRaw)) return null;
  const roles = normalizeRoles(data.roles, roleRaw);
  const role = primaryRole(roles);
  return {
    id: String(data.id),
    role,
    roles,
    display_name: (data.display_name as string | null) ?? null,
    real_name: (data.real_name as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
    contact_email: (data.contact_email as string | null) ?? null,
    created_at: String(data.created_at),
  };
}

const PROFILE_SELECT =
  "id, role, roles, display_name, real_name, phone, contact_email, created_at, updated_at";

/** 批量读取用户资料（需 DB 策略允许，如同群 peer 策略） */
export async function fetchProfilesByIds(userIds: string[]): Promise<ProfileContact[]> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("profiles").select(PROFILE_SELECT).in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => parseProfileRow(row as Record<string, unknown>))
    .filter((p): p is Profile => !!p)
    .map(({ id, role, roles, display_name, real_name, phone }) => ({
      id,
      role,
      roles,
      display_name,
      real_name,
      phone,
    }));
}

export function profileDisplayName(p: ProfileContact): string {
  return p.real_name?.trim() || p.display_name?.trim() || p.id.slice(0, 8);
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    const msg = error.message ?? "";
    if (error.code === "42703" || /roles|real_name|does not exist|column/i.test(msg)) {
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
      const roles = normalizeRoles(null, fallback.role);
      return {
        ...fallback,
        role: primaryRole(roles),
        roles,
        real_name: null,
        phone: null,
        contact_email: null,
      } as Profile;
    }
    console.error("fetchProfile", error);
    return null;
  }
  if (!data) return null;
  return parseProfileRow(data as Record<string, unknown>);
}

/** Call after signup if DB trigger is not yet applied — inserts own profile once. */
export async function ensureProfileRow(
  userId: string,
  roles: UserRole[],
  contact?: { realName?: string; phone?: string; contactEmail?: string }
): Promise<string | null> {
  const normalized = normalizeRoles(roles);
  const row: Record<string, unknown> = {
    id: userId,
    role: primaryRole(normalized),
    roles: normalized,
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

/** 平台管理员修改成员职能（非 admin 可多选） */
export async function adminUpdateMemberRoles(userId: string, roles: UserRole[]): Promise<void> {
  const normalized = normalizeRoles(roles);
  const { error } = await supabase
    .from("profiles")
    .update({
      role: primaryRole(normalized),
      roles: normalized,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw new Error(error.message);
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
