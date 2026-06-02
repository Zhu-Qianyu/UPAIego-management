/** 将手机号转为 Supabase Auth 用的 synthetic email（无需真实邮箱/SMS） */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits;
  if (digits.length === 13 && digits.startsWith("86")) return digits.slice(2);
  return digits;
}

export function phoneToAuthEmail(phone: string): string {
  const n = normalizePhone(phone);
  if (!n) throw new Error("手机号无效");
  return `p${n}@upaiego.auth`;
}

export function isValidChinaMobile(phone: string): boolean {
  const n = normalizePhone(phone);
  return /^1\d{10}$/.test(n);
}

export function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone?.trim()) return "—";
  const n = normalizePhone(phone);
  if (n.length === 11) return `${n.slice(0, 3)} ${n.slice(3, 7)} ${n.slice(7)}`;
  return phone.trim();
}

export function isSyntheticAuthEmail(email: string | null | undefined): boolean {
  return Boolean(email?.endsWith("@upaiego.auth"));
}

export function accountDisplayLabel(
  phone: string | null | undefined,
  email: string | null | undefined,
  contactEmail?: string | null,
  realName?: string | null
): string {
  if (realName?.trim()) return realName.trim();
  if (contactEmail?.trim()) return contactEmail.trim();
  if (phone?.trim()) return formatPhoneDisplay(phone);
  if (email && !isSyntheticAuthEmail(email)) return email;
  return "个人信息";
}

/** 登录：手机号（新账号）或邮箱（含历史邮箱注册账号） */
export function resolveLoginAuthEmail(loginId: string): string {
  const raw = loginId.trim();
  if (!raw) throw new Error("请输入手机号或邮箱");
  if (raw.includes("@")) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) throw new Error("邮箱格式不正确");
    return raw.toLowerCase();
  }
  if (!isValidChinaMobile(raw)) throw new Error("请输入有效的手机号或邮箱");
  return phoneToAuthEmail(normalizePhone(raw));
}

export function describeAuthLoginEmail(email: string | null | undefined): string {
  if (!email) return "—";
  if (isSyntheticAuthEmail(email)) {
    const digits = email.replace(/^p/, "").replace(/@upaiego\.auth$/, "");
    return `手机号 ${formatPhoneDisplay(digits)}（系统登录标识）`;
  }
  return email;
}
