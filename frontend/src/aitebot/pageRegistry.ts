import type { UserRole } from "../types/roles";
import type { AitebotPageContext, SceneTab } from "./types";

const PAGE_TITLES: Record<string, string> = {
  "/": "首页",
  "/admin": "管理台",
  "/group": "群组",
  "/group/manage": "群组管理",
  "/devices/manage": "设备管理",
  "/scene": "场景业务",
  "/bounties": "悬赏令",
  "/map": "数采地图",
  "/operator-work": "运维工作台",
  "/wallet": "我的钱包",
  "/profile": "个人资料",
};

export function resolvePageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith("/devices/")) return "设备详情";
  return pathname;
}

export function parseSceneTab(search: string): SceneTab | null {
  const tab = new URLSearchParams(search).get("tab");
  if (tab === "tasks" || tab === "demands" || tab === "stations") return tab;
  return null;
}

export function buildPageContext(args: {
  pathname: string;
  search: string;
  role: UserRole;
  navItems: { path: string; label: string }[];
}): AitebotPageContext {
  return {
    route: args.pathname,
    pageTitle: resolvePageTitle(args.pathname),
    role: args.role,
    sceneTab: args.pathname === "/scene" ? parseSceneTab(args.search) : null,
    query: Object.fromEntries(new URLSearchParams(args.search)),
    navItems: args.navItems,
  };
}
