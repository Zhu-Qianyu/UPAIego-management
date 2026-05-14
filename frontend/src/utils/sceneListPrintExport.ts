import type { PartyDemand, ScenarioPosition } from "../api/operations";
import type { SceneTask } from "../api/scenes";
import { labelSceneCategories } from "./sceneCategories";

function sceneTaskStatusLabel(s: SceneTask["status"]): string {
  switch (s) {
    case "draft":
      return "草稿";
    case "published":
      return "已发布";
    case "closed":
      return "已关闭";
    default:
      return String(s);
  }
}

export function escapeHtml(s: string | null | undefined): string {
  if (s == null || s === "") return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtZhDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("zh-CN", { hour12: false });
}

function wrapPrintHtml(bodyFragment: string): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><title>列表</title></head><body style="margin:16px;">${bodyFragment}</body></html>`;
}

export function buildPartyDemandsExportFragment(docTitle: string, subtitle: string, rows: PartyDemand[]): string {
  const when = fmtZhDateTime(new Date().toISOString());
  const tbody =
    rows.length === 0
      ? `<tr><td colspan="8" style="text-align:center">暂无数据</td></tr>`
      : rows
          .map((r, i) => {
            const company = (r.client_company || r.title || "").trim();
            return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${escapeHtml(company)}</td>
        <td>${escapeHtml(r.device_type?.trim() || "—")}</td>
        <td>${escapeHtml(labelSceneCategories(r.scene_categories))}</td>
        <td style="text-align:right">${r.max_hours_per_scene}</td>
        <td style="text-align:right">${r.total_hours_required != null ? r.total_hours_required : "无限"}</td>
        <td>${escapeHtml(r.requirement_summary?.trim() || "—")}</td>
        <td>${escapeHtml(fmtZhDateTime(r.created_at))}</td>
      </tr>`;
          })
          .join("");
  return `
<style>
  .scene-export-wrap { font-family: system-ui, "Microsoft YaHei", "PingFang SC", sans-serif; color: #111; }
  .scene-export-wrap h1 { font-size: 18px; margin: 0 0 6px; }
  .scene-export-wrap .sub { font-size: 12px; color: #555; margin-bottom: 12px; }
  .scene-export-wrap table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .scene-export-wrap th, .scene-export-wrap td { border: 1px solid #333; padding: 5px 6px; vertical-align: top; word-break: break-word; }
  .scene-export-wrap th { background: #eee; text-align: left; }
  @media print {
    @page { size: A4 landscape; margin: 12mm; }
    .scene-export-wrap { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
<div class="scene-export-wrap">
  <h1>${escapeHtml(docTitle)}</h1>
  <div class="sub">${escapeHtml(subtitle)} · 导出时间 ${escapeHtml(when)} · 共 ${rows.length} 条</div>
  <table>
    <thead>
      <tr>
        <th style="width:36px">序号</th>
        <th>甲方公司</th>
        <th>设备类型</th>
        <th>场景大类</th>
        <th style="width:52px">每场景上限(h)</th>
        <th style="width:52px">需求总计(h)</th>
        <th>其它说明</th>
        <th style="width:96px">创建时间</th>
      </tr>
    </thead>
    <tbody>${tbody}</tbody>
  </table>
</div>`;
}

