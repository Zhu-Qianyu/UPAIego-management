import {
  createSceneMacroSite,
  createScenarioPosition,
  listSceneMacroSites,
  uploadMacroPanoramaSnapshot,
  uploadWorkstationSnapshot,
  type SceneMacroSite,
} from "./operations";
import type {
  AgentAction,
  AitebotPageContext,
  AgentResponsePayload,
  AgentBroadcastResult,
  AgentGroupRulesResult,
  AgentPendingBroadcast,
  AgentPendingGroupRules,
} from "../aitebot/types";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { SceneCategoryKey } from "../utils/sceneCategories";
import { SCENE_CATEGORY_KEYS } from "../utils/sceneCategories";

export type AgentChatTurn = { role: "user" | "assistant"; content: string };

export type AgentImagePayload = {
  index: number;
  mimeType: string;
  base64: string;
  hint?: "macro" | "position" | "unknown";
};

export type AgentMacroProposal = {
  id: string;
  kind: "macro";
  imageIndex: number;
  title: string;
  description?: string | null;
  contact_name: string;
  contact_phone: string;
  address_province: string;
  address_city: string;
  address_district: string;
  address_detail?: string | null;
};

export type AgentPositionProposal = {
  id: string;
  kind: "position";
  imageIndex: number;
  macroProposalId?: string | null;
  existingMacroId?: string | null;
  title: string;
  process_description?: string | null;
  scene_categories: string[];
  address_province: string;
  address_city: string;
  address_district: string;
  address_detail?: string | null;
};

export type AgentProposal = AgentMacroProposal | AgentPositionProposal;

export type AgentResponse = {
  assistant_message: string;
  proposals: AgentProposal[];
  questions: string[];
  actions: AgentAction[];
  pending_broadcast: AgentPendingBroadcast | null;
  pending_group_rules: AgentPendingGroupRules | null;
  broadcast_result: AgentBroadcastResult | null;
  group_rules_result: AgentGroupRulesResult | null;
};

export type PendingImage = {
  index: number;
  file: File;
  hint: "macro" | "position" | "unknown";
  previewUrl: string;
};

const FN = "scene-ai-agent";
const MAX_CHAT_TURNS = 24;

async function readFunctionInvokeError(error: unknown, data: unknown): Promise<string> {
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  }
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error.trim()) return body.error.trim();
    } catch {
      // response body may not be JSON
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "调用智能助手失败";
}

function isSceneAiEnabled(): boolean {
  const v = import.meta.env.VITE_SCENE_AI_ENABLED;
  if (v === "0" || v === "false" || v === "no") return false;
  return v === "1" || v === "true" || v === "yes" || v === undefined || v === "";
}

export function sceneAiFeatureEnabled(): boolean {
  return isSceneAiEnabled();
}

const AGENT_IMAGE_MAX_EDGE = 1280;
const AGENT_IMAGE_JPEG_QUALITY = 0.82;
const AGENT_IMAGE_SKIP_COMPRESS_BYTES = 350_000;

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("图片读取失败"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function compressAgentImage(file: File): Promise<{ blob: Blob; mimeType: string }> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, AGENT_IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法处理图片");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", AGENT_IMAGE_JPEG_QUALITY)
    );
    if (!blob) throw new Error("图片压缩失败");
    return { blob, mimeType: "image/jpeg" };
  } finally {
    bitmap?.close();
  }
}

/** 压缩并编码为 base64，避免大图栈溢出或请求体过大。 */
export async function prepareAgentImagePayload(
  file: File
): Promise<{ base64: string; mimeType: string }> {
  const mimeType = file.type.startsWith("image/") ? file.type : "image/jpeg";
  if (
    file.size <= AGENT_IMAGE_SKIP_COMPRESS_BYTES &&
    (mimeType === "image/jpeg" || mimeType === "image/webp")
  ) {
    return { base64: await blobToBase64(file), mimeType };
  }
  try {
    const compressed = await compressAgentImage(file);
    return { base64: await blobToBase64(compressed.blob), mimeType: compressed.mimeType };
  } catch {
    return { base64: await blobToBase64(file), mimeType };
  }
}

