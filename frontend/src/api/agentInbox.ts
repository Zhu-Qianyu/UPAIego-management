import { supabase } from "./supabase";

export type AgentInboxMessage = {
  id: string;
  group_id: string;
  recipient_user_id: string;
  sender_user_id: string | null;
  broadcast_id: string;
  title: string;
  body: string;
  category: "notice" | "task" | "workflow" | "holiday";
  read_at: string | null;
  created_at: string;
};

const TABLE = "agent_inbox_messages";

export async function countAgentInboxUnread(groupId?: string | null): Promise<number> {
  const { data, error } = await supabase.rpc("count_agent_inbox_unread", {
    p_group_id: groupId ?? null,
  });
  if (error) {
    if (error.message.includes("does not exist") || error.message.includes("Could not find")) {
      return 0;
    }
    throw new Error(error.message);
  }
  return typeof data === "number" ? data : Number(data ?? 0);
}

export async function listAgentInboxMessages(args: {
  groupId?: string | null;
  limit?: number;
  unreadOnly?: boolean;
}): Promise<AgentInboxMessage[]> {
  let q = supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 30);

  if (args.groupId) {
    q = q.eq("group_id", args.groupId);
  }
  if (args.unreadOnly) {
    q = q.is("read_at", null);
  }

  const { data, error } = await q;
  if (error) {
    if (error.message.includes("does not exist") || error.message.includes("Could not find")) {
      return [];
    }
    throw new Error(error.message);
  }
  return (data ?? []) as AgentInboxMessage[];
}

export async function markAgentInboxRead(messageIds: string[]): Promise<void> {
  if (!messageIds.length) return;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from(TABLE)
    .update({ read_at: now })
    .in("id", messageIds)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}

export async function markAllAgentInboxRead(groupId?: string | null): Promise<void> {
  const unread = await listAgentInboxMessages({ groupId, unreadOnly: true, limit: 200 });
  if (!unread.length) return;
  await markAgentInboxRead(unread.map((m) => m.id));
}
