export type SceneTab = "tasks" | "demands" | "stations";

export type AgentAction =
  | { type: "navigate"; path: string; label?: string }
  | { type: "scene_tab"; tab: SceneTab; label?: string }
  | { type: "toast"; message: string }
  | { type: "refresh"; target: "scene" | "current" };

export type AitebotPageContext = {
  route: string;
  pageTitle: string;
  role: string;
  sceneTab?: SceneTab | null;
  query: Record<string, string>;
  /** 当前用户可见的导航入口，供模型决定跳转目标 */
  navItems: { path: string; label: string }[];
};

export type AgentBroadcastResult = {
  ok: boolean;
  sent_count?: number;
  broadcast_id?: string;
  target_roles?: string[];
  error?: string;
};

export type AgentGroupRulesResult = {
  ok: boolean;
  mode?: string;
  rules_length?: number;
  preview?: string;
  error?: string;
};

export type AgentResponsePayload = {
  assistant_message: string;
  proposals: unknown[];
  questions: string[];
  actions?: AgentAction[];
  broadcast_result?: AgentBroadcastResult | null;
  group_rules_result?: AgentGroupRulesResult | null;
};
