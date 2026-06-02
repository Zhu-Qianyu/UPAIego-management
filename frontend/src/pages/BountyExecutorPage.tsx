import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchActiveGroupId } from "../api/groups";
import {
  formatManualTrackedDeviceLabel,
  listManualTrackedDevices,
} from "../api/operations";
import { listDevices } from "../api/client";
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
  listMyActiveCheckouts,
  listOpenBountiesForGroup,
  type Bounty,
  type BountyClaim,
  type DeviceExecutorAssignment,
  type ExecutorProfileView,
} from "../api/bounties";
import { isOfflineDeviceAssignmentId, toOfflineDeviceAssignmentId } from "../utils/deviceAssignmentId";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import {
  Alert,
  CardList,
  CardListItem,
  EmptyState,
  IconClipboard,
  IconSparkles,
  PageHero,
  PageShell,
  SegmentedTabs,
  StatGrid,
  UiButton,
  uiInput,
  uiLabel,
} from "../components/ui/PageLayout";

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
  const [checkoutsByClaim, setCheckoutsByClaim] = useState<Record<string, DeviceExecutorAssignment>>({});
  const [deviceLabels, setDeviceLabels] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setErr("");
    try {
      const gid = await fetchActiveGroupId();
      setGroupId(gid);
      const [open, mine, prof, daily, checkouts] = await Promise.all([
        gid ? listOpenBountiesForGroup(gid) : Promise.resolve([]),
        listMyClaims(),
        fetchMyExecutorProfile(),
        fetchMyDailyClaimUsage().catch(() => null),
        listMyActiveCheckouts(),
      ]);
      setOpenBounties(open);
      setMyClaims(mine);
      const checkoutMap: Record<string, DeviceExecutorAssignment> = {};
      for (const a of checkouts) {
        if (a.bounty_claim_id) checkoutMap[a.bounty_claim_id] = a;
      }
      setCheckoutsByClaim(checkoutMap);
      if (gid) {
        try {
          const [offline, online] = await Promise.all([
            listManualTrackedDevices(gid),
            listDevices({ scope: "own", limit: 500, offset: 0 }).then((r) => r.devices),
          ]);
          const labels: Record<string, string> = {};
          for (const d of online) labels[d.device_id] = d.readable_name || d.device_id;
          for (const m of offline) {
            labels[toOfflineDeviceAssignmentId(m.public_code)] = `${formatManualTrackedDeviceLabel(m)} · ${m.public_code}`;
          }
          setDeviceLabels(labels);
        } catch {
          setDeviceLabels({});
        }
      } else {
        setDeviceLabels({});
      }
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
    <PageShell>
      <RefreshStrip active={refreshing} />
      <PageHero
        eyebrow="数采执行"
        title="悬赏令"
        description="按小时领取工时池；向运维借设备，归还与结算分开（结算可多次）。"
        accent="indigo"
        icon={<IconSparkles />}
        onRefresh={() => { setRefreshing(true); void load(); }}
        refreshing={refreshing}
        footer={
          <StatGrid
            items={[
              { label: "进行中", value: `${activeCount}/${tierLimit}`, hint: "并发（台）" },
              { label: "今日已领", value: `${claimedToday}/${dailyLimit}`, hint: "小时", tone: remainingToday <= 0 ? "warn" : "ok" },
              { label: "可接单", value: openBounties.length, hint: "开放悬赏" },
              { label: "段位", value: profile?.tier.name ?? "—", hint: `${profile?.stats.points_balance ?? 0} 积分` },
            ]}
          />
        }
      />

      <Alert variant="info">
        <Link to="/wallet" className="font-semibold text-indigo-800 underline underline-offset-2 hover:text-indigo-950">
          我的钱包
        </Link>
        ：查看可提现余额与结算明细（运维按次结算，与归还设备分开）。
      </Alert>

      {!groupId && <Alert variant="warn">请先加入工作群后再接单。</Alert>}
      {err && <Alert variant="error">{err}</Alert>}
      {!canClaimConcurrent && tab === "open" && (
        <Alert variant="warn">已达并发上限（{tierLimit} 台）。请先处理进行中的接单。</Alert>
      )}
      {canClaimConcurrent && remainingToday <= 0 && tab === "open" && (
        <Alert variant="warn">今日领取已达上限（{dailyLimit} h）。明日 0 点（北京时间）后可继续。</Alert>
      )}

      <SegmentedTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "open", label: "可接单", icon: <IconSparkles />, badge: openBounties.length },
          { id: "mine", label: "我的接单", icon: <IconClipboard />, badge: activeClaims.length },
          { id: "tier", label: "我的段位" },
        ]}
      />

      {tab === "open" && (
        <section className="space-y-3">
          {openBounties.length === 0 ? (
            <EmptyState title="暂无可接悬赏单" description="等待管理员发布新的工时池" icon={<IconSparkles />} />
          ) : (
            <CardList>
              {openBounties.map((b) => {
                const penalty = estimatePenaltyPoints(1, b.points_per_hour);
                const claimH = parseInt(claimHours[b.id] ?? "1", 10);
                const estPay =
                  Number.isFinite(claimH) && claimH > 0
                    ? (claimH * Number(b.hourly_rate)).toFixed(2)
                    : null;
                return (
                  <CardListItem key={b.id}>
                  <div className="glass-panel rounded-2xl p-5 space-y-4 h-full">
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
                    <p className="text-xs text-amber-900 bg-amber-50/90 rounded-xl px-3 py-2 ring-1 ring-amber-100">
                      未完成将按未完成小时 × {b.points_per_hour} 积分扣分（例：1h ≈ {penalty} 分）；超时未执行部分退回悬赏池。
                    </p>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="block">
                        <span className={uiLabel}>本次领取（小时）</span>
                        <input
                          type="number"
                          min={1}
                          max={Math.min(b.remaining_hours, remainingToday)}
                          step={1}
                          className={`${uiInput} !w-28`}
                          value={claimHours[b.id] ?? "1"}
                          onChange={(e) => setClaimHours((prev) => ({ ...prev, [b.id]: e.target.value }))}
                        />
                        {estPay !== null && (
                          <span className="block mt-1 text-xs text-gray-500">
                            约 ¥{estPay}（{claimH}h × ¥{Number(b.hourly_rate).toFixed(2)}/h）
                          </span>
                        )}
                      </label>
                      <UiButton disabled={!groupId || !canClaimMore || busyId === b.id} onClick={() => void onClaim(b)}>
                        {busyId === b.id ? "提交中…" : "接单"}
                      </UiButton>
                    </div>
                  </div>
                  </CardListItem>
                );
              })}
            </CardList>
          )}
        </section>
      )}

      {tab === "mine" && (
        <section className="space-y-3">
          {myClaims.length === 0 ? (
            <EmptyState title="尚无接单记录" description="在「可接单」页领取悬赏工时" icon={<IconClipboard />} />
          ) : (
            <CardList>
              {myClaims.map((c) => {
                const title = c.bounties?.title ?? "悬赏单";
                const rate = c.bounties?.points_per_hour ?? 1;
                const uncompleted = Math.max(c.claimed_hours - Number(c.executed_hours), 0);
                const executed = Number(c.executed_hours);
                const progressPct =
                  c.claimed_hours > 0
                    ? Math.min(100, Math.round((Math.min(executed, c.claimed_hours) / c.claimed_hours) * 100))
                    : 0;
                const progressLabel =
                  c.status === "completed"
                    ? `已结算 ${executed} / ${c.claimed_hours} 小时`
                    : c.status === "active"
                      ? `已结算 ${executed} / ${c.claimed_hours} 小时`
                      : executed > 0
                        ? `已结算 ${executed} / ${c.claimed_hours} 小时`
                        : `领取 ${c.claimed_hours} 小时 · ${claimStatusLabel(c.status)}`;
                const checkout = checkoutsByClaim[c.id];
                return (
                  <CardListItem key={c.id}>
                  <div className="glass-panel rounded-2xl p-5 h-full">
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
                    <div className="mt-4 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-slate-700">完成进度</span>
                        <span className="text-slate-500">{progressLabel}</span>
                      </div>
                      <div className="h-2.5 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            c.status === "completed" ? "bg-emerald-500" : "bg-indigo-500"
                          }`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                    {c.status === "active" && (() => {
                      const opId = c.bounties?.assigned_operator_id;
                      const op = opId ? operatorsById[opId] : undefined;
                      return (
                        <div className="mt-3 space-y-2">
                          {checkout && (
                            <p className="text-sm text-violet-900 bg-violet-50 rounded-lg px-3 py-2 mt-2">
                              当前借出：
                              {deviceLabels[checkout.device_id] ?? checkout.device_id}
                              {isOfflineDeviceAssignmentId(checkout.device_id) ? "（离线）" : "（联网）"}
                            </p>
                          )}
                          {c.device_returned_at && !checkout && (
                            <p className="text-sm text-emerald-900 bg-emerald-50 rounded-lg px-3 py-2 mt-2">
                              设备已归还（{new Date(c.device_returned_at).toLocaleString()}）
                            </p>
                          )}
                          {op && (
                            <p className="text-sm text-indigo-900 bg-indigo-50 rounded-lg px-3 py-2">
                              运维联系人：{profileDisplayName(op)}
                              {op.phone ? ` · ${op.phone}` : "（未登记手机）"}
                            </p>
                          )}
                          <p className="text-xs text-gray-600">
                            向运维借设备作业；结算可多次，归还设备每单仅一次，请勿自行标记完成。
                          </p>
                          <UiButton variant="secondary" className="!text-red-600" disabled={busyId === c.id} onClick={() => void onAbandon(c)}>
                            放弃（约扣 {estimatePenaltyPoints(uncompleted, rate)} 分）
                          </UiButton>
                        </div>
                      );
                    })()}
                    {c.close_reason && (
                      <p className="mt-2 text-xs text-gray-500">备注：{c.close_reason}</p>
                    )}
                  </div>
                  </CardListItem>
                );
              })}
            </CardList>
          )}
        </section>
      )}

      {tab === "tier" && profile && (
        <section className="space-y-4">
          <div className="rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 p-6 sm:p-8 text-white shadow-xl shadow-indigo-200/50">
            <p className="text-sm text-white/75">当前段位</p>
            <p className="text-3xl font-bold mt-1">{profile.tier.name}</p>
            <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <dt className="text-white/70">积分</dt>
                <dd className="text-xl font-bold">{profile.stats.points_balance}</dd>
              </div>
              <div>
                <dt className="text-white/70">进行中</dt>
                <dd className="text-xl font-bold">
                  {profile.stats.active_claim_count} / {profile.tier.max_concurrent_claims} 台
                </dd>
              </div>
              <div>
                <dt className="text-white/70">今日已领</dt>
                <dd className="text-xl font-bold">
                  {claimedToday} / {dailyLimit} h
                </dd>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-white/70">距下一档</dt>
                <dd className="font-medium text-white/95">
                  {profile.nextTier
                    ? `「${profile.nextTier.name}」还需 ${profile.pointsToNext} 积分（≥${profile.nextTier.min_points}）`
                    : "已达最高档"}
                </dd>
              </div>
            </dl>
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">段位说明</h3>
            <div className="overflow-x-auto glass-panel rounded-2xl">
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
              <CardList>
                {profile.ledger.map((row) => (
                  <CardListItem key={row.id}>
                  <div className="glass-panel rounded-2xl px-4 py-3 text-sm h-full flex flex-col justify-between gap-2">
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
                  </div>
                  </CardListItem>
                ))}
              </CardList>
            )}
          </div>
        </section>
      )}
    </PageShell>
  );
}
