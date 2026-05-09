import { supabase } from "./supabase";
import type { UserRole } from "../types/roles";
import { isUserRole } from "../types/roles";

export interface Profile {
  id: string;
  role: UserRole;
  display_name: string | null;
  created_at: string;
}

/** 批量读取用户资料（需 DB 策略允许，如同群 peer 策略） */
export async function fetchProfilesByIds(
  userIds: string[]
): Promise<Pick<Profile, "id" | "display_name" | "role">[]> {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("profiles").select("id, display_name, role").in("id", ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as Pick<Profile, "id" | "display_name" | "role">[];
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) {
    console.error("fetchProfile", error);
    return null;
  }
  if (!data?.role || !isUserRole(data.role)) return null;
  return data as Profile;
}

/** Call after signup if DB trigger is not yet applied — inserts own profile once. */
export async function ensureProfileRow(userId: string, role: UserRole): Promise<string | null> {
  const { error } = await supabase.from("profiles").upsert(
    { id: userId, role, updated_at: new Date().toISOString() },
    { onConflict: "id" }
  );
  if (error) {
    console.error("ensureProfileRow", error);
    return error.message;
  }
  return null;
}
