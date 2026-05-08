import { supabase } from "./supabase";

export interface KpiRow {
  id: string;
  title: string;
  target_value: number | null;
  unit: string | null;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface AdminMessageRow {
  id: string;
  title: string;
  body: string;
  created_at: string;
  created_by: string | null;
}

export async function listKpis(): Promise<KpiRow[]> {
  const { data, error } = await supabase.from("admin_kpis").select("*").order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as KpiRow[];
}

export async function upsertKpi(row: {
  id?: string;
  title: string;
  target_value: number | null;
  unit: string | null;
  notes: string | null;
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
