import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { updateMyAuthEmail, updateMyPassword, updateMyProfile } from "../api/profiles";
import { formatRolesLabel } from "../auth/roleUtils";
import {
  describeAuthLoginEmail,
  formatPhoneDisplay,
  isSyntheticAuthEmail,
  isValidChinaMobile,
} from "../utils/phoneAuth";
import { Alert, PageHero, PageShell, Panel, UiButton, uiInput, uiLabel } from "../components/ui/PageLayout";

export default function ProfilePage() {
  const { profile, session, refreshProfile } = useAuth();
  const authEmail = session?.user?.email ?? "";

  const [realName, setRealName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [profileBusy, setProfileBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!profile) return;
    setRealName(profile.real_name ?? "");
    setDisplayName(profile.display_name ?? "");
    setPhone(profile.phone ?? "");
    setContactEmail(profile.contact_email ?? "");
    setLoginEmail(isSyntheticAuthEmail(authEmail) ? "" : authEmail);
  }, [profile, authEmail]);

  if (!profile) {
    return <div className="py-16 text-center text-gray-500">加载中…</div>;
  }

  async function onSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    setProfileBusy(true);
    try {
      await updateMyProfile({
        realName,
        displayName,
        phone,
        contactEmail,
      });
      await refreshProfile();
      setMsg("个人资料已保存");
    } catch (e: unknown) {
      const m =
        e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "保存失败";
      setErr(m);
    } finally {
      setProfileBusy(false);
    }
  }

  async function onSaveLoginEmail(e: React.FormEvent) {
    e.preventDefault();
    if (isSyntheticAuthEmail(authEmail)) {
      setErr("当前账号以手机号注册，登录请使用手机号；如需邮箱登录请联系管理员或在此填写联系邮箱");
      return;
    }
    setErr("");
    setMsg("");
    setEmailBusy(true);
    try {
      await updateMyAuthEmail(loginEmail);
      setMsg("登录邮箱已更新（若项目开启邮箱确认，请查收验证邮件）");
    } catch (e: unknown) {
      const m =
        e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "更新失败";
      setErr(m);
    } finally {
      setEmailBusy(false);
    }
  }

  async function onSavePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setErr("两次输入的密码不一致");
      return;
    }
    setErr("");
    setMsg("");
    setPwdBusy(true);
    try {
      await updateMyPassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setMsg("密码已更新");
    } catch (e: unknown) {
      const m =
        e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "更新失败";
      setErr(m);
    } finally {
      setPwdBusy(false);
    }
  }

  return (
    <PageShell>
      <PageHero
        eyebrow="账号"
        title="个人信息"
        description="维护姓名、手机、邮箱等资料；登录方式见下方说明。"
        accent="indigo"
      />

      {err && <Alert variant="error">{err}</Alert>}
      {msg && <Alert variant="success">{msg}</Alert>}

      <Panel title="基本资料" description="悬赏联系人、群内展示等会使用真实姓名与手机号">
        <form onSubmit={onSaveProfile} className="space-y-4 max-w-lg">
          <div className="text-sm text-slate-600 rounded-lg bg-slate-50 px-3 py-2">
            角色：<strong>{formatRolesLabel(profile.roles)}</strong>
            <span className="text-slate-400 ml-2 font-mono text-xs">{profile.id.slice(0, 8)}…</span>
          </div>
          <label className="block">
            <span className={uiLabel}>真实姓名</span>
            <input className={uiInput} value={realName} onChange={(e) => setRealName(e.target.value)} />
          </label>
          <label className="block">
            <span className={uiLabel}>显示名称（可选）</span>
            <input className={uiInput} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label className="block">
            <span className={uiLabel}>手机号</span>
            <input
              className={uiInput}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="11 位手机号"
            />
            {phone && isValidChinaMobile(phone) && (
              <span className="text-xs text-slate-500 mt-1 block">格式化：{formatPhoneDisplay(phone)}</span>
            )}
          </label>
          <label className="block">
            <span className={uiLabel}>联系邮箱（可选）</span>
            <input
              className={uiInput}
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="用于通知，可与登录邮箱不同"
            />
          </label>
          <UiButton type="submit" disabled={profileBusy}>
            {profileBusy ? "保存中…" : "保存资料"}
          </UiButton>
        </form>
      </Panel>

      <Panel title="登录方式" description="新用户使用手机号+密码登录；历史账号可使用注册邮箱登录">
        <div className="space-y-4 max-w-lg text-sm">
          <p className="text-slate-600">
            当前登录标识：<strong>{describeAuthLoginEmail(authEmail)}</strong>
          </p>
          {!isSyntheticAuthEmail(authEmail) ? (
            <form onSubmit={onSaveLoginEmail} className="space-y-3">
              <label className="block">
                <span className={uiLabel}>登录邮箱</span>
                <input
                  className={uiInput}
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                />
              </label>
              <UiButton type="submit" variant="secondary" disabled={emailBusy}>
                {emailBusy ? "更新中…" : "更新登录邮箱"}
              </UiButton>
            </form>
          ) : (
            <p className="text-slate-500 text-xs leading-relaxed">
              您使用手机号注册，请用<strong>手机号 + 密码</strong>登录。上方「手机号」填写后保存即可；联系邮箱仅用于通知。
            </p>
          )}
        </div>
      </Panel>

      <Panel title="修改密码">
        <form onSubmit={onSavePassword} className="space-y-4 max-w-lg">
          <label className="block">
            <span className={uiLabel}>新密码</span>
            <input
              className={uiInput}
              type="password"
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="block">
            <span className={uiLabel}>确认新密码</span>
            <input
              className={uiInput}
              type="password"
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <UiButton type="submit" variant="secondary" disabled={pwdBusy || !newPassword}>
            {pwdBusy ? "更新中…" : "更新密码"}
          </UiButton>
        </form>
      </Panel>
    </PageShell>
  );
}
