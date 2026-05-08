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
import { useAuth } from "./auth/AuthContext";
import { supabase } from "./api/supabase";
import { ROLE_LABELS } from "./auth/roleLabels";
import type { UserRole } from "./types/roles";
import RoleRoute from "./components/RoleRoute";
import AnnouncementsBanner from "./components/AnnouncementsBanner";

function navForRole(role: UserRole): { to: string; label: string }[] {
  const byRole: Record<UserRole, { to: string; label: string }[]> = {
    admin: [
      { to: "/admin", label: "管理台" },
      { to: "/fleet", label: "全量设备" },
      { to: "/register", label: "注册设备" },
      { to: "/search", label: "搜索" },
      { to: "/scene", label: "场景任务" },
      { to: "/map", label: "数采地图" },
    ],
    device_operator: [
      { to: "/", label: "设备总览" },
      { to: "/register", label: "注册设备" },
      { to: "/search", label: "搜索" },
    ],
    scene_operator: [{ to: "/scene", label: "场景任务" }],
    collection_executor: [{ to: "/map", label: "数采地图" }],
  };
  return byRole[role];
}

function MigrationNotice() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-amber-50/50">
      <div className="max-w-lg rounded-2xl border border-amber-200 bg-white p-6 text-sm text-amber-950 shadow-sm">
        <p className="font-semibold text-base mb-2">未检测到账号角色（profiles）</p>
        <p className="text-amber-900/90 mb-3">
          请已在 Supabase 执行角色迁移脚本后再刷新页面。脚本路径：
        </p>
        <code className="block text-xs bg-amber-100/80 rounded-lg p-3 break-all text-amber-950">
          docs/ROLE_SYSTEM_MIGRATION.sql
        </code>
      </div>
    </div>
  );
}

export default function App() {
  const { session, profile, loading } = useAuth();
  const location = useLocation();
  const isAuthed = !!session?.user;

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
    return <MigrationNotice />;
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
            <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end">
              <span className="hidden lg:inline text-xs text-gray-500 max-w-[200px] truncate">
                {session?.user?.email} · {ROLE_LABELS[profile.role]}
              </span>
              {navItems.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className={`px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors ${
                    location.pathname === link.to
                      ? "bg-indigo-100 text-indigo-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <button
                onClick={handleLogout}
                className="px-2 sm:px-3 py-2 rounded-lg text-xs sm:text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              >
                退出
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
          <Route path="/auth" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
