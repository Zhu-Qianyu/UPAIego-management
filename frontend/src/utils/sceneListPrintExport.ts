import type { PartyDemand, ScenarioPosition, SceneTaskAssignment } from "../api/operations";
import { getSnapshotPublicUrl } from "../api/operations";
import type { SceneTask } from "../api/scenes";
import { labelSceneCategories } from "./sceneCategories";

const SNAPSHOT_SIGN_SEC = 7200;

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

async function snapshotImgCell(path: string | null | undefined, css: string): Promise<string> {
  const p = path?.trim();
  if (!p) return `<span style="color:#888">—</span>`;
  try {
    const url = await getSnapshotPublicUrl(p, SNAPSHOT_SIGN_SEC);
    return `<img src="${escapeHtml(url)}" alt="" style="${css}" />`;
  } catch {
    return `<span style="color:#888">无法加载</span>`;
  }
}

function sharedPrintStyles(): string {
  return `
  .scene-export-wrap { font-family: system-ui, "Microsoft YaHei", "PingFang SC", sans-serif; color: #111; }
  .scene-export-wrap h1 { font-size: 18px; margin: 0 0 6px; }
  .scene-export-wrap .sub { font-size: 12px; color: #555; margin-bottom: 12px; }
  .scene-export-wrap table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .scene-export-wrap th, .scene-export-wrap td { border: 1px solid #333; padding: 5px 6px; vertical-align: top; word-break: break-word; }
  .scene-export-wrap th { background: #eee; text-align: left; }
  .scene-export-wrap td img { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .scene-export-wrap .subtable th,
  .scene-export-wrap .subtable td { border: 1px solid #999; padding: 4px 5px; vertical-align: top; word-break: break-word; }
  .scene-export-wrap .subtable th { background: #eaeaea; text-align: left; font-weight: 600; }
  @media print {
    @page { size: A4 landscape; margin: 10mm; }
    .scene-export-wrap { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    thead { display: table-header-group; }
    tr { page-break-inside: auto; }
  }`;
}

