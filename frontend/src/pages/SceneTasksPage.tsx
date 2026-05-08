import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listSceneTasks,
  createSceneTask,
  updateSceneTask,
  listRequirementsForTask,
  createRequirement,
  updateRequirement,
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
  type PartyDemand,
  type ScenarioPosition,
} from "../api/operations";
import Spinner from "../components/Spinner";

type Tab = "tasks" | "demands" | "stations";

function PartyDemandsTab({
  groupId,
  setErr,
}: {
  groupId: string;
  setErr: (s: string) => void;
}) {
  const [rows, setRows] = useState<PartyDemand[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [summary, setSummary] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await listPartyDemands(groupId);
      setRows(d);
    } catch (e: any) {
      setErr(e.message ?? "加载业务失败");
    } finally {
      setLoading(false);
    }
  }, [groupId, setErr]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await createPartyDemand({
        group_id: groupId,
        title,
        client_company: company,
        requirement_summary: summary,
      });
      setTitle("");
      setCompany("");
      setSummary("");
      await load();
    } catch (e: any) {
      setErr(e.message ?? "添加失败");
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        <strong>甲方业务</strong>：客户公司的数采需求与说明，便于对照现场落地。
      </p>
      <form onSubmit={onAdd} className="bg-white rounded-xl border border-indigo-100 p-4 space-y-2">
        <input
          required
          placeholder="业务 / 需求标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          placeholder="甲方公司名（可选）"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <textarea
          placeholder="数采需求摘要"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">
          添加业务
        </button>
      </form>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="bg-white rounded-xl border border-gray-200 p-4 flex justify-between gap-3">
            <div>
              <p className="font-medium text-gray-900">{r.title}</p>
              {r.client_company && <p className="text-xs text-gray-500 mt-1">甲方：{r.client_company}</p>}
              {r.requirement_summary && (
                <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{r.requirement_summary}</p>
              )}
            </div>
            <button
              type="button"
              onClick={async () => {
                if (!confirm("删除该条业务？")) return;
                await deletePartyDemand(r.id);
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
  demands,
  setErr,
}: {
  groupId: string;
  demands: PartyDemand[];
  setErr: (s: string) => void;
}) {
  const [rows, setRows] = useState<ScenarioPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [proc, setProc] = useState("");
  const [demandId, setDemandId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await listScenarioPositions(groupId);
      setRows(s);
    } catch (e: any) {
      setErr(e.message ?? "加载场景岗位失败");
    } finally {
      setLoading(false);
    }
  }, [groupId, setErr]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setErr("请选择现场快照图片");
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
        party_demand_id: demandId || undefined,
        snapshot_path: path,
      });
      setTitle("");
      setProc("");
      setDemandId("");
      setFile(null);
      await load();
    } catch (e: any) {
      setErr(e.message ?? "添加失败");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        <strong>场景岗位</strong>：乙方实际工位/工序快照（图片将保存到 Supabase Storage）。
      </p>
      <form onSubmit={onAdd} className="bg-white rounded-xl border border-indigo-100 p-4 space-y-2">
        <input
          required
          placeholder="岗位 / 工序名称"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <textarea
          placeholder="工序与现场说明"
          value={proc}
          onChange={(e) => setProc(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          value={demandId}
          onChange={(e) => setDemandId(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">关联甲方业务（可选）</option>
          {demands.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
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
                if (!confirm("删除该场景岗位？")) return;
                await deleteScenarioPosition(r.id);
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

function SceneTasksInner() {
  const [tasks, setTasks] = useState<SceneTask[]>([]);
  const [selected, setSelected] = useState<SceneTask | null>(null);
  const [reqs, setReqs] = useState<CollectionRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [tTitle, setTTitle] = useState("");
  const [tDesc, setTDesc] = useState("");
  const [rTitle, setRTitle] = useState("");
  const [rDesc, setRDesc] = useState("");
  const [rPri, setRPri] = useState("0");

  async function loadTasks() {
    const t = await listSceneTasks();
    setTasks(t);
    if (selected) {
      const still = t.find((x) => x.id === selected.id);
      setSelected(still ?? null);
    }
  }

  async function loadReqs(taskId: string) {
    const r = await listRequirementsForTask(taskId);
    setReqs(r);
  }

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      try {
        await loadTasks();
      } catch (e: any) {
        if (!cancel) setErr(e.message ?? "加载失败");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) {
      setReqs([]);
      return;
    }
    void loadReqs(selected.id);
  }, [selected?.id]);

  async function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await createSceneTask({ title: tTitle.trim(), description: tDesc.trim() || undefined });
      setTTitle("");
      setTDesc("");
      await loadTasks();
    } catch (e: any) {
      setErr(e.message ?? "创建失败");
    }
  }

  async function handleCreateReq(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setErr("");
    try {
      await createRequirement({
        scene_task_id: selected.id,
        title: rTitle.trim(),
        description: rDesc.trim() || undefined,
        priority: Number(rPri) || 0,
      });
      setRTitle("");
      setRDesc("");
      setRPri("0");
      await loadReqs(selected.id);
    } catch (e: any) {
      setErr(e.message ?? "添加需求失败");
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1 space-y-4">
        <h2 className="text-lg font-bold text-gray-900">场景任务</h2>
        <p className="text-sm text-gray-500">发布任务与采集需求；执行员仅见「已发布」。</p>
        {err && <p className="text-sm text-red-600">{err}</p>}
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
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setSelected(t)}
                className={`w-full text-left rounded-xl border px-4 py-3 text-sm transition-colors ${
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
            </li>
          ))}
        </ul>
      </div>
      <div className="lg:col-span-2">
        {!selected ? (
          <p className="text-gray-400 text-sm">请选择一个任务查看采集需求。</p>
        ) : (
          <div className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{selected.title}</h2>
                {selected.description && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{selected.description}</p>}
              </div>
              <select
                value={selected.status}
                onChange={async (e) => {
                  await updateSceneTask(selected.id, { status: e.target.value as SceneTask["status"] });
                  await loadTasks();
                  setSelected((prev) => (prev ? { ...prev, status: e.target.value as SceneTask["status"] } : null));
                }}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="draft">草稿</option>
                <option value="published">已发布</option>
                <option value="closed">已关闭</option>
              </select>
            </div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">采集需求</h3>
            <form onSubmit={handleCreateReq} className="space-y-2 mb-6">
              <div className="flex flex-wrap gap-2 items-end">
                <input
                  required
                  placeholder="需求标题"
                  value={rTitle}
                  onChange={(e) => setRTitle(e.target.value)}
                  className="flex-1 min-w-[140px] rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  placeholder="优先级"
                  value={rPri}
                  onChange={(e) => setRPri(e.target.value)}
                  className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">
                  添加需求
                </button>
              </div>
              <textarea
                placeholder="需求说明（可选）"
                value={rDesc}
                onChange={(e) => setRDesc(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </form>
            <ul className="divide-y divide-gray-100">
              {reqs.map((r) => (
                <li key={r.id} className="py-3 flex flex-wrap gap-3 items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{r.title}</p>
                    {r.description && <p className="text-xs text-gray-500 mt-1">{r.description}</p>}
                  </div>
                  <select
                    value={r.status}
                    onChange={async (e) => {
                      await updateRequirement(r.id, { status: e.target.value });
                      await loadReqs(selected.id);
                    }}
                    className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                  >
                    <option value="open">进行中</option>
                    <option value="done">已完成</option>
                    <option value="blocked">阻塞</option>
                  </select>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SceneTasksPage() {
  const [tab, setTab] = useState<Tab>("tasks");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [demands, setDemands] = useState<PartyDemand[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const gid = await fetchActiveGroupId();
        if (cancel) return;
        setGroupId(gid);
        if (gid) {
          const d = await listPartyDemands(gid);
          if (!cancel) setDemands(d);
        }
      } catch {
        if (!cancel) setGroupId(null);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (tab !== "stations" || !groupId) return;
    void listPartyDemands(groupId).then(setDemands).catch(() => {});
  }, [tab, groupId]);

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
        <p className="text-gray-600 mb-4">请先加入已审批的工作群组后，方可维护场景任务与甲方业务。</p>
        <Link to="/join" className="text-indigo-600 font-medium underline">
          申请入群
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">业务与场景</h1>
        <p className="text-sm text-gray-500 mt-1">场景流转任务、甲方数采需求、乙方工位快照。</p>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
        {tabBtn("tasks", "场景任务")}
        {tabBtn("demands", "甲方业务")}
        {tabBtn("stations", "场景岗位 / 快照")}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {tab === "tasks" && <SceneTasksInner />}
      {tab === "demands" && <PartyDemandsTab groupId={groupId} setErr={setErr} />}
      {tab === "stations" && (
        <ScenarioWorkstationsTab groupId={groupId} demands={demands} setErr={setErr} />
      )}
    </div>
  );
}
