import type { AgentPendingFormFill } from "./agentFormTypes";
import type { AgentAction, AgentPendingBroadcast, AgentPendingGroupRules } from "./types";

export const AGENT_TASK_CHOICE_PROMPT = "您想让我直接帮您做，还是跳转页面您自己来？";

export function resolveSelfServiceActions(opts: {
  formFills?: AgentPendingFormFill[];
  actions?: AgentAction[];
  broadcast?: AgentPendingBroadcast | null;
  groupRules?: AgentPendingGroupRules | null;
}): AgentAction[] {
  if (opts.actions?.length) {
    const nav = opts.actions.filter((a) => a.type === "navigate" || a.type === "scene_tab");
    if (nav.length) return nav.slice(0, 3);
  }

  if (opts.formFills?.length) {
    const seen = new Set<string>();
    const out: AgentAction[] = [];
    for (const f of opts.formFills) {
      const action = formFillToNavigateAction(f.form);
      const key =
        action.type === "navigate"
          ? action.path
          : action.type === "scene_tab"
            ? `${action.type}:${action.tab}`
            : action.type;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(action);
      if (out.length >= 3) break;
    }
    return out;
  }

  if (opts.broadcast) {
    return [{ type: "navigate", path: "/admin", label: "管理台" }];
  }

  if (opts.groupRules) {
    return [{ type: "navigate", path: "/group", label: "群组管理" }];
  }

  return [];
}

function formFillToNavigateAction(form: AgentPendingFormFill["form"]): AgentAction {
  switch (form) {
    case "party_demand_create":
    case "party_demand_update":
      return { type: "scene_tab", tab: "demands", label: "甲方业务" };
    case "scene_macro_create":
    case "scene_macro_update":
    case "scenario_position_create":
    case "scenario_position_update":
      return { type: "scene_tab", tab: "stations", label: "场景岗位" };
    case "collection_shift_create":
      return { type: "scene_tab", tab: "tasks", label: "采集排班" };
    case "manual_device_create":
    case "manual_devices_batch_create":
    case "device_register":
      return { type: "navigate", path: "/devices/manage", label: "设备管理" };
    case "group_topic_create":
      return { type: "navigate", path: "/group", label: "群组" };
    case "profile_update":
      return { type: "navigate", path: "/profile", label: "个人资料" };
    case "bounty_publish":
      return { type: "navigate", path: "/bounties", label: "悬赏令" };
    default:
      return { type: "navigate", path: "/scene", label: "场景业务" };
  }
}
