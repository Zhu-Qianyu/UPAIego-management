import { useState } from "react";
import { supabase } from "../api/supabase";
import type { UserRole } from "../types/roles";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "../auth/roleLabels";
import { SITE_DISPLAY_NAME, SITE_SUBTITLE } from "../branding";
import { ensureProfileRow } from "../api/profiles";
import { completeSignupGroupRequest } from "../api/groups";
import { formatAuthError } from "../utils/authErrors";
import { isValidChinaMobile, normalizePhone, phoneToAuthEmail } from "../utils/phoneAuth";

type Mode = "login" | "register";

const NON_ADMIN_ROLES: UserRole[] = ["device_operator", "scene_operator", "collection_executor"];

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registerRole, setRegisterRole] = useState<UserRole>("device_operator");
  const [realName, setRealName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const needsGroupCode = mode === "register" && registerRole !== "admin";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      const tel = normalizePhone(phone);
      if (!isValidChinaMobile(phone)) {
        setError("请输入有效的 11 位中国大陆手机号");
        return;
      }

      const authEmail = phoneToAuthEmail(tel);

      if (mode === "register") {
        const name = realName.trim();
        const contactEmail = email.trim();
        const code = inviteCode.trim().toUpperCase();

        if (registerRole !== "admin" && !code) {
          setError("设备运维员、场景操作员、数采执行员注册时必须填写群组号（入群代码）");
          return;
        }

        const meta: Record<string, string> = {
          role: registerRole,
          phone: tel,
        };
        if (name) meta.real_name = name;
        if (contactEmail) meta.contact_email = contactEmail;

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: authEmail,
          password,
          options: { data: meta },
        });
        if (signUpError) throw signUpError;

        if (data.user?.id) {
          await ensureProfileRow(data.user.id, registerRole, {
            realName: name,
            phone: tel,
            contactEmail: contactEmail || undefined,
          });
        }

        if (data.session && registerRole !== "admin") {
          await completeSignupGroupRequest(code);
        }

        if (data.session) {
          setMessage(
            registerRole === "admin"
              ? "注册成功，已自动登录。"
              : "注册已提交，请等待平台管理员在「群组管理」中审批通过后再使用系统。"
          );
          setPassword("");
          return;
        }

        setMessage("注册已提交。若无法自动登录，请稍后用手机号和密码登录。");
        setMode("login");
        setPassword("");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: authEmail,
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
                {mode === "login"
                  ? "使用手机号与密码登录。"
                  : "手机号注册；非管理员角色需填写群组号，注册后由平台管理员审批。"}
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

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">手机号</label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="11 位手机号"
                    autoComplete="tel"
                  />
                </div>

                {mode === "register" && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">真实姓名（可选）</label>
                      <input
                        type="text"
                        value={realName}
                        onChange={(e) => setRealName(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="便于群内协作联系"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">邮箱（可选）</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="用于接收通知，可不填"
                        autoComplete="email"
                      />
                    </div>
                    {needsGroupCode && (
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          群组号（入群代码）<span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={inviteCode}
                          onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          placeholder="向管理员索取"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          {NON_ADMIN_ROLES.map((r) => ROLE_LABELS[r]).join("、")}注册必填，提交后需管理员审批。
                        </p>
                      </div>
                    )}
                  </>
                )}

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
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                  />
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}
                {message && <p className="text-sm text-green-600">{message}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? "请稍候..." : mode === "login" ? "登录" : "提交注册"}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
