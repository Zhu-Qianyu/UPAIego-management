import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { isProfileContactComplete, updateMyProfileContact } from "../api/profiles";

function formatProfileSaveError(message: string): string {
  if (/real_name|phone|column/i.test(message)) {
    return `${message}。若刚升级系统，请让管理员在 Supabase 执行 docs/BOUNTY_OPERATOR_AUDIT_MIGRATION.sql 后再试。`;
  }
  return message;
}

/** 老用户未登记真名/手机时，在主内容区补全（保留侧边栏导航） */
export default function ProfileContactNotice() {
  const { profile, refreshProfile } = useAuth();
  const [realName, setRealName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setRealName(profile?.real_name?.trim() ?? "");
    setPhone(profile?.phone?.trim() ?? "");
  }, [profile?.real_name, profile?.phone]);

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
      const raw =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "保存失败";
      setError(formatProfileSaveError(raw));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 mb-4 text-sm text-amber-950">
        请先补全<strong>真实姓名</strong>与<strong>手机号</strong>后再使用下方功能。侧边栏仍可查看当前账号信息。
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
        <h1 className="text-lg font-semibold text-gray-900">补全联系信息</h1>
        <p className="text-sm text-gray-600 leading-relaxed">
          用于悬赏接单联系与群内协作。若您是在此要求之前注册的账号，只需补充一次。
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
          管理员也可在 Supabase → profiles 表中直接填写 real_name、phone。
        </p>
      </div>
    </div>
  );
}
