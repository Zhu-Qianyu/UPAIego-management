import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

/** 各角色统一入口「群组」；第二项「群组管理」仅平台管理员可见（创建群、审批入群） */
export default function GroupTabs() {
  const { hasRole } = useAuth();
  const location = useLocation();
  const isAdmin = hasRole("admin");
  const onMember = location.pathname === "/group";
  const onManage = location.pathname.startsWith("/group/manage");

  const tabClass = (active: boolean) =>
    `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      active ? "bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200/80" : "text-gray-600 hover:bg-gray-100"
    }`;

  return (
    <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2 mb-6">
      <Link to="/group" className={tabClass(onMember)}>
        群组
      </Link>
      {isAdmin && (
        <Link to="/group/manage" className={tabClass(onManage)}>
          群组管理
        </Link>
      )}
    </div>
  );
}
