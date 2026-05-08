import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listKpis,
  upsertKpi,
  deleteKpi,
  createAdminMessage,
  listAdminMessages,
  type KpiRow,
  type AdminMessageRow,
} from "../api/adminContent";
import Spinner from "../components/Spinner";

export default function AdminConsole() {
  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [messages, setMessages] = useState<AdminMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [kTitle, setKTitle] = useState("");
  const [kTarget, setKTarget] = useState("");
  const [kUnit, setKUnit] = useState("");
  const [kNotes, setKNotes] = useState("");

  const [mTitle, setMTitle] = useState("");
  const [mBody, setMBody] = useState("");

  async function refresh() {
    setLoading(true);
    setErr("");
    try {
      const [k, msg] = await Promise.all([listKpis(), listAdminMessages(30)]);
      setKpis(k);
      setMessages(msg);
    } catch (e: any) {
      setErr(e.message ?? "加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleAddKpi(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await upsertKpi({
        title: kTitle.trim(),
        target_value: kTarget === "" ? null : Number(kTarget),
        unit: kUnit.trim() || null,
        notes: kNotes.trim() || null,
      });
      setKTitle("");
      setKTarget("");
      setKUnit("");
      setKNotes("");
      await refresh();
    } catch (e: any) {
      setErr(e.message ?? "保存 KPI 失败");
    }
  }

  async function handlePostMessage(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await createAdminMessage(mTitle.trim(), mBody.trim());
      setMTitle("");
      setMBody("");
      await refresh();
    } catch (e: any) {
      setErr(e.message ?? "发布留言失败");
    }
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">管理员工作台</h1>
        <div className="flex gap-2 text-sm">
          <Link to="/fleet" className="text-indigo-600 hover:underline">
            全量设备
          </Link>
          <span className="text-gray-300">|</span>
          <Link to="/register" className="text-indigo-600 hover:underline">
            注册设备
          </Link>
          <span className="text-gray-300">|</span>
          <Link to="/search" className="text-indigo-600 hover:underline">
            搜索
          </Link>
          <span className="text-gray-300">|</span>
          <Link to="/map" className="text-indigo-600 hover:underline">
            数采地图
          </Link>
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <section className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">KPI 设置</h2>
          <p className="text-xs text-gray-500 mb-4">为团队设定可量化目标（示例：周采集量、设备在线率等）。</p>

          <form onSubmit={handleAddKpi} className="space-y-3 mb-6">
            <input
              required
              placeholder="指标名称"
              value={kTitle}
              onChange={(e) => setKTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <input
                placeholder="目标值（数字）"
                value={kTarget}
                onChange={(e) => setKTarget(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="单位"
                value={kUnit}
                onChange={(e) => setKUnit(e.target.value)}
                className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <textarea
              placeholder="备注说明"
              value={kNotes}
              onChange={(e) => setKNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
            >
              添加 / 更新 KPI
            </button>
          </form>

          <ul className="divide-y divide-gray-100 text-sm">
            {kpis.length === 0 && <li className="py-4 text-gray-400">暂无 KPI</li>}
            {kpis.map((k) => (
              <li key={k.id} className="py-3 flex justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900">{k.title}</p>
                  <p className="text-gray-500 text-xs mt-1">
                    目标：{k.target_value ?? "—"} {k.unit ?? ""}
                    {k.notes ? ` · ${k.notes}` : ""}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    更新于 {new Date(k.updated_at).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm("删除该 KPI？")) return;
                    await deleteKpi(k.id);
                    await refresh();
                  }}
                  className="text-red-600 text-xs shrink-0 h-fit"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">全员留言</h2>
          <p className="text-xs text-gray-500 mb-4">发布后所有角色登录即可在顶部公告区看到。</p>

          <form onSubmit={handlePostMessage} className="space-y-3 mb-8">
            <input
              required
              placeholder="标题"
              value={mTitle}
              onChange={(e) => setMTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <textarea
              required
              placeholder="正文"
              value={mBody}
              onChange={(e) => setMBody(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700"
            >
              发布公告
            </button>
          </form>

          <h3 className="text-sm font-semibold text-gray-700 mb-2">近期公告</h3>
          <ul className="space-y-3 text-sm max-h-80 overflow-y-auto">
            {messages.map((m) => (
              <li key={m.id} className="rounded-lg border border-gray-100 p-3 bg-gray-50/80">
                <p className="font-medium text-gray-900">{m.title}</p>
                <p className="text-gray-600 mt-1 whitespace-pre-wrap">{m.body}</p>
                <p className="text-xs text-gray-400 mt-2">{new Date(m.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
