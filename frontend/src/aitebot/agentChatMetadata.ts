import type { AgentChatMetadata } from "../api/agentChat";
import type { AgentPendingFormFill } from "./agentFormTypes";
import type { AgentAction, AgentPendingBroadcast, AgentPendingGroupRules } from "./types";

export function buildAssistantChatMetadata(args: {
  pendingBroadcast?: AgentPendingBroadcast;
  pendingGroupRules?: AgentPendingGroupRules;
  pendingFormFills?: AgentPendingFormFill[];
  pendingActions?: AgentAction[];
  confirmDone?: boolean;
}): AgentChatMetadata {
  const confirmDone = args.confirmDone ?? false;
  return {
    source: "chat",
    confirm_done: confirmDone,
    ...(args.pendingBroadcast && !confirmDone ? { pending_broadcast: args.pendingBroadcast } : {}),
    ...(args.pendingGroupRules && !confirmDone ? { pending_group_rules: args.pendingGroupRules } : {}),
    ...(args.pendingFormFills?.length && !confirmDone ? { pending_form_fills: args.pendingFormFills } : {}),
    ...(args.pendingActions?.length && !confirmDone ? { pending_actions: args.pendingActions } : {}),
  };
}
