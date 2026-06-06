import { registerDevice } from "./client";
import { publishBounty } from "./bounties";
import {
  createCollectionShift,
  publishCollectionShift,
} from "./collectionShifts";
import { createGroupTopic } from "./groups";
import {
  createManualTrackedDevice,
  createPartyDemand,
  createScenarioPosition,
  createSceneMacroSite,
  listPartyDemands,
  listSceneMacroSites,
  listScenarioPositions,
  updatePartyDemand,
  updateScenarioPosition,
  updateSceneMacroSite,
  uploadMacroPanoramaSnapshot,
  uploadPartyDeviceSnapshot,
  uploadWorkstationSnapshot,
} from "./operations";
import { updateMyProfile } from "./profiles";
import type { AgentFormKind, AgentPendingFormFill } from "../aitebot/agentFormTypes";
import { formRequiresImage, getFormImageUploadLabel } from "../aitebot/agentFormImages";
import { defaultLabelPrefix } from "../aitebot/formFillInferShared";
import { SCENE_CATEGORY_KEYS, type SceneCategoryKey } from "../utils/sceneCategories";
import type { UserRole } from "../types/roles";

export type AgentFormFillResult = {
  ok: boolean;
  summary?: string;
  error?: string;
  created_id?: string;
};

const FORM_ROLES: Record<string, UserRole[]> = {
  party_demand_create: ["admin", "scene_operator"],
  party_demand_update: ["admin", "scene_operator"],
  scene_macro_create: ["admin", "scene_operator"],
  scene_macro_update: ["admin", "scene_operator"],
  scenario_position_create: ["admin", "scene_operator"],
  scenario_position_update: ["admin", "scene_operator"],
  group_topic_create: ["admin", "scene_operator", "device_operator", "collection_executor"],
  manual_device_create: ["admin", "device_operator"],
  manual_devices_batch_create: ["admin", "device_operator"],
  collection_shift_create: ["admin", "scene_operator"],
  profile_update: ["admin", "scene_operator", "device_operator", "collection_executor"],
  bounty_publish: ["admin"],
  device_register: ["admin", "device_operator"],
};


function normalizeCategories(raw: unknown): SceneCategoryKey[] {
  if (!Array.isArray(raw)) return ["industrial"];
  const out = raw
    .map((c) => String(c).trim())
    .filter((c): c is SceneCategoryKey => (SCENE_CATEGORY_KEYS as readonly string[]).includes(c));
  return out.length ? out : ["industrial"];
}

function str(data: Record<string, unknown>, key: string, required = false): string {
  const v = String(data[key] ?? "").trim();
  if (required && !v) throw new Error(`缺少字段 ${key}`);
  return v;
}

function num(data: Record<string, unknown>, key: string, required = false): number {
  const n = Number(data[key]);
  if (!Number.isFinite(n)) {
    if (required) throw new Error(`缺少或无效数字 ${key}`);
    return 0;
  }
  return n;
}

function optionalStr(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  if (v == null || v === "") return null;
  return String(v).trim() || null;
}

function optionalNum(data: Record<string, unknown>, key: string): number | null {
  if (data[key] == null || data[key] === "") return null;
  const n = Number(data[key]);
  return Number.isFinite(n) ? n : null;
}

export function normalizePendingFormFills(raw: unknown, role: UserRole): AgentPendingFormFill[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentPendingFormFill[] = [];
  for (const item of raw.slice(0, 3)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const form = String(o.form ?? "").trim() as AgentFormKind;
    const allowed = FORM_ROLES[form];
    if (!allowed?.includes(role)) continue;
    const label = String(o.label ?? "").trim();
    if (!label) continue;
    const data = o.data && typeof o.data === "object" ? (o.data as Record<string, unknown>) : null;
    if (!data) continue;
    const target_id = o.target_id != null ? String(o.target_id).trim() : undefined;
    out.push({ form, label, target_id: target_id || undefined, data });
  }
  return out;
}

function resolveFormImageFile(spec: AgentPendingFormFill, imageFile?: File): File {
  if (!formRequiresImage(spec.form)) {
    if (imageFile) return imageFile;
    throw new Error("此表单不需要图片");
  }
  if (!imageFile) {
    throw new Error(`请先上传${getFormImageUploadLabel(spec.form)}`);
  }
  return imageFile;
}

