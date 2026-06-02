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
  contactEmail?: string | null
): string {
  if (contactEmail?.trim()) return contactEmail.trim();
  if (phone?.trim()) return formatPhoneDisplay(phone);
  if (email && !isSyntheticAuthEmail(email)) return email;
  return "—";
}
