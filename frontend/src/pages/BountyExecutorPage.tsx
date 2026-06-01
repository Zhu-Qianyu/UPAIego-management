import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchActiveGroupId } from "../api/groups";
import { fetchProfilesByIds, profileDisplayName, type ProfileContact } from "../api/profiles";
import {
  abandonBountyClaim,
  claimBounty,
  claimStatusLabel,
  dailyClaimLimitForSlots,
  estimatePenaltyPoints,
  fetchMyDailyClaimUsage,
  fetchMyExecutorProfile,
  sumClaimedHoursToday,
  formatDueCountdown,
  type DailyClaimUsage,
  ledgerReasonLabel,
  listMyClaims,
  listOpenBountiesForGroup,
  type Bounty,
  type BountyClaim,
  type ExecutorProfileView,
} from "../api/bounties";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";

type Tab = "open" | "mine" | "tier";

export default function BountyExecutorPage() {
  const [tab, setTab] = useState<Tab>("open");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [openBounties, setOpenBounties] = useState<Bounty[]>([]);
  const [myClaims, setMyClaims] = useState<BountyClaim[]>([]);
  const [profile, setProfile] = useState<ExecutorProfileView | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyClaimUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [claimHours, setClaimHours] = useState<Record<string, string>>({});
  const [operatorsById, setOperatorsById] = useState<Record<string, ProfileContact>>({});

  const load = useCallback(async () => {
    setErr("");
    try {
      const gid = await fetchActiveGroupId();
      setGroupId(gid);
      const [open, mine, prof, daily] = await Promise.all([
        gid ? listOpenBountiesForGroup(gid) : Promise.resolve([]),
        listMyClaims(),
        fetchMyExecutorProfile(),
        fetchMyDailyClaimUsage().catch(() => null),
      ]);
      setOpenBounties(open);
      setMyClaims(mine);
      const opIds = [
        ...new Set(
          mine.map((c) => c.bounties?.assigned_operator_id).filter((id): id is string => Boolean(id))
        ),
      ];
      if (opIds.length) {
        const ops = await fetchProfilesByIds(opIds);
        const map: Record<string, ProfileContact> = {};
        for (const p of ops) map[p.id] = p;
        setOperatorsById(map);
      } else {
        setOperatorsById({});
      }
      setProfile(prof);
      if (daily) {
        setDailyUsage(daily);
      } else if (prof) {
        const slots = prof.tier.max_concurrent_claims;
        const claimed = sumClaimedHoursToday(mine);
        const limit = dailyClaimLimitForSlots(slots);
        setDailyUsage({
          claimed_today: claimed,
          daily_limit: limit,
          remaining_today: Math.max(0, limit - claimed),
          slots,
          hours_per_slot: 8,
          claim_date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }),
          timezone: "Asia/Shanghai",
        });
      } else {
        setDailyUsage(null);
      }
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

  const activeClaims = useMemo(() => myClaims.filter((c) => c.status === "active"), [myClaims]);
  const tierLimit = profile?.tier.max_concurrent_claims ?? 1;
  const activeCount = profile?.stats.active_claim_count ?? activeClaims.length;
  const claimedToday = dailyUsage?.claimed_today ?? 0;
  const dailyLimit = dailyUsage?.daily_limit ?? tierLimit * 8;
  const remainingToday = dailyUsage?.remaining_today ?? Math.max(0, dailyLimit - claimedToday);
  const canClaimConcurrent = activeCount < tierLimit;
  const canClaimMore = canClaimConcurrent && remainingToday > 0;

  async function onClaim(b: Bounty) {
    const raw = claimHours[b.id] ?? "1";
    const hours = parseInt(raw, 10);
    if (!Number.isFinite(hours) || hours <= 0) {
      setErr("领取小时数须为正整数");
      return;
    }
    if (hours > b.remaining_hours) {
      setErr(`剩余工时仅 ${b.remaining_hours} 小时`);
      return;
    }
    if (hours > remainingToday) {
      setErr(`今日领取上限剩余 ${remainingToday} 小时（已领 ${claimedToday}/${dailyLimit} h，${tierLimit} 台×8h/台）`);
      return;
    }
    setBusyId(b.id);
    setErr("");
    try {
      await claimBounty(b.id, hours);
      await load();
      setTab("mine");
    } catch (e: any) {
      setErr(e.message ?? "接单失败");
    } finally {
      setBusyId(null);
    }
  }

  async function onAbandon(c: BountyClaim) {
    const pts = estimatePenaltyPoints(
      c.claimed_hours - c.executed_hours,
      c.bounties?.points_per_hour ?? 1
    );
    if (
      !window.confirm(
        `放弃将按未完成小时扣 ${pts} 积分，可能导致掉段；未执行部分退回悬赏池。确认放弃？`
      )
    ) {
      return;
    }
    setBusyId(c.id);
    setErr("");
    try {
      await abandonBountyClaim(c.id);
      await load();
    } catch (e: any) {
      setErr(e.message ?? "放弃失败");
    } finally {
      setBusyId(null);
    }
  }

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
          <h1 className="text-xl font-semibold text-gray-900">悬赏令</h1>
          <p className="text-sm text-gray-500 mt-1">
            按小时领取工时池 · 完成得积分升段 · 进行中 {activeCount}/{tierLimit} 台 · 今日已领{" "}
            {claimedToday}/{dailyLimit} h（每台每天 8h）
          </p>
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
          请先加入工作群后再接单。
        </div>
      )}

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
      )}

      {!canClaimConcurrent && tab === "open" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          已达当前段位并发上限（{tierLimit} 台）。请完成或处理进行中的接单后再领新单；已有单可继续做完。
        </div>
      )}
      {canClaimConcurrent && remainingToday <= 0 && tab === "open" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          今日领取已达上限（{dailyLimit} h = {tierLimit} 台 × 8h/台）。明日 0 点（北京时间）后可继续领取。
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-200 pb-px">
        {(
          [
            ["open", "可接单"],
            ["mine", "我的接单"],
            ["tier", "我的段位"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px ${
              tab === id
                ? "border-indigo-600 text-indigo-700 bg-white"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "open" && (
        <section className="space-y-3">
          {openBounties.length === 0 ? (
            <p className="text-sm text-gray-500 py-10 text-center border border-dashed rounded-xl">
              暂无可接悬赏单
            </p>
          ) : (
            <ul className="space-y-3">
              {openBounties.map((b) => {
                const penalty = estimatePenaltyPoints(1, b.points_per_hour);
                const claimH = parseInt(claimHours[b.id] ?? "1", 10);
                const estPay =
                  Number.isFinite(claimH) && claimH > 0
                    ? (claimH * Number(b.hourly_rate)).toFixed(2)
                    : null;
                return (
                  <li key={b.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <h3 className="font-medium text-gray-900">{b.title}</h3>
                        {b.description && <p className="text-sm text-gray-600 mt-1">{b.description}</p>}
                      </div>
                      <div className="text-sm text-gray-600 text-right">
                        <div>
                          剩余 <strong className="text-indigo-700">{b.remaining_hours}</strong> / {b.total_hours} h
                        </div>
                        <div>
                          期限：接单后 {b.completion_days} 天 · ¥{Number(b.hourly_rate).toFixed(2)}/小时
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                      未完成将按未完成小时 × {b.points_per_hour} 积分扣分（例：1h ≈ {penalty} 分），可能导致掉段；超时未执行部分退回悬赏池。
                    </p>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="text-sm">
                        <span className="text-gray-600">本次领取（小时）</span>
                        <input
                          type="number"
                          min={1}
                          max={Math.min(b.remaining_hours, remainingToday)}
                          step={1}
                          className="mt-1 block w-28 rounded-lg border border-gray-300 px-3 py-2"
                          value={claimHours[b.id] ?? "1"}
                          onChange={(e) => setClaimHours((prev) => ({ ...prev, [b.id]: e.target.value }))}
                        />
                        {estPay !== null && (
                          <span className="block mt-1 text-xs text-gray-500">
                            约 ¥{estPay}（{claimH}h × ¥{Number(b.hourly_rate).toFixed(2)}/h）
                          </span>
                        )}
                      </label>
                      <button
                        type="button"
                        disabled={!groupId || !canClaimMore || busyId === b.id}
                        onClick={() => void onClaim(b)}
                        className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {busyId === b.id ? "提交中…" : "接单"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "mine" && (
        <section className="space-y-3">
          {myClaims.length === 0 ? (
            <p className="text-sm text-gray-500 py-10 text-center border border-dashed rounded-xl">尚无接单记录</p>
          ) : (
            <ul className="space-y-3">
              {myClaims.map((c) => {
                const title = c.bounties?.title ?? "悬赏单";
                const rate = c.bounties?.points_per_hour ?? 1;
                const uncompleted = Math.max(c.claimed_hours - c.executed_hours, 0);
                return (
                  <li key={c.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <h3 className="font-medium text-gray-900">{title}</h3>
                        <p className="text-sm text-gray-600 mt-1">
                          领取 {c.claimed_hours} h · {claimStatusLabel(c.status)}
                        </p>
                      </div>
                      <div className="text-sm text-right text-gray-600">
                        {c.status === "active" && (
                          <div className="text-indigo-700 font-medium">{formatDueCountdown(c.due_at)}</div>
                        )}
                        <div className="text-xs">{new Date(c.due_at).toLocaleString()} 截止</div>
                      </div>
                    </div>
                    {c.status === "active" && (() => {
                      const opId = c.bounties?.assigned_operator_id;
                      const op = opId ? operatorsById[opId] : undefined;
                      return (
                        <div className="mt-3 space-y-2">
                          {op && (
                            <p className="text-sm text-indigo-900 bg-indigo-50 rounded-lg px-3 py-2">
                              运维联系人：{profileDisplayName(op)}
                              {op.phone ? ` · ${op.phone}` : "（未登记手机）"}
                            </p>
                          )}
                          <p className="text-xs text-gray-600">
                            完成后由设备运维员审核计分，请勿自行标记完成；超时未审核部分仍可能按规则扣分。
                          </p>
                          <button
                            type="button"
                            disabled={busyId === c.id}
                            onClick={() => void onAbandon(c)}
                            className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            放弃（约扣 {estimatePenaltyPoints(uncompleted, rate)} 分）
                          </button>
                        </div>
                      );
                    })()}
                    {c.close_reason && (
                      <p className="mt-2 text-xs text-gray-500">备注：{c.close_reason}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "tier" && profile && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm">
            <p className="text-sm text-indigo-600">当前段位</p>
            <p className="text-2xl font-semibold text-gray-900 mt-1">{profile.tier.name}</p>
            <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <dt className="text-gray-500">积分</dt>
                <dd className="text-lg font-semibold text-gray-900">{profile.stats.points_balance}</dd>
              </div>
              <div>
                <dt className="text-gray-500">进行中</dt>
                <dd className="text-lg font-semibold text-gray-900">
                  {profile.stats.active_claim_count} / {profile.tier.max_concurrent_claims} 台
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">今日已领</dt>
                <dd className="text-lg font-semibold text-gray-900">
                  {claimedToday} / {dailyLimit} h
                </dd>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-gray-500">距下一档</dt>
                <dd className="font-medium text-gray-800">
                  {profile.nextTier
                    ? `「${profile.nextTier.name}」还需 ${profile.pointsToNext} 积分（≥${profile.nextTier.min_points}）`
                    : "已达最高档"}
                </dd>
              </div>
            </dl>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">段位说明</h3>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">段位</th>
                    <th className="text-left px-3 py-2">所需积分</th>
                    <th className="text-left px-3 py-2">并发上限</th>
                    <th className="text-left px-3 py-2">今日可领上限</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.tiers.map((t) => (
                    <tr
                      key={t.tier_id}
                      className={`border-t border-gray-100 ${t.tier_id === profile.tier.tier_id ? "bg-indigo-50/60" : ""}`}
                    >
                      <td className="px-3 py-2 font-medium">{t.name}</td>
                      <td className="px-3 py-2">≥ {t.min_points}</td>
                      <td className="px-3 py-2">{t.max_concurrent_claims} 台</td>
                      <td className="px-3 py-2">{t.max_concurrent_claims * 8} h/日</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">近期积分流水</h3>
            {profile.ledger.length === 0 ? (
              <p className="text-sm text-gray-500 py-6 text-center border border-dashed rounded-xl">暂无流水</p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
                {profile.ledger.map((row) => (
                  <li key={row.id} className="px-4 py-3 flex flex-wrap justify-between gap-2 text-sm">
                    <div>
                      <span className={row.delta >= 0 ? "text-emerald-700" : "text-red-700"}>
                        {row.delta >= 0 ? "+" : ""}
                        {row.delta}
                      </span>
                      <span className="text-gray-500 ml-2">{ledgerReasonLabel(row.reason)}</span>
                      {row.note && <span className="text-gray-400 ml-2 text-xs">{row.note}</span>}
                    </div>
                    <div className="text-gray-500 text-xs">
                      余额 {row.balance_after} · {new Date(row.created_at).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
