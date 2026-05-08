import { useEffect, useState } from "react";
import {
  createWorkGroup,
  fetchOwnedWorkGroup,
  listPendingMembers,
  setMembershipStatus,
  type GroupMember,
  type WorkGroup,
} from "../api/groups";
import Spinner from "../components/Spinner";

export default function AdminGroupPage() {
  const [owned, setOwned] = useState<WorkGroup | null | undefined>(undefined);
  const [pending, setPending] = useState<GroupMember[]>([]);
  const [name, setName] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setErr("");
    try {
      const g = await fetchOwnedWorkGroup();
      setOwned(g);
      if (g) {
        const p = await listPendingMembers(g.id);
        setPending(p);
      } else {
        setPending([]);
      }
    } catch (e: any) {
      setErr(e.message ?? "加载失败");
      setOwned(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await createWorkGroup(name, customCode || undefined);
      setName("");
      setCustomCode("");
      await refresh();
    } catch (e: any) {
      setErr(e.message ?? "创建失败：每位管理员仅可创建一个群组。");
    }
  }

  async function approve(m: GroupMember, ok: boolean) {
    setBusyId(m.id);
    setErr("");
    try {
      await setMembershipStatus(m.id, ok ? "active" : "rejected");
      await refresh();
    } catch (e: any) {
      setErr(e.message ?? "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  if (loading || owned === undefined) return <Spinner />;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">群组与入群审批</h1>
        <p className="text-sm text-gray-500 mt-1">
          群主管理员拥有唯一工作群；向成员分发<strong>入群代码</strong>，对方在「申请入群」页提交后在此审批。
        </p>
      </div>

      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{err}</div>}

      {!owned ? (
        <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-indigo-100 p-6 space-y-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-800">创建你的群组</h2>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="群组显示名称"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            value={customCode}
            onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
            placeholder="自定义入群代码（可空，将自动生成 8 位）"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
          />
          <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">
            创建群组
          </button>
        </form>
      ) : (
        <div className="bg-white rounded-2xl border border-indigo-100 p-6 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-gray-800">{owned.display_name}</h2>
          <p className="text-xs text-gray-500">入群代码（可复制给用户）：</p>
          <p className="text-2xl font-mono font-bold tracking-widest text-indigo-800 bg-indigo-50 rounded-lg px-4 py-3 inline-block">
            {owned.invite_code}
          </p>
        </div>
      )}

      {owned && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-800">待审批入群</h2>
            <button type="button" onClick={() => void refresh()} className="text-xs text-indigo-600 hover:underline">
              刷新
            </button>
          </div>
          {pending.length === 0 ? (
            <p className="text-sm text-gray-400">暂无待处理申请</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {pending.map((m) => (
                <li key={m.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-mono text-gray-800">{m.request_email || m.user_id}</p>
                    <p className="text-xs text-gray-400">{new Date(m.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      onClick={() => void approve(m, true)}
                      className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-medium disabled:opacity-50"
                    >
                      同意
                    </button>
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      onClick={() => void approve(m, false)}
                      className="px-3 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 disabled:opacity-50"
                    >
                      拒绝
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
