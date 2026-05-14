import {
  formatManualTrackedDeviceLabel,
  labelExternalDeviceStatus,
  type ManualTrackedDevice,
} from "../api/operations";

/** 外部设备贴签二维码：纯文本，扫码后直接显示登记信息（非网址）。 */
export function buildManualTrackedDeviceQrText(d: ManualTrackedDevice): string {
  return [
    "UPAIEGO外部设备",
    `登记编号：${d.public_code}`,
    `设备：${formatManualTrackedDeviceLabel(d)}`,
    `内部ID：${d.id}`,
    `运行状态：${labelExternalDeviceStatus(d.external_status)}`,
  ].join("\n");
}

/** 浏览器内打开登记详情页（不写入二维码，仅供导出表或链接使用）。 */
export function manualDeviceAdminPageUrl(publicCode: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/+$/, "");
  return `${base}/devices/manual/${encodeURIComponent(publicCode)}`;
}
