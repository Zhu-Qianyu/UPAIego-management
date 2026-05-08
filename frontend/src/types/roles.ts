/** Matches public.profiles.role CHECK constraint and Supabase user_metadata.role */
export const USER_ROLES = [
  "admin",
  "device_operator",
  "scene_operator",
  "collection_executor",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}
