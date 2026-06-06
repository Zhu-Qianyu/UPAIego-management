import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { buildPageContext } from "./pageRegistry";
import type { AgentAction, AitebotPageContext } from "./types";

type AitebotContextValue = {
  pageContext: AitebotPageContext;
  lastActions: AgentAction[];
  toast: string | null;
  executeActions: (actions: AgentAction[]) => string[];
  clearToast: () => void;
};

const AitebotContext = createContext<AitebotContextValue | null>(null);

function navForRole(role: AitebotPageContext["role"]): { path: string; label: string }[] {
  const map: Record<string, { path: string; label: string }[]> = {
    admin: [
      { path: "/admin", label: "管理台" },
      { path: "/group", label: "群组" },
      { path: "/devices/manage", label: "设备管理" },
      { path: "/scene", label: "场景业务" },
      { path: "/bounties", label: "悬赏令" },
    ],
    scene_operator: [
      { path: "/scene", label: "场景业务" },
      { path: "/group", label: "群组" },
    ],
    device_operator: [
      { path: "/", label: "设备总览" },
      { path: "/operator-work", label: "运维工作台" },
      { path: "/group", label: "群组" },
    ],
    collection_executor: [
      { path: "/map", label: "数采地图" },
      { path: "/bounties", label: "悬赏令" },
      { path: "/scene", label: "采集排班" },
      { path: "/group", label: "群组" },
      { path: "/wallet", label: "我的钱包" },
    ],
  };
  return map[role] ?? [];
}

export function AitebotProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const role = profile?.role ?? "scene_operator";
  const [lastActions, setLastActions] = useState<AgentAction[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const pageContext = useMemo(
    () =>
      buildPageContext({
        pathname: location.pathname,
        search: location.search,
        role,
        navItems: navForRole(role),
      }),
    [location.pathname, location.search, role]
  );

  const executeActions = useCallback(
    (actions: AgentAction[]) => {
      const summaries: string[] = [];
      const safe = actions.slice(0, 6);

      for (const action of safe) {
        switch (action.type) {
          case "navigate": {
            navigate(action.path);
            summaries.push(action.label ?? `已打开 ${action.path}`);
            break;
          }
          case "scene_tab": {
            const path = `/scene?tab=${action.tab}`;
            if (location.pathname === "/scene") {
              window.dispatchEvent(
                new CustomEvent("aitebot:scene-tab", { detail: { tab: action.tab } })
              );
            } else {
              navigate(path);
            }
            const tabLabel =
              action.tab === "tasks" ? "采集排班" : action.tab === "demands" ? "甲方业务" : "场景岗位";
            summaries.push(action.label ?? `已切换到「${tabLabel}」`);
            break;
          }
          case "toast": {
            setToast(action.message);
            summaries.push(action.message);
            break;
          }
          case "refresh": {
            window.dispatchEvent(
              new CustomEvent("aitebot:refresh", { detail: { target: action.target } })
            );
            summaries.push(action.target === "scene" ? "已刷新场景业务数据" : "已刷新当前页面");
            break;
          }
          default:
            break;
        }
      }

      setLastActions(safe);
      return summaries;
    },
    [location.pathname, navigate]
  );

  const value = useMemo(
    () => ({
      pageContext,
      lastActions,
      toast,
      executeActions,
      clearToast: () => setToast(null),
    }),
    [pageContext, lastActions, toast, executeActions]
  );

  return <AitebotContext.Provider value={value}>{children}</AitebotContext.Provider>;
}

export function useAitebot() {
  const ctx = useContext(AitebotContext);
  if (!ctx) throw new Error("useAitebot must be used within AitebotProvider");
  return ctx;
}
