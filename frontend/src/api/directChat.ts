import { supabase } from "./supabase";

const CONV_TABLE = "direct_conversations";
const MSG_TABLE = "direct_messages";

export type DirectConversation = {
  id: string;
  group_id: string;
  user_low: string;
  user_high: string;
  last_message_at: string;
  created_at: string;
};

export type DirectMessage = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  content: string;
  read_at: string | null;
  created_at: string;
};

function isMissingTableError(message: string): boolean {
  return message.includes("does not exist") || message.includes("Could not find");
}

function normalizeConv(row: Record<string, unknown>): DirectConversation {
  return {
    id: String(row.id),
    group_id: String(row.group_id),
    user_low: String(row.user_low),
    user_high: String(row.user_high),
    last_message_at: String(row.last_message_at),
    created_at: String(row.created_at),
  };
}

function normalizeMsg(row: Record<string, unknown>): DirectMessage {
  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    sender_user_id: String(row.sender_user_id),
    content: String(row.content ?? ""),
    read_at: row.read_at != null ? String(row.read_at) : null,
    created_at: String(row.created_at),
  };
}

export function otherUserInConversation(conv: DirectConversation, me: string): string {
  return conv.user_low === me ? conv.user_high : conv.user_low;
}

export async function listDirectConversations(groupId: string): Promise<DirectConversation[]> {
  const { data, error } = await supabase
    .from(CONV_TABLE)
    .select("*")
    .eq("group_id", groupId)
    .order("last_message_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => normalizeConv(r as Record<string, unknown>));
}

export async function getOrCreateDirectConversation(
  groupId: string,
  otherUserId: string
): Promise<string> {
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
    p_group_id: groupId,
    p_other_user_id: otherUserId,
  });

  if (error) throw new Error(error.message);
  return String(data);
}

export async function listDirectMessages(
  conversationId: string,
  limit = 200
): Promise<DirectMessage[]> {
  const { data, error } = await supabase
    .from(MSG_TABLE)
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => normalizeMsg(r as Record<string, unknown>));
}

export async function sendDirectMessage(
  conversationId: string,
  content: string
): Promise<DirectMessage> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");

  const { data, error } = await supabase
    .from(MSG_TABLE)
    .insert({
      conversation_id: conversationId,
      sender_user_id: u.id,
      content: content.trim(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  const msg = normalizeMsg(data as Record<string, unknown>);

  await supabase
    .from(CONV_TABLE)
    .update({ last_message_at: msg.created_at })
    .eq("id", conversationId);

  return msg;
}

export async function markDirectMessagesRead(
  conversationId: string,
  beforeOrAt?: string
): Promise<void> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) return;

  let q = supabase
    .from(MSG_TABLE)
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .neq("sender_user_id", u.id)
    .is("read_at", null);

  if (beforeOrAt) q = q.lte("created_at", beforeOrAt);

  const { error } = await q;
  if (error && !isMissingTableError(error.message)) {
    throw new Error(error.message);
  }
}

export async function getLastDirectMessage(
  conversationId: string
): Promise<DirectMessage | null> {
  const { data, error } = await supabase
    .from(MSG_TABLE)
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message)) return null;
    throw new Error(error.message);
  }
  return data ? normalizeMsg(data as Record<string, unknown>) : null;
}

export function subscribeDirectMessages(
  conversationId: string,
  handlers: { onInsert?: (msg: DirectMessage) => void }
): () => void {
  const channel = supabase
    .channel(`direct-chat:${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: MSG_TABLE,
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        if (payload.new) handlers.onInsert?.(normalizeMsg(payload.new as Record<string, unknown>));
      }
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
