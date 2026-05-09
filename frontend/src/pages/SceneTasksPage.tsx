import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  listSceneTasks,
  createSceneTask,
  updateSceneTask,
  deleteSceneTask,
  getSceneTask,
  listRequirementsForTask,
  type SceneTask,
  type CollectionRequirement,
} from "../api/scenes";
import { fetchActiveGroupId } from "../api/groups";
import {
  createPartyDemand,
  createScenarioPosition,
  deletePartyDemand,
  deleteScenarioPosition,
  getSnapshotPublicUrl,
  listPartyDemands,
  listScenarioPositions,
  uploadWorkstationSnapshot,
  uploadPartyDeviceSnapshot,
  syncSceneTaskAssignments,
  listAssignmentsForSceneTask,
  updateAssignmentExecutedHours,
  type PartyDemand,
  type ScenarioPosition,
  type SceneTaskAssignment,
} from "../api/operations";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import { readRouteViewCache, routeViewCacheKey, routeViewCacheKeyExtra, writeRouteViewCache } from "../utils/routeViewCache";
import { useAuth } from "../auth/AuthContext";
import {
  SCENE_CATEGORY_KEYS,
  SCENE_CATEGORY_LABELS,
  labelSceneCategories,
  type SceneCategoryKey,
} from "../utils/sceneCategories";

type Tab = "tasks" | "demands" | "stations";

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
  const [summary, setSummary] = useState("");
  const [deviceFile, setDeviceFile] = useState<File | null>(null);
  const [totalUnlimited, setTotalUnlimited] = useState(true);
  const [totalHours, setTotalHours] = useState("");
  const [maxPerScene, setMaxPerScene] = useState("8");
  const [catTags, setCatTags] = useState<SceneCategoryKey[]>(["industrial"]);
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

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
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
        device_snapshot_bucket: bucket,
        device_snapshot_path: path,
        total_hours_required: total,
        max_hours_per_scene: maxH,
        scene_categories: [...catTags],
        requirement_summary: summary.trim() || undefined,
      });
      await syncSceneTaskAssignments(groupId);
      setClientCompany("");
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
    <div className="space-y-6">
      <RefreshStrip active={refreshing} />
      <p className="text-sm text-gray-500">
        <strong>甲方业务</strong>：填写甲方公司、设备快照、小时量与场景大类；发布后由系统按大类匹配到场景岗位并生成子任务。
      </p>
      <form onSubmit={onAdd} className="bg-white rounded-xl border border-indigo-100 p-4 space-y-3">
        <input
          required
          placeholder="甲方公司（必填）"
          value={clientCompany}
          onChange={(e) => setClientCompany(e.target.value)}
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
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="bg-white rounded-xl border border-gray-200 p-4 flex justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-gray-900">{r.client_company || r.title}</p>
              <p className="text-xs text-gray-500 mt-1">
                大类：{labelSceneCategories(r.scene_categories)} · 每场景上限 {r.max_hours_per_scene}h
                {r.total_hours_required != null ? ` · 需求总计 ${r.total_hours_required}h` : " · 需求总计：无限"}
              </p>
              {r.requirement_summary && (
                <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{r.requirement_summary}</p>
              )}
            </div>
            <button
              type="button"
              onClick={async () => {
                if (!confirm("删除该条甲方业务？关联的自动子任务会同步更新。")) return;
                await deletePartyDemand(r.id);
                await syncSceneTaskAssignments(groupId);
                await load();
              }}
              className="text-xs text-red-600 shrink-0 h-fit"
            >
              删除
            </button>
          </li>
        ))}
      </ul>
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
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row gap-4">
      {src && (
        <img src={src} alt="" className="w-full sm:w-40 h-32 object-cover rounded-lg border border-gray-100" />
      )}
      <div className="flex-1 min-w-0">
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
    <div className="space-y-6">
      <RefreshStrip active={refreshing} />
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
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.id} className="relative">
            <ScenarioRow row={r} />
            <button
              type="button"
              onClick={async () => {
                if (!confirm("删除该场景岗位？关联的自动子任务会同步更新。")) return;
                await deleteScenarioPosition(r.id);
                await syncSceneTaskAssignments(groupId);
                await load();
              }}
              className="absolute top-2 right-2 text-xs text-red-600 bg-white/90 px-2 py-1 rounded"
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function progressPct(executed: number, cap: number): number {
  if (cap <= 0) return 0;
  return Math.min(100, Math.max(0, (executed / cap) * 100));
}