async function resolvePartyDemandId(
  groupId: string,
  d: Record<string, unknown>
): Promise<string> {
  const explicit = optionalStr(d, "party_demand_id");
  if (explicit) return explicit;

  const company = str(d, "client_company", true);
  const deviceType = optionalStr(d, "device_type");
  const demands = await listPartyDemands(groupId);

  const exact = demands.find(
    (p) => p.client_company?.trim() === company || p.title?.trim() === company
  );
  if (exact) return exact.id;

  const fuzzy = demands.filter((p) => {
    const cc = (p.client_company || p.title || "").trim();
    if (!cc) return false;
    if (!(cc.includes(company) || company.includes(cc))) return false;
    if (deviceType && p.device_type) {
      const dt = p.device_type.trim();
      if (!(dt.includes(deviceType) || deviceType.includes(dt))) return false;
    }
    return true;
  });
  if (fuzzy.length >= 1) return fuzzy[0].id;

  throw new Error(`未找到甲方「${company}」。请先说「添加甲方业务，${company}」并完成选图确认后再登记设备。`);
}

export async function executeAgentFormFill(
  groupId: string,
  role: UserRole,
  spec: AgentPendingFormFill,
  imageFile?: File
): Promise<AgentFormFillResult> {
  const allowed = FORM_ROLES[spec.form];
  if (!allowed?.includes(role)) {
    return { ok: false, error: "当前角色无权执行此表单操作" };
  }

  try {
    const d = spec.data;
    switch (spec.form) {
      case "party_demand_create": {
        const client_company = str(d, "client_company", true);
        const device_type = str(d, "device_type") || "通用设备";
        const max_hours_per_scene = Math.max(1, Math.floor(num(d, "max_hours_per_scene") || 8));
        const scene_categories = normalizeCategories(d.scene_categories);
        const unlimited = d.total_hours_unlimited === true || d.total_hours_unlimited === "true";
        const total_hours_required = unlimited ? null : Math.max(0, Math.floor(num(d, "total_hours_required", !unlimited)));
        const file = resolveFormImageFile(spec, imageFile);
        const { path, bucket } = await uploadPartyDeviceSnapshot(groupId, file);
        const created = await createPartyDemand({
          group_id: groupId,
          title: client_company,
          client_company,
          device_type,
          device_snapshot_bucket: bucket,
          device_snapshot_path: path,
          max_hours_per_scene,
          scene_categories,
          total_hours_required,
          requirement_summary: optionalStr(d, "requirement_summary") ?? undefined,
          client_hourly_rate: optionalNum(d, "client_hourly_rate"),
        });
        return { ok: true, summary: `已创建甲方业务「${created.client_company}」`, created_id: created.id };
      }
      case "party_demand_update": {
        const id = spec.target_id?.trim();
        if (!id) throw new Error("缺少 target_id");
        const patch: Parameters<typeof updatePartyDemand>[1] = {};
        if (d.client_company != null) {
          const cc = str(d, "client_company");
          patch.client_company = cc;
          patch.title = cc;
        }
        if (d.device_type != null) patch.device_type = str(d, "device_type");
        if (d.max_hours_per_scene != null) patch.max_hours_per_scene = Math.floor(num(d, "max_hours_per_scene"));
        if (d.scene_categories != null) patch.scene_categories = normalizeCategories(d.scene_categories);
        if (d.total_hours_unlimited === true || d.total_hours_unlimited === "true") patch.total_hours_required = null;
        else if (d.total_hours_required != null) patch.total_hours_required = Math.floor(num(d, "total_hours_required"));
        if (d.requirement_summary !== undefined) patch.requirement_summary = optionalStr(d, "requirement_summary");
        if (d.client_hourly_rate !== undefined) patch.client_hourly_rate = optionalNum(d, "client_hourly_rate");
        await updatePartyDemand(id, patch);
        return { ok: true, summary: "已更新甲方业务" };
      }
      case "scene_macro_create": {
        const file = resolveFormImageFile(spec, imageFile);
        const { path } = await uploadMacroPanoramaSnapshot(groupId, file);
        const created = await createSceneMacroSite({
          group_id: groupId,
          title: str(d, "title", true),
          panorama_path: path,
          contact_name: str(d, "contact_name", true),
          contact_phone: str(d, "contact_phone", true),
          address_province: str(d, "address_province", true) || "待补充",
          address_city: str(d, "address_city", true) || "待补充",
          address_district: str(d, "address_district", true) || "待补充",
          description: optionalStr(d, "description") ?? undefined,
          address_detail: optionalStr(d, "address_detail") ?? undefined,
        });
        return { ok: true, summary: `已创建大场景「${created.title}」`, created_id: created.id };
      }
      case "scene_macro_update": {
        const id = spec.target_id?.trim();
        if (!id) throw new Error("缺少 target_id");
        await updateSceneMacroSite(id, {
          title: d.title != null ? str(d, "title") : undefined,
          contact_name: d.contact_name != null ? str(d, "contact_name") : undefined,
          contact_phone: d.contact_phone != null ? str(d, "contact_phone") : undefined,
          address_province: d.address_province != null ? str(d, "address_province") : undefined,
          address_city: d.address_city != null ? str(d, "address_city") : undefined,
          address_district: d.address_district != null ? str(d, "address_district") : undefined,
          description: d.description !== undefined ? optionalStr(d, "description") : undefined,
          address_detail: d.address_detail !== undefined ? optionalStr(d, "address_detail") : undefined,
        });
        return { ok: true, summary: "已更新大场景" };
      }
      case "scenario_position_create": {
        const macroId = str(d, "macro_scene_id", true);
        const file = resolveFormImageFile(spec, imageFile);
        const { path } = await uploadWorkstationSnapshot(groupId, file);
        const created = await createScenarioPosition({
          group_id: groupId,
          macro_scene_id: macroId,
          title: str(d, "title", true),
          snapshot_path: path,
          scene_categories: normalizeCategories(d.scene_categories),
          address_province: str(d, "address_province", true) || "待补充",
          address_city: str(d, "address_city", true) || "待补充",
          address_district: str(d, "address_district", true) || "待补充",
          process_description: optionalStr(d, "process_description") ?? undefined,
          address_detail: optionalStr(d, "address_detail") ?? undefined,
        });
        return { ok: true, summary: `已创建小岗位「${created.title}」`, created_id: created.id };
      }
      case "scenario_position_update": {
        const id = spec.target_id?.trim();
        if (!id) throw new Error("缺少 target_id");
        await updateScenarioPosition(id, {
          macro_scene_id: d.macro_scene_id != null ? str(d, "macro_scene_id") : undefined,
          title: d.title != null ? str(d, "title") : undefined,
          scene_categories: d.scene_categories != null ? normalizeCategories(d.scene_categories) : undefined,
          address_province: d.address_province != null ? str(d, "address_province") : undefined,
          address_city: d.address_city != null ? str(d, "address_city") : undefined,
          address_district: d.address_district != null ? str(d, "address_district") : undefined,
          process_description: d.process_description !== undefined ? optionalStr(d, "process_description") : undefined,
          address_detail: d.address_detail !== undefined ? optionalStr(d, "address_detail") : undefined,
        });
        return { ok: true, summary: "已更新小岗位" };
      }
      case "group_topic_create": {
        const created = await createGroupTopic(groupId, str(d, "title", true), optionalStr(d, "body") ?? "");
        return { ok: true, summary: `已发布群话题「${created.title}」`, created_id: created.id };
      }
      case "manual_device_create": {
        const partyId =
          optionalStr(d, "party_demand_id") ?? (await resolvePartyDemandId(groupId, d));
        const created = await createManualTrackedDevice({
          group_id: groupId,
          party_demand_id: partyId,
          device_short_label: str(d, "device_short_label", true),
        });
        return {
          ok: true,
          summary: `已登记离线设备「${created.device_short_label}」编号 ${created.public_code}`,
          created_id: created.id,
        };
      }
      case "manual_devices_batch_create": {
        const count = Math.min(50, Math.max(1, Math.floor(num(d, "count", true))));
        const partyId = await resolvePartyDemandId(groupId, d);
        const deviceType = optionalStr(d, "device_type");
        const prefix =
          optionalStr(d, "label_prefix") || (deviceType ? defaultLabelPrefix(deviceType) : "设备");
        const codes: string[] = [];
        for (let i = 1; i <= count; i++) {
          const label = `${prefix}${String(i).padStart(2, "0")}`;
          const created = await createManualTrackedDevice({
            group_id: groupId,
            party_demand_id: partyId,
            device_short_label: label,
          });
          codes.push(created.public_code);
        }
        const range =
          codes.length === 1 ? codes[0] : `${codes[0]}～${codes[codes.length - 1]}`;
        return {
          ok: true,
          summary: `已登记 ${count} 台离线设备（编号 ${range}）`,
        };
      }
      case "collection_shift_create": {
        const shiftId = await createCollectionShift({
          groupId,
          scenarioPositionId: str(d, "scenario_position_id", true),
          executorId: str(d, "executor_user_id", true),
          deviceCount: Math.max(1, Math.floor(num(d, "device_count", true))),
          scheduledStart: optionalStr(d, "scheduled_start"),
          scheduledEnd: optionalStr(d, "scheduled_end"),
          note: optionalStr(d, "note"),
        });
        if (d.publish === true || d.publish === "true") {
          await publishCollectionShift(shiftId);
          return { ok: true, summary: "已创建并发布采集排班", created_id: shiftId };
        }
        return { ok: true, summary: "已创建采集排班草稿", created_id: shiftId };
      }
      case "profile_update": {
        await updateMyProfile({
          realName: d.real_name !== undefined ? optionalStr(d, "real_name") ?? undefined : undefined,
          displayName: d.display_name !== undefined ? optionalStr(d, "display_name") ?? undefined : undefined,
          phone: d.phone !== undefined ? optionalStr(d, "phone") ?? undefined : undefined,
          contactEmail: d.contact_email !== undefined ? optionalStr(d, "contact_email") ?? undefined : undefined,
        });
        return { ok: true, summary: "已更新个人资料" };
      }
      case "bounty_publish": {
        const partyDemandIds = Array.isArray(d.party_demand_ids)
          ? d.party_demand_ids.map((x) => String(x).trim()).filter(Boolean)
          : [];
        if (!partyDemandIds.length) throw new Error("party_demand_ids 不能为空");
        const days = Math.floor(num(d, "completion_days", true));
        if (days !== 1 && days !== 2 && days !== 3) throw new Error("completion_days 须为 1、2 或 3");
        const id = await publishBounty({
          groupId,
          title: str(d, "title") || "悬赏单",
          totalHours: num(d, "total_hours", true),
          hourlyRate: num(d, "hourly_rate", true),
          completionDays: days as 1 | 2 | 3,
          assignedOperatorId: str(d, "assigned_operator_id", true),
          partyDemandIds,
          description: optionalStr(d, "description") ?? undefined,
        });
        return { ok: true, summary: "已发布悬赏令", created_id: id };
      }
      case "device_register": {
        const dev = await registerDevice({ serial_id: optionalStr(d, "serial_id") ?? undefined });
        return { ok: true, summary: `已登记联网设备 #${dev.readable_name}`, created_id: dev.device_id };
      }
      default:
        return { ok: false, error: "未知表单类型" };
    }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "填写失败" };
  }
}

