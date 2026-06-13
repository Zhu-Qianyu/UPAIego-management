import { ROLE_LABELS } from "./roleLabels";
import type { UserRole } from "../types/roles";
import { isUserRole, NON_ADMIN_ROLES } from "../types/roles";

export const ACTIVE_ROLE_STORAGE_KEY = "upai:active-role";

const NAV_PRIORITY: UserRole[] = [
  "admin",
  "scene_operator",
  "device_operator",
  "collection_executor",
];

/** 按 NAV 优先级排序（admin 独占；写入 DB 前调用） */
export function sortRolesByPriority(roles: readonly UserRole[]): UserRole[] {
  if (roles.includes("admin")) return ["admin"];
  const unique = [...new Set(roles.filter((r) => r !== "admin"))];
  return unique.sort((a, b) => NAV_PRIORITY.indexOf(a) - NAV_PRIORITY.indexOf(b));
}

/** 从 DB roles 列或旧版 role 单列归一化 */
export function normalizeRoles(rawRoles: unknown, fallbackRole?: UserRole | null): UserRole[] {
  if (Array.isArray(rawRoles)) {
    const picked = rawRoles.map(String).filter(isUserRole);
    if (picked.includes("admin")) return ["admin"];
    const unique = [...new Set(picked.filter((r) => r !== "admin"))];
    if (unique.length) return sortRolesByPriority(unique);
  }
  if (typeof rawRoles === "string" && isUserRole(rawRoles)) {
    return rawRoles === "admin" ? ["admin"] : sortRolesByPriority([rawRoles]);
  }
  if (fallbackRole && isUserRole(fallbackRole)) {
    return fallbackRole === "admin" ? ["admin"] : sortRolesByPriority([fallbackRole]);
  }
  return ["device_operator"];
}

export function primaryRole(roles: UserRole[]): UserRole {
  if (!roles.length) return "device_operator";
  const sorted = [...roles].sort(
    (a, b) => NAV_PRIORITY.indexOf(a) - NAV_PRIORITY.indexOf(b)
  );
  return sorted[0];
}

export function hasRole(roles: readonly UserRole[] | null | undefined, role: UserRole): boolean {
  if (!roles?.length) return false;
  if (roles.includes("admin")) return role === "admin";
  return roles.includes(role);
}

export function hasAnyRole(
  roles: readonly UserRole[] | null | undefined,
  allow: readonly UserRole[]
): boolean {
  return allow.some((r) => hasRole(roles, r));
}

export function formatRolesLabel(roles: readonly UserRole[]): string {
  if (!roles.length) return "—";
  return roles.map((r) => ROLE_LABELS[r]).join("、");
}

export function readStoredActiveRole(): UserRole | null {
  try {
    const v = localStorage.getItem(ACTIVE_ROLE_STORAGE_KEY);
    return v && isUserRole(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeStoredActiveRole(role: UserRole | null): void {
  try {
    if (!role) localStorage.removeItem(ACTIVE_ROLE_STORAGE_KEY);
    else localStorage.setItem(ACTIVE_ROLE_STORAGE_KEY, role);
  } catch {
    /* ignore */
  }
}

export function resolveActiveRole(roles: UserRole[]): UserRole {
  if (roles.includes("admin")) return "admin";
  const stored = readStoredActiveRole();
  if (stored && hasRole(roles, stored)) return stored;
  return primaryRole(roles);
}

export function validateRegisterRoles(selected: UserRole[]): UserRole[] {
  if (selected.includes("admin")) return ["admin"];
  const ops = selected.filter((r): r is (typeof NON_ADMIN_ROLES)[number] =>
    NON_ADMIN_ROLES.includes(r as (typeof NON_ADMIN_ROLES)[number])
  );
  const unique = [...new Set(ops)];
  if (!unique.length) throw new Error("请至少选择一种职能");
  return sortRolesByPriority(unique);
}

const NAV_BY_ROLE: Record<UserRole, { to: string; label: string }[]> = {
  admin: [
    { to: "/admin", label: "管理台" },
    { to: "/group", label: "群组" },
    { to: "/devices/manage", label: "设备管理" },
    { to: "/scene", label: "场景业务" },
    { to: "/bounties", label: "悬赏令" },
    { to: "/map", label: "数采地图" },
  ],
  device_operator: [
    { to: "/", label: "设备总览" },
    { to: "/operator-work", label: "运维工作台" },
    { to: "/group", label: "群组" },
    { to: "/devices/manage", label: "设备管理" },
  ],
  scene_operator: [
    { to: "/scene", label: "场景业务" },
    { to: "/group", label: "群组" },
  ],
  collection_executor: [
    { to: "/map", label: "数采地图" },
    { to: "/", label: "设备总览" },
    { to: "/bounties", label: "悬赏令" },
    { to: "/wallet", label: "我的钱包" },
    { to: "/scene", label: "采集排班" },
    { to: "/group", label: "群组" },
  ],
};

/** 多职导航合并（按路径去重，按 NAV_PRIORITY 排序） */
export function navForRoles(roles: readonly UserRole[]): { to: string; label: string }[] {
  if (hasRole(roles, "admin")) return NAV_BY_ROLE.admin;
  const order = new Map<string, number>();
  const merged = new Map<string, { to: string; label: string }>();
  for (const role of NAV_PRIORITY) {
    if (!hasRole(roles, role)) continue;
    for (const item of NAV_BY_ROLE[role]) {
      if (!merged.has(item.to)) {
        merged.set(item.to, item);
        order.set(item.to, order.size);
      }
    }
  }
  return [...merged.values()].sort((a, b) => (order.get(a.to) ?? 0) - (order.get(b.to) ?? 0));
}

export function homePathForRoles(roles: readonly UserRole[], activeRole?: UserRole | null): string {
  const active = activeRole && hasRole(roles, activeRole) ? activeRole : resolveActiveRole([...roles]);
  if (active === "admin") return "/admin";
  if (active === "scene_operator") return "/scene";
  if (active === "collection_executor") return "/map";
  if (active === "device_operator") return "/";
  return "/";
}
