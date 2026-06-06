import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clockInCollectionShift,
  clockOutCollectionShift,
  closeCollectionShift,
  collectionShiftStatusLabel,
  createCollectionShift,
  deleteCollectionShiftDraft,
  deleteCollectionShiftDrafts,
  loadCollectionShiftBundles,
  publishCollectionShift,
  type CollectionShiftBundle,
} from "../api/collectionShifts";
import { listGroupProfilesByRole } from "../api/groups";
import { formatScenarioPositionLabel, listScenarioPositions, listSceneMacroSites, type ScenarioPosition, type SceneMacroSite } from "../api/operations";
import { profileDisplayName, fetchProfilesByIds } from "../api/profiles";
import { useAuth } from "../auth/AuthContext";
import { labelSceneCategories } from "../utils/sceneCategories";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import { BatchSelectCheckbox, BatchSelectToolbar } from "../components/ui/BatchSelectToolbar";
import { CardList, CardListItem, CompactList, CompactListRow, ListViewSection } from "../components/ui/PageLayout";
import { useBatchSelection } from "../hooks/useBatchSelection";

function fromDatetimeLocalValue(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export default function CollectionShiftsTab({
  groupId,
  isExecutorView,
}: {
  groupId: string;
  isExecutorView: boolean;
}) {
  const { profile } = useAuth();
  const canManage = profile?.role === "admin" || profile?.role === "scene_operator";

  const [bundles, setBundles] = useState<CollectionShiftBundle[]>([]);
  const [positions, setPositions] = useState<ScenarioPosition[]>([]);
  const [macros, setMacros] = useState<SceneMacroSite[]>([]);
  const [executors, setExecutors] = useState<{ id: string; name: string }[]>([]);
  const [executorNames, setExecutorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [positionId, setPositionId] = useState("");
  const [executorId, setExecutorId] = useState("");
  const [deviceCount, setDeviceCount] = useState("1");
  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("");
  const [note, setNote] = useState("");
  const loadedOnceRef = useRef(false);
  const draftBatch = useBatchSelection();
  const [draftBatchDeleting, setDraftBatchDeleting] = useState(false);

  const positionMap = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);
  const macroMap = useMemo(() => new Map(macros.map((m) => [m.id, m])), [macros]);
  const draftBundles = useMemo(
    () => (canManage && !isExecutorView ? bundles.filter((b) => b.shift.status === "draft") : []),
    [bundles, canManage, isExecutorView]
  );
  const draftIds = useMemo(() => draftBundles.map((b) => b.shift.id), [draftBundles]);

  function positionLabel(pos: ScenarioPosition | undefined): string {
    if (!pos) return "场景岗位";
    return formatScenarioPositionLabel(pos, macroMap);
  }

  const load = useCallback(async () => {
    setErr("");
    if (loadedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    try {
      const rows = await loadCollectionShiftBundles(groupId, { executorOnly: isExecutorView });
      const [ps, ms] = await Promise.all([listScenarioPositions(groupId), listSceneMacroSites(groupId)]);
      setBundles(rows);
      setPositions(ps);
      setMacros(ms);

      const execIds = [...new Set(rows.map((r) => r.shift.executor_id))];
      if (execIds.length) {
        const profs = await fetchProfilesByIds(execIds);
        const nameMap: Record<string, string> = {};
        for (const p of profs) nameMap[p.id] = profileDisplayName(p);
        setExecutorNames(nameMap);
      } else {
        setExecutorNames({});
      }

      if (canManage && !isExecutorView) {
        const list = await listGroupProfilesByRole(groupId, "collection_executor");
        setExecutors(list.map((p) => ({ id: p.id, name: profileDisplayName(p) })));
      }
      loadedOnceRef.current = true;
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId, isExecutorView, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    setErr("");
    const count = Number(deviceCount);
    if (!positionId) {
      setErr("请选择场景岗位");
      return;
    }
    if (!executorId) {
      setErr("请选择数采执行员");
      return;
    }
    if (!Number.isFinite(count) || count < 1 || !Number.isInteger(count)) {
      setErr("设备数量须为正整数");
      return;
    }
    try {
      const id = await createCollectionShift({
        groupId,
        scenarioPositionId: positionId,
        executorId,
        deviceCount: count,
        scheduledStart: fromDatetimeLocalValue(scheduledStart),
        scheduledEnd: fromDatetimeLocalValue(scheduledEnd),
        note: note.trim() || null,
      });
      setPositionId("");
      setExecutorId("");
      setDeviceCount("1");
      setScheduledStart("");
      setScheduledEnd("");
      setNote("");
      await load();
      if (window.confirm("排班草稿已创建，是否立即发布并分配设备？")) {
        setBusyId(id);
        try {
          await publishCollectionShift(id);
          await load();
        } finally {
          setBusyId(null);
        }
      }
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "创建失败");
    }
  }

  async function onDraftBatchDelete() {
    if (draftBatch.count === 0) return;
    if (!confirm(`确定删除选中的 ${draftBatch.count} 条排班草稿？`)) return;
    setErr("");
    setDraftBatchDeleting(true);
    try {
      await deleteCollectionShiftDrafts(draftBatch.selectedIds);
      draftBatch.clear();
      await load();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "批量删除失败");
    } finally {
      setDraftBatchDeleting(false);
    }
  }

  if (loading && bundles.length === 0) return <Spinner />;

  return (
    <div className="w-full min-w-0 space-y-6">
      <RefreshStrip active={refreshing} />
      <div>
        <h2 className="text-lg font-bold text-gray-900">采集排班</h2>
        <p className="text-sm text-gray-500 mt-1">
          {isExecutorView
            ? "查看已发布的排班、本批设备登记编号，并按时上下班打卡。"
            : "手动选择场景岗位、数采执行员与设备数量；发布后排班自动从本群可用离线设备中匀出一批编号。"}
        </p>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      {canManage && !isExecutorView && (
        <form onSubmit={onCreate} className="bg-white rounded-xl border border-indigo-100 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">场景岗位（必填）</label>
              <select
                required
                value={positionId}
                onChange={(e) => setPositionId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">请选择…</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatScenarioPositionLabel(p, macroMap)} ·{" "}
                    {[p.address_province, p.address_city].filter(Boolean).join("")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">数采执行员（必填）</label>
              <select
                required
                value={executorId}
                onChange={(e) => setExecutorId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">请选择…</option>
                {executors.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">安排设备数量（必填）</label>
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                required
                value={deviceCount}
                onChange={(e) => setDeviceCount(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">计划上班（可选）</label>
              <input
                type="datetime-local"
                value={scheduledStart}
                onChange={(e) => setScheduledStart(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">计划下班（可选）</label>
              <input
                type="datetime-local"
                value={scheduledEnd}
                onChange={(e) => setScheduledEnd(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <textarea
            placeholder="备注（可选）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={positions.length === 0 || executors.length === 0}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            创建排班草稿
          </button>
          {(positions.length === 0 || executors.length === 0) && (
            <p className="text-xs text-amber-700">
              {positions.length === 0 ? "请先在「场景岗位 / 快照」添加岗位。" : "本群暂无数采执行员成员。"}
            </p>
          )}
        </form>
      )}

      {canManage && !isExecutorView && draftBundles.length > 0 && (
        <BatchSelectToolbar
          total={draftBundles.length}
          selectedCount={draftBatch.count}
          onSelectAll={() => draftBatch.toggleAll(draftIds)}
          onClear={draftBatch.clear}
          onDelete={() => void onDraftBatchDelete()}
          deleting={draftBatchDeleting}
          deleteLabel="删除选中草稿"
        />
      )}

      {bundles.length === 0 && !loading && (
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6 text-center">
          {isExecutorView ? "暂无已发布的采集排班。" : "暂无排班，请创建草稿并发布。"}
        </p>
      )}

      <ListViewSection
        storageKey="collection-shifts"
        compact={
          <CompactList>
            {bundles.map(({ shift, devices }) => {
              const pos = positionMap.get(shift.scenario_position_id);
              const isDraft = shift.status === "draft";
              return (
                <CompactListRow
                  key={shift.id}
                  primary={
                    <span className="inline-flex items-center gap-2 min-w-0">
                      {canManage && !isExecutorView && isDraft && (
                        <BatchSelectCheckbox
                          checked={draftBatch.isSelected(shift.id)}
                          onChange={() => draftBatch.toggle(shift.id)}
                        />
                      )}
                      <span className="truncate">{positionLabel(pos)}</span>
                    </span>
                  }
                  secondary={`${collectionShiftStatusLabel(shift.status)} · ${devices.length}/${shift.device_count} 台`}
                  meta={
                    shift.scheduled_start
                      ? `计划 ${new Date(shift.scheduled_start).toLocaleString()}`
                      : shift.published_at
                        ? `发布 ${new Date(shift.published_at).toLocaleString()}`
                        : undefined
                  }
                />
              );
            })}
          </CompactList>
        }
      >
        <CardList>
          {bundles.map(({ shift, devices, openSession }) => {
            const pos = positionMap.get(shift.scenario_position_id);
            const execName = executorNames[shift.executor_id];
            const isBusy = busyId === shift.id;
            return (
              <CardListItem key={shift.id}>
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 h-full w-full min-w-0">
                  {canManage && !isExecutorView && shift.status === "draft" && (
                    <div className="flex items-center gap-2 -mt-1 mb-1">
                      <BatchSelectCheckbox
                        checked={draftBatch.isSelected(shift.id)}
                        onChange={() => draftBatch.toggle(shift.id)}
                      />
                      <span className="text-xs text-gray-500">草稿 · 可多选批量删除</span>
                    </div>
                  )}
                  <div className="flex flex-wrap justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-900">{positionLabel(pos)}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {collectionShiftStatusLabel(shift.status)}
                        {!isExecutorView && execName ? ` · 执行员 ${execName}` : ""}
                        {pos ? ` · ${labelSceneCategories(pos.scene_categories)}` : ""}
                      </p>
                      {pos && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {[pos.address_province, pos.address_city, pos.address_district].join(" ")}
                        </p>
                      )}
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      <p>
                        设备 {devices.length}/{shift.device_count}
                      </p>
                      {shift.scheduled_start && (
                        <p className="mt-1">计划 {new Date(shift.scheduled_start).toLocaleString()}</p>
                      )}
                      {shift.published_at && (
                        <p className="mt-1">发布 {new Date(shift.published_at).toLocaleString()}</p>
                      )}
                    </div>
                  </div>

                  {shift.note && <p className="text-sm text-gray-600 whitespace-pre-wrap">{shift.note}</p>}

                  {devices.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-2">本批设备编号</p>
                      <ul className="flex flex-wrap gap-2">
                        {devices.map((d) => (
                          <li
                            key={d.id}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-mono"
                            title={d.device_label}
                          >
                            {d.public_code}
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-gray-400 mt-2">{devices.map((d) => d.device_label).join(" · ")}</p>
                    </div>
                  )}

                  {shift.status === "draft" && canManage && !isExecutorView && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        disabled={isBusy}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50"
                        onClick={() => {
                          void (async () => {
                            setErr("");
                            setBusyId(shift.id);
                            try {
                              await publishCollectionShift(shift.id);
                              await load();
                            } catch (ex: unknown) {
                              setErr(ex instanceof Error ? ex.message : "发布失败");
                            } finally {
                              setBusyId(null);
                            }
                          })();
                        }}
                      >
                        {isBusy ? "发布中…" : "发布并排设备"}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-sm"
                        onClick={() => {
                          if (!confirm("删除该排班草稿？")) return;
                          void (async () => {
                            setBusyId(shift.id);
                            try {
                              await deleteCollectionShiftDraft(shift.id);
                              await load();
                            } catch (ex: unknown) {
                              setErr(ex instanceof Error ? ex.message : "删除失败");
                            } finally {
                              setBusyId(null);
                            }
                          })();
                        }}
                      >
                        删除草稿
                      </button>
                    </div>
                  )}

                  {shift.status === "published" && canManage && !isExecutorView && (
                    <button
                      type="button"
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm"
                      onClick={() => {
                        if (!confirm("关闭排班？执行员将无法继续打卡，设备将释放。")) return;
                        void (async () => {
                          setBusyId(shift.id);
                          try {
                            await closeCollectionShift(shift.id);
                            await load();
                          } catch (ex: unknown) {
                            setErr(ex instanceof Error ? ex.message : "关闭失败");
                          } finally {
                            setBusyId(null);
                          }
                        })();
                      }}
                    >
                      关闭排班
                    </button>
                  )}

                  {isExecutorView && shift.status === "published" && (
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3 space-y-2">
                      <p className="text-xs text-indigo-900">
                        {openSession
                          ? `已上班 · ${new Date(openSession.clock_in_at).toLocaleString()} 起`
                          : "当前未上班"}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {!openSession ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
                            onClick={() => {
                              void (async () => {
                                setBusyId(shift.id);
                                try {
                                  await clockInCollectionShift(shift.id);
                                  await load();
                                } catch (ex: unknown) {
                                  setErr(ex instanceof Error ? ex.message : "上班打卡失败");
                                } finally {
                                  setBusyId(null);
                                }
                              })();
                            }}
                          >
                            上班打卡
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium disabled:opacity-50"
                            onClick={() => {
                              void (async () => {
                                setBusyId(shift.id);
                                try {
                                  await clockOutCollectionShift(shift.id);
                                  await load();
                                } catch (ex: unknown) {
                                  setErr(ex instanceof Error ? ex.message : "下班打卡失败");
                                } finally {
                                  setBusyId(null);
                                }
                              })();
                            }}
                          >
                            下班打卡
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </CardListItem>
            );
          })}
        </CardList>
      </ListViewSection>
    </div>
  );
}
