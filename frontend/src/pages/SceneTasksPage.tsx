import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { fetchActiveGroupId } from "../api/groups";
import {
  createPartyDemand,
  updatePartyDemand,
  createScenarioPosition,
  updateScenarioPosition,
  createSceneMacroSite,
  updateSceneMacroSite,
  deletePartyDemand,
  deletePartyDemands,
  deleteScenarioPosition,
  deleteScenarioPositions,
  deleteSceneMacroSite,
  deleteSceneMacroSites,
  getSnapshotPublicUrl,
  listPartyDemands,
  listScenarioPositions,
  listSceneMacroSites,
  uploadWorkstationSnapshot,
  uploadPartyDeviceSnapshot,
  uploadMacroPanoramaSnapshot,
  type PartyDemand,
  type PartyDemandUpdatePatch,
  type ScenarioPosition,
  type SceneMacroSite,
} from "../api/operations";
import CollectionShiftsTab from "./CollectionShiftsTab";
import Spinner from "../components/Spinner";
import { BatchSelectCheckbox, BatchSelectToolbar } from "../components/ui/BatchSelectToolbar";
import { CardList, CardListItem, CompactList, CompactListRow, ListViewSection } from "../components/ui/PageLayout";
import RefreshStrip from "../components/RefreshStrip";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { readRouteViewCache, routeViewCacheKey, writeRouteViewCache } from "../utils/routeViewCache";
import { useAuth } from "../auth/AuthContext";
import {
  SCENE_CATEGORY_KEYS,
  SCENE_CATEGORY_LABELS,
  labelSceneCategories,
  type SceneCategoryKey,
} from "../utils/sceneCategories";
import {
  buildMacroScenesPrintHtml,
  buildPartyDemandsPrintHtml,
  openSceneListPrint,
  type SceneMacroPrintFields,
} from "../utils/sceneListPrintExport";

type Tab = "tasks" | "demands" | "stations";

