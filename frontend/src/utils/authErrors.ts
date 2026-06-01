/** 将 Supabase Auth 英文错误转为用户可读中文说明 */
export function formatAuthError(message: string | undefined | null): string {
  const raw = (message ?? "").trim();
  if (!raw) return "认证失败，请检查邮箱和密码。";

  const lower = raw.toLowerCase();

  if (
    lower.includes("email rate limit") ||
    lower.includes("rate limit exceeded") ||
    lower.includes("over_email_send_rate_limit")
  ) {
    return (
      "注册/找回密码邮件发送过于频繁（Supabase 邮件频率限制）。" +
      "请等待约 1 小时后再用同一邮箱注册，或联系管理员在 Supabase 控制台调高 Auth 邮件限额；" +
      "开发环境可在 Authentication → Providers → Email 中关闭「Confirm email」以减少发信。"
    );
  }

  if (lower.includes("user already registered") || lower.includes("already been registered")) {
    return "该邮箱已注册。请直接登录，或使用其它邮箱。";
  }

  if (lower.includes("invalid login credentials") || lower.includes("invalid credentials")) {
    return "邮箱或密码不正确。若刚注册，请先查收确认邮件完成验证后再登录。";
  }

  if (lower.includes("email not confirmed")) {
    return "邮箱尚未完成确认。请查收注册邮件中的确认链接后再登录。";
  }

  if (lower.includes("signup is disabled")) {
    return "当前环境已关闭自助注册，请联系管理员开通账号。";
  }

  return raw;
}
