import { supabase } from "./supabase";
import type { UserRole } from "../types/roles";
import { isUserRole } from "../types/roles";

export interface Profile {
  id: string;
  role: UserRole;
  display_name: string | null;
  created_at: string;
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
export async function ensureProfileRow(userId: string, role: UserRole): Promise<void> {
  const { error } = await supabase.from("profiles").upsert(
    { id: userId, role, updated_at: new Date().toISOString() },
    { onConflict: "id" }
  );
  if (error) console.error("ensureProfileRow", error);
}
