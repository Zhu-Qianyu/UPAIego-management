import { useEffect, useState } from "react";
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
import Spinner from "../components/Spinner";

export default function SceneTasksPage() {
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
        <h1 className="text-2xl font-bold text-gray-900">场景任务</h1>
        <p className="text-sm text-gray-500">发布任务并管理采集需求；执行员仅能看到「已发布」任务。</p>

        {err && <p className="text-sm text-red-600">{err}</p>}

        <form onSubmit={handleCreateTask} className="bg-white rounded-xl border border-indigo-100 p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-800">新建任务</h2>
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
              <div className="flex gap-2">
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
              {reqs.length === 0 && <li className="py-4 text-gray-400 text-sm">暂无采集需求</li>}
              {reqs.map((r) => (
                <li key={r.id} className="py-3 flex flex-wrap gap-3 items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{r.title}</p>
                    {r.description && <p className="text-xs text-gray-500 mt-1">{r.description}</p>}
                    <p className="text-xs text-gray-400 mt-1">优先级 {r.priority} · {r.status}</p>
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
