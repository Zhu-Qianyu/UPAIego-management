import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { isProfileContactComplete, updateMyProfileContact } from "../api/profiles";
import AccountDeleteModal from "./AccountDeleteModal";

/** 老用户未登记真名/手机时，登录后先补全再进入系统 */
export default function ProfileContactNotice() {
  const { profile, refreshProfile, session } = useAuth();
  const [realName, setRealName] = useState(profile?.real_name?.trim() ?? "");
  const [phone, setPhone] = useState(profile?.phone?.trim() ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [accountDeleteOpen, setAccountDeleteOpen] = useState(false);

  if (profile && isProfileContactComplete(profile)) {
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await updateMyProfileContact(realName, phone);
      await refreshProfile();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "保存失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-indigo-50/40">
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm space-y-4">
          <h1 className="text-lg font-semibold text-gray-900">补全联系信息</h1>
          <p className="text-sm text-gray-600 leading-relaxed">
            系统已要求登记<strong>真实姓名</strong>与<strong>手机号</strong>，用于悬赏接单联系、群内协作等。
            您是在此要求之前注册的账号，请补充一次后即可正常使用。
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block text-sm">
              <span className="text-gray-600">真实姓名</span>
              <input
                type="text"
                required
                value={realName}
                onChange={(e) => setRealName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                placeholder="与证件一致"
              />
            </label>
            <label className="block text-sm">
              <span className="text-gray-600">手机号</span>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                placeholder="11 位手机号"
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? "保存中…" : "保存并继续"}
            </button>
          </form>

          <p className="text-xs text-gray-500 border-t border-gray-100 pt-3">
            管理员也可在 Supabase Table Editor 中直接编辑 <code className="bg-gray-100 px-1 rounded">profiles</code>{" "}
            的 real_name、phone 字段为您补录。
          </p>

          <button
            type="button"
            onClick={() => setAccountDeleteOpen(true)}
            className="w-full py-2 rounded-xl border border-red-200 text-sm text-red-700 hover:bg-red-50"
          >
            注销账号
          </button>
        </div>
      </div>

      <AccountDeleteModal
        open={accountDeleteOpen}
        onClose={() => setAccountDeleteOpen(false)}
        email={session?.user?.email}
      />
    </div>
  );
}
