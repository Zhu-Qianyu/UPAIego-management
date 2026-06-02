import { useCallback, useEffect, useState } from "react";
import {
  fetchMyWalletSummary,
  formatCny,
  listMySettlementLines,
  listMyWalletLedger,
  walletLedgerReasonLabel,
  type SettlementLine,
  type WalletLedgerEntry,
  type WalletSummary,
} from "../api/settlement";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import {
  Alert,
  EmptyState,
  IconSparkles,
  PageHero,
  PageShell,
  Panel,
  SegmentedTabs,
  StatGrid,
  UiButton,
} from "../components/ui/PageLayout";

type Tab = "ledger" | "settlements";

export default function ExecutorWalletPage() {
  const [tab, setTab] = useState<Tab>("ledger");
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [lines, setLines] = useState<SettlementLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    try {
      const [s, lg, sl] = await Promise.all([
        fetchMyWalletSummary(),
        listMyWalletLedger(),
        listMySettlementLines(),
      ]);
      setSummary(s);
      setLedger(lg);
      setLines(sl);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "加载失败";
      setErr(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="py-24 flex justify-center">
        <Spinner />
      </div>
    );
  }

  const stats = summary
    ? [
        { label: "可提现", value: formatCny(summary.available_balance), hint: "已结算入账", tone: "ok" as const },
        { label: "待结算", value: formatCny(summary.pending_balance), hint: "进行中悬赏预估", tone: "warn" as const },
        { label: "累计已结算", value: formatCny(summary.total_settled), hint: "历史入账" },
        { label: "累计提现", value: formatCny(summary.total_withdrawn), hint: "暂未开放" },
      ]
    : [];

  return (
    <PageShell>
      <RefreshStrip active={refreshing} />
      <PageHero
        eyebrow="执行员"
        title="我的钱包"
        description="按悬赏单价（元/小时）结算；设备运维员收回设备并确认小时数后入账。"
        accent="emerald"
        icon={<IconSparkles />}
        onRefresh={() => {
          setRefreshing(true);
          void load();
        }}
        refreshing={refreshing}
      />

      {err && <Alert variant="error">{err}</Alert>}

      <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 p-6 text-white shadow-lg shadow-emerald-900/20">
        <p className="text-sm font-medium text-emerald-100">可提现余额</p>
        <p className="mt-1 text-4xl font-bold tracking-tight">
          {formatCny(summary?.available_balance ?? 0)}
        </p>
        <p className="mt-2 text-xs text-emerald-100/90">
          待结算预估 {formatCny(summary?.pending_balance ?? 0)} · 累计已结算{" "}
          {formatCny(summary?.total_settled ?? 0)}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <UiButton
            type="button"
            className="!bg-white !text-emerald-800 hover:!bg-emerald-50"
            onClick={() => setWithdrawOpen(true)}
          >
            提现
          </UiButton>
        </div>
      </div>

      {withdrawOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">提现</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              提现功能暂未上线，敬请期待。当前余额可在「结算明细」中查看入账记录。
            </p>
            <UiButton type="button" className="w-full" onClick={() => setWithdrawOpen(false)}>
              知道了
            </UiButton>
          </div>
        </div>
      )}

      {summary && <StatGrid items={stats} />}

      <Alert variant="info">
        结算流程：运维员收回设备、核对数采登记小时 → 审核通过并入账。金额 = 确认小时 × 悬赏单价。
      </Alert>

      <SegmentedTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "ledger", label: "余额流水", badge: ledger.length },
          { id: "settlements", label: "结算明细", badge: lines.length },
        ]}
      />

      {tab === "ledger" && (
        <Panel title="余额流水">
          {ledger.length === 0 ? (
            <EmptyState title="暂无流水" description="完成悬赏并由运维员入账后，将显示在此" icon={<IconSparkles />} />
          ) : (
            <ul className="space-y-2">
              {ledger.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50/90 ring-1 ring-slate-200/80 px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium text-slate-900">{walletLedgerReasonLabel(row.reason)}</p>
                    {row.note && <p className="text-xs text-slate-500 mt-0.5">{row.note}</p>}
                    <p className="text-xs text-slate-400 mt-0.5">
                      {new Date(row.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold ${row.delta >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {row.delta >= 0 ? "+" : ""}
                      {formatCny(row.delta)}
                    </p>
                    <p className="text-xs text-slate-500">余额 {formatCny(row.balance_after)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === "settlements" && (
        <Panel title="结算明细">
          {lines.length === 0 ? (
            <EmptyState title="暂无结算单" description="运维员审核并入账后会生成明细" icon={<IconSparkles />} />
          ) : (
            <ul className="space-y-2">
              {lines.map((line) => (
                <li
                  key={line.id}
                  className="rounded-xl bg-slate-50/90 ring-1 ring-slate-200/80 px-4 py-3 text-sm space-y-1"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-semibold text-slate-900">+{formatCny(line.amount)}</span>
                    <span className="text-xs text-slate-500">{new Date(line.settled_at).toLocaleString()}</span>
                  </div>
                  <p className="text-slate-600">
                    确认 {line.confirmed_hours} h × {formatCny(line.hourly_rate_snapshot)}/h
                    {line.registered_hours_sum > 0 && (
                      <span className="text-slate-400"> · 登记合计 {line.registered_hours_sum} h</span>
                    )}
                  </p>
                  {line.operator_note && <p className="text-xs text-slate-500">{line.operator_note}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </PageShell>
  );
}
