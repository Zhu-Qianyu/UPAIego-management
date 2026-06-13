import { supabase } from "./supabase";
import { fetchProfile } from "./profiles";
import { hasRole } from "../auth/roleUtils";
import type { SceneCategoryKey } from "../utils/sceneCategories";
import { isValidManualDevicePublicCode, normalizeManualDevicePublicCode } from "../utils/deviceCodePrefix";
import { isMissingColumnError } from "../utils/supabaseSchemaCompat";

const PD = "party_demands";
const PDMC = "party_demand_macro_caps";
const SP = "scenario_positions";
const SMS = "scene_macro_sites";
const STA = "scene_task_assignments";
export const SNAPSHOT_BUCKET = "scenario-workstation-snapshots";

async function requireAdminForPartyDemand(): Promise<void> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");
  const prof = await fetchProfile(u.id);
  if (!hasRole(prof?.roles, "admin")) {
    throw new Error("仅平台管理员可维护甲方业务");
  }
}

export interface PartyDemand {
  id: string;
  group_id: string;
  title: string;
  client_company: string | null;
  /** 甲方设备类型（与公司并列）；旧数据可能未回填 */
  device_type?: string | null;
  requirement_summary: string | null;
  device_snapshot_bucket: string | null;
  device_snapshot_path: string | null;
  total_hours_required: number | null;
  max_hours_per_scene: number;
  scene_categories: string[];
  /** 甲方结算单价（元/小时），用于管理员收入估算 */
  client_hourly_rate?: number | null;
  /** 离线设备登记编号前缀：同一甲方 4 位随机大写字母，如 SKAX */
  device_code_prefix?: string | null;
  created_by: string;
  created_at: string;
}

export interface SceneMacroSite {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  panorama_bucket: string | null;
  panorama_path: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  address_province: string;
  address_city: string;
  address_district: string;
  address_detail: string | null;
  created_by: string;
  created_at: string;
}

export interface ScenarioPosition {
  id: string;
  group_id: string;
  macro_scene_id: string | null;
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

export interface PartyDemandMacroCap {
  id: string;
  party_demand_id: string;
  macro_scene_id: string;
  approved_hours: number;
  created_at: string;
  updated_at: string;
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

export function formatPartyDemandMacroHoursSummary(caps: PartyDemandMacroCap[]): string {
  if (caps.length === 0) return "未配置大场景批复小时";
  const hours = caps.map((c) => c.approved_hours);
  const min = Math.min(...hours);
  const max = Math.max(...hours);
  const range = min === max ? `${min}h` : `${min}~${max}h`;
  return `${range}（${caps.length} 个大场景）`;
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
  device_type: string;
  device_snapshot_bucket: string;
  device_snapshot_path: string;
  total_hours_required: number | null;
  max_hours_per_scene: number;
  scene_categories: string[];
  requirement_summary?: string;
  client_hourly_rate?: number | null;
}): Promise<PartyDemand> {
  await requireAdminForPartyDemand();
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");
  const company = row.client_company.trim();
  const insertBase = {
    group_id: row.group_id,
    title: row.title.trim(),
    client_company: company,
    device_type: row.device_type.trim(),
    device_snapshot_bucket: row.device_snapshot_bucket,
    device_snapshot_path: row.device_snapshot_path,
    total_hours_required: row.total_hours_required,
    max_hours_per_scene: row.max_hours_per_scene,
    scene_categories: row.scene_categories,
    requirement_summary: row.requirement_summary?.trim() || null,
    created_by: u.id,
    client_hourly_rate: row.client_hourly_rate ?? null,
  };

  const { data, error } = await supabase.from(PD).insert(insertBase).select().single();
  if (error) throw new Error(error.message);
  return data as PartyDemand;
}

export type PartyDemandUpdatePatch = Partial<{
  title: string;
  client_company: string | null;
  device_type: string | null;
  requirement_summary: string | null;
  total_hours_required: number | null;
  max_hours_per_scene: number;
  scene_categories: string[];
  device_snapshot_bucket: string;
  device_snapshot_path: string;
  client_hourly_rate: number | null;
  device_code_prefix: string | null;
}>;

export async function updatePartyDemand(id: string, patch: PartyDemandUpdatePatch): Promise<void> {
  await requireAdminForPartyDemand();
  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) payload.title = patch.title.trim();
  if (patch.client_company !== undefined) {
    payload.client_company = patch.client_company === null ? null : patch.client_company.trim() || null;
  }
  if (patch.device_type !== undefined) {
    payload.device_type = patch.device_type === null ? null : patch.device_type.trim() || null;
  }
  if (patch.requirement_summary !== undefined) {
    payload.requirement_summary = patch.requirement_summary === null ? null : patch.requirement_summary.trim() || null;
  }
  if (patch.total_hours_required !== undefined) payload.total_hours_required = patch.total_hours_required;
  if (patch.max_hours_per_scene !== undefined) payload.max_hours_per_scene = patch.max_hours_per_scene;
  if (patch.scene_categories !== undefined) payload.scene_categories = patch.scene_categories;
  if (patch.device_snapshot_bucket !== undefined) payload.device_snapshot_bucket = patch.device_snapshot_bucket;
  if (patch.device_snapshot_path !== undefined) payload.device_snapshot_path = patch.device_snapshot_path;
  if (patch.client_hourly_rate !== undefined) payload.client_hourly_rate = patch.client_hourly_rate;
  if (Object.keys(payload).length === 0) return;
  let { error } = await supabase.from(PD).update(payload).eq("id", id);
  if (error && isMissingColumnError(error, "device_code_prefix") && "device_code_prefix" in payload) {
    const { device_code_prefix: _drop, ...rest } = payload;
    if (Object.keys(rest).length === 0) return;
    ({ error } = await supabase.from(PD).update(rest).eq("id", id));
  }
  if (error) throw new Error(error.message);
}

