import { useCallback, useEffect, useState } from "react";
import { deleteOwnAccount } from "../api/account";
import { supabase } from "../api/supabase";

type Props = {
  open: boolean;
  onClose: () => void;
  email: string | undefined;
};

export default function AccountDeleteModal({ open, onClose, email }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const resetAndClose = useCallback(() => {
    setConfirmed(false);
    setError("");
    setLoading(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || loading) return;
      resetAndClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, resetAndClose]);

  if (!open) return null;

  async function handleConfirmDelete() {
    if (!confirmed) return;
    setError("");
    setLoading(true);
    try {
      await deleteOwnAccount();
      await supabase.auth.signOut();
      resetAndClose();
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : "注销失败，请稍后重试";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-delete-title"
      onClick={() => {
        if (!loading) resetAndClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-red-100 p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="account-delete-title" className="text-lg font-semibold text-gray-900">
          确认注销账号？
        </h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          此操作<strong className="text-red-700 font-semibold">不可恢复</strong>。将永久删除登录账号
          {email ? (
            <>
              （<span className="font-mono text-xs break-all">{email}</span>）
            </>
          ) : null}
          ，以及数据库中与该账号关联的数据，包括：
        </p>
        <ul className="text-xs text-gray-600 list-disc pl-5 space-y-1">
          <li>个人资料与角色</li>
          <li>名下设备记录</li>
          <li>你创建的场景任务与采集要求</li>
          <li>作为群主的工作群及群内话题、甲方需求、场景工位等（级联删除）</li>
          <li>群成员关系等其它引用当前用户的数据</li>
        </ul>
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          对象存储中的快照文件若仍存在，可在 Supabase Storage 中手动清理对应前缀。
        </p>

        <label className="flex items-start gap-3 cursor-pointer text-sm text-gray-700">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 rounded border-gray-300 text-red-600 focus:ring-red-500"
          />
          <span>我已了解上述后果，确认要永久注销该账号</span>
        </label>

        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
            {/delete_own_account|42883|does not exist|Could not find the function/i.test(error) ? (
              <p className="mt-2 text-gray-600">
                若提示函数不存在，请在 Supabase SQL Editor 中执行仓库内{" "}
                <code className="bg-white px-1 rounded">docs/USER_ACCOUNT_DELETE_MIGRATION.sql</code>。
              </p>
            ) : null}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            disabled={loading}
            onClick={resetAndClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!confirmed || loading}
            onClick={() => void handleConfirmDelete()}
            className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "处理中…" : "确认永久注销"}
          </button>
        </div>
      </div>
    </div>
  );
}
