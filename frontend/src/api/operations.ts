import { supabase } from "./supabase";

const PD = "party_demands";
const SP = "scenario_positions";
export const SNAPSHOT_BUCKET = "scenario-workstation-snapshots";

export interface PartyDemand {
  id: string;
  group_id: string;
  title: string;
  client_company: string | null;
  requirement_summary: string | null;
  created_by: string;
  created_at: string;
}

export interface ScenarioPosition {
  id: string;
  group_id: string;
  party_demand_id: string | null;
  title: string;
  process_description: string | null;
  snapshot_bucket: string;
  snapshot_path: string;
  created_by: string;
  created_at: string;
}

export async function listPartyDemands(groupId: string): Promise<PartyDemand[]> {
  const { data, error } = await supabase
    .from(PD)
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PartyDemand[];
}

export async function createPartyDemand(row: {
  group_id: string;
  title: string;
  client_company?: string;
  requirement_summary?: string;
}): Promise<PartyDemand> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");
  const { data, error } = await supabase
    .from(PD)
    .insert({
      group_id: row.group_id,
      title: row.title.trim(),
      client_company: row.client_company?.trim() || null,
      requirement_summary: row.requirement_summary?.trim() || null,
      created_by: u.id,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as PartyDemand;
}

export async function deletePartyDemand(id: string): Promise<void> {
  const { error } = await supabase.from(PD).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listScenarioPositions(groupId: string): Promise<ScenarioPosition[]> {
  const { data, error } = await supabase
    .from(SP)
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ScenarioPosition[];
}

export async function uploadWorkstationSnapshot(
  groupId: string,
  file: File
): Promise<{ path: string; bucket: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safe = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  const name = `${groupId}/${crypto.randomUUID()}.${safe}`;
  const { error: upErr } = await supabase.storage.from(SNAPSHOT_BUCKET).upload(name, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (upErr) throw new Error(upErr.message);
  return { path: name, bucket: SNAPSHOT_BUCKET };
}

export async function getSnapshotPublicUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from(SNAPSHOT_BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function createScenarioPosition(row: {
  group_id: string;
  title: string;
  process_description?: string;
  party_demand_id?: string | null;
  snapshot_path: string;
}): Promise<ScenarioPosition> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");
  const { data, error } = await supabase
    .from(SP)
    .insert({
      group_id: row.group_id,
      title: row.title.trim(),
      process_description: row.process_description?.trim() || null,
      party_demand_id: row.party_demand_id ?? null,
      snapshot_path: row.snapshot_path,
      snapshot_bucket: SNAPSHOT_BUCKET,
      created_by: u.id,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ScenarioPosition;
}

export async function deleteScenarioPosition(id: string): Promise<void> {
  const { error } = await supabase.from(SP).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
