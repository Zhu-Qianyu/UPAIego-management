import { supabase } from "./supabase";
import type { SceneCategoryKey } from "../utils/sceneCategories";

const PD = "party_demands";
const SP = "scenario_positions";
const STA = "scene_task_assignments";
export const SNAPSHOT_BUCKET = "scenario-workstation-snapshots";

export interface PartyDemand {
  id: string;
  group_id: string;
  title: string;
  client_company: string | null;
  requirement_summary: string | null;
  device_snapshot_bucket: string | null;
  device_snapshot_path: string | null;
  total_hours_required: number | null;
  max_hours_per_scene: number;
  scene_categories: string[];
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
  scene_categories: string[];
  address_province: string;
  address_city: string;
  address_district: string;
  address_detail: string | null;
  created_by: string;
  created_at: string;
}

export interface SceneTaskAssignment {
  id: string;
  scene_task_id: string;
  scenario_position_id: string;
  party_demand_id: string;
  max_hours_cap: number;
  executed_hours: number;
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
  client_company: string;
  device_snapshot_bucket: string;
  device_snapshot_path: string;
  total_hours_required: number | null;
  max_hours_per_scene: number;
  scene_categories: string[];
  requirement_summary?: string;
}): Promise<PartyDemand> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");
  const { data, error } = await supabase
    .from(PD)
    .insert({
      group_id: row.group_id,
      title: row.title.trim(),
      client_company: row.client_company.trim(),
      device_snapshot_bucket: row.device_snapshot_bucket,
      device_snapshot_path: row.device_snapshot_path,
      total_hours_required: row.total_hours_required,
      max_hours_per_scene: row.max_hours_per_scene,
      scene_categories: row.scene_categories,
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
  const name = `${groupId}/workstation/${crypto.randomUUID()}.${safe}`;
  const { error: upErr } = await supabase.storage.from(SNAPSHOT_BUCKET).upload(name, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (upErr) throw new Error(upErr.message);
  return { path: name, bucket: SNAPSHOT_BUCKET };
}

/** 甲方业务「设备快照」：与工位快照同一 bucket，路径前缀便于区分。 */
export async function uploadPartyDeviceSnapshot(
  groupId: string,
  file: File
): Promise<{ path: string; bucket: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safe = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  const name = `${groupId}/party-device/${crypto.randomUUID()}.${safe}`;
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
  scene_categories: SceneCategoryKey[];
  address_province: string;
  address_city: string;
  address_district: string;
  address_detail?: string;
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
      scene_categories: row.scene_categories,
      address_province: row.address_province.trim(),
      address_city: row.address_city.trim(),
      address_district: row.address_district.trim(),
      address_detail: row.address_detail?.trim() || null,
      created_by: u.id,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ScenarioPosition;
}

export async function updateScenarioPosition(
  id: string,
  patch: {
    title?: string;
    process_description?: string | null;
    scene_categories?: SceneCategoryKey[];
    address_province?: string;
    address_city?: string;
    address_district?: string;
    address_detail?: string | null;
    snapshot_path?: string;
  }
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) payload.title = patch.title.trim();
  if (patch.process_description !== undefined) {
    payload.process_description = patch.process_description === null ? null : patch.process_description.trim() || null;
  }
  if (patch.scene_categories !== undefined) payload.scene_categories = patch.scene_categories;
  if (patch.address_province !== undefined) payload.address_province = patch.address_province.trim();
  if (patch.address_city !== undefined) payload.address_city = patch.address_city.trim();
  if (patch.address_district !== undefined) payload.address_district = patch.address_district.trim();
  if (patch.address_detail !== undefined) {
    payload.address_detail = patch.address_detail === null ? null : patch.address_detail.trim() || null;
  }
  if (patch.snapshot_path !== undefined) {
    payload.snapshot_path = patch.snapshot_path;
    payload.snapshot_bucket = SNAPSHOT_BUCKET;
  }
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase.from(SP).update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteScenarioPosition(id: string): Promise<void> {
  const { error } = await supabase.from(SP).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function syncSceneTaskAssignments(groupId: string): Promise<void> {
  const { error } = await supabase.rpc("sync_scene_task_assignments", { p_group_id: groupId });
  if (error) throw new Error(error.message);
}

export async function listAssignmentsForSceneTask(sceneTaskId: string): Promise<SceneTaskAssignment[]> {
  const { data, error } = await supabase
    .from(STA)
    .select("*")
    .eq("scene_task_id", sceneTaskId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SceneTaskAssignment[];
}

/** 当前工作群下所有场景任务的子任务（一次查询，供任务列表卡片展示读条） */
export async function listAssignmentsForWorkGroup(groupId: string): Promise<SceneTaskAssignment[]> {
  const { data: tasks, error: e1 } = await supabase.from("scene_tasks").select("id").eq("group_id", groupId);
  if (e1) throw new Error(e1.message);
  const ids = (tasks ?? []).map((t: { id: string }) => t.id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from(STA).select("*").in("scene_task_id", ids).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SceneTaskAssignment[];
}

export async function updateAssignmentExecutedHours(id: string, executedHours: number): Promise<void> {
  const { error } = await supabase.from(STA).update({ executed_hours: executedHours }).eq("id", id);
  if (error) throw new Error(error.message);
}