function AssignmentsBlock({
  taskId,
  positions,
  demands,
  isExecutor,
  setErr,
}: {
  taskId: string;
  positions: Map<string, ScenarioPosition>;
  demands: Map<string, PartyDemand>;
  isExecutor: boolean;
  setErr: (s: string) => void;
}) {
  const [rows, setRows] = useState<SceneTaskAssignment[]>([]);
  const [localHours, setLocalHours] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const a = await listAssignmentsForSceneTask(taskId);
      setRows(a);
      const next: Record<string, string> = {};
      for (const x of a) next[x.id] = String(x.executed_hours);
      setLocalHours(next);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "加载子任务失败");
    } finally {
      setLoading(false);
    }
  }, [taskId, setErr]);

  useEffect(() => {
    void load();
  }, [load]);

  const byPosition = useMemo(() => {
    const m = new Map<string, SceneTaskAssignment[]>();
    for (const r of rows) {
      const list = m.get(r.scenario_position_id) ?? [];
      list.push(r);
      m.set(r.scenario_position_id, list);
    }
    return m;
  }, [rows]);

  if (loading) return <p className="text-sm text-gray-500">加载自动分配子任务…</p>;
  if (rows.length === 0) {
    return (
      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-3">
        暂无子任务。请将本任务设为「已发布」，并确保甲方业务与场景岗位的大类存在交集；系统会自动生成。
      </p>
    );
  }

  return (
    <div className="space-y-6 mt-4">
      <h3 className="text-sm font-semibold text-gray-800">系统自动分配的执行进度</h3>
      {[...byPosition.entries()].map(([posId, assigns]) => {
        const pos = positions.get(posId);
        return (
          <div key={posId} className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 space-y-3">
            <div>
              <p className="font-medium text-gray-900">{pos?.title ?? "场景岗位"}</p>
              {pos && (
                <p className="text-xs text-gray-500 mt-1">
                  {labelSceneCategories(pos.scene_categories)} ·{" "}
                  {[pos.address_province, pos.address_city, pos.address_district].join(" ")}
                </p>
              )}
            </div>
            <div className="space-y-4 pl-2 border-l-2 border-indigo-200">
              {assigns.map((a) => {
                const d = demands.get(a.party_demand_id);
                const pct = progressPct(Number(a.executed_hours), Number(a.max_hours_cap));
                return (
                  <div key={a.id} className="space-y-2">
                    <p className="text-sm text-gray-800">
                      甲方：<span className="font-medium">{d?.client_company ?? d?.title ?? "—"}</span>
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
                          className="w-24 rounded border border-gray-300 px-2 py-1 text-sm"
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
                              await load();
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

type SceneTasksInnerCacheV1 = { v: 1; tasks: SceneTask[]; selectedId: string | null };

function SceneTasksInner({
  groupId,
  isExecutorView,
}: {
  groupId: string;
  isExecutorView: boolean;
}) {
  const { profile, session } = useAuth();
  const innerCacheKey = useMemo(
    () => routeViewCacheKeyExtra(session?.user?.id, "scene-tasks-inner", "v1"),
    [session?.user?.id]
  );

  const isAdmin = profile?.role === "admin";

  const [tasks, setTasks] = useState<SceneTask[]>([]);
  const [selected, setSelected] = useState<SceneTask | null>(null);
  const [reqs, setReqs] = useState<CollectionRequirement[]>([]);
  const [positions, setPositions] = useState<Map<string, ScenarioPosition>>(new Map());
  const [demands, setDemands] = useState<Map<string, PartyDemand>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");

  const [tTitle, setTTitle] = useState("");
  const [tDesc, setTDesc] = useState("");
  const [dueLocal, setDueLocal] = useState("");
  const fetchedOnceRef = useRef(false);

  useLayoutEffect(() => {
    if (!innerCacheKey) return;
    const snap = readRouteViewCache<SceneTasksInnerCacheV1>(innerCacheKey);
    if (!snap || snap.v !== 1) return;
    setTasks(snap.tasks);
    fetchedOnceRef.current = true;
    if (snap.selectedId) {
      const sel = snap.tasks.find((x) => x.id === snap.selectedId);
      setSelected(sel ?? null);
    } else {
      setSelected(null);
    }
    setLoading(false);
  }, [innerCacheKey]);

  const loadTasks = useCallback(async () => {
    if (fetchedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    try {
      const t = await listSceneTasks({ groupId, isAdmin });
      const visible = isExecutorView ? t.filter((x) => x.status === "published") : t;
      setTasks(visible);
      setSelected((prev) => {
        if (!prev) return null;
        const still = visible.find((x) => x.id === prev.id);
        return still ?? null;
      });
      fetchedOnceRef.current = true;
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId, isAdmin, isExecutorView]);

  useEffect(() => {
    if (!innerCacheKey) return;
    void loadTasks();
  }, [innerCacheKey, loadTasks]);

  useEffect(() => {
    if (!innerCacheKey || loading) return;
    writeRouteViewCache(innerCacheKey, { v: 1, tasks, selectedId: selected?.id ?? null });
  }, [innerCacheKey, tasks, selected, loading]);

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

  async function loadReqs(taskId: string) {
    const r = await listRequirementsForTask(taskId);
    setReqs(r);
  }

  useEffect(() => {
    if (!selected) {
      setReqs([]);
      setDueLocal("");
      return;
    }
    setDueLocal(toDatetimeLocalValue(selected.due_at));
    void loadReqs(selected.id);
  }, [selected?.id, selected?.due_at]);

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await createSceneTask({
        title: tTitle.trim(),
        description: tDesc.trim() || undefined,
        group_id: groupId,
      });
      setTTitle("");
      setTDesc("");
      await loadTasks();
      await syncSceneTaskAssignments(groupId);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "创建失败");
    }
  }

  async function saveDueAt() {
    if (!selected) return;
    setErr("");
    const nextIso = fromDatetimeLocalValue(dueLocal);
    const cur = await getSceneTask(selected.id);
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
      await updateSceneTask(selected.id, { due_at: nextIso });
      await loadTasks();
      setSelected((prev) => (prev && prev.id === cur.id ? { ...prev, due_at: nextIso } : prev));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "保存失败");
    }
  }

  function canDeleteDraft(t: SceneTask): boolean {
    if (t.status !== "draft") return false;
    return profile?.role === "admin" || t.created_by === session?.user?.id;
  }

  if (loading && tasks.length === 0) return <Spinner />;

  return (
    <>
      <RefreshStrip active={refreshing} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-4">
          <h2 className="text-lg font-bold text-gray-900">场景任务</h2>
          <p className="text-sm text-gray-500">
            {isExecutorView
              ? "查看已发布任务及采集进度；已执行小时由你填报。"
              : "创建任务并发布；子任务由系统按甲方业务与场景岗位的大类匹配自动生成。"}
          </p>
          {err && <p className="text-sm text-red-600">{err}</p>}
          {!isExecutorView && (
            <form onSubmit={handleCreateTask} className="bg-white rounded-xl border border-indigo-100 p-4 space-y-2">
              <input
                required
                placeholder="任务标题"
                value={tTitle}
                onChange={(e) => setTTitle(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <textarea
                placeholder="描述（可选）"
                value={tDesc}
                onChange={(e) => setTDesc(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button type="submit" className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">
                创建草稿
              </button>
            </form>
          )}
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li key={t.id} className="flex gap-2 items-stretch">
                <button
                  type="button"
                  onClick={() => setSelected(t)}
                  className={`flex-1 min-w-0 text-left rounded-xl border px-4 py-3 text-sm transition-colors ${
                    selected?.id === t.id ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <span className="font-medium text-gray-900">{t.title}</span>
                  <span className="block text-xs text-gray-500 mt-1">
                    {t.status === "draft" && "草稿"}
                    {t.status === "published" && "已发布"}
                    {t.status === "closed" && "已关闭"}
                  </span>
                </button>
                {!isExecutorView && canDeleteDraft(t) && (
                  <button
                    type="button"
                    title="删除草稿"
                    onClick={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!confirm("删除该草稿？其下采集需求会一并删除。")) return;
                      setErr("");
                      try {
                        await deleteSceneTask(t.id);
                        await loadTasks();
                        setSelected((prev) => (prev?.id === t.id ? null : prev));
                      } catch (ex: unknown) {
                        const msg = ex instanceof Error ? ex.message : "删除失败";
                        setErr(msg);
                      }
                    }}
                    className="shrink-0 self-center px-2.5 py-2 rounded-xl border border-red-200 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100"
                  >
                    删除
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="lg:col-span-2">
          {!selected ? (
            <p className="text-gray-400 text-sm">请选择一个任务查看详情。</p>
          ) : (
            <div className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-6">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{selected.title}</h2>
                  {selected.description && (
                    <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{selected.description}</p>
                  )}
                  {selected.due_at && (
                    <p className="text-sm text-amber-800 mt-2">
                      截止时间：<span className="font-medium">{new Date(selected.due_at).toLocaleString()}</span>
                    </p>
                  )}
                </div>
                {!isExecutorView && (
                  <div className="flex flex-wrap items-center gap-2">
                    {canDeleteDraft(selected) && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm("删除该草稿？其下采集需求会一并删除。")) return;
                          setErr("");
                          try {
                            await deleteSceneTask(selected.id);
                            await loadTasks();
                            setSelected(null);
                          } catch (ex: unknown) {
                            const msg = ex instanceof Error ? ex.message : "删除失败";
                            setErr(msg);
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg border border-red-200 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100"
                      >
                        删除草稿
                      </button>
                    )}
                    <select
                      value={selected.status}
                      onChange={async (e) => {
                        const st = e.target.value as SceneTask["status"];
                        await updateSceneTask(selected.id, { status: st });
                        if (st === "published") await syncSceneTaskAssignments(groupId);
                        await loadTasks();
                        setSelected((prev) => (prev ? { ...prev, status: st } : null));
                      }}
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
                <div className="mb-6 rounded-xl border border-gray-200 bg-slate-50 p-4 space-y-2">
                  <p className="text-xs font-medium text-gray-700">业务员设置截止时间（可选）</p>
                  <p className="text-xs text-gray-500">仅可延后，不可早于当前已保存的截止时间；不设置则界面不显示截止信息。</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <input
                      type="datetime-local"
                      value={dueLocal}
                      onChange={(e) => setDueLocal(e.target.value)}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => void saveDueAt()}
                      className="px-3 py-1.5 rounded-lg bg-gray-800 text-white text-sm"
                    >
                      保存截止时间
                    </button>
                  </div>
                </div>
              )}

              {selected.status === "published" && (
                <AssignmentsBlock
                  taskId={selected.id}
                  positions={positions}
                  demands={demands}
                  isExecutor={isExecutorView}
                  setErr={setErr}
                />
              )}

              {!isExecutorView && reqs.length > 0 && (
                <div className="mt-8 border-t border-gray-100 pt-4">
                  <h3 className="text-sm font-semibold text-gray-500 mb-2">历史采集需求（旧数据）</h3>
                  <ul className="divide-y divide-gray-100">
                    {reqs.map((r) => (
                      <li key={r.id} className="py-2 text-sm text-gray-700">
                        {r.title}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
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
    <div className="space-y-6">
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
