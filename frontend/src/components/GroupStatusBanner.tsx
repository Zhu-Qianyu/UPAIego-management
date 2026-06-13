import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchActiveGroupId, fetchMyMemberships, fetchOwnedWorkGroup } from "../api/groups";
import { useAuth } from "../auth/AuthContext";

/**
 * 顶部提示：未入群 / 审批中
 */
export default function GroupStatusBanner() {
  const { hasRole } = useAuth();
  const [show, setShow] = useState<"none" | "pending" | "no_group">("none");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [owned, gid] = await Promise.all([fetchOwnedWorkGroup(), fetchActiveGroupId()]);
        if (cancelled) return;
        if (owned) {
          setShow("none");
          return;
        }
        if (gid) {
          setShow("none");
          return;
        }
        const rows = await fetchMyMemberships();
        const pend = rows.find((r) => r.membership_status === "pending");
        if (pend) setShow("pending");
        else setShow("no_group");
      } catch {
        if (!cancelled) setShow("none");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (show === "none") return null;

  if (show === "pending") {
    return (
      <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        你的<strong>入群申请</strong>正在等待平台管理员审批（群组管理 → 待审批入群），通过后可见本群话题与业务数据。
      </div>
    );
  }

  const isAdmin = hasRole("admin");

  return (
    <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950 flex flex-wrap items-center gap-x-2 gap-y-1">
      {isAdmin ? (
        <>
          <span>
            你尚未加入已激活的工作群组。若需<strong>新建</strong>工作群，请先
          </span>
          <Link to="/group/manage" className="font-medium text-indigo-600 underline whitespace-nowrap">
            打开群组管理创建
          </Link>
          <span>；若仅需加入他人已建好的群，可到</span>
          <Link to="/group" className="font-medium text-indigo-600 underline whitespace-nowrap">
            群组页
          </Link>
          <span>使用入群代码申请。</span>
        </>
      ) : (
        <>
          <span>你尚未加入已激活的工作群组（群组仅可由平台管理员创建）。请先</span>
          <Link to="/group" className="font-medium text-indigo-600 underline">
            申请入群
          </Link>
          <span>（向管理员索取入群代码）。</span>
        </>
      )}
    </div>
  );
}
