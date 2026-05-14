import QRCode from "qrcode";
import {
  formatManualTrackedDeviceLabel,
  labelExternalDeviceStatus,
  type ManualTrackedDevice,
} from "../api/operations";
import { escapeHtml, openSceneListPrint } from "./sceneListPrintExport";
import { buildManualTrackedDeviceQrText, manualDeviceAdminPageUrl } from "./manualDeviceQrPayload";

async function qrDataUrlForRow(row: ManualTrackedDevice, width: number): Promise<string | null> {
  const text = buildManualTrackedDeviceQrText(row);
  try {
    return await QRCode.toDataURL(text, { width, margin: 1, errorCorrectionLevel: "M" });
  } catch {
    return null;
  }
}

function partyDeviceType(d: ManualTrackedDevice): string {
  const raw = d.party_demands;
  const p = Array.isArray(raw) ? raw[0] : raw;
  return (p?.device_type ?? "").trim() || "—";
}

function fmtZhDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("zh-CN", { hour12: false });
}

export async function buildManualDevicesExportHtml(
  docTitle: string,
  subtitle: string,
  rows: ManualTrackedDevice[],
  qrPixelWidth = 140
): Promise<string> {
  const when = fmtZhDateTime(new Date().toISOString());
  if (rows.length === 0) {
    return `
<style>
  .scene-export-wrap { font-family: system-ui, "Microsoft YaHei", "PingFang SC", sans-serif; color: #111; }
  .scene-export-wrap h1 { font-size: 18px; margin: 0 0 6px; }
  .scene-export-wrap .sub { font-size: 12px; color: #555; margin-bottom: 12px; }
  @media print {
    @page { size: A4 landscape; margin: 12mm; }
  }
</style>
<div class="scene-export-wrap">
  <h1>${escapeHtml(docTitle)}</h1>
  <div class="sub">${escapeHtml(subtitle)} · 导出时间 ${escapeHtml(when)} · 共 0 条</div>
  <p style="font-size:12px">暂无外部设备。</p>
</div>`;
  }

  const bodyRows = await Promise.all(
    rows.map(async (r, i) => {
      const dataUrl = await qrDataUrlForRow(r, qrPixelWidth);
      const label = formatManualTrackedDeviceLabel(r);
      const adminUrl = manualDeviceAdminPageUrl(r.public_code);
      const img = dataUrl
        ? `<img src="${dataUrl}" alt="" width="${qrPixelWidth}" height="${qrPixelWidth}" style="display:block;margin:0 auto;" />`
        : `<span style="color:#999;font-size:11px">二维码生成失败</span>`;
      return `<tr>
        <td style="text-align:center;vertical-align:middle">${i + 1}</td>
        <td style="text-align:center;vertical-align:middle;width:${qrPixelWidth + 24}px">${img}</td>
        <td>${escapeHtml(label)}</td>
        <td>${escapeHtml(partyDeviceType(r))}</td>
        <td style="font-family:ui-monospace,monospace;font-size:11px">${escapeHtml(r.public_code)}</td>
        <td style="font-family:ui-monospace,monospace;font-size:9px;word-break:break-all">${escapeHtml(r.id)}</td>
        <td>${escapeHtml(labelExternalDeviceStatus(r.external_status))}</td>
        <td style="font-size:9px;word-break:break-all">${escapeHtml(adminUrl)}</td>
        <td style="white-space:nowrap;font-size:10px">${escapeHtml(fmtZhDateTime(r.created_at))}</td>
      </tr>`;
    })
  );

  return `
<style>
  .scene-export-wrap { font-family: system-ui, "Microsoft YaHei", "PingFang SC", sans-serif; color: #111; }
  .scene-export-wrap h1 { font-size: 18px; margin: 0 0 6px; }
  .scene-export-wrap .sub { font-size: 12px; color: #555; margin-bottom: 12px; }
  .scene-export-wrap table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .scene-export-wrap th, .scene-export-wrap td { border: 1px solid #333; padding: 6px; vertical-align: top; word-break: break-word; }
  .scene-export-wrap th { background: #eee; text-align: left; }
  @media print {
    @page { size: A4 landscape; margin: 10mm; }
    .scene-export-wrap { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
<div class="scene-export-wrap">
  <h1>${escapeHtml(docTitle)}</h1>
  <div class="sub">${escapeHtml(subtitle)} · 导出时间 ${escapeHtml(when)} · 共 ${rows.length} 条（二维码为纯文本；表内含备查网页链接）</div>
  <table>
    <thead>
      <tr>
        <th style="width:36px">序号</th>
        <th style="width:${qrPixelWidth + 24}px">二维码</th>
        <th>展示名称</th>
        <th>甲方设备类型</th>
        <th style="width:88px">登记编号</th>
        <th style="width:120px">内部 ID</th>
        <th style="width:56px">运行状态</th>
        <th>备查网页链接</th>
        <th style="width:96px">登记时间</th>
      </tr>
    </thead>
    <tbody>${bodyRows.join("")}</tbody>
  </table>
</div>`;
}

export async function openManualDevicesPrint(
  docTitle: string,
  subtitle: string,
  rows: ManualTrackedDevice[]
): Promise<void> {
  const html = await buildManualDevicesExportHtml(docTitle, subtitle, rows);
  openSceneListPrint(html);
}
