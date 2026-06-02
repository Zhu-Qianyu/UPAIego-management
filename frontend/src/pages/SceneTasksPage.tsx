import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { listSceneTasks, createSceneTask, updateSceneTask, deleteSceneTask, getSceneTask, type SceneTask } from "../api/scenes";
import { fetchActiveGroupId } from "../api/groups";
import {
  createPartyDemand,
  updatePartyDemand,
  createScenarioPosition,
  updateScenarioPosition,
  deletePartyDemand,
  deleteScenarioPosition,
  getSnapshotPublicUrl,
  listPartyDemands,
  listScenarioPositions,
  uploadWorkstationSnapshot,
  uploadPartyDeviceSnapshot,
  syncSceneTaskAssignments,
  batchGenerateSceneTasksForGroup,
  listAssignmentsForWorkGroup,
  updateAssignmentExecutedHours,
  type PartyDemand,
  type PartyDemandUpdatePatch,
  type ScenarioPosition,
  type SceneTaskAssignment,
} from "../api/operations";
import Spinner from "../components/Spinner";
import { CardList, CardListItem, CompactList, CompactListRow, ListViewSection } from "../components/ui/PageLayout";
import RefreshStrip from "../components/RefreshStrip";
import { readRouteViewCache, routeViewCacheKey, routeViewCacheKeyExtra, writeRouteViewCache } from "../utils/routeViewCache";
import { useAuth } from "../auth/AuthContext";
import {
  SCENE_CATEGORY_KEYS,
  SCENE_CATEGORY_LABELS,
  labelSceneCategories,
  type SceneCategoryKey,
} from "../utils/sceneCategories";
import {
  buildPartyDemandsPrintHtml,
  buildScenarioPositionsPrintHtml,
  buildSceneTasksPrintHtml,
  openSceneListPrint,
} from "../utils/sceneListPrintExport";

type Tab = "tasks" | "demands" | "stations";

function normalizeDemandCatTags(arr: string[] | null | undefined): SceneCategoryKey[] {
  const picked = (arr ?? []).filter((x): x is SceneCategoryKey =>
    (SCENE_CATEGORY_KEYS as readonly string[]).includes(x)
  );
  return picked.length >= 1 ? picked : ["industrial"];
}