export async function deletePartyDemand(id: string): Promise<void> {
  await requireAdminForPartyDemand();
  const { error } = await supabase.from(PD).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePartyDemands(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await requireAdminForPartyDemand();
  const { error } = await supabase.from(PD).delete().in("id", ids);
  if (error) throw new Error(error.message);
}

export async function listPartyDemandMacroCapsForGroup(groupId: string): Promise<PartyDemandMacroCap[]> {
  const { data, error } = await supabase
    .from(PDMC)
    .select("*, party_demands!inner(group_id)")
    .eq("party_demands.group_id", groupId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const { party_demands: _pd, ...cap } = row as PartyDemandMacroCap & { party_demands?: unknown };
    return cap as PartyDemandMacroCap;
  });
}

export async function replacePartyDemandMacroCaps(
  partyDemandId: string,
  caps: { macro_scene_id: string; approved_hours: number }[]
): Promise<void> {
  await requireAdminForPartyDemand();
  const { error: delErr } = await supabase.from(PDMC).delete().eq("party_demand_id", partyDemandId);
  if (delErr) throw new Error(delErr.message);
  if (caps.length === 0) return;
  const { error } = await supabase.from(PDMC).insert(
    caps.map((c) => ({
      party_demand_id: partyDemandId,
      macro_scene_id: c.macro_scene_id,
      approved_hours: c.approved_hours,
    }))
  );
  if (error) throw new Error(error.message);
}

export async function listSceneMacroSites(groupId: string): Promise<SceneMacroSite[]> {
  const { data, error } = await supabase
    .from(SMS)
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SceneMacroSite[];
}

