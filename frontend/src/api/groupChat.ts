import { supabase } from "./supabase";
import type { AgentChatMetadata } from "./agentChat";

const TABLE = "group_chat_messages";

export type GroupChatSenderType = "user" | "bot" | "system";
export type GroupChatMessageKind = "chat" | "broadcast" | "system" | "bot_action";

export interface GroupChatMessage {
  id: string;
  group_id: string;
  sender_type: GroupChatSenderType;
  sender_user_id: string | null;
  content: string;
  message_kind: GroupChatMessageKind;
  reply_to_id: string | null;
  metadata: AgentChatMetadata;
  created_at: string;
}

function isMissingTableError(message: string): boolean {
  return message.includes("does not exist") || message.includes("Could not find");
}

function normalizeRow(row: Record<string, unknown>): GroupChatMessage {
  return {
    id: String(row.id),
    group_id: String(row.group_id),
    sender_type: row.sender_type as GroupChatSenderType,
    sender_user_id: row.sender_user_id != null ? String(row.sender_user_id) : null,
    content: String(row.content ?? ""),
    message_kind: (row.message_kind as GroupChatMessageKind) ?? "chat",
    reply_to_id: row.reply_to_id != null ? String(row.reply_to_id) : null,
    metadata: (row.metadata as AgentChatMetadata) ?? {},
    created_at: String(row.created_at),
  };
}

export async function listGroupChatMessages(
  groupId: string,
  limit = 200
): Promise<GroupChatMessage[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => normalizeRow(r as Record<string, unknown>));
}

export async function sendUserGroupChatMessage(
  groupId: string,
  content: string,
  replyToId?: string | null
): Promise<GroupChatMessage> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      group_id: groupId,
      sender_type: "user",
      sender_user_id: u.id,
      content: content.trim(),
      message_kind: "chat",
      reply_to_id: replyToId ?? null,
      metadata: {},
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return normalizeRow(data as Record<string, unknown>);
}

export async function sendBotGroupChatMessage(
  groupId: string,
  content: string,
  metadata: AgentChatMetadata = {}
): Promise<GroupChatMessage> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      group_id: groupId,
      sender_type: "bot",
      sender_user_id: null,
      content: content.trim(),
      message_kind: "bot_action",
      metadata,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return normalizeRow(data as Record<string, unknown>);
}

export async function updateGroupChatMessage(
  id: string,
  patch: { content?: string; metadata?: AgentChatMetadata }
): Promise<GroupChatMessage> {
  const payload: Record<string, unknown> = {};
  if (patch.content !== undefined) payload.content = patch.content;
  if (patch.metadata !== undefined) payload.metadata = patch.metadata;

  const { data, error } = await supabase.from(TABLE).update(payload).eq("id", id).select().single();

  if (error) throw new Error(error.message);
  return normalizeRow(data as Record<string, unknown>);
}

export function subscribeGroupChat(
  groupId: string,
  handlers: {
    onInsert?: (msg: GroupChatMessage) => void;
    onUpdate?: (msg: GroupChatMessage) => void;
  }
): () => void {
  const channel = supabase
    .channel(`group-chat:${groupId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: TABLE,
        filter: `group_id=eq.${groupId}`,
      },
      (payload) => {
        if (payload.new) handlers.onInsert?.(normalizeRow(payload.new as Record<string, unknown>));
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: TABLE,
        filter: `group_id=eq.${groupId}`,
      },
      (payload) => {
        if (payload.new) handlers.onUpdate?.(normalizeRow(payload.new as Record<string, unknown>));
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}

export const BOT_MENTION = "@豆小秘";
export const BOT_NAME = "豆小秘";

export function isBotInvocation(text: string): boolean {
  const t = text.trim();
  return t.startsWith(BOT_MENTION) || t.startsWith("豆小秘");
}

export function stripBotMention(text: string): string {
  return text.trim().replace(/^@?豆小秘[，,\s]*/u, "").trim();
}
