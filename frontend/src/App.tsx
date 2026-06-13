import { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import AuthPage from "./pages/AuthPage";
import { useAuth } from "./auth/AuthContext";
import { supabase } from "./api/supabase";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "./auth/roleLabels";
import { formatRolesLabel, homePathForRoles, navForRoles } from "./auth/roleUtils";
import type { UserRole } from "./types/roles";
import RoleRoute from "./components/RoleRoute";
import AnnouncementsBanner from "./components/AnnouncementsBanner";
import KpiBanner from "./components/KpiBanner";
import GroupStatusBanner from "./components/GroupStatusBanner";
import AccountDeleteModal from "./components/AccountDeleteModal";
import PendingApprovalGate from "./components/PendingApprovalGate";
import Spinner from "./components/Spinner";
import { SITE_DISPLAY_NAME } from "./branding";
import SiteFooter from "./components/SiteFooter";
import { accountDisplayLabel } from "./utils/phoneAuth";
import { AitebotProvider } from "./aitebot/AitebotContext";

const DeviceManagePage = lazy(() => import("./pages/DeviceManagePage"));
const ManualDeviceByCodePage = lazy(() => import("./pages/ManualDeviceByCodePage"));
const RoleHome = lazy(() => import("./pages/RoleHome"));
const AdminConsole = lazy(() => import("./pages/AdminConsole"));
const SceneTasksPage = lazy(() => import("./pages/SceneTasksPage"));
const ExecutorMapPage = lazy(() => import("./pages/ExecutorMapPage"));
const BountyPage = lazy(() => import("./pages/BountyPage"));
const BountyOperatorWorkPage = lazy(() => import("./pages/BountyOperatorWorkPage"));
const GroupPage = lazy(() => import("./pages/GroupPage"));
const AdminGroupPage = lazy(() => import("./pages/AdminGroupPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const ExecutorWalletPage = lazy(() => import("./pages/ExecutorWalletPage"));

const SIDEBAR_COLLAPSED_KEY = "upai:sidebar-collapsed";

function AccountNavActions({
  onOpenDelete,
  onLogout,
}: {
  onOpenDelete: () => void;
  onLogout: () => void | Promise<void>;
}) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={() => onOpenDelete()}
        className="px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-red-600 hover:bg-red-50 hover:text-red-700 whitespace-nowrap"
      >
        注销账号
      </button>
      <button
        type="button"
        onClick={() => void onLogout()}
        className="px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 whitespace-nowrap"
      >
        退出
      </button>
    </div>
  );
}

function MigrationNotice({
  accountDeleteOpen,
  setAccountDeleteOpen,
}: {
  accountDeleteOpen: boolean;
  setAccountDeleteOpen: (v: boolean) => void;
}) {
  const { session, refreshProfile, profileSyncHint } = useAuth();
  const [retrying, setRetrying] = useState(false);
  const userId = session?.user?.id ?? "";

  async function retry() {
    setRetrying(true);
    try {
      await refreshProfile();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-amber-50/50">
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-lg rounded-2xl border border-amber-200 bg-white p-6 text-sm text-amber-950 shadow-sm space-y-4">
        <p className="font-semibold text-base">未检测到账号角色（profiles）</p>
        <p className="text-amber-900/90">
          任选一种方式修复后，点击下方「同步并重试」即可，无需改代码。
        </p>

        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-2">
          <p className="font-medium text-gray-800 text-xs uppercase tracking-wide">方式 A（最快）</p>
          <p className="text-gray-700 text-xs">
            Supabase → <strong>Table Editor</strong> → <code className="bg-white px-1 rounded">profiles</code> →
            新增一行：<code className="bg-white px-1 rounded">id</code> =
            你的用户 UUID，
            <code className="bg-white px-1 rounded">role</code> ={" "}
            <code className="bg-white px-1 rounded">device_operator</code>（或{" "}
            <code className="bg-white px-1 rounded">admin</code>）。
          </p>
          {userId && (
            <p className="text-xs font-mono break-all text-indigo-800 bg-indigo-50 rounded-lg px-2 py-1">
              id: {userId}
            </p>
          )}
        </div>

        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-2">
          <p className="font-medium text-gray-800 text-xs uppercase tracking-wide">方式 B（SQL Editor）</p>
          <p className="text-gray-600 text-xs">把下面的 YOUR_USER_UUID 换成上面复制的 id 后执行一次：</p>
          <pre className="text-[11px] leading-relaxed bg-stone-900 text-stone-100 rounded-lg p-3 overflow-x-auto">
            {`INSERT INTO public.profiles (id, role)\nVALUES ('YOUR_USER_UUID', 'device_operator')\nON CONFLICT (id) DO UPDATE\nSET role = EXCLUDED.role, updated_at = now();`}
          </pre>
        </div>

        <p className="text-xs text-gray-600">
          若尚未建表：请联系平台管理员在服务器数据库中初始化 <code className="bg-gray-100 px-1 rounded">profiles</code> 等基础表。
        </p>

        {profileSyncHint && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {profileSyncHint}
          </div>
        )}

        <button
          type="button"
          disabled={retrying}
          onClick={() => void retry()}
          className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {retrying ? "同步中..." : "同步并重试"}
        </button>

        <div className="border-t border-gray-200 pt-4 mt-2">
          <p className="text-xs text-gray-500 mb-2">若不想继续使用此账号，可注销（将删除登录用户及关联数据）。</p>
          <button
            type="button"
            onClick={() => setAccountDeleteOpen(true)}
            className="w-full py-2 rounded-xl border border-red-200 text-sm font-medium text-red-700 bg-red-50/80 hover:bg-red-100"
          >
            注销账号
          </button>
        </div>
        </div>

        <AccountDeleteModal
          open={accountDeleteOpen}
          onClose={() => setAccountDeleteOpen(false)}
          email={session?.user?.email}
        />
      </div>
    </div>
  );
}

export default function App() {
  const { session, profile, loading, activeRole, setActiveRole } = useAuth();
  const location = useLocation();
  const isAuthed = !!session?.user;
  const [accountDeleteOpen, setAccountDeleteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileSidebarOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileSidebarOpen]);

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  if (loading && !profile) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">加载中...</div>;
  }

  if (!isAuthed) {
    return (
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    );
  }

  if (!profile) {
    return (
      <MigrationNotice accountDeleteOpen={accountDeleteOpen} setAccountDeleteOpen={setAccountDeleteOpen} />
    );
  }

  const navItems = navForRoles(profile.roles);
  const homeTo = homePathForRoles(profile.roles, activeRole);
  const roleBadge =
    profile.roles.length > 1 ? formatRolesLabel(profile.roles) : ROLE_LABELS[profile.role];
  const operativeRoles = profile.roles.filter((r) => r !== "admin");

  return (
    <AitebotProvider>
    <div
      className="min-h-screen flex bg-gradient-to-b from-indigo-50 via-slate-50 to-gray-50"
      data-app-shell="sidebar-v2"
    >
      {mobileSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[1px] md:hidden"
          aria-label="关闭菜单"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <aside
        className={[
          "fixed md:sticky md:top-0 md:self-start z-50 md:z-30",
          "flex flex-col min-h-0 h-screen max-h-[100dvh]",
          "w-56 shrink-0 border-r border-indigo-100 bg-white/95 shadow-sm md:shadow-none",
          "transition-[transform,width] duration-200 ease-out",
          sidebarCollapsed ? "md:w-[4.25rem]" : "",
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        ].join(" ")}
        aria-label="功能导航"
      >
        <div
          className={`flex items-center gap-2 shrink-0 border-b border-indigo-100/90 p-3 ${sidebarCollapsed ? "md:flex-col" : ""}`}
        >
          <Link
            to={homeTo}
            onClick={() => setMobileSidebarOpen(false)}
            className={`font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent truncate min-w-0 ${
              sidebarCollapsed ? "md:text-center md:text-sm flex-1" : "text-lg flex-1"
            }`}
            title={SITE_DISPLAY_NAME}
          >
            <span className="md:hidden">{SITE_DISPLAY_NAME}</span>
            <span className="hidden md:inline">{sidebarCollapsed ? "u" : SITE_DISPLAY_NAME}</span>
          </Link>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            className="hidden md:flex items-center justify-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            <svg
              className={`w-5 h-5 transition-transform ${sidebarCollapsed ? "" : "rotate-180"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5 [scrollbar-width:thin]">
          <ul className="space-y-0.5">
            {navItems.map((link) => {
              const active =
                link.to === "/devices/manage"
                  ? location.pathname === "/devices/manage" || location.pathname.startsWith("/devices/")
                  : link.to === "/group"
                    ? location.pathname === "/group" || location.pathname.startsWith("/group/")
                    : location.pathname === link.to;
              const abbr = link.label.slice(0, 1);
              return (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    onClick={() => setMobileSidebarOpen(false)}
                    title={sidebarCollapsed ? link.label : undefined}
                    className={`
                      flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm font-medium transition-colors
                      ${
                        active
                          ? "bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200/80"
                          : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                      }
                      ${sidebarCollapsed ? "justify-center px-1" : ""}
                    `}
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                        active ? "bg-white/80 text-indigo-800" : "bg-indigo-50 text-indigo-700"
                      }`}
                      aria-hidden
                    >
                      {abbr}
                    </span>
                    <span className={sidebarCollapsed ? "truncate md:hidden" : "truncate"}>
                      {link.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-indigo-100 bg-white/90 px-3 sm:px-4 backdrop-blur">
          <div className="flex items-center gap-1 md:hidden">
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-lg p-2 text-gray-600 hover:bg-gray-100"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="打开功能菜单"
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="text-xs text-gray-500 whitespace-nowrap">菜单</span>
          </div>
          <div className="hidden sm:block min-w-0 flex-1" />
          <div
            className="flex min-w-0 flex-1 sm:flex-initial items-center justify-end gap-2"
            title={profile.roles.map((r) => `${ROLE_LABELS[r]} — ${ROLE_DESCRIPTIONS[r]}`).join("\n")}
          >
            <Link
              to="/profile"
              className="truncate text-xs text-indigo-700 hover:text-indigo-900 max-w-[100px] sm:max-w-[140px] md:max-w-[220px] underline-offset-2 hover:underline"
              title="编辑个人信息"
            >
              {accountDisplayLabel(profile.phone, session?.user?.email, profile.contact_email, profile.real_name)}
            </Link>
            {operativeRoles.length > 1 ? (
              <select
                value={activeRole ?? profile.role}
                onChange={(e) => setActiveRole(e.target.value as UserRole)}
                className="shrink-0 max-w-[8rem] rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] sm:text-xs font-semibold text-indigo-800 ring-1 ring-indigo-200/80"
                aria-label="当前工作台职能"
                title={`身兼：${roleBadge}`}
              >
                {operativeRoles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            ) : (
              <span
                className="shrink-0 rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] sm:text-xs font-semibold text-indigo-800 ring-1 ring-indigo-200/80"
                aria-label={`当前角色：${roleBadge}`}
              >
                {roleBadge}
              </span>
            )}
          </div>
          <AccountNavActions
            onOpenDelete={() => setAccountDeleteOpen(true)}
            onLogout={handleLogout}
          />
        </header>

        <AccountDeleteModal
          open={accountDeleteOpen}
          onClose={() => setAccountDeleteOpen(false)}
          email={session?.user?.email}
        />

        <main className="max-w-[90rem] mx-auto w-full min-w-0 flex-1 overflow-x-hidden box-border px-4 sm:px-6 lg:px-8 py-8">
        <PendingApprovalGate>
        <GroupStatusBanner />
        <KpiBanner />
        <AnnouncementsBanner />
        <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<RoleHome />} />
          <Route
            path="/admin"
            element={
              <RoleRoute allow={["admin"]}>
                <AdminConsole />
              </RoleRoute>
            }
          />
          <Route path="/fleet" element={<Navigate to="/devices/manage?tab=fleet" replace />} />
          <Route
            path="/devices/manage"
            element={
              <RoleRoute allow={["admin", "device_operator"]}>
                <DeviceManagePage />
              </RoleRoute>
            }
          />
          <Route
            path="/devices/manual/:code"
            element={
              <RoleRoute allow={["admin", "device_operator"]}>
                <ManualDeviceByCodePage />
              </RoleRoute>
            }
          />
          <Route path="/register" element={<Navigate to="/devices/manage" replace />} />
          <Route path="/search" element={<Navigate to="/devices/manage?tab=search" replace />} />
          <Route
            path="/devices/:id"
            element={
              <RoleRoute allow={["admin", "device_operator"]}>
                <Navigate to="/devices/manage" replace />
              </RoleRoute>
            }
          />
          <Route
            path="/scene"
            element={
              <RoleRoute allow={["admin", "scene_operator", "collection_executor"]}>
                <SceneTasksPage />
              </RoleRoute>
            }
          />
          <Route
            path="/map"
            element={
              <RoleRoute allow={["admin", "collection_executor"]}>
                <ExecutorMapPage />
              </RoleRoute>
            }
          />
          <Route
            path="/bounties"
            element={
              <RoleRoute allow={["admin", "collection_executor"]}>
                <BountyPage />
              </RoleRoute>
            }
          />
          <Route
            path="/operator-work"
            element={
              <RoleRoute allow={["device_operator"]}>
                <BountyOperatorWorkPage />
              </RoleRoute>
            }
          />
          <Route path="/group" element={<GroupPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route
            path="/wallet"
            element={
              <RoleRoute allow={["collection_executor"]}>
                <ExecutorWalletPage />
              </RoleRoute>
            }
          />
          <Route
            path="/group/manage"
            element={
              <RoleRoute allow={["admin"]}>
                <AdminGroupPage />
              </RoleRoute>
            }
          />
          <Route path="/topics" element={<Navigate to="/group" replace />} />
          <Route path="/join" element={<Navigate to="/group" replace />} />
          <Route path="/admin/group" element={<Navigate to="/group/manage" replace />} />
          <Route path="/auth" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </PendingApprovalGate>
        </main>
        <SiteFooter />
      </div>
    </div>
    </AitebotProvider>
  );
}