export async function sendSceneAgentMessage(args: {
  messages: AgentChatTurn[];
  images: PendingImage[];
  groupId: string;
  existingMacros?: Pick<SceneMacroSite, "id" | "title">[];
  pageContext?: AitebotPageContext;
}): Promise<AgentResponse> {
  if (!isSceneAiEnabled()) {
    throw new Error("智能助手未启用。请在环境变量中设置 VITE_SCENE_AI_ENABLED=true 并部署 Edge Function（豆包：ARK_API_KEY + ARK_MODEL）。");
  }

  const imagePayload: AgentImagePayload[] = await Promise.all(
    args.images.map(async (img) => {
      const prepared = await prepareAgentImagePayload(img.file);
      return {
        index: img.index,
        mimeType: prepared.mimeType,
        base64: prepared.base64,
        hint: img.hint,
      };
    })
  );

  const { data, error } = await supabase.functions.invoke(FN, {
    body: {
      messages: args.messages.slice(-MAX_CHAT_TURNS),
      images: imagePayload,
      groupId: args.groupId,
      existingMacros: args.existingMacros ?? [],
      pageContext: args.pageContext ?? null,
    },
  });

  if (error) {
    throw new Error(await readFunctionInvokeError(error, data));
  }

  const payload = data as AgentResponsePayload & { error?: string };
  if (payload?.error) {
    throw new Error(payload.error);
  }

  return {
    assistant_message: payload.assistant_message ?? "",
    proposals: normalizeProposals(payload.proposals),
    questions: payload.questions ?? [],
    actions: normalizeActions(payload.actions),
    pending_broadcast: normalizePendingBroadcast(payload.pending_broadcast),
    pending_group_rules: normalizePendingGroupRules(payload.pending_group_rules),
    broadcast_result: payload.broadcast_result ?? null,
    group_rules_result: payload.group_rules_result ?? null,
  };
}

export async function executeAgentBroadcast(
  groupId: string,
  spec: AgentPendingBroadcast
): Promise<AgentBroadcastResult> {
  const targetRoles = spec.target_roles[0] === "all" ? null : spec.target_roles;
  const { data, error } = await supabase.rpc("send_agent_group_broadcast", {
    p_group_id: groupId,
    p_title: spec.title,
    p_body: spec.body,
    p_target_roles: targetRoles,
    p_category: spec.category ?? "notice",
  });
  if (error) return { ok: false, error: error.message };
  const row = data as Record<string, unknown> | null;
  return {
    ok: true,
    sent_count: typeof row?.sent_count === "number" ? row.sent_count : Number(row?.sent_count ?? 0),
    broadcast_id: row?.broadcast_id != null ? String(row.broadcast_id) : undefined,
    target_roles: Array.isArray(row?.target_roles) ? (row!.target_roles as string[]) : spec.target_roles,
  };
}

export async function executeAgentGroupRules(
  groupId: string,
  spec: AgentPendingGroupRules
): Promise<AgentGroupRulesResult> {
  const { data, error } = await supabase.rpc("upsert_agent_group_rules", {
    p_group_id: groupId,
    p_mode: spec.mode,
    p_content: spec.content,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as Record<string, unknown> | null;
  return {
    ok: true,
    mode: row?.mode != null ? String(row.mode) : spec.mode,
    rules_length: typeof row?.rules_length === "number" ? row.rules_length : Number(row?.rules_length ?? 0),
    preview: row?.preview != null ? String(row.preview) : undefined,
  };
}

function normalizePendingBroadcast(raw: unknown): AgentPendingBroadcast | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = String(o.title ?? "").trim();
  const body = String(o.body ?? "").trim();
  const targetRoles = normalizeBroadcastRoles(o.target_roles);
  if (!title || !body || !targetRoles) return null;
  return {
    title,
    body,
    target_roles: targetRoles,
    category: o.category != null ? String(o.category) : undefined,
  };
}

function normalizePendingGroupRules(raw: unknown): AgentPendingGroupRules | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const mode = String(o.mode ?? "").trim().toLowerCase();
  if (mode !== "append" && mode !== "replace" && mode !== "clear") return null;
  const content = String(o.content ?? "").trim();
  if (mode !== "clear" && !content) return null;
  return { mode, content: content.slice(0, 4000) };
}

function normalizeBroadcastRoles(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: string[] = [];
  for (const r of raw) {
    const s = String(r).trim();
    if (s === "all") return ["all"];
    if (["admin", "device_operator", "scene_operator", "collection_executor"].includes(s) && !out.includes(s)) {
      out.push(s);
    }
  }
  return out.length ? out : null;
}

function normalizeActions(raw: unknown): AgentAction[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = o.type;
    if (type === "navigate" && typeof o.path === "string" && o.path.startsWith("/")) {
      out.push({ type: "navigate", path: o.path, label: o.label != null ? String(o.label) : undefined });
    } else if (type === "scene_tab" && (o.tab === "tasks" || o.tab === "demands" || o.tab === "stations")) {
      out.push({
        type: "scene_tab",
        tab: o.tab,
        label: o.label != null ? String(o.label) : undefined,
      });
    } else if (type === "toast" && typeof o.message === "string") {
      out.push({ type: "toast", message: o.message.slice(0, 200) });
    } else if (type === "refresh" && (o.target === "scene" || o.target === "current")) {
      out.push({ type: "refresh", target: o.target });
    }
  }
  return out;
}