function normalizeDemandCatTags(arr: string[] | null | undefined): SceneCategoryKey[] {
  const picked = (arr ?? []).filter((x): x is SceneCategoryKey =>
    (SCENE_CATEGORY_KEYS as readonly string[]).includes(x)
  );
  return picked.length >= 1 ? picked : ["industrial"];
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
  const [clientRate, setClientRate] = useState("");
  const [catTags, setCatTags] = useState<SceneCategoryKey[]>(["industrial"]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCompany, setEditCompany] = useState("");
  const [editDeviceType, setEditDeviceType] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editDeviceFile, setEditDeviceFile] = useState<File | null>(null);
  const [editTotalUnlimited, setEditTotalUnlimited] = useState(true);
  const [editTotalHours, setEditTotalHours] = useState("");
  const [editMaxPerScene, setEditMaxPerScene] = useState("8");
  const [editClientRate, setEditClientRate] = useState("");
  const [editCatTags, setEditCatTags] = useState<SceneCategoryKey[]>(["industrial"]);
  const loadedOnceRef = useRef(false);
  const batch = useBatchSelection();
  const [batchDeleting, setBatchDeleting] = useState(false);
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);

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
    setEditClientRate(
      r.client_hourly_rate != null && r.client_hourly_rate > 0 ? String(r.client_hourly_rate) : ""
    );
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
    let clientHourlyRate: number | null = null;
    if (editClientRate.trim() !== "") {
      const rate = Number(editClientRate);
      if (!Number.isFinite(rate) || rate < 0) {
        setErr("甲方单价须为非负数");
        return;
      }
      clientHourlyRate = rate;
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
        client_hourly_rate: clientHourlyRate,
      };
      if (editDeviceFile) {
        const { path, bucket } = await uploadPartyDeviceSnapshot(groupId, editDeviceFile);
        patch.device_snapshot_bucket = bucket;
        patch.device_snapshot_path = path;
      }
      await updatePartyDemand(editingId, patch);
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
    let clientHourlyRate: number | null = null;
    if (clientRate.trim() !== "") {
      const rate = Number(clientRate);
      if (!Number.isFinite(rate) || rate < 0) {
        setErr("甲方单价须为非负数");
        return;
      }
      clientHourlyRate = rate;
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
        client_hourly_rate: clientHourlyRate,
      });
      setClientCompany("");
      setDeviceType("");
      setSummary("");
      setDeviceFile(null);
      setTotalUnlimited(true);
      setTotalHours("");
      setMaxPerScene("8");
      setClientRate("");
      setCatTags(["industrial"]);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "添加失败");
    }
  }

  async function onBatchDelete() {
    if (batch.count === 0) return;
    if (!confirm(`确定删除选中的 ${batch.count} 条甲方业务？`)) return;
    setErr("");
    setBatchDeleting(true);
    try {
      await deletePartyDemands(batch.selectedIds);
      if (editingId && batch.isSelected(editingId)) closeEdit();
      batch.clear();
      await load();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "批量删除失败");
    } finally {
      setBatchDeleting(false);
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
        <strong>甲方业务</strong>：填写甲方公司、设备类型、<strong>甲方价格</strong>、设备快照、小时量与场景大类；下方列表可预览设备快照。
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
          <label className="block text-xs text-gray-500 mb-1">甲方结算单价（元/小时，可选，用于管理员看板收入估算）</label>
          <input
            type="number"
            min={0}
            step="0.01"
            placeholder="例如 120"
            value={clientRate}
            onChange={(e) => setClientRate(e.target.value)}
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
      <BatchSelectToolbar
        total={rows.length}
        selectedCount={batch.count}
        onSelectAll={() => batch.toggleAll(rowIds)}
        onClear={batch.clear}
        onDelete={() => void onBatchDelete()}
        deleting={batchDeleting}
      />
      <ListViewSection
        storageKey="scene-party-demands"
        compact={
          <CompactList>
            {rows.map((r) => (
              <CompactListRow
                key={r.id}
                primary={
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <BatchSelectCheckbox checked={batch.isSelected(r.id)} onChange={() => batch.toggle(r.id)} />
                    <span className="truncate">{r.client_company || r.title}</span>
                  </span>
                }
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
            <div className="flex items-start gap-2">
              <BatchSelectCheckbox checked={batch.isSelected(r.id)} onChange={() => batch.toggle(r.id)} />
              <div className="flex-1 min-w-0">
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
                  <label className="block text-xs text-gray-500 mb-1">甲方结算单价（元/小时，可选）</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="留空表示未配置"
                    value={editClientRate}
                    onChange={(e) => setEditClientRate(e.target.value)}
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
                        if (!confirm("删除该条甲方业务？")) return;
                        if (editingId === r.id) closeEdit();
                        try {
                          await deletePartyDemand(r.id);
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
            </div>
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

function ScenarioRow({ row, macroTitle }: { row: ScenarioPosition; macroTitle?: string }) {
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

  const displayTitle = macroTitle ? `${macroTitle} · ${row.title}` : row.title;

  return (
    <div className="bg-white p-4 flex flex-col sm:flex-row gap-4">
      {src && (
        <img src={src} alt="" className="w-full sm:w-40 h-32 object-cover rounded-lg border border-gray-100" />
      )}
      <div className="flex-1 min-w-0 pr-24">
        <p className="font-medium text-gray-900">{displayTitle}</p>
        <p className="text-xs text-gray-500 mt-1">
          大类：{labelSceneCategories(row.scene_categories)} ·{" "}
          {[row.address_province, row.address_city, row.address_district].filter(Boolean).join(" ")}
          {row.address_detail ? ` ${row.address_detail}` : ""}
        </p>
        {row.process_description && (
          <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{row.process_description}</p>
        )}
      </div>
    </div>
  );
}

function scenarioCategoriesToRecord(cats: string[]): Record<SceneCategoryKey, boolean> {
  const rec: Record<SceneCategoryKey, boolean> = { industrial: false, home: false, special: false };
  for (const c of cats) {
    if (c in rec) rec[c as SceneCategoryKey] = true;
  }
  if (!SCENE_CATEGORY_KEYS.some((k) => rec[k])) rec.industrial = true;
  return rec;
}

function MacroPanoramaSnapshot({ snapshotPath }: { snapshotPath: string | null | undefined }) {
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
      <div className="w-full max-w-xs sm:w-52 shrink-0 min-h-[8rem] flex items-center justify-center text-xs text-gray-400 border border-dashed border-gray-200 rounded-lg px-2 text-center">
        暂无全景图
      </div>
    );
  }
  if (loadErr) {
    return (
      <div className="w-full max-w-xs sm:w-52 shrink-0 min-h-[8rem] flex items-center justify-center text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 text-center">
        无法加载全景图
      </div>
    );
  }
  if (!src) {
    return (
      <div className="w-full max-w-xs sm:w-52 shrink-0 h-36 flex items-center justify-center text-xs text-gray-400 border border-gray-100 rounded-lg bg-gray-50">
        加载全景图…
      </div>
    );
  }
  return (
    <div className="shrink-0 w-full max-w-xs sm:w-52">
      <a href={src} target="_blank" rel="noopener noreferrer" className="block group">
        <img
          src={src}
          alt="大场景全景图"
          className="w-full h-36 object-cover rounded-lg border border-gray-100 group-hover:opacity-95"
        />
        <span className="text-xs text-indigo-600 mt-1 inline-block group-hover:underline">新标签页打开原图</span>
      </a>
    </div>
  );
}

function MacroSiteRow({ row }: { row: SceneMacroSite }) {
  return (
    <div className="p-4 flex flex-col sm:flex-row gap-4">
      <MacroPanoramaSnapshot snapshotPath={row.panorama_path} />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="font-medium text-gray-900">{row.title}</p>
        {row.description && <p className="text-sm text-gray-600 whitespace-pre-wrap">{row.description}</p>}
        <p className="text-xs text-gray-500">
          {[row.address_province, row.address_city, row.address_district].filter(Boolean).join(" ")}
          {row.address_detail ? ` ${row.address_detail}` : ""}
        </p>
        {(row.contact_name?.trim() || row.contact_phone?.trim()) && (
          <p className="text-xs text-gray-600 mt-1">
            联系人：{row.contact_name?.trim() || "—"} · {row.contact_phone?.trim() || "—"}
          </p>
        )}
      </div>
    </div>
  );
}

function ScenarioWorkstationsTab({
  groupId,
  setErr,
}: {
  groupId: string;
  setErr: (s: string) => void;
}) {
  const [macros, setMacros] = useState<SceneMacroSite[]>([]);
  const [rows, setRows] = useState<ScenarioPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadedOnceRef = useRef(false);

  const [macroTitle, setMacroTitle] = useState("");
  const [macroDesc, setMacroDesc] = useState("");
  const [macroProvince, setMacroProvince] = useState("");
  const [macroCity, setMacroCity] = useState("");
  const [macroDistrict, setMacroDistrict] = useState("");
  const [macroDetail, setMacroDetail] = useState("");
  const [macroContactName, setMacroContactName] = useState("");
  const [macroContactPhone, setMacroContactPhone] = useState("");
  const [macroPanoramaFile, setMacroPanoramaFile] = useState<File | null>(null);
  const [macroBusy, setMacroBusy] = useState(false);
  const [editingMacroId, setEditingMacroId] = useState<string | null>(null);
  const [eMacroTitle, setEMacroTitle] = useState("");
  const [eMacroDesc, setEMacroDesc] = useState("");
  const [eMacroProvince, setEMacroProvince] = useState("");
  const [eMacroCity, setEMacroCity] = useState("");
  const [eMacroDistrict, setEMacroDistrict] = useState("");
  const [eMacroDetail, setEMacroDetail] = useState("");
  const [eMacroContactName, setEMacroContactName] = useState("");
  const [eMacroContactPhone, setEMacroContactPhone] = useState("");
  const [eMacroPanoramaFile, setEMacroPanoramaFile] = useState<File | null>(null);
  const [eMacroBusy, setEMacroBusy] = useState(false);
  const macroBatch = useBatchSelection();
  const [macroBatchDeleting, setMacroBatchDeleting] = useState(false);
  const [printFields, setPrintFields] = useState<SceneMacroPrintFields>({
    positionInfo: true,
    locationInfo: true,
    contactInfo: true,
  });
  const [printBusy, setPrintBusy] = useState(false);
  const macroIds = useMemo(() => macros.map((m) => m.id), [macros]);

  const positionsByMacro = useMemo(() => {
    const map = new Map<string, ScenarioPosition[]>();
    for (const m of macros) map.set(m.id, []);
    for (const r of rows) {
      const mid = r.macro_scene_id;
      if (mid) {
        const list = map.get(mid);
        if (list) list.push(r);
      }
    }
    return map;
  }, [macros, rows]);

  const [addPosMacroId, setAddPosMacroId] = useState<string | null>(null);
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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [eMacroSceneId, setEMacroSceneId] = useState("");
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
  const posBatch = useBatchSelection();
  const [posBatchDeleting, setPosBatchDeleting] = useState(false);

  const load = useCallback(async () => {
    if (loadedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    try {
      const [m, s] = await Promise.all([listSceneMacroSites(groupId), listScenarioPositions(groupId)]);
      setMacros(m);
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

  function resetPosDraft() {
    setTitle("");
    setProc("");
    setProvince("");
    setCity("");
    setDistrict("");
    setDetail("");
    setSelCats({ industrial: true, home: false, special: false });
    setFile(null);
  }

  function toggleAddPos(m: SceneMacroSite) {
    setErr("");
    if (addPosMacroId === m.id) {
      setAddPosMacroId(null);
      resetPosDraft();
      return;
    }
    setAddPosMacroId(m.id);
    resetPosDraft();
    setProvince(m.address_province);
    setCity(m.address_city);
    setDistrict(m.address_district);
    setDetail(m.address_detail ?? "");
  }

  function toggleCat(k: SceneCategoryKey) {
    setSelCats((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  function toggleECat(k: SceneCategoryKey) {
    setESelCats((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  function openMacroEdit(m: SceneMacroSite) {
    setErr("");
    setEditingMacroId(m.id);
    setEMacroTitle(m.title);
    setEMacroDesc(m.description ?? "");
    setEMacroProvince(m.address_province);
    setEMacroCity(m.address_city);
    setEMacroDistrict(m.address_district);
    setEMacroDetail(m.address_detail ?? "");
    setEMacroContactName(m.contact_name ?? "");
    setEMacroContactPhone(m.contact_phone ?? "");
    setEMacroPanoramaFile(null);
  }

  async function onSaveMacroEdit(e: React.FormEvent, id: string) {
    e.preventDefault();
    setErr("");
    if (!eMacroProvince.trim() || !eMacroCity.trim() || !eMacroDistrict.trim()) {
      setErr("请填写大场景的省、市、区（县）");
      return;
    }
    if (!eMacroContactName.trim()) {
      setErr("请填写场景联系人姓名");
      return;
    }
    if (!eMacroContactPhone.trim()) {
      setErr("请填写场景联系人电话");
      return;
    }
    setEMacroBusy(true);
    try {
      const patch: Parameters<typeof updateSceneMacroSite>[1] = {
        title: eMacroTitle.trim(),
        description: eMacroDesc.trim() || null,
        contact_name: eMacroContactName.trim(),
        contact_phone: eMacroContactPhone.trim(),
        address_province: eMacroProvince.trim(),
        address_city: eMacroCity.trim(),
        address_district: eMacroDistrict.trim(),
        address_detail: eMacroDetail.trim() || null,
      };
      if (eMacroPanoramaFile) {
        const { path } = await uploadMacroPanoramaSnapshot(groupId, eMacroPanoramaFile);
        patch.panorama_path = path;
      }
      await updateSceneMacroSite(id, patch);
      setEditingMacroId(null);
      setEMacroPanoramaFile(null);
      await load();
    } catch (err: unknown) {
      setErr(err instanceof Error ? err.message : "保存大场景失败");
    } finally {
      setEMacroBusy(false);
    }
  }

  async function onAddMacro(e: React.FormEvent) {
    e.preventDefault();
    if (!macroTitle.trim()) {
      setErr("请填写大场景名称");
      return;
    }
    if (!macroProvince.trim() || !macroCity.trim() || !macroDistrict.trim()) {
      setErr("请填写大场景的省、市、区（县）");
      return;
    }
    if (!macroPanoramaFile) {
      setErr("请上传大场景全景图");
      return;
    }
    if (!macroContactName.trim()) {
      setErr("请填写场景联系人姓名");
      return;
    }
    if (!macroContactPhone.trim()) {
      setErr("请填写场景联系人电话");
      return;
    }
    setErr("");
    setMacroBusy(true);
    try {
      const { path } = await uploadMacroPanoramaSnapshot(groupId, macroPanoramaFile);
      await createSceneMacroSite({
        group_id: groupId,
        title: macroTitle.trim(),
        description: macroDesc.trim() || undefined,
        panorama_path: path,
        contact_name: macroContactName.trim(),
        contact_phone: macroContactPhone.trim(),
        address_province: macroProvince.trim(),
        address_city: macroCity.trim(),
        address_district: macroDistrict.trim(),
        address_detail: macroDetail.trim() || undefined,
      });
      setMacroTitle("");
      setMacroDesc("");
      setMacroProvince("");
      setMacroCity("");
      setMacroDistrict("");
      setMacroDetail("");
      setMacroContactName("");
      setMacroContactPhone("");
      setMacroPanoramaFile(null);
      await load();
    } catch (err: unknown) {
      setErr(err instanceof Error ? err.message : "添加大场景失败");
    } finally {
      setMacroBusy(false);
    }
  }

  async function onMacroBatchDelete() {
    if (macroBatch.count === 0) return;
    if (!confirm(`确定删除选中的 ${macroBatch.count} 个大场景？有下属小岗位的大场景将无法删除。`)) return;
    setErr("");
    setMacroBatchDeleting(true);
    try {
      await deleteSceneMacroSites(macroBatch.selectedIds);
      if (editingMacroId && macroBatch.isSelected(editingMacroId)) setEditingMacroId(null);
      macroBatch.clear();
      await load();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "批量删除大场景失败");
    } finally {
      setMacroBatchDeleting(false);
    }
  }

  async function onPrintSelectedMacros() {
    if (macroBatch.count === 0) {
      setErr("请先在大场景列表中勾选要打印的大场景");
      return;
    }
    if (!printFields.positionInfo && !printFields.locationInfo && !printFields.contactInfo) {
      setErr("请至少选择一项打印信息");
      return;
    }
    setErr("");
    setPrintBusy(true);
    try {
      const selected = macros.filter((m) => macroBatch.isSelected(m.id));
      const html = await buildMacroScenesPrintHtml(
        "大场景打印列表",
        `工作群 ${groupId}`,
        selected,
        positionsByMacro,
        printFields
      );
      openSceneListPrint(html);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "无法打开打印窗口");
    } finally {
      setPrintBusy(false);
    }
  }

  function openEdit(r: ScenarioPosition) {
    setErr("");
    setEditingId(r.id);
    setEMacroSceneId(r.macro_scene_id ?? "");
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
    if (!eMacroSceneId) {
      setErr("请选择所属大场景");
      return;
    }
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
        macro_scene_id: eMacroSceneId,
        process_description: eProc.trim() || null,
        scene_categories: cats,
        address_province: eProvince.trim(),
        address_city: eCity.trim(),
        address_district: eDistrict.trim(),
        address_detail: eDetail.trim() || null,
        ...(snapshotPath ? { snapshot_path: snapshotPath } : {}),
      });
      setEditingId(null);
      setEFile(null);
      await load();
    } catch (err: unknown) {
      setErr(err instanceof Error ? err.message : "保存失败");
    } finally {
      setEBusy(false);
    }
  }

  async function onAdd(e: React.FormEvent, macroId: string) {
    e.preventDefault();
    if (!file) {
      setErr("请选择现场快照图片");
      return;
    }
    const cats = SCENE_CATEGORY_KEYS.filter((k) => selCats[k]);
    if (cats.length < 1) {
      setErr("请至少勾选一个场景大类");
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
        macro_scene_id: macroId,
        title: title.trim(),
        process_description: proc.trim() || undefined,
        snapshot_path: path,
        scene_categories: cats,
        address_province: province.trim(),
        address_city: city.trim(),
        address_district: district.trim(),
        address_detail: detail.trim() || undefined,
      });
      resetPosDraft();
      setAddPosMacroId(null);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading && rows.length === 0 && macros.length === 0) return <Spinner />;

  function renderPosAddForm(macroId: string) {
    return (
      <form onSubmit={(e) => void onAdd(e, macroId)} className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4 space-y-2">
        <p className="text-xs font-medium text-indigo-900">添加小岗位</p>
        <p className="text-xs text-gray-500">场景大类（可多选）</p>
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
          placeholder="工序 / 小岗位（必填）"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
        />
        <textarea
          placeholder="具体描述（可选）"
          value={proc}
          onChange={(e) => setProc(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            required
            placeholder="省（必填）"
            value={province}
            onChange={(e) => setProvince(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          />
          <input
            required
            placeholder="市（必填）"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          />
          <input
            required
            placeholder="区/县（必填）"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          />
        </div>
        <input
          placeholder="详细地址（可选）"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
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
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {busy ? "上传中…" : "确认添加"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setAddPosMacroId(null);
              resetPosDraft();
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            取消
          </button>
        </div>
      </form>
    );
  }

  function renderPosEditForm(r: ScenarioPosition) {
    return (
      <form onSubmit={(ev) => void onSaveEdit(ev, r.id)} className="border border-indigo-100 bg-indigo-50/40 rounded-lg p-4 space-y-2 mt-2">
        <p className="text-xs font-medium text-indigo-900">编辑小岗位</p>
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
          placeholder="工序 / 小岗位"
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
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
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
    );
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <RefreshStrip active={refreshing} />
      <p className="text-sm text-gray-500">
        先<strong>添加大场景</strong>（含全景图与联系人），再在各<strong>大场景卡片内</strong>维护下属小岗位；打印时在大场景列表中多选后配置打印项。
      </p>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">添加大场景</h2>
        <form onSubmit={onAddMacro} className="bg-white rounded-xl border border-violet-100 p-4 space-y-2">
          <input
            required
            placeholder="大场景名称（必填）"
            value={macroTitle}
            onChange={(e) => setMacroTitle(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <textarea
            placeholder="大场景说明（可选）"
            value={macroDesc}
            onChange={(e) => setMacroDesc(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              required
              placeholder="省（必填）"
              value={macroProvince}
              onChange={(e) => setMacroProvince(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="市（必填）"
              value={macroCity}
              onChange={(e) => setMacroCity(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="区/县（必填）"
              value={macroDistrict}
              onChange={(e) => setMacroDistrict(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <input
            placeholder="详细地址（可选）"
            value={macroDetail}
            onChange={(e) => setMacroDetail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              required
              placeholder="场景联系人姓名（必填）"
              value={macroContactName}
              onChange={(e) => setMacroContactName(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="场景联系人电话（必填）"
              value={macroContactPhone}
              onChange={(e) => setMacroContactPhone(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">全景图（必填）</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setMacroPanoramaFile(e.target.files?.[0] ?? null)}
              className="text-sm w-full"
            />
          </div>
          <button
            type="submit"
            disabled={macroBusy}
            className="px-4 py-2 bg-violet-700 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {macroBusy ? "保存中…" : "添加大场景"}
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-gray-900">大场景列表</h2>
        <BatchSelectToolbar
          total={macros.length}
          selectedCount={macroBatch.count}
          onSelectAll={() => macroBatch.toggleAll(macroIds)}
          onClear={macroBatch.clear}
          onDelete={() => void onMacroBatchDelete()}
          deleting={macroBatchDeleting}
          deleteLabel="删除选中大场景"
        />
        {macros.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-3 space-y-3">
            <p className="text-sm text-slate-700">
              打印：先勾选大场景（已选 <strong>{macroBatch.count}</strong> / {macros.length}），再选择打印信息并打印。
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={printFields.positionInfo}
                  onChange={(e) => setPrintFields((p) => ({ ...p, positionInfo: e.target.checked }))}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                岗位信息
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={printFields.locationInfo}
                  onChange={(e) => setPrintFields((p) => ({ ...p, locationInfo: e.target.checked }))}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                位置信息
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={printFields.contactInfo}
                  onChange={(e) => setPrintFields((p) => ({ ...p, contactInfo: e.target.checked }))}
                  className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                联系人信息
              </label>
            </div>
            <button
              type="button"
              disabled={printBusy || macroBatch.count === 0}
              onClick={() => void onPrintSelectedMacros()}
              className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {printBusy ? "生成中…" : "打印选中大场景"}
            </button>
          </div>
        )}
        {macros.length === 0 ? (
          <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6 text-center">
            暂无大场景，请先在上方添加。
          </p>
        ) : (
          <div className="space-y-4">
            {macros.map((m) => {
              const macroPositions = positionsByMacro.get(m.id) ?? [];
              const macroPosIds = macroPositions.map((p) => p.id);
              const macroPosSelected = macroPosIds.filter((id) => posBatch.isSelected(id)).length;
              return (
                <article
                  key={m.id}
                  className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm"
                >
                  <div className="relative">
                    <div className="flex items-start gap-2 p-3 pb-0">
                      <BatchSelectCheckbox
                        checked={macroBatch.isSelected(m.id)}
                        onChange={() => macroBatch.toggle(m.id)}
                        label={`选择大场景 ${m.title}`}
                      />
                      <div className="flex-1 min-w-0 pr-20">
                        {editingMacroId === m.id ? (
                          <form onSubmit={(ev) => void onSaveMacroEdit(ev, m.id)} className="p-1 space-y-2">
                            <p className="text-xs font-medium text-violet-900">编辑大场景</p>
                            <input
                              required
                              value={eMacroTitle}
                              onChange={(e) => setEMacroTitle(e.target.value)}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                            />
                            <textarea
                              value={eMacroDesc}
                              onChange={(e) => setEMacroDesc(e.target.value)}
                              rows={2}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <input
                                required
                                placeholder="省"
                                value={eMacroProvince}
                                onChange={(e) => setEMacroProvince(e.target.value)}
                                className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                              />
                              <input
                                required
                                placeholder="市"
                                value={eMacroCity}
                                onChange={(e) => setEMacroCity(e.target.value)}
                                className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                              />
                              <input
                                required
                                placeholder="区/县"
                                value={eMacroDistrict}
                                onChange={(e) => setEMacroDistrict(e.target.value)}
                                className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                              />
                            </div>
                            <input
                              placeholder="详细地址"
                              value={eMacroDetail}
                              onChange={(e) => setEMacroDetail(e.target.value)}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                            />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <input
                                required
                                placeholder="场景联系人姓名"
                                value={eMacroContactName}
                                onChange={(e) => setEMacroContactName(e.target.value)}
                                className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                              />
                              <input
                                required
                                placeholder="场景联系人电话"
                                value={eMacroContactPhone}
                                onChange={(e) => setEMacroContactPhone(e.target.value)}
                                className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                              />
                            </div>
                            <div>
                              <p className="text-xs text-gray-500 mb-1">当前全景图</p>
                              <MacroPanoramaSnapshot snapshotPath={m.panorama_path} />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">更换全景图（可选）</label>
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={(e) => setEMacroPanoramaFile(e.target.files?.[0] ?? null)}
                                className="text-sm w-full"
                              />
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="submit"
                                disabled={eMacroBusy}
                                className="px-4 py-2 bg-violet-700 text-white rounded-lg text-sm disabled:opacity-50"
                              >
                                {eMacroBusy ? "保存中…" : "保存"}
                              </button>
                              <button
                                type="button"
                                disabled={eMacroBusy}
                                onClick={() => {
                                  setEditingMacroId(null);
                                  setEMacroPanoramaFile(null);
                                }}
                                className="px-4 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                              >
                                取消
                              </button>
                            </div>
                          </form>
                        ) : (
                          <MacroSiteRow row={m} />
                        )}
                      </div>
                    </div>
                    {editingMacroId !== m.id && (
                      <div className="absolute top-3 right-3 flex gap-1">
                        <button
                          type="button"
                          onClick={() => openMacroEdit(m)}
                          className="text-xs text-violet-700 bg-white/95 px-2 py-1 rounded border border-violet-200 shadow-sm"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!confirm("删除该大场景？")) return;
                            if (editingMacroId === m.id) setEditingMacroId(null);
                            if (addPosMacroId === m.id) setAddPosMacroId(null);
                            try {
                              await deleteSceneMacroSite(m.id);
                              await load();
                            } catch (ex: unknown) {
                              setErr(ex instanceof Error ? ex.message : "删除失败");
                            }
                          }}
                          className="text-xs text-red-600 bg-white/95 px-2 py-1 rounded border border-red-100 shadow-sm"
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-gray-100 bg-slate-50/60 px-4 py-4 mt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <h3 className="text-sm font-medium text-gray-800">
                        小岗位
                        <span className="ml-1.5 text-xs font-normal text-gray-500">共 {macroPositions.length} 个</span>
                      </h3>
                      <button
                        type="button"
                        onClick={() => toggleAddPos(m)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                          addPosMacroId === m.id
                            ? "border border-gray-300 bg-white text-gray-700"
                            : "bg-indigo-600 text-white hover:bg-indigo-700"
                        }`}
                      >
                        {addPosMacroId === m.id ? "收起表单" : "添加小岗位"}
                      </button>
                    </div>

                    {addPosMacroId === m.id && renderPosAddForm(m.id)}

                    {macroPositions.length > 0 && (
                      <BatchSelectToolbar
                        total={macroPosIds.length}
                        selectedCount={macroPosSelected}
                        onSelectAll={() => posBatch.toggleAll(macroPosIds)}
                        onClear={() => {
                          for (const id of macroPosIds) {
                            if (posBatch.isSelected(id)) posBatch.toggle(id);
                          }
                        }}
                        onDelete={() => {
                          void (async () => {
                            if (macroPosSelected === 0) return;
                            if (!confirm(`确定删除该大场景下选中的 ${macroPosSelected} 个小岗位？`)) return;
                            setErr("");
                            setPosBatchDeleting(true);
                            try {
                              await deleteScenarioPositions(
                                macroPosIds.filter((id) => posBatch.isSelected(id))
                              );
                              if (editingId && posBatch.isSelected(editingId)) setEditingId(null);
                              for (const id of macroPosIds) {
                                if (posBatch.isSelected(id)) posBatch.toggle(id);
                              }
                              await load();
                            } catch (ex: unknown) {
                              setErr(ex instanceof Error ? ex.message : "批量删除失败");
                            } finally {
                              setPosBatchDeleting(false);
                            }
                          })();
                        }}
                        deleting={posBatchDeleting}
                        deleteLabel="删除选中小岗位"
                      />
                    )}

                    {macroPositions.length === 0 ? (
                      <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-4 text-center">
                        该大场景下暂无小岗位，点击「添加小岗位」创建。
                      </p>
                    ) : (
                      <ul className="space-y-3 mt-3">
                        {macroPositions.map((r) => (
                          <li
                            key={r.id}
                            className="rounded-lg border border-gray-200 bg-white overflow-hidden"
                          >
                            <div className="relative">
                              <div className="absolute top-2 left-2 z-10">
                                <BatchSelectCheckbox
                                  checked={posBatch.isSelected(r.id)}
                                  onChange={() => posBatch.toggle(r.id)}
                                  label={`选择 ${r.title}`}
                                />
                              </div>
                              <ScenarioRow row={r} />
                              {editingId !== r.id && (
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
                                      if (!confirm("删除该小岗位？")) return;
                                      if (editingId === r.id) setEditingId(null);
                                      await deleteScenarioPosition(r.id);
                                      await load();
                                    }}
                                    className="text-xs text-red-600 bg-white/95 px-2 py-1 rounded border border-red-100 shadow-sm"
                                  >
                                    删除
                                  </button>
                                </div>
                              )}
                            </div>
                            {editingId === r.id && (
                              <div className="px-3 pb-3">{renderPosEditForm(r)}</div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
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
          请先加入已审批的工作群组后，方可维护采集排班与甲方业务。工作群仅由平台管理员创建，请向管理员索取<strong>入群代码</strong>。
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
        <h1 className="text-2xl font-bold text-gray-900">{isExecutorView ? "采集排班" : "场景业务"}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {isExecutorView
            ? "查看已发布排班、本批设备编号，并按时上下班打卡。"
            : "采集排班、甲方业务、大场景与小岗位维护。"}
        </p>
      </div>
      {!isExecutorView && (
        <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
          {tabBtn("tasks", "采集排班")}
          {tabBtn("demands", "甲方业务")}
          {tabBtn("stations", "场景岗位")}
        </div>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
      {(tab === "tasks" || isExecutorView) && (
        <CollectionShiftsTab groupId={groupId} isExecutorView={isExecutorView} />
      )}
      {!isExecutorView && tab === "demands" && <PartyDemandsTab groupId={groupId} setErr={setErr} />}
      {!isExecutorView && tab === "stations" && (
        <ScenarioWorkstationsTab groupId={groupId} setErr={setErr} />
      )}
    </div>
  );
}
