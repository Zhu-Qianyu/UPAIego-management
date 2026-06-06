import type {
  AgentAction,
  AitebotPageContext,
  AgentResponsePayload,
  AgentBroadcastResult,
  AgentGroupRulesResult,
  AgentPendingBroadcast,
  AgentPendingGroupRules,
  AgentPendingFormFill,
} from "../aitebot/types";
import { normalizePendingFormFills } from "./agentForms";
import { buildFormFillConfirmMessage, inferFormFillsFromUserText, stripActionsWhenFormFills } from "../aitebot/formFillInfer";
import { AGENT_TASK_CHOICE_PROMPT } from "../aitebot/selfServiceNavigation";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type AgentChatTurn = { role: "user" | "assistant"; content: string };

/** @deprecated 视觉录入已下架，保留类型供历史聊天记录 metadata 兼容 */
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

/** @deprecated 视觉录入已下架 */
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
  pending_form_fills: AgentPendingFormFill[];
  broadcast_result: AgentBroadcastResult | null;
  group_rules_result: AgentGroupRulesResult | null;
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

export async function sendSceneAgentMessage(args: {
  messages: AgentChatTurn[];
  groupId: string;
  pageContext?: AitebotPageContext;
  role?: string;
}): Promise<AgentResponse> {
  if (!isSceneAiEnabled()) {
    throw new Error("智能助手未启用。请在环境变量中设置 VITE_SCENE_AI_ENABLED=true 并部署 Edge Function（豆包：ARK_API_KEY + ARK_MODEL）。");
  }

  const { data, error } = await supabase.functions.invoke(FN, {
    body: {
      messages: args.messages.slice(-MAX_CHAT_TURNS),
      groupId: args.groupId,
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

  const role = (args.role ?? "collection_executor") as import("../types/roles").UserRole;
  const lastUserText = [...args.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  let pending_form_fills = normalizePendingFormFills(payload.pending_form_fills, role);
  const usedInfer = !pending_form_fills.length;
  if (usedInfer) {
    pending_form_fills = inferFormFillsFromUserText(lastUserText, role);
  }

  let assistant_message = payload.assistant_message ?? "";
  if (pending_form_fills.length && usedInfer) {
    assistant_message = buildFormFillConfirmMessage(pending_form_fills);
  } else if (pending_form_fills.length && /切换|打开.*页面|标签页/.test(assistant_message)) {
    assistant_message = buildFormFillConfirmMessage(pending_form_fills);
  } else if (pending_form_fills.length && !assistant_message.includes(AGENT_TASK_CHOICE_PROMPT)) {
    assistant_message = `${assistant_message.trim()}\n\n${AGENT_TASK_CHOICE_PROMPT}`;
  }

  let actions = normalizeActions(payload.actions);
  if (pending_form_fills.length) {
    actions = stripActionsWhenFormFills(actions) as AgentAction[];
  }

  return {
    assistant_message,
    proposals: [],
    questions: payload.questions ?? [],
    actions,
    pending_broadcast: normalizePendingBroadcast(payload.pending_broadcast),
    pending_group_rules: normalizePendingGroupRules(payload.pending_group_rules),
    pending_form_fills,
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
