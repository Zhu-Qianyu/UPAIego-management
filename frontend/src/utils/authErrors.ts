/** 将 Supabase Auth 英文错误转为用户可读中文说明 */
export function formatAuthError(message: string | undefined | null): string {
  const raw = (message ?? "").trim();
  if (!raw) return "认证失败，请检查账号和密码。";

  const lower = raw.toLowerCase();

  if (
    lower.includes("email rate limit") ||
    lower.includes("rate limit exceeded") ||
    lower.includes("over_email_send_rate_limit")
  ) {
    return "操作过于频繁，请稍后再试。";
  }

  if (lower.includes("user already registered") || lower.includes("already been registered")) {
    return "该手机号已注册，请直接登录。";
  }

  if (lower.includes("invalid login credentials") || lower.includes("invalid credentials")) {
    return "手机号/邮箱或密码不正确。";
  }

  if (
    lower.includes("error sending confirmation email") ||
    lower.includes("sending confirmation email")
  ) {
    return (
      "注册确认邮件发送失败。自建 Supabase 请在服务器 ~/supabase/docker/.env 设置 ENABLE_EMAIL_AUTOCONFIRM=true 后执行：" +
      "bash scripts/server/fix_auth_email_autoconfirm.sh（或 docker compose restart auth）。"
    );
  }

  if (lower.includes("email not confirmed")) {
    return "账号尚未激活。请在服务器 ~/supabase/docker/.env 设置 ENABLE_EMAIL_AUTOCONFIRM=true 并重启 auth 容器。";
  }

  if (lower.includes("signup is disabled")) {
    return "当前环境已关闭自助注册，请联系管理员开通账号。";
  }

  if (lower.includes("database error saving new user")) {
    return (
      "注册时数据库写入失败。常见原因：① 未在 Supabase 执行手机注册相关 SQL（见 docs/REGISTRATION_SIGNUP_FIX.sql）；" +
      "② 非管理员未填或填错群组号；③ 库表缺少 real_name/phone/contact_email 等列。" +
      "请在 Supabase → Logs → Postgres 查看具体报错后重试。"
    );
  }

  if (lower.includes("invalid invite") || lower.includes("群组") || lower.includes("入群") || lower.includes("invite_code")) {
    return raw;
  }

  if (/[\u4e00-\u9fff]/.test(raw)) return raw;

  return raw;
}
