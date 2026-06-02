import { supabase } from "./supabase";
import type { UserRole } from "../types/roles";
import { isUserRole } from "../types/roles";

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