export async function buildPartyDemandsPrintHtml(docTitle: string, subtitle: string, rows: PartyDemand[]): Promise<string> {
  const when = fmtZhDateTime(new Date().toISOString());
  const imgStyle = "max-width:140px;max-height:100px;object-fit:contain;display:block;margin:0 auto;border:1px solid #ccc";
  const tbody =
    rows.length === 0
      ? `<tr><td colspan="10" style="text-align:center">暂无数据</td></tr>`
      : (
          await Promise.all(
            rows.map(async (r, i) => {
              const company = (r.client_company || r.title || "").trim();
              const snap = await snapshotImgCell(r.device_snapshot_path, imgStyle);
              const price =
                r.client_hourly_rate != null && r.client_hourly_rate > 0
                  ? `${Number(r.client_hourly_rate).toFixed(2)}`
                  : "—";
              return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="text-align:center;vertical-align:middle;width:150px">${snap}</td>
        <td>${escapeHtml(company)}</td>
        <td>${escapeHtml(r.device_type?.trim() || "—")}</td>
        <td style="text-align:right">${escapeHtml(price)}</td>
        <td>${escapeHtml(labelSceneCategories(r.scene_categories))}</td>
        <td style="text-align:right">${r.max_hours_per_scene}</td>
        <td style="text-align:right">${r.total_hours_required != null ? r.total_hours_required : "无限"}</td>
        <td>${escapeHtml(r.requirement_summary?.trim() || "—")}</td>
        <td>${escapeHtml(fmtZhDateTime(r.created_at))}</td>
      </tr>`;
            })
          )
        ).join("");
  return `
<style>${sharedPrintStyles()}
</style>
<div class="scene-export-wrap">
  <h1>${escapeHtml(docTitle)}</h1>
  <div class="sub">${escapeHtml(subtitle)} · 导出时间 ${escapeHtml(when)} · 共 ${rows.length} 条（含设备快照图）</div>
  <table>
    <thead>
      <tr>
        <th style="width:36px">序号</th>
        <th style="width:150px">设备快照</th>
        <th>甲方公司</th>
        <th>设备类型</th>
        <th style="width:72px">甲方价格(元/h)</th>
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

export async function buildScenarioPositionsPrintHtml(
  docTitle: string,
  subtitle: string,
  rows: ScenarioPosition[],
  macroById?: Map<string, { title: string }>
): Promise<string> {
  const when = fmtZhDateTime(new Date().toISOString());
  const imgStyle = "max-width:140px;max-height:100px;object-fit:contain;display:block;margin:0 auto;border:1px solid #ccc";
  const tbody =
    rows.length === 0
      ? `<tr><td colspan="11" style="text-align:center">暂无数据</td></tr>`
      : (
          await Promise.all(
            rows.map(async (r, i) => {
              const snap = await snapshotImgCell(r.snapshot_path, imgStyle);
              const macroTitle =
                r.macro_scene_id && macroById?.get(r.macro_scene_id)?.title
                  ? macroById.get(r.macro_scene_id)!.title
                  : "—";
              return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="text-align:center;vertical-align:middle;width:150px">${snap}</td>
        <td>${escapeHtml(macroTitle)}</td>
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
          )
        ).join("");
  return `
<style>${sharedPrintStyles()}
</style>
<div class="scene-export-wrap">
  <h1>${escapeHtml(docTitle)}</h1>
  <div class="sub">${escapeHtml(subtitle)} · 导出时间 ${escapeHtml(when)} · 共 ${rows.length} 条（含现场快照图）</div>
  <table>
    <thead>
      <tr>
        <th style="width:36px">序号</th>
        <th style="width:150px">现场快照</th>
        <th>大场景</th>
        <th>工序 / 小岗位</th>
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

function assignmentProgressLine(a: SceneTaskAssignment): string {
  const cap = Number(a.max_hours_cap);
  const ex = Number(a.executed_hours);
  if (!Number.isFinite(cap) || cap <= 0) return `${ex} / —`;
  const pct = Math.min(100, Math.max(0, (ex / cap) * 100));
  return `${ex}/${cap}h · ${pct.toFixed(0)}%`;
}

function buildSceneTaskCompletionSections(
  tasks: SceneTask[],
  assignmentsByTaskId: ReadonlyMap<string, SceneTaskAssignment[]>,
  demands: Map<string, PartyDemand>
): string {
  return tasks
    .map((t, i) => {
      const assigns = assignmentsByTaskId.get(t.id) ?? [];
      let subTable: string;
      if (assigns.length === 0) {
        subTable = `<p style="margin:4px 0 0;font-size:10px;color:#666">无业务读条（未发布或尚无匹配的甲方业务）。</p>`;
      } else {
        const subRows = assigns
          .map((a) => {
            const d = demands.get(a.party_demand_id);
            const company = (d?.client_company || d?.title || "—").trim();
            const dev = d?.device_type?.trim() || "—";
            const cats = labelSceneCategories(d?.scene_categories);
            return `<tr>
          <td>${escapeHtml(company)}</td>
          <td>${escapeHtml(dev)}</td>
          <td>${escapeHtml(cats)}</td>
          <td style="text-align:right">${escapeHtml(String(a.executed_hours))}</td>
          <td style="text-align:right">${escapeHtml(String(a.max_hours_cap))}</td>
          <td>${escapeHtml(assignmentProgressLine(a))}</td>
        </tr>`;
          })
          .join("");
        subTable = `
        <table class="subtable" style="width:100%;border-collapse:collapse;margin-top:4px;font-size:10px;">
          <thead>
            <tr>
              <th>甲方</th>
              <th>设备类型</th>
              <th>匹配大类</th>
              <th style="width:52px">已执行(h)</th>
              <th style="width:52px">上限(h)</th>
              <th style="width:100px">完成度</th>
            </tr>
          </thead>
          <tbody>${subRows}</tbody>
        </table>`;
      }
      return `
      <div class="task-detail" style="margin-top:12px;padding-top:10px;border-top:1px solid #bbb;page-break-inside:avoid;">
        <p style="font-size:12px;font-weight:bold;margin:0 0 2px;">
          ${escapeHtml(String(i + 1))}. ${escapeHtml(t.title.trim() || "—")}
          <span style="font-weight:normal;color:#555">（${escapeHtml(sceneTaskStatusLabel(t.status))}）</span>
        </p>
        <p style="font-size:10px;color:#666;margin:0 0 2px">业务读条与小时完成情况</p>
        ${subTable}
      </div>`;
    })
    .join("");
}

export async function buildSceneTasksPrintHtml(
  docTitle: string,
  subtitle: string,
  tasks: SceneTask[],
  positions: Map<string, ScenarioPosition>,
  assignmentCountByTaskId: ReadonlyMap<string, number>,
  assignmentsByTaskId: ReadonlyMap<string, SceneTaskAssignment[]>,
  demands: Map<string, PartyDemand>
): Promise<string> {
  const when = fmtZhDateTime(new Date().toISOString());
  const imgStyle = "max-width:120px;max-height:90px;object-fit:contain;display:block;margin:0 auto;border:1px solid #ccc";
  const tbody =
    tasks.length === 0
      ? `<tr><td colspan="10" style="text-align:center">暂无数据</td></tr>`
      : (
          await Promise.all(
            tasks.map(async (t, i) => {
              const pos = t.scenario_position_id ? positions.get(t.scenario_position_id) : undefined;
              const posTitle = pos?.title?.trim() || "—";
              const snap = pos?.snapshot_path
                ? await snapshotImgCell(pos.snapshot_path, imgStyle)
                : `<span style="color:#888">—</span>`;
              const catAddr = pos
                ? `${labelSceneCategories(pos.scene_categories)} · ${[pos.address_province, pos.address_city, pos.address_district].filter(Boolean).join("")}${pos.address_detail?.trim() ? ` ${pos.address_detail.trim()}` : ""}`
                : "—";
              const nSub = assignmentCountByTaskId.get(t.id) ?? 0;
              return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${escapeHtml(sceneTaskStatusLabel(t.status))}</td>
        <td>${escapeHtml(t.title.trim() || "—")}</td>
        <td>${escapeHtml(posTitle)}</td>
        <td style="text-align:center;vertical-align:middle;width:130px">${snap}</td>
        <td>${escapeHtml(catAddr)}</td>
        <td style="text-align:right">${nSub}</td>
        <td>${escapeHtml(t.description?.trim() || "—")}</td>
        <td>${escapeHtml(fmtZhDateTime(t.due_at))}</td>
        <td>${escapeHtml(fmtZhDateTime(t.created_at))}</td>
      </tr>`;
            })
          )
        ).join("");
  const completionSections = buildSceneTaskCompletionSections(tasks, assignmentsByTaskId, demands);
  const completionBlock =
    tasks.length > 0
      ? `<h2 style="font-size:14px;margin:18px 0 6px;border-bottom:1px solid #333;padding-bottom:4px">各任务业务完成情况</h2>${completionSections}`
      : "";
  return `
<style>${sharedPrintStyles()}
</style>
<div class="scene-export-wrap">
  <h1>${escapeHtml(docTitle)}</h1>
  <div class="sub">${escapeHtml(subtitle)} · 导出时间 ${escapeHtml(when)} · 共 ${tasks.length} 条（含绑定岗位现场图与各任务业务完成情况）</div>
  <table>
    <thead>
      <tr>
        <th style="width:36px">序号</th>
        <th style="width:52px">状态</th>
        <th>任务标题</th>
        <th>绑定岗位</th>
        <th style="width:130px">岗位现场图</th>
        <th>大类 / 地址</th>
        <th style="width:44px">子任务数</th>
        <th>任务说明</th>
        <th style="width:96px">截止时间</th>
        <th style="width:96px">创建时间</th>
      </tr>
    </thead>
    <tbody>${tbody}</tbody>
  </table>
  ${completionBlock}
</div>`;
}

async function waitForImagesThenPrint(win: Window): Promise<void> {
  const imgs = [...win.document.images];
  await Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          })
    )
  );
  await new Promise<void>((r) => setTimeout(r, 200));
  win.focus();
  win.print();
}

export function openSceneListPrint(fragmentHtml: string): void {
  const w = window.open("", "_blank");
  if (!w) throw new Error("浏览器阻止了弹窗，请允许本站打开新窗口后重试");
  w.document.write(wrapPrintHtml(fragmentHtml));
  w.document.close();
  void waitForImagesThenPrint(w).catch(() => {
    setTimeout(() => {
      w.focus();
      w.print();
    }, 500);
  });
}
