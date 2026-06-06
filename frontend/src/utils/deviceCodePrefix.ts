import { pinyin } from "pinyin-pro";

/** 从甲方公司名生成离线设备编号前缀，如「智元觅蜂」→ ZYMF */
export function deriveDeviceCodePrefix(company: string): string {
  const cleaned = company.trim().replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "");
  if (!cleaned) return "DEV";

  if (/^[A-Za-z0-9]+$/.test(cleaned)) {
    return cleaned.toUpperCase().slice(0, 8) || "DEV";
  }

  const firsts = pinyin(cleaned, { pattern: "first", toneType: "none", type: "array" }) as string[];
  const prefix = firsts
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return prefix.slice(0, 8) || "DEV";
}

/** 格式化展示：登记编号 ZYMF0001 */
export function formatManualDevicePublicCode(code: string): string {
  return code.trim().toUpperCase();
}