export async function createSceneMacroSite(row: {
  group_id: string;
  title: string;
  description?: string;
  panorama_path: string;
  contact_name: string;
  contact_phone: string;
  address_province: string;
  address_city: string;
  address_district: string;
  address_detail?: string;
}): Promise<SceneMacroSite> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");
  const { data, error } = await supabase
    .from(SMS)
    .insert({
      group_id: row.group_id,
      title: row.title.trim(),
      description: row.description?.trim() || null,
      panorama_path: row.panorama_path,
      panorama_bucket: SNAPSHOT_BUCKET,
      contact_name: row.contact_name.trim(),
      contact_phone: row.contact_phone.trim(),
      address_province: row.address_province.trim(),
      address_city: row.address_city.trim(),
      address_district: row.address_district.trim(),
      address_detail: row.address_detail?.trim() || null,
      created_by: u.id,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as SceneMacroSite;
}

export async function updateSceneMacroSite(
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    panorama_path: string;
    contact_name: string;
    contact_phone: string;
    address_province: string;
    address_city: string;
    address_district: string;
    address_detail: string | null;
  }>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) payload.title = patch.title.trim();
  if (patch.description !== undefined) {
    payload.description = patch.description === null ? null : patch.description.trim() || null;
  }
  if (patch.panorama_path !== undefined) {
    payload.panorama_path = patch.panorama_path;
    payload.panorama_bucket = SNAPSHOT_BUCKET;
  }
  if (patch.contact_name !== undefined) payload.contact_name = patch.contact_name.trim();
  if (patch.contact_phone !== undefined) payload.contact_phone = patch.contact_phone.trim();
  if (patch.address_province !== undefined) payload.address_province = patch.address_province.trim();
  if (patch.address_city !== undefined) payload.address_city = patch.address_city.trim();
  if (patch.address_district !== undefined) payload.address_district = patch.address_district.trim();
  if (patch.address_detail !== undefined) {
    payload.address_detail = patch.address_detail === null ? null : patch.address_detail.trim() || null;
  }
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase.from(SMS).update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteSceneMacroSite(id: string): Promise<void> {
  const { count, error: cErr } = await supabase
    .from(SP)
    .select("id", { count: "exact", head: true })
    .eq("macro_scene_id", id);
  if (cErr) throw new Error(cErr.message);
  if ((count ?? 0) > 0) {
    throw new Error("该大场景下仍有小岗位，请先删除或迁移小岗位");
  }
  const { error } = await supabase.from(SMS).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteSceneMacroSites(ids: string[]): Promise<void> {
  for (const id of ids) {
    await deleteSceneMacroSite(id);
  }
}

export function formatScenarioPositionLabel(
  pos: Pick<ScenarioPosition, "title" | "macro_scene_id">,
  macros: Map<string, SceneMacroSite> | SceneMacroSite[]
): string {
  const macroId = pos.macro_scene_id;
  if (!macroId) return pos.title;
  const macro = macros instanceof Map ? macros.get(macroId) : macros.find((m) => m.id === macroId);
  return macro ? `${macro.title} · ${pos.title}` : pos.title;
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

/** 上传新工位快照并尽力删除旧路径（编辑换图）。 */
export async function replaceWorkstationSnapshot(
  groupId: string,
  file: File,
  previousPath?: string | null
): Promise<{ path: string; bucket: string }> {
  const uploaded = await uploadWorkstationSnapshot(groupId, file);
  const prev = previousPath?.trim();
  if (prev && prev !== uploaded.path) {
    await supabase.storage.from(SNAPSHOT_BUCKET).remove([prev]);
  }
  return uploaded;
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

/** 大场景全景图：与工位快照同一 bucket。 */
export async function uploadMacroPanoramaSnapshot(
  groupId: string,
  file: File
): Promise<{ path: string; bucket: string }> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safe = ["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg";
  const name = `${groupId}/macro-panorama/${crypto.randomUUID()}.${safe}`;
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
  macro_scene_id: string;
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
      macro_scene_id: row.macro_scene_id,
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
    macro_scene_id?: string;
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
  if (patch.macro_scene_id !== undefined) payload.macro_scene_id = patch.macro_scene_id;
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
  const { data, error } = await supabase.from(SP).update(payload).eq("id", id).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("更新失败：无权限或记录不存在");
}

export async function deleteScenarioPosition(id: string): Promise<void> {
  const { error } = await supabase.from(SP).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteScenarioPositions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from(SP).delete().in("id", ids);
  if (error) throw new Error(error.message);
}

export async function syncSceneTaskAssignments(groupId: string): Promise<void> {
  const { error } = await supabase.rpc("sync_scene_task_assignments", { p_group_id: groupId });
  if (error) throw new Error(error.message);
}

/** 管理员：为本工作群每个尚无绑定任务的场景岗位插入一条草稿（RPC，见 docs/SCENE_TASKS_BATCH_GENERATION_MIGRATION.sql）。返回新建条数。 */
export async function batchGenerateSceneTasksForGroup(groupId: string): Promise<number> {
  const { data, error } = await supabase.rpc("batch_generate_scene_tasks_for_group", { p_group_id: groupId });
  if (error) throw new Error(error.message);
  return typeof data === "number" ? data : Number(data ?? 0);
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

const MTD = "manual_tracked_devices";

export const EXTERNAL_DEVICE_STATUSES = ["normal", "fault", "factory_repair"] as const;
export type ExternalDeviceStatus = (typeof EXTERNAL_DEVICE_STATUSES)[number];

export function isExternalDeviceStatus(v: string | null | undefined): v is ExternalDeviceStatus {
  return v !== undefined && v !== null && (EXTERNAL_DEVICE_STATUSES as readonly string[]).includes(v);
}

export function normalizeExternalDeviceStatus(v: string | null | undefined): ExternalDeviceStatus {
  if (isExternalDeviceStatus(v)) return v;
  return "normal";
}

export function labelExternalDeviceStatus(s: string | null | undefined): string {
  switch (normalizeExternalDeviceStatus(s)) {
    case "normal":
      return "正常";
    case "fault":
      return "异常";
    case "factory_repair":
      return "返厂维修";
    default:
      return "正常";
  }
}

/** 列表排序：数值越大越靠前（需关注）。 */
export function externalDeviceStatusAttentionRank(s: string | null | undefined): number {
  const x = normalizeExternalDeviceStatus(s);
  if (x === "factory_repair") return 3;
  if (x === "fault") return 2;
  return 1;
}

export type ManualTrackedPartyRow = {
  client_company: string | null;
  title: string;
  device_type?: string | null;
  device_code_prefix?: string | null;
};

export interface ManualTrackedDevice {
  id: string;
  group_id: string;
  party_demand_id: string;
  device_short_label: string;
  external_status: ExternalDeviceStatus;
  public_code: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  party_demands?: ManualTrackedPartyRow | ManualTrackedPartyRow[] | null;
}

export function formatManualTrackedDeviceLabel(d: ManualTrackedDevice): string {
  const raw = d.party_demands;
  const p = Array.isArray(raw) ? raw[0] : raw;
  const company = (p?.client_company || p?.title || "").trim() || "甲方";
  return `${company} · ${d.device_short_label.trim()}`;
}

export type ManualDevicePartyGroup = {
  partyDemandId: string;
  label: string;
  codePrefix: string | null;
  devices: ManualTrackedDevice[];
};

function partyDemandDisplayName(d: PartyDemand): string {
  return (d.client_company || d.title || "未命名").trim();
}

function resolvePartyCodePrefix(
  partyId: string,
  devices: ManualTrackedDevice[],
  demands: PartyDemand[]
): string | null {
  const pd = demands.find((d) => d.id === partyId);
  const fromDemand = pd?.device_code_prefix?.trim().toUpperCase();
  if (fromDemand && /^[A-Z]{4}$/.test(fromDemand)) return fromDemand;

  const sample = devices.find((d) => d.party_demand_id === partyId);
  if (!sample) return null;
  const m = /^([A-Z]{4})[0-9]{4}$/.exec(sample.public_code.trim().toUpperCase());
  return m ? m[1] : null;
}

/** 按甲方业务分组离线设备（列表展示用） */
export function groupManualTrackedDevicesByParty(
  devices: ManualTrackedDevice[],
  demands: PartyDemand[]
): ManualDevicePartyGroup[] {
  const byParty = new Map<string, ManualTrackedDevice[]>();
  for (const d of devices) {
    const list = byParty.get(d.party_demand_id) ?? [];
    list.push(d);
    byParty.set(d.party_demand_id, list);
  }

  const orderIds = demands.map((d) => d.id).filter((id) => byParty.has(id));
  for (const id of byParty.keys()) {
    if (!orderIds.includes(id)) orderIds.push(id);
  }

  return orderIds.map((partyDemandId) => {
    const pd = demands.find((d) => d.id === partyDemandId);
    const devs = [...(byParty.get(partyDemandId) ?? [])].sort((a, b) =>
      a.public_code.localeCompare(b.public_code)
    );
    const label = pd
      ? partyDemandDisplayName(pd)
      : formatManualTrackedDeviceLabel(devs[0]).split(" · ")[0] || "未命名甲方";
    return {
      partyDemandId,
      label,
      codePrefix: resolvePartyCodePrefix(partyDemandId, devices, demands),
      devices: devs,
    };
  });
}

export async function listManualTrackedDevices(groupId: string): Promise<ManualTrackedDevice[]> {
  const { data, error } = await supabase
    .from(MTD)
    .select("*, party_demands(client_company,title,device_type,device_code_prefix)")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ManualTrackedDevice[];
}

/** 当前账号在 RLS 下可见的全部离线设备登记（管理员 fleet 总览等）。 */
export async function listAllManualTrackedDevices(): Promise<ManualTrackedDevice[]> {
  const { data, error } = await supabase
    .from(MTD)
    .select("*, party_demands(client_company,title,device_type,device_code_prefix)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ManualTrackedDevice[];
}

function manualTrackedRowMatchesQuery(row: ManualTrackedDevice, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return false;
  if (row.public_code.toLowerCase().includes(n)) return true;
  if (row.id.toLowerCase().includes(n)) return true;
  if (row.device_short_label.toLowerCase().includes(n)) return true;
  if (formatManualTrackedDeviceLabel(row).toLowerCase().includes(n)) return true;
  if (labelExternalDeviceStatus(row.external_status).toLowerCase().includes(n)) return true;
  return false;
}

/** 按登记编号、系统 UUID、简称或展示类型筛选离线设备；fleet 为全量可见范围，own 为当前工作群。 */
export async function searchManualTrackedDevices(
  query: string,
  opts: { scope: "own" | "fleet"; groupId: string | null }
): Promise<ManualTrackedDevice[]> {
  const q = query.trim();
  if (!q) return [];
  let rows: ManualTrackedDevice[];
  if (opts.scope === "fleet") {
    rows = await listAllManualTrackedDevices();
  } else {
    if (!opts.groupId) return [];
    rows = await listManualTrackedDevices(opts.groupId);
  }
  return rows.filter((r) => manualTrackedRowMatchesQuery(r, q));
}

export async function getManualTrackedDeviceByPublicCode(publicCode: string): Promise<ManualTrackedDevice | null> {
  const code = normalizeManualDevicePublicCode(publicCode);
  if (!isValidManualDevicePublicCode(code)) return null;
  const { data, error } = await supabase
    .from(MTD)
    .select("*, party_demands(client_company,title,device_type,device_code_prefix)")
    .eq("public_code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as ManualTrackedDevice | null;
}

export async function createManualTrackedDevice(input: {
  group_id: string;
  party_demand_id: string;
  device_short_label: string;
}): Promise<ManualTrackedDevice> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");

  const { error: prefixErr } = await supabase.rpc("ensure_party_device_code_prefix", {
    p_party_demand_id: input.party_demand_id,
  });
  if (prefixErr && !/ensure_party_device_code_prefix|set_party_device_code_prefix/.test(prefixErr.message)) {
    throw new Error(prefixErr.message);
  }

  const { data, error } = await supabase
    .from(MTD)
    .insert({
      group_id: input.group_id,
      party_demand_id: input.party_demand_id,
      device_short_label: input.device_short_label.trim(),
      external_status: "normal",
      created_by: u.id,
    })
    .select("*, party_demands(client_company,title,device_type,device_code_prefix)")
    .single();
  if (error) throw new Error(error.message);
  return data as ManualTrackedDevice;
}

export async function updateManualTrackedDevice(
  id: string,
  patch: Partial<Pick<ManualTrackedDevice, "external_status" | "device_short_label">>
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.external_status !== undefined) {
    payload.external_status = normalizeExternalDeviceStatus(patch.external_status);
  }
  if (patch.device_short_label !== undefined) payload.device_short_label = patch.device_short_label.trim();
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase.from(MTD).update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}

function formatManualTrackedDeleteError(message: string): string {
  if (/foreign key|violates.*restrict|collection_shift_devices/i.test(message)) {
    return "该设备已被采集排班引用，请先关闭或删除相关排班后再删";
  }
  return message;
}

export async function deleteManualTrackedDevice(id: string): Promise<void> {
  const { data, error } = await supabase.from(MTD).delete().eq("id", id).select("id").maybeSingle();
  if (error) throw new Error(formatManualTrackedDeleteError(error.message));
  if (!data?.id) throw new Error("删除失败：无权限或设备不存在");
}

export async function deleteManualTrackedDevices(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return;

  let deleted = 0;
  const blocked: string[] = [];

  for (const id of unique) {
    const { data, error } = await supabase.from(MTD).delete().eq("id", id).select("id").maybeSingle();
    if (error) {
      blocked.push(formatManualTrackedDeleteError(error.message));
      continue;
    }
    if (data?.id) deleted += 1;
    else blocked.push("无删除权限或设备不存在");
  }

  if (deleted === 0) {
    const hint = blocked[0] ?? "未知原因";
    throw new Error(unique.length === 1 ? `删除失败：${hint}` : `批量删除失败：${hint}`);
  }
  if (deleted < unique.length) {
    throw new Error(`已删除 ${deleted} 台，另有 ${unique.length - deleted} 台未能删除（可能已被采集排班引用）`);
  }
}

/** 同一甲方业务批量登记离线设备（最多 50 台，共用设备简称，编号自动递增）。 */
export async function createManualTrackedDevicesBatch(input: {
  group_id: string;
  party_demand_id: string;
  device_short_label: string;
  count: number;
}): Promise<ManualTrackedDevice[]> {
  const n = Math.min(50, Math.max(1, Math.floor(input.count)));
  const created: ManualTrackedDevice[] = [];
  for (let i = 0; i < n; i++) {
    created.push(
      await createManualTrackedDevice({
        group_id: input.group_id,
        party_demand_id: input.party_demand_id,
        device_short_label: input.device_short_label,
      })
    );
  }
  return created;
}
