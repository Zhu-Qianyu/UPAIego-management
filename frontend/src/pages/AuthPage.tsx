import { useState } from "react";
import { supabase } from "../api/supabase";
import type { UserRole } from "../types/roles";
import { NON_ADMIN_ROLES } from "../types/roles";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "../auth/roleLabels";
import { validateRegisterRoles } from "../auth/roleUtils";
import { SITE_DISPLAY_NAME, SITE_SUBTITLE, SITE_COMPANY_NAME, SITE_ICP_NUMBER, SITE_ICP_URL } from "../branding";
import { ensureProfileRow } from "../api/profiles";
import { validateInviteCode } from "../api/groups";
import { formatAuthError } from "../utils/authErrors";
import { isValidChinaMobile, normalizePhone, phoneToAuthEmail, resolveLoginAuthEmail } from "../utils/phoneAuth";

type Mode = "login" | "register";

const NON_ADMIN_ROLE_LIST: UserRole[] = [...NON_ADMIN_ROLES];

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [loginId, setLoginId] = useState("");
  const [registerPhone, setRegisterPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registerRoles, setRegisterRoles] = useState<UserRole[]>(["device_operator"]);
  const [registerAsAdmin, setRegisterAsAdmin] = useState(false);
  const [realName, setRealName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [invitePreview, setInvitePreview] = useState<string | null>(null);
  const [invitePreviewErr, setInvitePreviewErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const needsGroupCode = mode === "register" && !registerAsAdmin;
  const groupCodeMissing = needsGroupCode && !inviteCode.trim();
  const canSubmitRegister = mode === "login" || !groupCodeMissing;

  async function previewInviteCode(code: string) {
    const c = code.trim();
    if (!c) {
      setInvitePreview(null);
      setInvitePreviewErr("");
      return;
    }
    try {
      const { displayName } = await validateInviteCode(c);
      setInvitePreview(displayName);
      setInvitePreviewErr("");
    } catch (e: unknown) {
      setInvitePreview(null);
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message: unknown }).message)
          : "群组号无效";
      setInvitePreviewErr(msg);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      if (mode === "register") {
        const tel = normalizePhone(registerPhone);
        if (!isValidChinaMobile(registerPhone)) {
          setError("请输入有效的 11 位中国大陆手机号");
          return;
        }

        const authEmail = phoneToAuthEmail(tel);
        const name = realName.trim();
        const contactEmail = email.trim();
        const code = inviteCode.trim().toUpperCase();

        const roles = registerAsAdmin ? (["admin"] as UserRole[]) : validateRegisterRoles(registerRoles);

        if (!registerAsAdmin) {
          if (!code) {
            setError(`${NON_ADMIN_ROLE_LIST.map((r) => ROLE_LABELS[r]).join("、")}注册时必须填写群组号，否则无法注册`);
            return;
          }
          await validateInviteCode(code);
        }

        const meta: Record<string, string | string[]> = {
          roles,
          role: roles[0],
          phone: tel,
        };
        if (!registerAsAdmin && code) meta.invite_code = code;
        if (name) meta.real_name = name;
        if (contactEmail) meta.contact_email = contactEmail;

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: authEmail,
          password,
          options: { data: meta },
        });
        if (signUpError) throw signUpError;

        if (data.user?.id) {
          await ensureProfileRow(data.user.id, roles, {
            realName: name,
            phone: tel,
            contactEmail: contactEmail || undefined,
          });
        }

        if (data.session) {
          setMessage(
            registerAsAdmin
              ? "注册成功，已自动登录。"
              : "注册已提交，请等待平台管理员在「群组管理」中审批通过后再使用系统。"
          );
          setPassword("");
          return;
        }

        setMessage("注册已提交。若无法自动登录，请稍后用手机号和密码登录。");
        setMode("login");
        setLoginId(registerPhone);
        setPassword("");
        return;
      }

      const authEmail = resolveLoginAuthEmail(loginId);
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
                  ? "使用手机号或邮箱与密码登录（老账号若无手机号请用注册邮箱）。"
                  : registerAsAdmin
                    ? "平台管理员注册：无需群组号，注册后可直接创建/管理工作群。"
                    : "业务成员注册：须填写有效群组号，由对应管理员审批入群。"}
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
                  <div className="space-y-3">
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-violet-200 bg-violet-50/80 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={registerAsAdmin}
                        onChange={(e) => {
                          setRegisterAsAdmin(e.target.checked);
                          if (e.target.checked) setInviteCode("");
                        }}
                        className="mt-0.5 rounded border-violet-300 text-violet-600 focus:ring-violet-500"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-violet-950">注册为平台管理员</span>
                        <span className="block text-xs text-violet-800/90 mt-0.5 leading-relaxed">
                          {ROLE_DESCRIPTIONS.admin} 无需群组号，不与其它职能兼任。
                        </span>
                      </span>
                    </label>

                    {!registerAsAdmin && (
                      <>
                        <span className="block text-xs font-medium text-gray-500">业务职能（可多选）</span>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          {NON_ADMIN_ROLE_LIST.map((r) => {
                            const checked = registerRoles.includes(r);
                            return (
                              <label
                                key={r}
                                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border px-2 py-3 text-center text-sm transition-colors ${
                                  checked
                                    ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200"
                                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    setRegisterRoles((prev) => {
                                      if (prev.includes(r)) {
                                        const next = prev.filter((x) => x !== r);
                                        return next.length ? next : prev;
                                      }
                                      return [...prev, r];
                                    });
                                  }}
                                  className="sr-only"
                                />
                                <span className="font-medium text-gray-900 leading-snug">{ROLE_LABELS[r]}</span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed">
                          {registerRoles.map((r) => ROLE_DESCRIPTIONS[r]).join("；")}
                        </p>
                        <p className="text-xs text-amber-700">注册必填群组号，归属对应管理员工作群</p>
                      </>
                    )}
                  </div>
                )}

                {needsGroupCode && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 space-y-2">
                    <label className="block text-xs font-semibold text-amber-900">
                      群组号（入群代码）<span className="text-red-600">* 必填</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={inviteCode}
                      onChange={(e) => {
                        const v = e.target.value.toUpperCase();
                        setInviteCode(v);
                        setInvitePreview(null);
                        setInvitePreviewErr("");
                      }}
                      onBlur={() => void previewInviteCode(inviteCode)}
                      className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder="填写你要加入的管理员所发群组号"
                    />
                    {invitePreview && (
                      <p className="text-xs text-emerald-800 bg-emerald-50 rounded-lg px-2 py-1.5 ring-1 ring-emerald-100">
                        将加入工作群「{invitePreview}」，由该群平台管理员审批
                      </p>
                    )}
                    {invitePreviewErr && (
                      <p className="text-xs text-red-600">{invitePreviewErr}</p>
                    )}
                    <p className="text-xs text-amber-800">
                      群组号不必与他人相同；填哪个有效群组号，就归到哪位管理员的工作群下。未填或无效将无法注册。
                    </p>
                  </div>
                )}

                {mode === "login" ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">手机号或邮箱</label>
                    <input
                      type="text"
                      required
                      value={loginId}
                      onChange={(e) => setLoginId(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="11 位手机号或注册邮箱"
                      autoComplete="username"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">手机号</label>
                    <input
                      type="tel"
                      required
                      value={registerPhone}
                      onChange={(e) => setRegisterPhone(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="11 位手机号"
                      autoComplete="tel"
                    />
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
                  disabled={loading || !canSubmitRegister}
                  className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? "请稍候..." : mode === "login" ? "登录" : "提交注册"}
                </button>
              </form>
            </div>
            <p className="mt-4 text-center text-[11px] leading-relaxed text-gray-500">
              {SITE_COMPANY_NAME}
              <span className="mx-1.5 text-gray-400">·</span>
              <a
                href={SITE_ICP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-500 hover:text-indigo-700 underline-offset-2 hover:underline"
              >
                {SITE_ICP_NUMBER}
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
