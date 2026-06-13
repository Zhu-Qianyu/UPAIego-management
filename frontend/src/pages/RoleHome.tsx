import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { homePathForRoles } from "../auth/roleUtils";

export default function RoleHome() {
  const { profile, loading, activeRole } = useAuth();

  if (loading || !profile) {
    return <div className="py-16 text-center text-gray-500">加载中...</div>;
  }

  return <Navigate to={homePathForRoles(profile.roles, activeRole)} replace />;
}