export async function executeAgentFormFills(
  groupId: string,
  role: UserRole,
  specs: AgentPendingFormFill[],
  images?: Record<number, File>
): Promise<{ summaries: string[]; errors: string[] }> {
  const summaries: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const result = await executeAgentFormFill(groupId, role, spec, images?.[i]);
    if (result.ok && result.summary) summaries.push(result.summary);
    else errors.push(result.error ?? `${spec.label} 失败`);
  }
  return { summaries, errors };
}

/** 供 edge function 注入的参考数据摘要（前端调试可用） */
export async function loadAgentFormContext(groupId: string): Promise<string> {
  const [demands, macros, positions] = await Promise.all([
    listPartyDemands(groupId),
    listSceneMacroSites(groupId),
    listScenarioPositions(groupId),
  ]);
  const demandLines = demands
    .slice(0, 25)
    .map((p) => `${p.client_company ?? p.title}(${p.id}) 设备:${p.device_type ?? "—"}`)
    .join("；");
  const macroLines = macros.slice(0, 25).map((m) => `${m.title}(${m.id})`).join("；");
  const posLines = positions
    .slice(0, 40)
    .map((p) => `${p.title}(${p.id})→宏观:${p.macro_scene_id ?? "?"}`)
    .join("；");
  return [
    demandLines ? `【甲方业务】${demandLines}` : "【甲方业务】暂无",
    macroLines ? `【大场景】${macroLines}` : "【大场景】暂无",
    posLines ? `【小岗位】${posLines}` : "【小岗位】暂无",
  ].join("\n");
}
