import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { fetchAdminDashboardStats, type AdminDashboardStats } from "../api/adminDashboard";
import { fetchOwnedWorkGroup, type WorkGroup } from "../api/groups";
import { formatCny } from "../api/settlement";
import Spinner from "../components/Spinner";
import { PageHero, PageShell } from "../components/ui/PageLayout";
import RefreshStrip from "../components/RefreshStrip";
import { useAuth } from "../auth/AuthContext";
import { readRouteViewCache, routeViewCacheKey, writeRouteViewCache } from "../utils/routeViewCache";

type AdminDashboardCacheV1 = { v: 1; owned: WorkGroup | null; stats: AdminDashboardStats | null };

function formatHours(h: number): string {
  if (!Number.isFinite(h)) return "0";
  return h % 1 === 0 ? String(h) : h.toFixed(2);
}

function formatEstimate(amount: number | null): string {
  if (amount == null) return "—";
  return formatCny(amount);
}

function profitClass(amount: number | null): string {
  if (amount == null) return "text-emerald-700";
  if (amount < 0) return "text-rose-700";
  return "text-emerald-700";
}

function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "cost" | "income";
}) {
  const ring =
    tone === "cost"
      ? "ring-rose-100 bg-rose-50/80"
      : tone === "income"
        ? "ring-emerald-100 bg-emerald-50/80"
        : "ring-indigo-100 bg-white";
  const valueClass =
    tone === "cost" ? "text-rose-700" : tone === "income" ? "text-emerald-700" : "text-indigo-950";
  return (
    <div className={`rounded-2xl ring-1 ${ring} p-5 shadow-sm min-w-0`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${valueClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500 leading-relaxed">{hint}</p>}
    </div>
  );
}

function FinancePeriodRow({
  label,
  cost,
  profit,
}: {
  label: string;
  cost: number;
  profit: number | null;
}) {
  return (
    <tr className="border-t border-slate-100">
      <td className="py-3 pr-4 text-sm font-medium text-slate-700">{label}</td>
      <td className="py-3 px-4 text-sm text-right tabular-nums text-rose-700">{formatCny(cost)}</td>
      <td className={`py-3 pl-4 text-sm text-right tabular-nums ${profitClass(profit)}`}>
        {formatEstimate(profit)}
      </td>
    </tr>
  );
}

export default function AdminConsole() {
  const { session } = useAuth();
  const location = useLocation();
  const cacheKey = useMemo(
    () => routeViewCacheKey(session?.user?.id, location.pathname),
    [session?.user?.id, location.pathname]
  );

  const [owned, setOwned] = useState<WorkGroup | null | undefined>(undefined);
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");

  useLayoutEffect(() => {
    if (!cacheKey) return;
    const snap = readRouteViewCache<AdminDashboardCacheV1>(cacheKey);
    if (!snap || snap.v !== 1) return;
    setOwned(snap.owned);
    setStats(snap.stats);
    setLoading(false);
  }, [cacheKey]);

  const refresh = useCallback(async () => {
    const stale = cacheKey ? readRouteViewCache<AdminDashboardCacheV1>(cacheKey) : null;
    if (stale) setRefreshing(true);
    else setLoading(true);
    setErr("");
    try {
      const g = await fetchOwnedWorkGroup();
      setOwned(g);
      if (!g) {
        setStats(null);
        if (cacheKey) writeRouteViewCache(cacheKey, { v: 1, owned: null, stats: null });
        return;
      }
      const next = await fetchAdminDashboardStats(g.id);
      setStats(next);
      if (cacheKey) writeRouteViewCache(cacheKey, { v: 1, owned: g, stats: next });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading && !stats) return <Spinner />;

  const finance = stats?.finance;

  return (
    <PageShell>
      <RefreshStrip active={refreshing} />
      <PageHero
        eyebrow="管理员"
        title="数据看板"
        description="汇总本工作群的甲方业务、设备规模、采量与收支（按北京时间周 / 月 / 年统计）。"
        accent="indigo"
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        footer={
          owned ? (
            <p className="text-sm text-white/85">
              工作群：<span className="font-semibold">{owned.display_name}</span>
              <span className="mx-2 opacity-60">·</span>
              群组号 <code className="rounded bg-white/15 px-1.5 py-0.5 text-xs">{owned.invite_code}</code>
            </p>
          ) : undefined
        }
      />

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
      )}

      {!owned && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          尚未创建工作群。请先在{" "}
          <Link to="/group/manage" className="font-semibold underline underline-offset-2">
            群组管理
          </Link>{" "}
          中创建，再查看业务数据。
        </div>
      )}

      {owned && stats && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard label="甲方业务" value={String(stats.party_demand_count)} hint="本群已维护的甲方需求" />
            <StatCard
              label="设备总数"
              value={String(stats.device_count)}
              hint="联网设备 + 离线登记设备（本群可见范围）"
            />
            <StatCard
              label="本年执行员成本"
              value={formatCny(finance?.cost_year ?? 0)}
              hint="已结算发放给数采执行员的金额"
              tone="cost"
            />
            <StatCard
              label="本年净利润估算"
              value={formatEstimate(finance?.profit_year ?? null)}
              hint={
                finance?.income_configured
                  ? "甲方价格 × 已采工时 − 执行员结算成本"
                  : "请在场景业务 → 甲方业务中填写甲方价格"
              }
              tone="income"
            />
          </div>

          <section className="rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-900">收支概览</h2>
              <p className="text-xs text-slate-500 mt-1">
                成本为执行员结算支出；净利润估算 = 甲方价格 × 数采登记工时 − 成本（场景累计工时计入收入侧，暂不按周月拆分）。
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left">
                <thead>
                  <tr className="bg-slate-50/80 text-xs uppercase tracking-wider text-slate-500">
                    <th className="py-3 pr-4 pl-5 font-semibold">周期</th>
                    <th className="py-3 px-4 font-semibold text-right">成本（执行员）</th>
                    <th className="py-3 pl-4 pr-5 font-semibold text-right">净利润估算</th>
                  </tr>
                </thead>
                <tbody className="px-5">
                  <FinancePeriodRow label="本周" cost={finance?.cost_week ?? 0} profit={finance?.profit_week ?? null} />
                  <FinancePeriodRow label="本月" cost={finance?.cost_month ?? 0} profit={finance?.profit_month ?? null} />
                  <FinancePeriodRow label="本年" cost={finance?.cost_year ?? 0} profit={finance?.profit_year ?? null} />
                  <FinancePeriodRow label="累计" cost={finance?.cost_total ?? 0} profit={finance?.profit_total ?? null} />
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">各甲方业务采量</h2>
                <p className="text-xs text-slate-500 mt-1">
                  工时来自设备数采登记；「场景累计」为场景任务填报工时（无分周月明细）。
                </p>
              </div>
              <Link
                to="/scene"
                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
              >
                管理甲方业务 →
              </Link>
            </div>
            {stats.party_demands.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400">暂无甲方业务，请先在场景业务中添加。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[48rem] text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 text-xs uppercase tracking-wider text-slate-500">
                      <th className="py-3 pr-3 pl-5 font-semibold">甲方业务</th>
                      <th className="py-3 px-2 font-semibold text-right">设备</th>
                      <th className="py-3 px-2 font-semibold text-right">本周 h</th>
                      <th className="py-3 px-2 font-semibold text-right">本月 h</th>
                      <th className="py-3 px-2 font-semibold text-right">本年 h</th>
                      <th className="py-3 px-2 font-semibold text-right">场景累计 h</th>
                      <th className="py-3 px-2 font-semibold text-right">累计 h</th>
                      <th className="py-3 px-2 font-semibold text-right">甲方价格</th>
                      <th className="py-3 pl-2 pr-5 font-semibold text-right">累计净利润估算</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.party_demands.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                        <td className="py-3 pr-3 pl-5 font-medium text-slate-900 min-w-[10rem]">{row.label}</td>
                        <td className="py-3 px-2 text-right tabular-nums text-slate-600">{row.device_count}</td>
                        <td className="py-3 px-2 text-right tabular-nums">{formatHours(row.hours_week)}</td>
                        <td className="py-3 px-2 text-right tabular-nums">{formatHours(row.hours_month)}</td>
                        <td className="py-3 px-2 text-right tabular-nums">{formatHours(row.hours_year)}</td>
                        <td className="py-3 px-2 text-right tabular-nums text-slate-500">
                          {row.scene_hours_total > 0 ? formatHours(row.scene_hours_total) : "—"}
                        </td>
                        <td className="py-3 px-2 text-right tabular-nums font-medium">{formatHours(row.hours_total)}</td>
                        <td className="py-3 px-2 text-right tabular-nums text-slate-600">
                          {row.client_hourly_rate != null && row.client_hourly_rate > 0
                            ? `${formatCny(row.client_hourly_rate)}/h`
                            : "—"}
                        </td>
                        <td className={`py-3 pl-2 pr-5 text-right tabular-nums ${profitClass(row.profit_total)}`}>
                          {formatEstimate(row.profit_total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </PageShell>
  );
}
