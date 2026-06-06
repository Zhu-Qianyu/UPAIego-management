import {
  createSceneMacroSite,
  createScenarioPosition,
  listSceneMacroSites,
  uploadMacroPanoramaSnapshot,
  uploadWorkstationSnapshot,
  type SceneMacroSite,
} from "./operations";
import type { AgentAction, AitebotPageContext, AgentResponsePayload, AgentBroadcastResult } from "../aitebot/types";
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
  broadcast_result: AgentBroadcastResult | null;
};

export type PendingImage = {
  index: number;
  file: File;
  hint: "macro" | "position" | "unknown";
  previewUrl: string;
};

const FN = "scene-ai-agent";

function isSceneAiEnabled(): boolean {
  const v = import.meta.env.VITE_SCENE_AI_ENABLED;
  if (v === "0" || v === "false" || v === "no") return false;
  return v === "1" || v === "true" || v === "yes" || v === undefined || v === "";
}

export function sceneAiFeatureEnabled(): boolean {
  return isSceneAiEnabled();
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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
    args.images.map(async (img) => ({
      index: img.index,
      mimeType: img.file.type || "image/jpeg",
      base64: await fileToBase64(img.file),
      hint: img.hint,
    }))
  );

  const { data, error } = await supabase.functions.invoke(FN, {
    body: {
      messages: args.messages,
      images: imagePayload,
      groupId: args.groupId,
      existingMacros: args.existingMacros ?? [],
      pageContext: args.pageContext ?? null,
    },
  });

  if (error) {
    throw new Error(error.message || "调用智能助手失败");
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
    broadcast_result: payload.broadcast_result ?? null,
  };
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