function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function PartyDemandsTab({
  groupId,
  setErr,
}: {
  groupId: string;
  setErr: (s: string) => void;
}) {
  const [rows, setRows] = useState<PartyDemand[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clientCompany, setClientCompany] = useState("");
  const [deviceType, setDeviceType] = useState("");
  const [summary, setSummary] = useState("");
  const [deviceFile, setDeviceFile] = useState<File | null>(null);
  const [totalUnlimited, setTotalUnlimited] = useState(true);
  const [totalHours, setTotalHours] = useState("");
  const [maxPerScene, setMaxPerScene] = useState("8");
  const [catTags, setCatTags] = useState<SceneCategoryKey[]>(["industrial"]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCompany, setEditCompany] = useState("");
  const [editDeviceType, setEditDeviceType] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editDeviceFile, setEditDeviceFile] = useState<File | null>(null);
  const [editTotalUnlimited, setEditTotalUnlimited] = useState(true);
  const [editTotalHours, setEditTotalHours] = useState("");
  const [editMaxPerScene, setEditMaxPerScene] = useState("8");
  const [editCatTags, setEditCatTags] = useState<SceneCategoryKey[]>(["industrial"]);
  const loadedOnceRef = useRef(false);

  const load = useCallback(async () => {
    if (loadedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    try {
      const d = await listPartyDemands(groupId);
      setRows(d);
      loadedOnceRef.current = true;
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "加载业务失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId, setErr]);

  useEffect(() => {
    void load();
  }, [load]);

  function addCatTag(k: SceneCategoryKey) {
    setCatTags((prev) => [...prev, k]);
  }

  function removeCatTag(i: number) {
    setCatTags((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addEditCatTag(k: SceneCategoryKey) {
    setEditCatTags((prev) => [...prev, k]);
  }

  function removeEditCatTag(i: number) {
    setEditCatTags((prev) => prev.filter((_, idx) => idx !== i));
  }

  function openEdit(r: PartyDemand) {
    setEditingId(r.id);
    setEditCompany((r.client_company || r.title || "").trim());
    setEditDeviceType((r.device_type ?? "").trim());
    setEditSummary(r.requirement_summary ?? "");
    setEditTotalUnlimited(r.total_hours_required == null);
    setEditTotalHours(r.total_hours_required != null ? String(r.total_hours_required) : "");
    setEditMaxPerScene(String(r.max_hours_per_scene));
    setEditCatTags(normalizeDemandCatTags(r.scene_categories));
    setEditDeviceFile(null);
    setErr("");
  }

  function closeEdit() {
    setEditingId(null);
    setEditDeviceFile(null);
  }

  async function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setErr("");
    if (!editCompany.trim()) {
      setErr("请填写甲方公司");
      return;
    }
    if (!editDeviceType.trim()) {
      setErr("请填写设备类型");
      return;
    }
    const maxH = Number(editMaxPerScene);
    if (!Number.isFinite(maxH) || maxH <= 0 || !Number.isInteger(maxH)) {
      setErr("每场景上限小时量须为正整数");
      return;
    }
    let total: number | null = null;
    if (!editTotalUnlimited) {
      const t = Number(editTotalHours);
      if (!Number.isFinite(t) || t < 0 || !Number.isInteger(t)) {
        setErr("需求总小时量须为非负整数，或勾选「无限」");
        return;
      }
      total = t;
    }
    if (editCatTags.length < 1) {
      setErr("请至少选择一个场景大类（可重复）");
      return;
    }
    try {
      const company = editCompany.trim();
      const patch: PartyDemandUpdatePatch = {
        title: company,
        client_company: company,
        device_type: editDeviceType.trim(),
        requirement_summary: editSummary.trim() || null,
        total_hours_required: total,
        max_hours_per_scene: maxH,
        scene_categories: [...editCatTags],
      };
      if (editDeviceFile) {
        const { path, bucket } = await uploadPartyDeviceSnapshot(groupId, editDeviceFile);
        patch.device_snapshot_bucket = bucket;
        patch.device_snapshot_path = path;
      }
      await updatePartyDemand(editingId, patch);
      await syncSceneTaskAssignments(groupId);
      closeEdit();
      await load();
    } catch (err: unknown) {
      setErr(err instanceof Error ? err.message : "保存失败");
    }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!clientCompany.trim()) {
      setErr("请填写甲方公司");
      return;
    }
    if (!deviceType.trim()) {
      setErr("请填写设备类型");
      return;
    }
    if (!deviceFile) {
      setErr("请上传设备快照");
      return;
    }
    const maxH = Number(maxPerScene);
    if (!Number.isFinite(maxH) || maxH <= 0 || !Number.isInteger(maxH)) {
      setErr("每场景上限小时量须为正整数");
      return;
    }
    let total: number | null = null;
    if (!totalUnlimited) {
      const t = Number(totalHours);
      if (!Number.isFinite(t) || t < 0 || !Number.isInteger(t)) {
        setErr("需求总小时量须为非负整数，或勾选「无限」");
        return;
      }
      total = t;
    }
    if (catTags.length < 1) {
      setErr("请至少选择一个场景大类（可重复）");
      return;
    }
    try {
      const { path, bucket } = await uploadPartyDeviceSnapshot(groupId, deviceFile);
      await createPartyDemand({
        group_id: groupId,
        title: clientCompany.trim(),
        client_company: clientCompany.trim(),
        device_type: deviceType.trim(),
        device_snapshot_bucket: bucket,
        device_snapshot_path: path,
        total_hours_required: total,
        max_hours_per_scene: maxH,
        scene_categories: [...catTags],
        requirement_summary: summary.trim() || undefined,
      });
      await syncSceneTaskAssignments(groupId);
      setClientCompany("");
      setDeviceType("");
      setSummary("");
      setDeviceFile(null);
      setTotalUnlimited(true);
      setTotalHours("");
      setMaxPerScene("8");
      setCatTags(["industrial"]);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "添加失败");
    }
  }

  if (loading && rows.length === 0) return <Spinner />;

  return (
    <div className="w-full min-w-0 space-y-6">
      <RefreshStrip active={refreshing} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">列表打印（含设备快照图，打印前会等待图片加载）：</span>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              setErr("");
              try {
                const html = await buildPartyDemandsPrintHtml("甲方业务列表", `工作群 ${groupId}`, rows);
                openSceneListPrint(html);
              } catch (e: unknown) {
                setErr(e instanceof Error ? e.message : "无法打开打印窗口");
              }
            })();
          }}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm bg-white hover:bg-gray-50"
        >
          打印列表
        </button>
      </div>
      <p className="text-sm text-gray-500">
        <strong>甲方业务</strong>：填写甲方公司、设备类型、设备快照、小时量与场景大类；下方列表可预览设备快照。发布后由系统按大类匹配到场景岗位并生成子任务。
      </p>
      <form onSubmit={onAdd} className="bg-white rounded-xl border border-indigo-100 p-4 space-y-3">
        <input
          required
          placeholder="甲方公司（必填）"
          value={clientCompany}
          onChange={(e) => setClientCompany(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          required
          placeholder="设备类型（必填），例如：机械臂视觉套件"
          value={deviceType}
          onChange={(e) => setDeviceType(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div>
          <label className="block text-xs text-gray-500 mb-1">设备快照（必填）</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setDeviceFile(e.target.files?.[0] ?? null)}
            className="text-sm w-full"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={totalUnlimited} onChange={(e) => setTotalUnlimited(e.target.checked)} />
            需求总小时量：无限
          </label>
          {!totalUnlimited && (
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="总小时量（整数）"
              value={totalHours}
              onChange={(e) => setTotalHours(e.target.value.replace(/\D/g, ""))}
              className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          )}
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">每场景上限小时量（必填，正整数）</label>
          <input
            type="text"
            inputMode="numeric"
            required
            value={maxPerScene}
            onChange={(e) => setMaxPerScene(e.target.value.replace(/\D/g, ""))}
            className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">场景大类（工业 / 家庭 / 特种，可重复添加）</p>
          <div className="flex flex-wrap gap-2 mb-2">
            {SCENE_CATEGORY_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => addCatTag(k)}
                className="px-2 py-1 rounded-lg border border-gray-300 text-xs bg-white hover:bg-gray-50"
              >
                +{SCENE_CATEGORY_LABELS[k]}
              </button>
            ))}
          </div>
          <ul className="flex flex-wrap gap-2 text-xs">
            {catTags.map((k, i) => (
              <li key={`${k}-${i}`} className="flex items-center gap-1 bg-indigo-50 text-indigo-900 px-2 py-1 rounded">
                {SCENE_CATEGORY_LABELS[k]}
                <button type="button" className="text-red-600" onClick={() => removeCatTag(i)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
        <textarea
          placeholder="其它说明（可选）"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">
          添加甲方业务
        </button>
      </form>
      <ListViewSection
        storageKey="scene-party-demands"
        compact={
          <CompactList>
            {rows.map((r) => (
              <CompactListRow
                key={r.id}
                primary={r.client_company || r.title}
                secondary={`设备类型：${r.device_type?.trim() || "—"} · ${labelSceneCategories(r.scene_categories)}`}
                meta={
                  r.total_hours_required != null
                    ? `上限 ${r.max_hours_per_scene}h/场景 · 总计 ${r.total_hours_required}h`
                    : `上限 ${r.max_hours_per_scene}h/场景 · 总计无限`
                }
              />
            ))}
          </CompactList>
        }
      >
      <CardList>
        {rows.map((r) => (
          <CardListItem key={r.id}>
          <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 h-full w-full min-w-0 overflow-hidden box-border">
            {editingId === r.id ? (
              <form onSubmit={onSaveEdit} className="space-y-3">
                <p className="text-xs font-medium text-gray-700">编辑甲方业务</p>
                <input
                  required
                  placeholder="甲方公司（必填）"
                  value={editCompany}
                  onChange={(e) => setEditCompany(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                  required
                  placeholder="设备类型（必填）"
                  value={editDeviceType}
                  onChange={(e) => setEditDeviceType(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <div>
                  <p className="text-xs text-gray-500 mb-1">当前设备快照</p>
                  <PartyDemandDeviceSnapshot snapshotPath={r.device_snapshot_path} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">更换设备快照（可选）</label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setEditDeviceFile(e.target.files?.[0] ?? null)}
                    className="text-sm w-full"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editTotalUnlimited}
                      onChange={(e) => setEditTotalUnlimited(e.target.checked)}
                    />
                    需求总小时量：无限
                  </label>
                  {!editTotalUnlimited && (
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="总小时量（整数）"
                      value={editTotalHours}
                      onChange={(e) => setEditTotalHours(e.target.value.replace(/\D/g, ""))}
                      className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">每场景上限小时量（正整数）</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={editMaxPerScene}
                    onChange={(e) => setEditMaxPerScene(e.target.value.replace(/\D/g, ""))}
                    className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">场景大类（可重复）</p>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {SCENE_CATEGORY_KEYS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => addEditCatTag(k)}
                        className="px-2 py-1 rounded-lg border border-gray-300 text-xs bg-white hover:bg-gray-50"
                      >
                        +{SCENE_CATEGORY_LABELS[k]}
                      </button>
                    ))}
                  </div>
                  <ul className="flex flex-wrap gap-2 text-xs">
                    {editCatTags.map((k, i) => (
                      <li
                        key={`${k}-${i}`}
                        className="flex items-center gap-1 bg-indigo-50 text-indigo-900 px-2 py-1 rounded"
                      >
                        {SCENE_CATEGORY_LABELS[k]}
                        <button type="button" className="text-red-600" onClick={() => removeEditCatTag(i)}>
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <textarea
                  placeholder="其它说明（可选）"
                  value={editSummary}
                  onChange={(e) => setEditSummary(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">
                    保存
                  </button>
                  <button type="button" onClick={closeEdit} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">
                    取消
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col sm:flex-row gap-4">
                <PartyDemandDeviceSnapshot snapshotPath={r.device_snapshot_path} />
                <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{r.client_company || r.title}</p>
                    <p className="text-sm text-gray-600 mt-1">设备类型：{r.device_type?.trim() || "—"}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      大类：{labelSceneCategories(r.scene_categories)} · 每场景上限 {r.max_hours_per_scene}h
                      {r.total_hours_required != null ? ` · 需求总计 ${r.total_hours_required}h` : " · 需求总计：无限"}
                    </p>
                    {r.requirement_summary && (
                      <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{r.requirement_summary}</p>
                    )}
                  </div>
                  <div className="flex flex-row sm:flex-col gap-2 shrink-0 sm:items-end">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="text-xs text-indigo-700 font-medium px-2 py-1 rounded border border-indigo-200 hover:bg-indigo-50"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm("删除该条甲方业务？关联的自动子任务会同步更新。")) return;
                        if (editingId === r.id) closeEdit();
                        try {
                          await deletePartyDemand(r.id);
                          await syncSceneTaskAssignments(groupId);
                          await load();
                        } catch (ex: unknown) {
                          setErr(ex instanceof Error ? ex.message : "删除失败");
                        }
                      }}
                      className="text-xs text-red-600"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          </CardListItem>
        ))}
      </CardList>
      </ListViewSection>
    </div>
  );
}

/** 甲方业务设备图：与工位快照同一 bucket，路径存于 device_snapshot_path */
function PartyDemandDeviceSnapshot({ snapshotPath }: { snapshotPath: string | null | undefined }) {
  const pathKey = snapshotPath?.trim() ?? "";
  const [src, setSrc] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  useEffect(() => {
    if (!pathKey) {
      setSrc(null);
      setLoadErr(false);
      return;
    }
    let cancel = false;
    setSrc(null);
    setLoadErr(false);
    getSnapshotPublicUrl(pathKey)
      .then((u) => {
        if (!cancel) setSrc(u);
      })
      .catch(() => {
        if (!cancel) setLoadErr(true);
      });
    return () => {
      cancel = true;
    };
  }, [pathKey]);

  if (!pathKey) {
    return (
      <div className="w-full max-w-xs sm:w-44 shrink-0 min-h-[8rem] flex items-center justify-center text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg px-2 text-center">
        暂无设备快照
      </div>
    );
  }
  if (loadErr) {
    return (
      <div className="w-full max-w-xs sm:w-44 shrink-0 min-h-[8rem] flex items-center justify-center text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 text-center">
        无法加载设备快照
      </div>
    );
  }
  if (!src) {
    return (
      <div className="w-full max-w-xs sm:w-44 shrink-0 h-32 flex items-center justify-center text-xs text-gray-400 border border-gray-100 rounded-lg bg-gray-50">
        加载快照…
      </div>
    );
  }
  return (
    <div className="shrink-0 w-full max-w-xs sm:w-44">
      <a href={src} target="_blank" rel="noopener noreferrer" className="block group">
        <img
          src={src}
          alt="设备快照"
          className="w-full h-32 object-cover rounded-lg border border-gray-100 group-hover:opacity-95"
        />
        <span className="text-xs text-indigo-600 mt-1 inline-block group-hover:underline">新标签页打开原图</span>
      </a>
    </div>
  );
}

function ScenarioRow({ row }: { row: ScenarioPosition }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    getSnapshotPublicUrl(row.snapshot_path)
      .then((u) => {
        if (!cancel) setSrc(u);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [row.snapshot_path]);

  return (
    <div className="bg-white p-4 flex flex-col sm:flex-row gap-4">
      {src && (
        <img src={src} alt="" className="w-full sm:w-40 h-32 object-cover rounded-lg border border-gray-100" />
      )}
      <div className="flex-1 min-w-0 pr-24">
        <p className="font-medium text-gray-900">{row.title}</p>
        <p className="text-xs text-gray-500 mt-1">
          大类：{labelSceneCategories(row.scene_categories)} ·{" "}
          {[row.address_province, row.address_city, row.address_district].filter(Boolean).join(" ")}
          {row.address_detail ? ` ${row.address_detail}` : ""}
        </p>
        {row.process_description && (
          <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{row.process_description}</p>
        )}
        <p className="text-xs text-gray-400 mt-2">{new Date(row.created_at).toLocaleString()}</p>
      </div>
    </div>
  );
}

function scenarioCategoriesToRecord(cats: string[]): Record<SceneCategoryKey, boolean> {
  const r: Record<SceneCategoryKey, boolean> = { industrial: false, home: false, special: false };
  for (const k of SCENE_CATEGORY_KEYS) {
    if (cats.includes(k)) r[k] = true;
  }
  if (!cats.length) r.industrial = true;
  return r;
}

function ScenarioWorkstationsTab({
  groupId,
  setErr,
}: {
  groupId: string;
  setErr: (s: string) => void;
}) {
  const [rows, setRows] = useState<ScenarioPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [title, setTitle] = useState("");
  const [proc, setProc] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [detail, setDetail] = useState("");
  const [selCats, setSelCats] = useState<Record<SceneCategoryKey, boolean>>({
    industrial: true,
    home: false,
    special: false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const loadedOnceRef = useRef(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eProc, setEProc] = useState("");
  const [eProvince, setEProvince] = useState("");
  const [eCity, setECity] = useState("");
  const [eDistrict, setEDistrict] = useState("");
  const [eDetail, setEDetail] = useState("");
  const [eSelCats, setESelCats] = useState<Record<SceneCategoryKey, boolean>>({
    industrial: true,
    home: false,
    special: false,
  });
  const [eFile, setEFile] = useState<File | null>(null);
  const [eBusy, setEBusy] = useState(false);

  const load = useCallback(async () => {
    if (loadedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    try {
      const s = await listScenarioPositions(groupId);
      setRows(s);
      loadedOnceRef.current = true;
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "加载场景岗位失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId, setErr]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleCat(k: SceneCategoryKey) {
    setSelCats((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  function toggleECat(k: SceneCategoryKey) {
    setESelCats((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  function openEdit(r: ScenarioPosition) {
    setErr("");
    setEditingId(r.id);
    setETitle(r.title);
    setEProc(r.process_description ?? "");
    setEProvince(r.address_province);
    setECity(r.address_city);
    setEDistrict(r.address_district);
    setEDetail(r.address_detail ?? "");
    setESelCats(scenarioCategoriesToRecord(r.scene_categories ?? []));
    setEFile(null);
  }

  async function onSaveEdit(e: React.FormEvent, rowId: string) {
    e.preventDefault();
    setErr("");
    const cats = SCENE_CATEGORY_KEYS.filter((k) => eSelCats[k]);
    if (cats.length < 1) {
      setErr("请至少勾选一个场景大类");
      return;
    }
    if (!eProvince.trim() || !eCity.trim() || !eDistrict.trim()) {
      setErr("请填写省、市、区（县）");
      return;
    }
    setEBusy(true);
    try {
      let snapshotPath: string | undefined;
      if (eFile) {
        const { path } = await uploadWorkstationSnapshot(groupId, eFile);
        snapshotPath = path;
      }
      await updateScenarioPosition(rowId, {
        title: eTitle.trim(),
        process_description: eProc.trim() || null,
        scene_categories: cats,
        address_province: eProvince.trim(),
        address_city: eCity.trim(),
        address_district: eDistrict.trim(),
        address_detail: eDetail.trim() || null,
        ...(snapshotPath ? { snapshot_path: snapshotPath } : {}),
      });
      await syncSceneTaskAssignments(groupId);
      setEditingId(null);
      setEFile(null);
      await load();
    } catch (err: unknown) {
      setErr(err instanceof Error ? err.message : "保存失败");
    } finally {
      setEBusy(false);
    }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setErr("请选择现场快照图片");
      return;
    }
    const cats = SCENE_CATEGORY_KEYS.filter((k) => selCats[k]);
    if (cats.length < 1) {
      setErr("请至少勾选一个场景大类（同一类不可重复勾选）");
      return;
    }
    if (!province.trim() || !city.trim() || !district.trim()) {
      setErr("请填写省、市、区（县）");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const { path } = await uploadWorkstationSnapshot(groupId, file);
      await createScenarioPosition({
        group_id: groupId,
        title: title.trim(),
        process_description: proc.trim() || undefined,
        snapshot_path: path,
        scene_categories: cats,
        address_province: province.trim(),
        address_city: city.trim(),
        address_district: district.trim(),
        address_detail: detail.trim() || undefined,
      });
      await syncSceneTaskAssignments(groupId);
      setTitle("");
      setProc("");
      setProvince("");
      setCity("");
      setDistrict("");
      setDetail("");
      setSelCats({ industrial: true, home: false, special: false });
      setFile(null);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading && rows.length === 0) return <Spinner />;

  return (
    <div className="w-full min-w-0 space-y-6">
      <RefreshStrip active={refreshing} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">列表打印（含工位现场快照图，打印前会等待图片加载）：</span>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              setErr("");
              try {
                const html = await buildScenarioPositionsPrintHtml("场景岗位列表", `工作群 ${groupId}`, rows);
                openSceneListPrint(html);
              } catch (e: unknown) {
                setErr(e instanceof Error ? e.message : "无法打开打印窗口");
              }
            })();
          }}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm bg-white hover:bg-gray-50"
        >
          打印列表
        </button>
      </div>
      <p className="text-sm text-gray-500">
        <strong>场景岗位 / 快照</strong>：工序与现场说明、厂区省市区（必填）、场景大类（三类中可多选、互不重复）、现场照片。
      </p>
      <form onSubmit={onAdd} className="bg-white rounded-xl border border-indigo-100 p-4 space-y-2">
        <p className="text-xs text-gray-500">场景大类（不可重复选，可多选）</p>
        <div className="flex flex-wrap gap-3">
          {SCENE_CATEGORY_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selCats[k]} onChange={() => toggleCat(k)} />
              {SCENE_CATEGORY_LABELS[k]}
            </label>
          ))}
        </div>
        <input
          required
          placeholder="工序 / 岗位（必填）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <textarea
          placeholder="具体描述（可选）"
          value={proc}
          onChange={(e) => setProc(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            required
            placeholder="省（必填）"
            value={province}
            onChange={(e) => setProvince(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            required
            placeholder="市（必填）"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            required
            placeholder="区/县（必填）"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <input
          placeholder="详细地址（可选）"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div>
          <label className="block text-xs text-gray-500 mb-1">现场快照（必填）</label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm w-full"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm disabled:opacity-50"
        >
          {busy ? "上传中..." : "添加场景岗位"}
        </button>
      </form>
      <ListViewSection
        storageKey="scene-positions"
        compact={
          <CompactList>
            {rows.map((r) => (
              <CompactListRow
                key={r.id}
                primary={r.title}
                secondary={r.process_description ?? undefined}
                meta={`${labelSceneCategories(r.scene_categories)} · ${[r.address_province, r.address_city, r.address_district].filter(Boolean).join(" ")}`}
              />
            ))}
          </CompactList>
        }
      >
      <CardList as="div">
        {rows.map((r) => (
          <CardListItem as="div" key={r.id}>
          <div className="relative rounded-xl border border-gray-200 overflow-hidden h-full w-full min-w-0 box-border">
            <ScenarioRow row={r} />
            <div className="absolute top-2 right-2 flex gap-1">
              <button
                type="button"
                onClick={() => openEdit(r)}
                className="text-xs text-violet-700 bg-white/95 px-2 py-1 rounded border border-violet-200 shadow-sm"
              >
                编辑
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm("删除该场景岗位？关联的自动子任务会同步更新。")) return;
                  if (editingId === r.id) setEditingId(null);
                  await deleteScenarioPosition(r.id);
                  await syncSceneTaskAssignments(groupId);
                  await load();
                }}
                className="text-xs text-red-600 bg-white/95 px-2 py-1 rounded border border-red-100 shadow-sm"
              >
                删除
              </button>
            </div>
            {editingId === r.id && (
              <form
                onSubmit={(ev) => void onSaveEdit(ev, r.id)}
                className="border-t border-indigo-100 bg-indigo-50/40 p-4 space-y-2"
              >
                <p className="text-xs font-medium text-indigo-900">编辑场景岗位</p>
                <div className="flex flex-wrap gap-3">
                  {SCENE_CATEGORY_KEYS.map((k) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={eSelCats[k]} onChange={() => toggleECat(k)} />
                      {SCENE_CATEGORY_LABELS[k]}
                    </label>
                  ))}
                </div>
                <input
                  required
                  placeholder="工序 / 岗位"
                  value={eTitle}
                  onChange={(e) => setETitle(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                />
                <textarea
                  placeholder="具体描述"
                  value={eProc}
                  onChange={(e) => setEProc(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    required
                    placeholder="省"
                    value={eProvince}
                    onChange={(e) => setEProvince(e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                  />
                  <input
                    required
                    placeholder="市"
                    value={eCity}
                    onChange={(e) => setECity(e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                  />
                  <input
                    required
                    placeholder="区/县"
                    value={eDistrict}
                    onChange={(e) => setEDistrict(e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                  />
                </div>
                <input
                  placeholder="详细地址（可选）"
                  value={eDetail}
                  onChange={(e) => setEDetail(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                />
                <div>
                  <label className="block text-xs text-gray-600 mb-1">更换现场快照（可选，不选则保留原图）</label>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setEFile(e.target.files?.[0] ?? null)}
                    className="text-sm w-full"
                  />
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={eBusy}
                    className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm disabled:opacity-50"
                  >
                    {eBusy ? "保存中…" : "保存"}
                  </button>
                  <button
                    type="button"
                    disabled={eBusy}
                    onClick={() => {
                      setEditingId(null);
                      setEFile(null);
                      setErr("");
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  >
                    取消
                  </button>
                </div>
              </form>
            )}
          </div>
          </CardListItem>
        ))}
      </CardList>
      </ListViewSection>
    </div>
  );
}

function progressPct(executed: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, Math.max(0, (executed / cap) * 100));
}

function AssignmentsInline({
  rows,
  positions,
  demands,
  isExecutor,
  setErr,
  onHoursSaved,
}: {
  rows: SceneTaskAssignment[];
  positions: Map<string, ScenarioPosition>;
  demands: Map<string, PartyDemand>;
  isExecutor: boolean;
  setErr: (s: string) => void;
  onHoursSaved: () => void | Promise<void>;
}) {
  const [localHours, setLocalHours] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const x of rows) next[x.id] = String(x.executed_hours);
    setLocalHours(next);
  }, [rows]);

  const byPosition = useMemo(() => {
    const m = new Map<string, SceneTaskAssignment[]>();
    for (const r of rows) {
      const list = m.get(r.scenario_position_id) ?? [];
      list.push(r);
      m.set(r.scenario_position_id, list);
    }
    return m;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
        暂无自动子任务。请将任务设为「已发布」，并保证甲方业务与本岗位大类有交集。
      </p>
    );
  }

  return (
    <div className="space-y-4 mt-3 border-t border-gray-100 pt-3">
      <p className="text-xs font-semibold text-gray-800">业务进度</p>
      {[...byPosition.entries()].map(([posId, assigns]) => {
        const pos = positions.get(posId);
        return (
          <div key={posId} className="rounded-lg border border-gray-200 bg-gray-50/90 p-3 space-y-3">
            <div>
              <p className="text-sm font-medium text-gray-900">{pos?.title ?? "场景岗位"}</p>
              {pos && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {labelSceneCategories(pos.scene_categories)} ·{" "}
                  {[pos.address_province, pos.address_city, pos.address_district].join(" ")}
                </p>
              )}
            </div>
            <div className="space-y-3 pl-2 border-l-2 border-indigo-200">
              {assigns.map((a) => {
                const d = demands.get(a.party_demand_id);
                const pct = progressPct(Number(a.executed_hours), Number(a.max_hours_cap));
                return (
                  <div key={a.id} className="space-y-1.5">
                    <p className="text-sm text-gray-800">
                      甲方：<span className="font-medium">{d?.client_company ?? d?.title ?? "—"}</span>
                      <span className="text-gray-600"> · 设备 </span>
                      <span className="font-medium">{d?.device_type?.trim() || "—"}</span>
                      <span className="text-xs text-gray-500 ml-2">
                        （{labelSceneCategories(d?.scene_categories)}）
                      </span>
                    </p>
                    <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-gray-600">
                      已执行 {a.executed_hours} / 上限 {a.max_hours_cap} 小时
                    </p>
                    {isExecutor && (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-xs text-gray-500">填报已执行小时</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm bg-white"
                          value={localHours[a.id] ?? ""}
                          onChange={(e) =>
                            setLocalHours((prev) => ({
                              ...prev,
                              [a.id]: e.target.value.replace(/[^\d.]/g, ""),
                            }))
                          }
                        />
                        <button
                          type="button"
                          className="text-xs px-2 py-1 rounded bg-indigo-600 text-white"
                          onClick={async () => {
                            setErr("");
                            const v = Number(localHours[a.id]);
                            if (!Number.isFinite(v) || v < 0) {
                              setErr("已执行小时须为非负数");
                              return;
                            }
                            try {
                              await updateAssignmentExecutedHours(a.id, v);
                              await onHoursSaved();
                            } catch (e: unknown) {
                              setErr(e instanceof Error ? e.message : "保存失败");
                            }
                          }}
                        >
                          保存
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type SceneTasksInnerCacheV1 = { v: 3; tasks: SceneTask[] };

function SceneTasksInner({
  groupId,
  isExecutorView,
}: {
  groupId: string;
  isExecutorView: boolean;
}) {
  const { profile, session } = useAuth();
  const innerCacheKey = useMemo(
    () => routeViewCacheKeyExtra(session?.user?.id, "scene-tasks-inner", "v3"),
    [session?.user?.id]
  );

  const isAdmin = profile?.role === "admin";

  const [tasks, setTasks] = useState<SceneTask[]>([]);
  const [allAssignments, setAllAssignments] = useState<SceneTaskAssignment[]>([]);
  const [positions, setPositions] = useState<Map<string, ScenarioPosition>>(new Map());
  const [demands, setDemands] = useState<Map<string, PartyDemand>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");

  const [positionIdForCreate, setPositionIdForCreate] = useState("");
  const [dueByTaskId, setDueByTaskId] = useState<Record<string, string>>({});
  const [batchBusy, setBatchBusy] = useState(false);
  const fetchedOnceRef = useRef(false);

  const assignmentsByTaskId = useMemo(() => {
    const m = new Map<string, SceneTaskAssignment[]>();
    for (const a of allAssignments) {
      const list = m.get(a.scene_task_id) ?? [];
      list.push(a);
      m.set(a.scene_task_id, list);
    }
    return m;
  }, [allAssignments]);

  const assignmentCountByTaskId = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) m.set(t.id, (assignmentsByTaskId.get(t.id) ?? []).length);
    return m;
  }, [tasks, assignmentsByTaskId]);

  const loadAssignments = useCallback(async () => {
    try {
      const a = await listAssignmentsForWorkGroup(groupId);
      setAllAssignments(a);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "加载子任务失败");
    }
  }, [groupId]);

  useLayoutEffect(() => {
    if (!innerCacheKey) return;
    const snap = readRouteViewCache<SceneTasksInnerCacheV1>(innerCacheKey);
    if (!snap || snap.v !== 3) return;
    setTasks(snap.tasks);
    fetchedOnceRef.current = true;
    const due: Record<string, string> = {};
    for (const t of snap.tasks) due[t.id] = toDatetimeLocalValue(t.due_at);
    setDueByTaskId(due);
    setLoading(false);
  }, [innerCacheKey]);

  const loadTasks = useCallback(async () => {
    if (fetchedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    try {
      const t = await listSceneTasks({ groupId });
      const visible = isExecutorView ? t.filter((x) => x.status === "published") : t;
      setTasks(visible);
      setDueByTaskId((prev) => {
        const next = { ...prev };
        for (const x of visible) {
          next[x.id] = toDatetimeLocalValue(x.due_at);
        }
        return next;
      });
      fetchedOnceRef.current = true;
      await loadAssignments();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId, isExecutorView, loadAssignments]);

  useEffect(() => {
    if (!innerCacheKey) return;
    void loadTasks();
  }, [innerCacheKey, loadTasks]);

  useEffect(() => {
    if (!innerCacheKey || loading) return;
    writeRouteViewCache(innerCacheKey, { v: 3, tasks });
  }, [innerCacheKey, tasks, loading]);

  useEffect(() => {
    if (!groupId) return;
    void (async () => {
      try {
        const [ps, ds] = await Promise.all([listScenarioPositions(groupId), listPartyDemands(groupId)]);
        setPositions(new Map(ps.map((p) => [p.id, p])));
        setDemands(new Map(ds.map((d) => [d.id, d])));
      } catch {
        /* ignore */
      }
    })();
  }, [groupId]);

  function buildSceneTaskFromPosition(p: ScenarioPosition): { title: string; description: string } {
    const title = `【${p.title}】场景采集任务`;
    const lines = [
      "本任务由管理员基于现有场景岗位「业务强制」创建；发布后仅在该岗位下与甲方业务大类匹配生成子任务。",
      p.process_description?.trim() && `岗位说明：${p.process_description.trim()}`,
      `厂区：${[p.address_province, p.address_city, p.address_district].filter(Boolean).join(" ")}${p.address_detail ? ` ${p.address_detail}` : ""}`,
    ].filter(Boolean) as string[];
    return { title, description: lines.join("\n\n") };
  }

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    if (!isAdmin) {
      setErr("仅管理员可创建场景任务。");
      return;
    }
    setErr("");
    if (!positionIdForCreate) {
      setErr("请选择一个现有场景岗位。");
      return;
    }
    const p = positions.get(positionIdForCreate);
    if (!p) {
      setErr("所选岗位不存在或已删除，请刷新后重选。");
      return;
    }
    try {
      const { title, description } = buildSceneTaskFromPosition(p);
      await createSceneTask({
        title,
        description,
        group_id: groupId,
        scenario_position_id: p.id,
      });
      setPositionIdForCreate("");
      await loadTasks();
    } catch (err: unknown) {
      setErr(err instanceof Error ? err.message : "创建失败");
    }
  }

  async function saveDueAtForTask(taskId: string) {
    setErr("");
    const nextIso = fromDatetimeLocalValue(dueByTaskId[taskId] ?? "");
    const cur = await getSceneTask(taskId);
    if (!cur) {
      setErr("任务不存在");
      return;
    }
    if (cur.due_at && nextIso) {
      if (new Date(nextIso).getTime() < new Date(cur.due_at).getTime()) {
        setErr("截止时间只能延后，不能早于当前已设置的截止时间。");
        return;
      }
    }
    try {
      await updateSceneTask(taskId, { due_at: nextIso });
      await loadTasks();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function setTaskStatus(taskId: string, st: SceneTask["status"]) {
    await updateSceneTask(taskId, { status: st });
    if (st === "published") await syncSceneTaskAssignments(groupId);
    await loadTasks();
  }

  function canDeleteDraft(t: SceneTask): boolean {
    if (t.status !== "draft") return false;
    return profile?.role === "admin" || profile?.role === "scene_operator";
  }

  if (loading && tasks.length === 0) return <Spinner />;

  return (
    <>
      <RefreshStrip active={refreshing} />
      <div className="w-full min-w-0 space-y-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900">场景任务</h2>
          <p className="text-sm text-gray-500 mt-1">
            {isExecutorView
              ? "列表布局与场景岗位一致（无现场快照）；请在下方的业务读条中填报已执行小时。"
              : isAdmin
                ? "可由后台一键为全部场景岗位补齐草稿，或逐个选择岗位创建；已发布后展示业务读条。业务员可发布、维护截止时间。"
                : "任务由管理员创建；你可发布并维护截止时间。每条任务展示绑定岗位信息与业务读条。"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">
            列表打印（含绑定岗位现场图；主表下方含各任务业务读条与已执行/上限小时；打印前会等待图片加载）：
          </span>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                setErr("");
                try {
                  const html = await buildSceneTasksPrintHtml(
                    "场景任务列表",
                    `工作群 ${groupId}`,
                    tasks,
                    positions,
                    assignmentCountByTaskId,
                    assignmentsByTaskId,
                    demands
                  );
                  openSceneListPrint(html);
                } catch (e: unknown) {
                  setErr(e instanceof Error ? e.message : "无法打开打印窗口");
                }
              })();
            }}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm bg-white hover:bg-gray-50"
          >
            打印列表
          </button>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {!isExecutorView && isAdmin && (
          <div className="bg-white rounded-xl border border-indigo-100 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
              <p className="text-xs text-gray-600">为本群所有「尚无绑定任务」的场景岗位各建一条草稿（服务端批量插入，已存在的岗位会跳过）。</p>
              <button
                type="button"
                disabled={batchBusy || positions.size === 0}
                onClick={() => {
                  void (async () => {
                    setErr("");
                    setBatchBusy(true);
                    try {
                      const n = await batchGenerateSceneTasksForGroup(groupId);
                      await loadTasks();
                      if (n === 0) setErr("没有新增：每个岗位已有对应场景任务，或当前群无场景岗位。");
                    } catch (e: unknown) {
                      setErr(e instanceof Error ? e.message : "批量生成失败");
                    } finally {
                      setBatchBusy(false);
                    }
                  })();
                }}
                className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50"
              >
                {batchBusy ? "批量生成中…" : "一键批量生成草稿"}
              </button>
            </div>
          </div>
        )}
        {!isExecutorView && isAdmin && (
          <form onSubmit={handleCreateTask} className="bg-white rounded-xl border border-indigo-100 p-4 space-y-2">
            <label className="block text-xs font-medium text-gray-700">选择现有场景岗位（必填）</label>
            <select
              required
              value={positionIdForCreate}
              onChange={(e) => setPositionIdForCreate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">请选择岗位…</option>
              {[...positions.values()]
                .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} · {[p.address_province, p.address_city].filter(Boolean).join("")}
                  </option>
                ))}
            </select>
            {positions.size === 0 && (
              <p className="text-xs text-amber-700">
                当前工作群尚无场景岗位，请先到「场景岗位 / 快照」页添加后再创建任务。
              </p>
            )}
            <button
              type="submit"
              disabled={positions.size === 0}
              className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              基于所选岗位创建草稿（业务强制）
            </button>
          </form>
        )}

        {tasks.length === 0 && !loading && (
          <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6 text-center space-y-1">
            <span className="block font-medium text-gray-600">暂无场景任务</span>
            <span className="block text-xs leading-relaxed">
              {isExecutorView
                ? "仅展示已发布任务；若管理员刚创建草稿，需发布后才可见。请确认当前工作群与任务所属群一致。"
                : isAdmin
                  ? "可使用上文「一键批量生成草稿」，或选择单个岗位创建。若旧数据 group_id 为空，需在库中补全后才会出现在本群列表。"
                  : "任务由管理员创建；你可协助发布与维护截止时间。若仅有草稿，列表仍会为空直至发布。"}
            </span>
          </p>
        )}

        <ListViewSection
          storageKey="scene-tasks"
          compact={
            <CompactList>
              {tasks.map((t) => {
                const pos = t.scenario_position_id ? positions.get(t.scenario_position_id) : undefined;
                const statusLabel =
                  t.status === "draft" ? "草稿" : t.status === "published" ? "已发布" : "已关闭";
                return (
                  <CompactListRow
                    key={t.id}
                    primary={t.title}
                    secondary={t.description ?? undefined}
                    meta={`${statusLabel}${t.due_at ? ` · 截止 ${new Date(t.due_at).toLocaleString()}` : ""}${pos ? ` · ${labelSceneCategories(pos.scene_categories)}` : ""}`}
                  />
                );
              })}
            </CompactList>
          }
        >
        <CardList as="div">
          {tasks.map((t) => {
            const pos = t.scenario_position_id ? positions.get(t.scenario_position_id) : undefined;
            const assigns = assignmentsByTaskId.get(t.id) ?? [];
            return (
              <CardListItem as="div" key={t.id}>
              <div
                className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm h-full w-full min-w-0 box-border"
              >
                <div className="p-4 flex flex-col sm:flex-row gap-3 sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 gap-y-1">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                          t.status === "published"
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-100"
                            : t.status === "closed"
                              ? "bg-gray-100 text-gray-600 border border-gray-200"
                              : "bg-amber-50 text-amber-900 border border-amber-100"
                        }`}
                      >
                        {t.status === "draft" && "草稿"}
                        {t.status === "published" && "已发布"}
                        {t.status === "closed" && "已关闭"}
                      </span>
                      <h3 className="text-base font-semibold text-gray-900">{t.title}</h3>
                    </div>
                    {pos && (
                      <p className="text-xs text-gray-500 mt-1.5">
                        {labelSceneCategories(pos.scene_categories)} ·{" "}
                        {[pos.address_province, pos.address_city, pos.address_district].join(" ")}
                        {pos.address_detail ? ` ${pos.address_detail}` : ""}
                      </p>
                    )}
                    {t.description && (
                      <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{t.description}</p>
                    )}
                    {t.due_at && (
                      <p className="text-sm text-amber-900 mt-2">
                        截止：{new Date(t.due_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  {!isExecutorView && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {canDeleteDraft(t) && (
                        <button
                          type="button"
                          title="删除草稿"
                          onClick={async () => {
                            if (!confirm("删除该草稿？其下采集需求会一并删除。")) return;
                            setErr("");
                            try {
                              await deleteSceneTask(t.id);
                              await loadTasks();
                            } catch (ex: unknown) {
                              setErr(ex instanceof Error ? ex.message : "删除失败");
                            }
                          }}
                          className="px-2.5 py-1.5 rounded-lg border border-red-200 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100"
                        >
                          删除
                        </button>
                      )}
                      <select
                        value={t.status}
                        onChange={(e) =>
                          void setTaskStatus(t.id, e.target.value as SceneTask["status"]).catch((ex: unknown) =>
                            setErr(ex instanceof Error ? ex.message : "更新失败")
                          )
                        }
                        className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="draft">草稿</option>
                        <option value="published">已发布</option>
                        <option value="closed">已关闭</option>
                      </select>
                    </div>
                  )}
                </div>

                {!isExecutorView && (
                  <div className="px-4 pb-3 border-t border-gray-100 bg-slate-50/70 pt-3">
                    <p className="text-xs text-gray-600 mb-1.5">截止时间（可选，仅可延后）</p>
                    <div className="flex flex-wrap gap-2 items-end">
                      <input
                        type="datetime-local"
                        value={dueByTaskId[t.id] ?? ""}
                        onChange={(e) =>
                          setDueByTaskId((prev) => ({ ...prev, [t.id]: e.target.value }))
                        }
                        className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
                      />
                      <button
                        type="button"
                        onClick={() => void saveDueAtForTask(t.id)}
                        className="px-3 py-1.5 rounded-lg bg-gray-800 text-white text-sm"
                      >
                        保存截止
                      </button>
                    </div>
                  </div>
                )}

                {t.status === "published" ? (
                  <div className="px-4 pb-4">
                    <AssignmentsInline
                      rows={assigns}
                      positions={positions}
                      demands={demands}
                      isExecutor={isExecutorView}
                      setErr={setErr}
                      onHoursSaved={() => void loadAssignments()}
                    />
                  </div>
                ) : (
                  <div className="px-4 pb-3 text-xs text-gray-400 border-t border-gray-50 bg-white">
                    发布后将按甲方业务与岗位大类自动计算并展示业务读条。
                  </div>
                )}
              </div>
              </CardListItem>
            );
          })}
        </CardList>
        </ListViewSection>
      </div>
    </>
  );
}

type SceneShellCacheV1 = { v: 1; groupId: string | null; demands: PartyDemand[]; tab: Tab };

export default function SceneTasksPage() {
  const { session, profile } = useAuth();
  const location = useLocation();
  const shellKey = useMemo(
    () => routeViewCacheKey(session?.user?.id, location.pathname),
    [session?.user?.id, location.pathname]
  );

  const isExecutorView = profile?.role === "collection_executor";

  const [tab, setTab] = useState<Tab>("tasks");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [demands, setDemands] = useState<PartyDemand[]>([]);
  const [err, setErr] = useState("");

  useLayoutEffect(() => {
    if (!shellKey) return;
    const s = readRouteViewCache<SceneShellCacheV1>(shellKey);
    if (!s || s.v !== 1) return;
    setGroupId(s.groupId);
    setDemands(s.demands);
    if (!isExecutorView) setTab(s.tab);
    setLoading(false);
  }, [shellKey, isExecutorView]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const stale = shellKey ? readRouteViewCache<SceneShellCacheV1>(shellKey) : null;
      if (stale) setRefreshing(true);
      else setLoading(true);
      try {
        const gid = await fetchActiveGroupId();
        if (cancel) return;
        setGroupId(gid);
        if (gid && !isExecutorView) {
          const d = await listPartyDemands(gid);
          if (!cancel) setDemands(d);
        }
      } catch {
        if (!cancel) setGroupId(null);
      } finally {
        if (!cancel) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [shellKey, isExecutorView]);

  useEffect(() => {
    if (!shellKey || loading) return;
    writeRouteViewCache(shellKey, { v: 1, groupId, demands, tab });
  }, [shellKey, groupId, demands, tab, loading]);

  useEffect(() => {
    if (tab !== "stations" || !groupId || isExecutorView) return;
    void listPartyDemands(groupId).then(setDemands).catch(() => {});
  }, [tab, groupId, isExecutorView]);

  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        tab === t ? "bg-indigo-100 text-indigo-800" : "text-gray-600 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );

  if (loading) return <Spinner />;

  if (!groupId) {
    return (
      <div className="max-w-xl mx-auto text-center py-16">
        <RefreshStrip active={refreshing} />
        <p className="text-gray-600 mb-4">
          请先加入已审批的工作群组后，方可维护场景任务与甲方业务。工作群仅由平台管理员创建，请向管理员索取<strong>入群代码</strong>。
        </p>
        <Link to="/group" className="text-indigo-600 font-medium underline">
          前往群组申请入群
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <RefreshStrip active={refreshing} />
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{isExecutorView ? "场景采集任务" : "场景业务"}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {isExecutorView
            ? "已发布场景下的自动子任务与进度；请填报已执行小时。"
            : "场景流转任务、甲方数采需求、乙方工位快照。"}
        </p>
      </div>
      {!isExecutorView && (
        <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
          {tabBtn("tasks", "场景任务")}
          {tabBtn("demands", "甲方业务")}
          {tabBtn("stations", "场景岗位 / 快照")}
        </div>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {(tab === "tasks" || isExecutorView) && (
        <SceneTasksInner groupId={groupId} isExecutorView={isExecutorView} />
      )}
      {!isExecutorView && tab === "demands" && <PartyDemandsTab groupId={groupId} setErr={setErr} />}
      {!isExecutorView && tab === "stations" && (
        <ScenarioWorkstationsTab groupId={groupId} setErr={setErr} />
      )}
    </div>
  );
}
