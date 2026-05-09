import { useState } from "react";
import { Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import Register from "./pages/Register";
import DeviceDetail from "./pages/DeviceDetail";
import Search from "./pages/Search";
import AuthPage from "./pages/AuthPage";
import RoleHome from "./pages/RoleHome";
import AdminConsole from "./pages/AdminConsole";
import SceneTasksPage from "./pages/SceneTasksPage";
import ExecutorMapPage from "./pages/ExecutorMapPage";
import JoinGroupPage from "./pages/JoinGroupPage";
import TopicsPage from "./pages/TopicsPage";
import AdminGroupPage from "./pages/AdminGroupPage";
import { useAuth } from "./auth/AuthContext";
import { supabase } from "./api/supabase";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "./auth/roleLabels";
import type { UserRole } from "./types/roles";
import RoleRoute from "./components/RoleRoute";
import AnnouncementsBanner from "./components/AnnouncementsBanner";
import GroupStatusBanner from "./components/GroupStatusBanner";
import AccountDeleteModal from "./components/AccountDeleteModal";

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

function navForRole(role: UserRole): { to: string; label: string }[] {
  const byRole: Record<UserRole, { to: string; label: string }[]> = {
    admin: [
      { to: "/admin", label: "管理台" },
      { to: "/admin/group", label: "群组" },
      { to: "/topics", label: "话题" },
      { to: "/join", label: "入群" },
      { to: "/fleet", label: "全量设备" },
      { to: "/register", label: "注册设备" },
      { to: "/search", label: "搜索" },
      { to: "/scene", label: "业务与场景" },
      { to: "/map", label: "数采地图" },
    ],
    device_operator: [
      { to: "/", label: "设备总览" },
      { to: "/topics", label: "话题" },
      { to: "/join", label: "入群" },
      { to: "/register", label: "注册设备" },
      { to: "/search", label: "搜索" },
    ],
    scene_operator: [
      { to: "/scene", label: "业务与场景" },
      { to: "/topics", label: "话题" },
      { to: "/join", label: "入群" },
    ],
    collection_executor: [
      { to: "/map", label: "数采地图" },
      { to: "/topics", label: "话题" },
      { to: "/join", label: "入群" },
    ],
  };
  return byRole[role];
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
    <div className="min-h-screen flex items-center justify-center p-6 bg-amber-50/50">
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
          若尚未建表：在仓库中执行完整脚本{" "}
          <code className="bg-gray-100 px-1 rounded">docs/ROLE_SYSTEM_MIGRATION.sql</code>
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
  );
}

export default function App() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();
  const isAuthed = !!session?.user;
  const [accountDeleteOpen, setAccountDeleteOpen] = useState(false);

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  if (loading) {
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

  const navItems = navForRole(profile.role);

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-slate-50 to-gray-50">
      <nav className="bg-white/90 backdrop-blur border-b border-indigo-100 shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-3">
            <Link
              to={profile.role === "admin" ? "/admin" : profile.role === "scene_operator" ? "/scene" : profile.role === "collection_executor" ? "/map" : "/"}
              className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent shrink-0"
            >
              UPAIego
            </Link>
            <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
              <div
                className="hidden md:flex items-center gap-2 shrink-0 mr-1 border-r border-gray-200/90 pr-3"
                title={`${ROLE_LABELS[profile.role]} — ${ROLE_DESCRIPTIONS[profile.role]}`}
              >
                <span className="truncate text-xs text-gray-600 max-w-[180px] lg:max-w-[240px]">
                  {session?.user?.email}
                </span>
                <span
                  className="shrink-0 rounded-md bg-indigo-100 text-indigo-800 px-2 py-0.5 text-xs font-semibold tracking-tight ring-1 ring-indigo-200/80"
                  aria-label={`当前角色：${ROLE_LABELS[profile.role]}`}
                >
                  {ROLE_LABELS[profile.role]}
                </span>
              </div>
              <div
                className="flex md:hidden items-center gap-2 shrink-0 border-r border-gray-200/90 pr-2"
                title={`${ROLE_LABELS[profile.role]} — ${session?.user?.email ?? ""}`}
              >
                <span
                  className="shrink-0 rounded-md bg-indigo-100 text-indigo-800 px-2 py-0.5 text-[11px] font-semibold ring-1 ring-indigo-200/80"
                  aria-label={`当前角色：${ROLE_LABELS[profile.role]}`}
                >
                  {ROLE_LABELS[profile.role]}
                </span>
              </div>
              <div className="flex items-center gap-1 overflow-x-auto max-w-[min(100%,42vw)] sm:max-w-[min(100%,52vw)] md:max-w-none min-w-0 [scrollbar-width:thin]">
                {navItems.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={`shrink-0 px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                      location.pathname === link.to
                        ? "bg-indigo-100 text-indigo-700"
                        : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
              <AccountNavActions
                onOpenDelete={() => setAccountDeleteOpen(true)}
                onLogout={handleLogout}
              />
            </div>
          </div>
        </div>
      </nav>

      <AccountDeleteModal
        open={accountDeleteOpen}
        onClose={() => setAccountDeleteOpen(false)}
        email={session?.user?.email}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <GroupStatusBanner />
        <AnnouncementsBanner />
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
          <Route
            path="/fleet"
            element={
              <RoleRoute allow={["admin"]}>
                <Dashboard />
              </RoleRoute>
            }
          />
          <Route
            path="/register"
            element={
              <RoleRoute allow={["admin", "device_operator"]}>
                <Register />
              </RoleRoute>
            }
          />
          <Route
            path="/search"
            element={
              <RoleRoute allow={["admin", "device_operator"]}>
                <Search />
              </RoleRoute>
            }
          />
          <Route
            path="/devices/:id"
            element={
              <RoleRoute allow={["admin", "device_operator"]}>
                <DeviceDetail />
              </RoleRoute>
            }
          />
          <Route
            path="/scene"
            element={
              <RoleRoute allow={["admin", "scene_operator"]}>
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
          <Route path="/topics" element={<TopicsPage />} />
          <Route path="/join" element={<JoinGroupPage />} />
          <Route
            path="/admin/group"
            element={
              <RoleRoute allow={["admin"]}>
                <AdminGroupPage />
              </RoleRoute>
            }
          />
          <Route path="/auth" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
