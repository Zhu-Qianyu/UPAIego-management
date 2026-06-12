import { DEFAULT_SCENE_CATEGORIES } from "../utils/sceneCategories";

/** 与 edge formFillInfer.ts 同步的推断辅助函数 */

export function extractQuotedOrPlain(s: string): string {
  const q = s.match(/[「"']([^」"']+)[」"']/);
  if (q) return q[1].trim();
  return s.trim();
}

export function fieldValue(body: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}[为是]?[：:]?\\s*[「"']?([^」"',，\\n]+)[」"']?`, "i");
    const m = body.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

export function parseDeviceCount(text: string): number | null {
  const m = text.match(/(\d+)\s*台/);
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

export function extractClientCompany(text: string): string | null {
  const fromLabel = fieldValue(text, ["甲方", "公司", "公司名", "客户"]);
  if (fromLabel) return fromLabel;
  const m = text.match(/甲方[是为：:\s]+([^，,\n]+)/);
  if (m?.[1]?.trim()) return m[1].trim();
  return null;
}

export function extractDeviceType(text: string): string | null {
  return fieldValue(text, ["类型", "设备类型", "设备"]);
}

export function defaultLabelPrefix(deviceType: string): string {
  const t = deviceType.trim().replace(/设备$/u, "").trim();
  return t || "设备";
}

/** 批量离线设备共用设备简称（不含登记编号序号） */
export function batchDeviceShortLabel(deviceType: string): string {
  return defaultLabelPrefix(deviceType);
}

export function partyDemandDefaults(client_company: string, device_type?: string | null) {
  return {
    client_company,
    device_type: device_type?.trim() || "通用设备",
    max_hours_per_scene: 8,
    scene_categories: [...DEFAULT_SCENE_CATEGORIES],
    total_hours_unlimited: true,
  };
}

export function isFakeFormFillToast(message: string): boolean {
  return /添加设备信息|甲方\s*=|数量\s*=|设备信息：|已提示添加/.test(message);
}