export function buildScenarioPositionsExportFragment(docTitle: string, subtitle: string, rows: ScenarioPosition[]): string {
  const when = fmtZhDateTime(new Date().toISOString());
  const tbody =
    rows.length === 0
      ? `<tr><td colspan="9" style="text-align:center">暂无数据</td></tr>`
      : rows
          .map((r, i) => {
            return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${escapeHtml(r.title.trim() || "—")}</td>
        <td>${escapeHtml(r.process_description?.trim() || "—")}</td>
        <td>${escapeHtml(labelSceneCategories(r.scene_categories))}</td>
        <td>${escapeHtml(r.address_province || "—")}</td>
        <td>${escapeHtml(r.address_city || "—")}</td>
        <td>${escapeHtml(r.address_district || "—")}</td>
        <td>${escapeHtml(r.address_detail?.trim() || "—")}</td>
        <td>${escapeHtml(fmtZhDateTime(r.created_at))}</td>
      </tr>`;
          })
          .join("");
  return `
<style>
  .scene-export-wrap { font-family: system-ui, "Microsoft YaHei", "PingFang SC", sans-serif; color: #111; }
  .scene-export-wrap h1 { font-size: 18px; margin: 0 0 6px; }
  .scene-export-wrap .sub { font-size: 12px; color: #555; margin-bottom: 12px; }
  .scene-export-wrap table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .scene-export-wrap th, .scene-export-wrap td { border: 1px solid #333; padding: 5px 6px; vertical-align: top; word-break: break-word; }
  .scene-export-wrap th { background: #eee; text-align: left; }
  @media print {
    @page { size: A4 landscape; margin: 12mm; }
    .scene-export-wrap { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
<div class="scene-export-wrap">
  <h1>${escapeHtml(docTitle)}</h1>
  <div class="sub">${escapeHtml(subtitle)} · 导出时间 ${escapeHtml(when)} · 共 ${rows.length} 条</div>
  <table>
    <thead>
      <tr>
        <th style="width:36px">序号</th>
        <th>工序 / 岗位</th>
        <th>具体描述</th>
        <th>场景大类</th>
        <th>省</th>
        <th>市</th>
        <th>区/县</th>
        <th>详细地址</th>
        <th style="width:96px">创建时间</th>
      </tr>
    </thead>
    <tbody>${tbody}</tbody>
  </table>
</div>`;
}

export function buildSceneTasksExportFragment(
  docTitle: string,
  subtitle: string,
  tasks: SceneTask[],
  positions: Map<string, ScenarioPosition>,
  assignmentCountByTaskId: ReadonlyMap<string, number>
): string {
  const when = fmtZhDateTime(new Date().toISOString());
  const tbody =
    tasks.length === 0
      ? `<tr><td colspan="9" style="text-align:center">暂无数据</td></tr>`
      : tasks
          .map((t, i) => {
            const pos = t.scenario_position_id ? positions.get(t.scenario_position_id) : undefined;
            const posTitle = pos?.title?.trim() || "—";
            const catAddr = pos
              ? `${labelSceneCategories(pos.scene_categories)} · ${[pos.address_province, pos.address_city, pos.address_district].filter(Boolean).join("")}${pos.address_detail?.trim() ? ` ${pos.address_detail.trim()}` : ""}`
              : "—";
            const nSub = assignmentCountByTaskId.get(t.id) ?? 0;
            return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${escapeHtml(sceneTaskStatusLabel(t.status))}</td>
        <td>${escapeHtml(t.title.trim() || "—")}</td>
        <td>${escapeHtml(posTitle)}</td>
        <td>${escapeHtml(catAddr)}</td>
        <td style="text-align:right">${nSub}</td>
        <td>${escapeHtml(t.description?.trim() || "—")}</td>
        <td>${escapeHtml(fmtZhDateTime(t.due_at))}</td>
        <td>${escapeHtml(fmtZhDateTime(t.created_at))}</td>
      </tr>`;
          })
          .join("");
  return `
<style>
  .scene-export-wrap { font-family: system-ui, "Microsoft YaHei", "PingFang SC", sans-serif; color: #111; }
  .scene-export-wrap h1 { font-size: 18px; margin: 0 0 6px; }
  .scene-export-wrap .sub { font-size: 12px; color: #555; margin-bottom: 12px; }
  .scene-export-wrap table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .scene-export-wrap th, .scene-export-wrap td { border: 1px solid #333; padding: 5px 6px; vertical-align: top; word-break: break-word; }
  .scene-export-wrap th { background: #eee; text-align: left; }
  @media print {
    @page { size: A4 landscape; margin: 12mm; }
    .scene-export-wrap { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  }
</style>
<div class="scene-export-wrap">
  <h1>${escapeHtml(docTitle)}</h1>
  <div class="sub">${escapeHtml(subtitle)} · 导出时间 ${escapeHtml(when)} · 共 ${tasks.length} 条</div>
  <table>
    <thead>
      <tr>
        <th style="width:36px">序号</th>
        <th style="width:52px">状态</th>
        <th>任务标题</th>
        <th>绑定岗位</th>
        <th>大类 / 地址</th>
        <th style="width:44px">子任务数</th>
        <th>任务说明</th>
        <th style="width:96px">截止时间</th>
        <th style="width:96px">创建时间</th>
      </tr>
    </thead>
    <tbody>${tbody}</tbody>
  </table>
</div>`;
}

export function openSceneListPrint(fragmentHtml: string): void {
  const w = window.open("", "_blank");
  if (!w) throw new Error("浏览器阻止了弹窗，请允许本站打开新窗口后重试");
  w.document.write(wrapPrintHtml(fragmentHtml));
  w.document.close();
  const runPrint = () => {
    w.focus();
    w.print();
  };
  setTimeout(runPrint, 200);
}
