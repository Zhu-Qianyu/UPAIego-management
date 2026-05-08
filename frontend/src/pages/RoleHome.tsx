import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import Dashboard from "./Dashboard";

export default function RoleHome() {
  const { profile, loading } = useAuth();

  if (loading || !profile) {
    return <div className="py-16 text-center text-gray-500">加载中...</div>;
  }

  if (profile.role === "admin") return <Navigate to="/admin" replace />;
  if (profile.role === "scene_operator") return <Navigate to="/scene" replace />;
  if (profile.role === "collection_executor") return <Navigate to="/map" replace />;

  return <Dashboard />;
}
