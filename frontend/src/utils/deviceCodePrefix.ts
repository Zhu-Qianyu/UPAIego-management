/** 离线设备登记编号格式：4 位大写字母 + 4 位数字，如 SKAX0001；兼容旧 10 位 hex */
export const MANUAL_DEVICE_PUBLIC_CODE_RE = /^(?:[0-9A-F]{10}|[A-Z]{4}[0-9]{4})$/;

export function normalizeManualDevicePublicCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isValidManualDevicePublicCode(code: string): boolean {
  return MANUAL_DEVICE_PUBLIC_CODE_RE.test(normalizeManualDevicePublicCode(code));
}

/** 从登记编号提取 4 字母前缀（新格式） */
export function manualDevicePublicCodePrefix(code: string): string | null {
  const n = normalizeManualDevicePublicCode(code);
  const m = /^([A-Z]{4})[0-9]{4}$/.exec(n);
  return m ? m[1] : null;
}

export function formatManualDevicePublicCode(code: string): string {
  return normalizeManualDevicePublicCode(code);
}
