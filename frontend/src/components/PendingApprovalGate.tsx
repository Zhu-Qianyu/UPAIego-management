import { useCallback, useEffect, useState } from "react";
import { supabase } from "../api/supabase";
import { fetchActiveGroupId, fetchMyMemberships, completeSignupGroupRequest } from "../api/groups";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS } from "../auth/roleLabels";
import { formatPhoneDisplay } from "../utils/phoneAuth";
import Spinner from "./Spinner";

/** 非管理员且未入群：待审批 / 无群组 / 被拒绝时拦截 */
export default function PendingApprovalGate({ children }: { children: React.ReactNode }) {
  const { profile, refreshProfile } = useAuth();
  const [checking, setChecking] = useState(true);
  const [reapplyCode, setReapplyCode] = useState("");
  const [reapplyBusy, setReapplyBusy] = useState(false);
  const [reapplyErr, setReapplyErr] = useState("");
  const [blocked, setBlocked] = useState<"none" | "pending" | "rejected" | "no_group">("none");

  const check = useCallback(async () => {
    if (!profile || profile.role === "admin") {
      setBlocked("none");
      setChecking(false);
      return;
    }
    try {
      const [gid, rows] = await Promise.all([fetchActiveGroupId(), fetchMyMemberships()]);
      if (gid) {
        setBlocked("none");
        return;
      }
      if (rows.some((r) => r.membership_status === "pending")) {
        setBlocked("pending");
        return;
      }
      if (rows.length > 0 && rows.every((r) => r.membership_status === "rejected")) {
        setBlocked("rejected");
        return;
      }
      if (rows.length === 0) {
        setBlocked("no_group");
        return;
      }
      setBlocked("none");
    } finally {
      setChecking(false);
    }
  }, [profile]);

  useEffect(() => {
    setChecking(true);
    void check();
  }, [check]);

  if (checking) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (blocked === "none") return <>{children}</>;

  async function logout() {
    await supabase.auth.signOut();
  }

  const showReapply = blocked === "rejected" || blocked === "no_group";

  return (
    <div className="max-w-lg mx-auto px-4 py-16">
      <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-8 shadow-sm text-center space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700 text-2xl">
          {blocked === "pending" ? "⏳" : "✕"}
        </div>
        <h1 className="text-xl font-semibold text-gray-900">
          {blocked === "pending"
            ? "等待管理员审批"
            : blocked === "no_group"
              ? "缺少群组绑定"
              : "入群申请未通过"}
        </h1>
        <p className="text-sm text-gray-600 leading-relaxed">
          {blocked === "pending" ? (
            <>
              您的账号（{ROLE_LABELS[profile!.role]} · 手机 {formatPhoneDisplay(profile!.phone)}）已提交注册。
              平台管理员在「群组管理」中审批通过后即可使用系统。
            </>
          ) : blocked === "no_group" ? (
            <>
              当前账号未关联任何群组。非管理员注册时必须填写群组号；请退出后重新注册，或下方补填群组号提交申请。
            </>
          ) : (
            <>您的入群申请已被拒绝。请填写新的群组号重新提交，或联系管理员。</>
          )}
        </p>
        {showReapply && (
          <div className="flex flex-col gap-2 text-left max-w-sm mx-auto pt-2">
            <input
              value={reapplyCode}
              onChange={(e) => setReapplyCode(e.target.value.toUpperCase())}
              placeholder="群组号（必填）"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
            />
            {reapplyErr && <p className="text-xs text-red-600">{reapplyErr}</p>}
            <button
              type="button"
              disabled={reapplyBusy || !reapplyCode.trim()}
              onClick={async () => {
                setReapplyBusy(true);
                setReapplyErr("");
                try {
                  await completeSignupGroupRequest(reapplyCode.trim());
                  setReapplyCode("");
                  setChecking(true);
                  await check();
                } catch (e: unknown) {
                  const msg =
                    e && typeof e === "object" && "message" in e
                      ? String((e as { message: unknown }).message)
                      : "提交失败";
                  setReapplyErr(msg);
                } finally {
                  setReapplyBusy(false);
                }
              }}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {reapplyBusy ? "提交中…" : "提交群组号申请"}
            </button>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
          <button
            type="button"
            onClick={() => {
              setChecking(true);
              void refreshProfile().then(() => check());
            }}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
          >
            刷新状态
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            className="px-4 py-2 rounded-xl border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
          >
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
