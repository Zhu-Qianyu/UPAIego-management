/** Matches public.profiles.role CHECK constraint and Supabase user_metadata.role */
export const USER_ROLES = [
  "admin",
  "device_operator",
  "scene_operator",
  "collection_executor",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** 可兼任的非管理员职能 */
export const NON_ADMIN_ROLES = ["device_operator", "scene_operator", "collection_executor"] as const;

export type OperativeRole = (typeof NON_ADMIN_ROLES)[number];

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

export function isOperativeRole(value: string): value is OperativeRole {
  return (NON_ADMIN_ROLES as readonly string[]).includes(value);
}
