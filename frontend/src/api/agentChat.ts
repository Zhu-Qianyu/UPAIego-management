import { supabase } from "./supabase";
import type { AgentPendingFormFill } from "../aitebot/agentFormTypes";
import type {
  AgentAction,
  AgentPendingBroadcast,
  AgentPendingGroupRules,
} from "../aitebot/types";
import type { AgentProposal } from "./sceneAgent";

export type AgentChatMessageRow = {
  id: string;
  group_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  metadata: AgentChatMetadata;
  created_at: string;
};

export type AgentMessageQuote = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type AgentChatPendingMetadata = {
  pending_broadcast?: AgentPendingBroadcast;
  pending_group_rules?: AgentPendingGroupRules;
  pending_form_fills?: AgentPendingFormFill[];
  pending_actions?: AgentAction[];
  confirm_done?: boolean;
};

export type AgentChatMetadata = AgentChatPendingMetadata & {
  proposals?: AgentProposal[];
  inbox_id?: string;
  source?: "inbox" | "chat";
  quote?: AgentMessageQuote;
};

const TABLE = "agent_chat_messages";

function isMissingTableError(message: string): boolean {
  return message.includes("does not exist") || message.includes("Could not find");
}

function isMissingUpdatePolicyError(message: string): boolean {
  return (
    message.includes("permission denied") ||
    message.includes("42501") ||
    message.includes("new row violates row-level security")
  );
}

export async function searchAgentChatMessages(args: {
  groupId: string;
  query: string;
  limit?: number;
}): Promise<AgentChatMessageRow[]> {
  const q = args.query.trim();
  if (!q) return [];

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("group_id", args.groupId)
    .ilike("content", `%${q}%`)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 50);

  if (error) {
    if (isMissingTableError(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map(normalizeRow);
}

export async function listAgentChatMessages(args: {
  groupId: string;
  limit?: number;
}): Promise<AgentChatMessageRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("group_id", args.groupId)
    .order("created_at", { ascending: true })
    .limit(args.limit ?? 200);

  if (error) {
    if (isMissingTableError(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map(normalizeRow);
}

export async function appendAgentChatMessage(args: {
  groupId: string;
  role: "user" | "assistant";
  content: string;
  metadata?: AgentChatMetadata;
}): Promise<AgentChatMessageRow | null> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) return null;

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      group_id: args.groupId,
      user_id: u.id,
      role: args.role,
      content: args.content,
      metadata: args.metadata ?? {},
    })
    .select()
    .single();

  if (error) {
    if (isMissingTableError(error.message)) return null;
    throw new Error(error.message);
  }
  return normalizeRow(data);
}

export async function updateAgentChatMessage(args: {
  messageId: string;
  content: string;
  metadata: AgentChatMetadata;
}): Promise<boolean> {
  const { error } = await supabase
    .from(TABLE)
    .update({
      content: args.content,
      metadata: args.metadata,
    })
    .eq("id", args.messageId);

  if (error) {
    if (isMissingTableError(error.message) || isMissingUpdatePolicyError(error.message)) {
      return false;
    }
    throw new Error(error.message);
  }
  return true;
}

export async function clearAgentChatHistory(groupId: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("group_id", groupId);
  if (error && !isMissingTableError(error.message)) {
    throw new Error(error.message);
  }
}

function normalizeRow(raw: Record<string, unknown>): AgentChatMessageRow {
  const meta = raw.metadata;
  return {
    id: String(raw.id),
    group_id: String(raw.group_id),
    user_id: String(raw.user_id),
    role: raw.role === "user" ? "user" : "assistant",
    content: String(raw.content ?? ""),
    metadata: meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as AgentChatMetadata) : {},
    created_at: String(raw.created_at ?? ""),
  };
}
