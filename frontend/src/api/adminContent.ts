import { supabase } from "./supabase";

/** KPI 只下发给这三种角色（管理员在管理台配置，不占用 target_role） */
export type KpiTargetRole = "device_operator" | "scene_operator" | "collection_executor";

export interface KpiRow {
  id: string;
  title: string;
  target_value: number | null;
  unit: string | null;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
  target_role: KpiTargetRole;
  valid_from: string | null;
  valid_until: string | null;
}

export function isKpiActiveAt(k: KpiRow, at: Date = new Date()): boolean {
  if (k.valid_from) {
    const from = new Date(k.valid_from);
    if (Number.isFinite(from.getTime()) && at < from) return false;
  }
  if (k.valid_until) {
    const until = new Date(k.valid_until);
    if (Number.isFinite(until.getTime()) && at > until) return false;
  }
  return true;
}

export interface AdminMessageRow {
  id: string;
  title: string;
  body: string;
  created_at: string;
  created_by: string | null;
}

export async function listKpis(): Promise<KpiRow[]> {
  const { data, error } = await supabase
    .from("admin_kpis")
    .select("*")
    .order("target_role", { ascending: true })
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as KpiRow[];
}

/** 某角色当前处于有效期内的 KPI（用于顶部展示） */
export async function listActiveKpisForRole(role: KpiTargetRole): Promise<KpiRow[]> {
  const { data, error } = await supabase
    .from("admin_kpis")
    .select("*")
    .eq("target_role", role)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as KpiRow[];
  return rows.filter((k) => isKpiActiveAt(k));
}

export async function upsertKpi(row: {
  id?: string;
  title: string;
  target_value: number | null;
  unit: string | null;
  notes: string | null;
  target_role: KpiTargetRole;
  valid_from: string | null;
  valid_until: string | null;
}): Promise<void> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error("未登录");
  const payload = {
    ...row,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("admin_kpis").upsert(payload);
  if (error) throw new Error(error.message);
}

export async function deleteKpi(id: string): Promise<void> {
  const { error } = await supabase.from("admin_kpis").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listAdminMessages(limit = 50): Promise<AdminMessageRow[]> {
  const { data, error } = await supabase
    .from("admin_messages")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as AdminMessageRow[];
}

export async function createAdminMessage(title: string, body: string): Promise<void> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error("未登录");
  const { error } = await supabase.from("admin_messages").insert({
    title,
    body,
    created_by: user.id,
  });
  if (error) throw new Error(error.message);
}
