import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { UserRole } from "../types/roles";
import { useAuth } from "../auth/AuthContext";

export default function RoleRoute({
  allow,
  children,
}: {
  allow: readonly UserRole[];
  children: ReactNode;
}) {
  const { profile, loading, hasAnyRole } = useAuth();

  if (loading || !profile) {
    return <div className="py-16 text-center text-gray-500">加载权限...</div>;
  }

  if (!hasAnyRole(allow)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
