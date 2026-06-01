import { useState } from "react";
import { supabase } from "../api/supabase";
import type { UserRole } from "../types/roles";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "../auth/roleLabels";
import { SITE_DISPLAY_NAME, SITE_SUBTITLE } from "../branding";
import { ensureProfileRow } from "../api/profiles";
import { formatAuthError } from "../utils/authErrors";

type Mode = "login" | "register";

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registerRole, setRegisterRole] = useState<UserRole>("device_operator");
  const [realName, setRealName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      if (mode === "register") {
        const name = realName.trim();
        const tel = phone.trim();
        const meta: Record<string, string> = { role: registerRole };
        if (name) meta.real_name = name;
        if (tel) meta.phone = tel;
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: meta },
        });
        if (signUpError) throw signUpError;

        if (data.user?.id) {
          await ensureProfileRow(
            data.user.id,
            registerRole,
            name || tel ? { realName: name, phone: tel } : undefined
          );
        }

        if (data.session) {
          setMessage("注册成功，已自动登录。");
          setPassword("");
          return;
        }

        setMessage(
          "注册已提交。若项目开启了邮箱确认，请查收邮件并点击确认链接后再登录；未开启确认时可直接用该邮箱登录。"
        );
        setMode("login");
        setPassword("");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : undefined;
      setError(formatAuthError(msg));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-root flex min-h-screen flex-col">
      <div className="auth-mesh" aria-hidden />
      <div className="auth-blob auth-blob--a" aria-hidden />
      <div className="auth-blob auth-blob--b" aria-hidden />
      <div className="auth-blob auth-blob--c" aria-hidden />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="w-full max-w-md">
            <div className="auth-card w-full bg-white/90 backdrop-blur-md rounded-2xl shadow-xl border border-white/60 ring-1 ring-indigo-100/80 p-6">
          <h1 className="auth-brand-title">
            {SITE_DISPLAY_NAME}
            <span className="auth-sparkle" aria-hidden>
              ✦
            </span>
          </h1>
          <p className="text-sm font-medium text-gray-600 mb-1">{SITE_SUBTITLE}</p>
          <p className="text-sm text-gray-500 mb-6">
            {mode === "login" ? "登录后进入与你角色匹配的工作台。" : "选择账号类型并注册；生产环境请限制管理员注册方式。"}
          </p>

          <div className="grid grid-cols-2 gap-2 bg-gray-100/90 rounded-lg p-1 mb-5">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`py-2 text-sm rounded-md transition-colors ${
                mode === "login" ? "bg-white text-indigo-600 font-medium shadow-sm" : "text-gray-600 hover:text-gray-800"
              }`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`py-2 text-sm rounded-md transition-colors ${
                mode === "register" ? "bg-white text-indigo-600 font-medium shadow-sm" : "text-gray-600 hover:text-gray-800"
              }`}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "register" && (
              <div>
                <span className="block text-xs font-medium text-gray-500 mb-2">注册为</span>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                    <label
                      key={r}
                      className={`flex gap-3 rounded-xl border p-3 cursor-pointer text-sm transition-colors ${
                        registerRole === r ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="role"
                        checked={registerRole === r}
                        onChange={() => setRegisterRole(r)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium text-gray-900">{ROLE_LABELS[r]}</span>
                        <span className="block text-xs text-gray-500 mt-0.5">{ROLE_DESCRIPTIONS[r]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {mode === "register" && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">真实姓名（可选）</label>
                  <input
                    type="text"
                    value={realName}
                    onChange={(e) => setRealName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="便于悬赏与群内联系"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">手机号（可选）</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="11 位手机号"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">邮箱</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="请输入邮箱"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">密码</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="至少 6 位"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {message && <p className="text-sm text-green-600">{message}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "请稍候..." : mode === "login" ? "登录" : "创建账号"}
            </button>
          </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
