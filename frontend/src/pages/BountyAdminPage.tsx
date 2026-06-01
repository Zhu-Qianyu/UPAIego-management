import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchActiveGroupId } from "../api/groups";
import { fetchProfilesByIds } from "../api/profiles";
import {
  adminFailBountyClaim,
  bountyStatusLabel,
  claimStatusLabel,
  closeBounty,
  listBountiesForGroup,
  listClaimsForBounty,
  publishBounty,
  type Bounty,
  type BountyClaim,
} from "../api/bounties";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";

export default function BountyAdminPage() {
  const [groupId, setGroupId] = useState<string | null>(null);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [claimsByBounty, setClaimsByBounty] = useState<Record<string, BountyClaim[]>>({});
  const [executorNames, setExecutorNames] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [totalHours, setTotalHours] = useState("8");
  const [totalReward, setTotalReward] = useState("0");
  const [completionDays, setCompletionDays] = useState<"1" | "2" | "3">("2");
  const [publishBusy, setPublishBusy] = useState(false);

  const loadClaims = useCallback(async (bountyId: string) => {
    const claims = await listClaimsForBounty(bountyId);
    setClaimsByBounty((prev) => ({ ...prev, [bountyId]: claims }));
    const ids = [...new Set(claims.map((c) => c.executor_id))];
    if (ids.length) {
      const profiles = await fetchProfilesByIds(ids);
      setExecutorNames((prev) => {
        const next = { ...prev };
        for (const p of profiles) {
          next[p.id] = p.display_name?.trim() || p.id.slice(0, 8);
        }
        return next;
      });
    }
  }, []);

  const load = useCallback(async () => {
    setErr("");
    try {
      const gid = await fetchActiveGroupId();
      setGroupId(gid);
      if (!gid) {
        setBounties([]);
        return;
      }
      const rows = await listBountiesForGroup(gid);
      setBounties(rows);
    } catch (e: any) {
      setErr(e.message ?? "加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (expandedId) void loadClaims(expandedId);
  }, [expandedId, loadClaims]);

  async function onPublish(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId) {
      setErr("请先加入工作群");
      return;
    }
    const hours = parseInt(totalHours, 10);
    const reward = parseFloat(totalReward);
    if (!Number.isFinite(hours) || hours <= 0) {
      setErr("总工时必须为正整数");
      return;
    }
    if (!Number.isFinite(reward) || reward < 0) {
      setErr("总报酬不能为负数");
      return;
    }
    setPublishBusy(true);
    setErr("");
    try {
      await publishBounty({
        groupId,
        title: title.trim() || "悬赏单",
        totalHours: hours,
        totalReward: reward,
        completionDays: parseInt(completionDays, 10) as 1 | 2 | 3,
        description: description.trim() || undefined,
      });
      setTitle("");
      setDescription("");
      await load();
    } catch (e: any) {
      setErr(e.message ?? "发布失败");
    } finally {
      setPublishBusy(false);
    }
  }

  async function onClose(bountyId: string) {
    if (!window.confirm("关闭后执行员将无法继续领取，已有进行中的接单不受影响。确认关闭？")) return;
    setBusyId(bountyId);
    setErr("");
    try {
      await closeBounty(bountyId);
      await load();
    } catch (e: any) {
      setErr(e.message ?? "关闭失败");
    } finally {
      setBusyId(null);
    }
  }

  async function onFailClaim(claimId: string) {
    const note = window.prompt("判定未完成（可选备注）", "管理员判定未完成");
    if (note === null) return;
    setBusyId(claimId);
    setErr("");
    try {
      await adminFailBountyClaim(claimId, note || undefined);
      if (expandedId) await loadClaims(expandedId);
      await load();
    } catch (e: any) {
      setErr(e.message ?? "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  const openCount = useMemo(() => bounties.filter((b) => b.status === "open").length, [bounties]);

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <RefreshStrip active={refreshing} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">悬赏令管理</h1>
          <p className="text-sm text-gray-500 mt-1">发布工时池，执行员按小时领取；与场景业务完全独立。</p>
        </div>
        <button
          type="button"
          onClick={() => { setRefreshing(true); void load(); }}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          刷新
        </button>
      </div>

      {!groupId && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          未检测到已加入的工作群。请先在「群组」加入或创建工作群后再发布悬赏令。
        </div>
      )}

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
      )}

      <form onSubmit={onPublish} className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4 shadow-sm">
        <h2 className="font-medium text-gray-900">发布悬赏令</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="text-gray-600">标题</span>
            <input
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：本周数据采集"
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">总工时（小时）</span>
            <input
              type="number"
              min={1}
              step={1}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              value={totalHours}
              onChange={(e) => setTotalHours(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">总报酬（元，整单）</span>
            <input
              type="number"
              min={0}
              step={0.01}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              value={totalReward}
              onChange={(e) => setTotalReward(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-gray-600">完成期限（接单后）</span>
            <select
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              value={completionDays}
              onChange={(e) => setCompletionDays(e.target.value as "1" | "2" | "3")}
            >
              <option value="1">1 天内</option>
              <option value="2">2 天内</option>
              <option value="3">3 天内</option>
            </select>
          </label>
        </div>
        <label className="block text-sm">
          <span className="text-gray-600">说明（可选）</span>
          <textarea
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 min-h-[72px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={!groupId || publishBusy}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {publishBusy ? "发布中…" : "发布悬赏令"}
        </button>
      </form>

      <section className="space-y-3">
        <h2 className="font-medium text-gray-900">
          悬赏列表 <span className="text-gray-400 font-normal text-sm">（开放 {openCount}）</span>
        </h2>
        {bounties.length === 0 ? (
          <p className="text-sm text-gray-500 py-8 text-center border border-dashed rounded-xl">暂无悬赏令</p>
        ) : (
          <ul className="space-y-3">
            {bounties.map((b) => {
              const claims = claimsByBounty[b.id] ?? [];
              const expanded = expandedId === b.id;
              const claimedHours = b.total_hours - b.remaining_hours;
              return (
                <li key={b.id} className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                  <div className="p-4 flex flex-wrap gap-3 items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium text-gray-900">{b.title}</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                          {bountyStatusLabel(b.status)}
                        </span>
                      </div>
                      {b.description && <p className="text-sm text-gray-600 mt-1">{b.description}</p>}
                      <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-600">
                        <div>
                          <dt className="text-gray-400">总工时</dt>
                          <dd className="font-medium text-gray-800">{b.total_hours} h</dd>
                        </div>
                        <div>
                          <dt className="text-gray-400">剩余</dt>
                          <dd className="font-medium text-indigo-700">{b.remaining_hours} h</dd>
                        </div>
                        <div>
                          <dt className="text-gray-400">已领</dt>
                          <dd>{claimedHours} h</dd>
                        </div>
                        <div>
                          <dt className="text-gray-400">报酬 / 期限</dt>
                          <dd>
                            ¥{Number(b.total_reward).toFixed(2)} · {b.completion_days} 天
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : b.id)}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
                      >
                        {expanded ? "收起明细" : "领取明细"}
                      </button>
                      {b.status !== "closed" && (
                        <button
                          type="button"
                          disabled={busyId === b.id}
                          onClick={() => void onClose(b.id)}
                          className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          关闭
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div className="border-t border-gray-100 bg-gray-50/80 p-4">
                      {claims.length === 0 ? (
                        <p className="text-sm text-gray-500">尚无领取记录</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="text-left text-gray-500 text-xs">
                                <th className="pb-2 pr-4">执行员</th>
                                <th className="pb-2 pr-4">领取 h</th>
                                <th className="pb-2 pr-4">截止</th>
                                <th className="pb-2 pr-4">状态</th>
                                <th className="pb-2">操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {claims.map((c) => (
                                <tr key={c.id} className="border-t border-gray-200/80">
                                  <td className="py-2 pr-4">{executorNames[c.executor_id] ?? c.executor_id.slice(0, 8)}</td>
                                  <td className="py-2 pr-4">{c.claimed_hours}</td>
                                  <td className="py-2 pr-4">{new Date(c.due_at).toLocaleString()}</td>
                                  <td className="py-2 pr-4">{claimStatusLabel(c.status)}</td>
                                  <td className="py-2">
                                    {c.status === "active" && (
                                      <button
                                        type="button"
                                        disabled={busyId === c.id}
                                        onClick={() => void onFailClaim(c.id)}
                                        className="text-red-600 hover:underline text-xs disabled:opacity-50"
                                      >
                                        判定未完成
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