function normalizeProposals(raw: unknown): AgentProposal[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentProposal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const kind = o.kind;
    if (kind === "macro") {
      out.push({
        id: String(o.id ?? `macro-${out.length}`),
        kind: "macro",
        imageIndex: Number(o.imageIndex ?? 0),
        title: String(o.title ?? "").trim(),
        description: o.description != null ? String(o.description) : null,
        contact_name: String(o.contact_name ?? "").trim(),
        contact_phone: String(o.contact_phone ?? "").trim(),
        address_province: String(o.address_province ?? "待补充").trim(),
        address_city: String(o.address_city ?? "待补充").trim(),
        address_district: String(o.address_district ?? "待补充").trim(),
        address_detail: o.address_detail != null ? String(o.address_detail) : null,
      });
    } else if (kind === "position") {
      const cats = (Array.isArray(o.scene_categories) ? o.scene_categories : ["industrial"]).filter(
        (c): c is SceneCategoryKey => (SCENE_CATEGORY_KEYS as readonly string[]).includes(String(c))
      );
      out.push({
        id: String(o.id ?? `pos-${out.length}`),
        kind: "position",
        imageIndex: Number(o.imageIndex ?? 0),
        macroProposalId: o.macroProposalId != null ? String(o.macroProposalId) : null,
        existingMacroId: o.existingMacroId != null ? String(o.existingMacroId) : null,
        title: String(o.title ?? "").trim(),
        process_description: o.process_description != null ? String(o.process_description) : null,
        scene_categories: cats.length ? cats : ["industrial"],
        address_province: String(o.address_province ?? "待补充").trim(),
        address_city: String(o.address_city ?? "待补充").trim(),
        address_district: String(o.address_district ?? "待补充").trim(),
        address_detail: o.address_detail != null ? String(o.address_detail) : null,
      });
    }
  }
  return out;
}

/** 仅创建，不含任何删除操作。 */
export async function executeAgentProposals(
  groupId: string,
  proposals: AgentProposal[],
  imageByIndex: Map<number, File>
): Promise<{ createdMacros: number; createdPositions: number }> {
  const macroIdByProposal = new Map<string, string>();
  let createdMacros = 0;
  let createdPositions = 0;

  const macros = proposals.filter((p): p is AgentMacroProposal => p.kind === "macro");
  const positions = proposals.filter((p): p is AgentPositionProposal => p.kind === "position");

  for (const m of macros) {
    const file = imageByIndex.get(m.imageIndex);
    if (!file) throw new Error(`大场景「${m.title}」缺少对应图片 (index ${m.imageIndex})`);
    if (!m.title.trim()) throw new Error("大场景名称不能为空");
    if (!m.contact_name.trim() || !m.contact_phone.trim()) {
      throw new Error(`大场景「${m.title}」缺少联系人姓名或电话`);
    }
    const { path } = await uploadMacroPanoramaSnapshot(groupId, file);
    const created = await createSceneMacroSite({
      group_id: groupId,
      title: m.title,
      description: m.description?.trim() || undefined,
      panorama_path: path,
      contact_name: m.contact_name,
      contact_phone: m.contact_phone,
      address_province: m.address_province,
      address_city: m.address_city,
      address_district: m.address_district,
      address_detail: m.address_detail?.trim() || undefined,
    });
    macroIdByProposal.set(m.id, created.id);
    createdMacros += 1;
  }

  for (const p of positions) {
    const file = imageByIndex.get(p.imageIndex);
    if (!file) throw new Error(`小岗位「${p.title}」缺少对应图片 (index ${p.imageIndex})`);
    let macroId = p.existingMacroId?.trim() || null;
    if (!macroId && p.macroProposalId) {
      macroId = macroIdByProposal.get(p.macroProposalId) ?? null;
    }
    if (!macroId) throw new Error(`小岗位「${p.title}」未指定所属大场景`);
    const { path } = await uploadWorkstationSnapshot(groupId, file);
    await createScenarioPosition({
      group_id: groupId,
      macro_scene_id: macroId,
      title: p.title,
      process_description: p.process_description?.trim() || undefined,
      snapshot_path: path,
      scene_categories: p.scene_categories as SceneCategoryKey[],
      address_province: p.address_province,
      address_city: p.address_city,
      address_district: p.address_district,
      address_detail: p.address_detail?.trim() || undefined,
    });
    createdPositions += 1;
  }

  return { createdMacros, createdPositions };
}

export async function loadMacrosForAgent(groupId: string) {
  return listSceneMacroSites(groupId);
}
