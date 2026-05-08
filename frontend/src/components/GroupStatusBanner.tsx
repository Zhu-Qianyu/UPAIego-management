import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchActiveGroupId, fetchMyMemberships, fetchOwnedWorkGroup } from "../api/groups";

/**
 * 顶部提示：未入群 / 审批中
 */
export default function GroupStatusBanner() {
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
        你的<strong>入群申请</strong>正在等待管理员审批，通过后可见本群话题与业务数据。
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950 flex flex-wrap items-center gap-2">
      <span>你尚未加入已激活的工作群组，请先</span>
      <Link to="/join" className="font-medium text-indigo-600 underline">
        申请入群
      </Link>
    </div>
  );
}
