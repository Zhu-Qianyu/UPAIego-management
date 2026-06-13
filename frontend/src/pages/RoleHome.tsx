import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { homePathForRoles } from "../auth/roleUtils";
import DeviceOverviewPage from "./DeviceOverviewPage";

export default function RoleHome() {
  const { profile, loading, activeRole, hasRole } = useAuth();

  if (loading || !profile) {
    return <div className="py-16 text-center text-gray-500">加载中...</div>;
  }

  if (hasRole("device_operator")) {
    return <DeviceOverviewPage />;
  }

  return <Navigate to={homePathForRoles(profile.roles, activeRole)} replace />;
}
