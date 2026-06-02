import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchActiveGroupId } from "../api/groups";
import {
  formatManualTrackedDeviceLabel,
  listManualTrackedDevices,
  type ManualTrackedDevice,
} from "../api/operations";
import { listDevices, type Device } from "../api/client";
import { fetchProfilesByIds, profileDisplayName } from "../api/profiles";
import {
  checkoutDeviceForClaim,
  claimStatusLabel,
  formatDueCountdown,
  getActiveCheckoutForClaim,
  listActiveClaimsForGroup,
  listAssignableDevicesForClaim,
  listClaimHourLogs,
  operatorRejectBountyClaim,
  returnDeviceForClaim,
  settleClaimSession,
  type AssignableDevice,
  type BountyClaim,
  type ClaimCheckout,
  type DeviceDataHourLog,
} from "../api/bounties";
import { estimateSettlementAmount, formatCny } from "../api/settlement";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import {
  isOfflineDeviceAssignmentId,
  toOfflineDeviceAssignmentId,
} from "../utils/deviceAssignmentId";
import {
  Alert,
  CardList,
  CardListItem,
  EmptyState,
  IconClipboard,
  IconDevices,
  IconWrench,
  PageHero,
  PageShell,
  Panel,
  StatGrid,
  UiButton,
  uiInput,
  uiLabel,
  uiSelect,
} from "../components/ui/PageLayout";

type ClaimWorkbench = {
  claim: BountyClaim;
  checkout: ClaimCheckout | null;
  assignable: AssignableDevice[];
  logs: DeviceDataHourLog[];
};

export default function BountyOperatorWorkPage() {
  const [groupId, setGroupId] = useState<string | null>(null);
  const [offlineDevices, setOfflineDevices] = useState<ManualTrackedDevice[]>([]);
  const [onlineDevices, setOnlineDevices] = useState<Device[]>([]);
  const [workbenches, setWorkbenches] = useState<ClaimWorkbench[]>([]);
  const [executorNames, setExecutorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [checkoutDeviceByClaim, setCheckoutDeviceByClaim] = useState<Record<string, string>>({});
  const [sessionHoursByClaim, setSessionHoursByClaim] = useState<Record<string, string>>({});
  const [sessionNoteByClaim, setSessionNoteByClaim] = useState<Record<string, string>>({});

  const deviceLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of onlineDevices) {
      map[d.device_id] = d.readable_name || d.device_id;
    }
    for (const m of offlineDevices) {
      map[toOfflineDeviceAssignmentId(m.public_code)] = `${formatManualTrackedDeviceLabel(m)} · ${m.public_code}`;
    }
    return map;
  }, [onlineDevices, offlineDevices]);

  const load = useCallback(async () => {
    setErr("");
    try {
      const gid = await fetchActiveGroupId();
      setGroupId(gid);
      if (!gid) {
        setWorkbenches([]);
        return;
      }
      const [claims, devRes] = await Promise.all([
        listActiveClaimsForGroup(gid),
        listDevices({ scope: "own", limit: 500, offset: 0 }),
      ]);
      setOnlineDevices(devRes.devices);
      try {
        setOfflineDevices(await listManualTrackedDevices(gid));
      } catch {
        setOfflineDevices([]);
      }

      const execIds = [...new Set(claims.map((c) => c.executor_id))];
      if (execIds.length) {
        const profiles = await fetchProfilesByIds(execIds);
        const map: Record<string, string> = {};
        for (const p of profiles) map[p.id] = profileDisplayName(p);
        setExecutorNames(map);
      } else {
        setExecutorNames({});
      }

      const rows: ClaimWorkbench[] = await Promise.all(
        claims.map(async (claim) => {
          const [checkout, assignable, logs] = await Promise.all([
            getActiveCheckoutForClaim(claim.id).catch(() => null),
            listAssignableDevicesForClaim(claim.id).catch(() => [] as AssignableDevice[]),
            listClaimHourLogs(claim.id).catch(() => [] as DeviceDataHourLog[]),
          ]);
          return { claim, checkout, assignable, logs };
        })
      );
      setWorkbenches(rows);

      setCheckoutDeviceByClaim((prev) => {
        const next = { ...prev };
        for (const w of rows) {
          if (!next[w.claim.id] && w.assignable[0]) {
            next[w.claim.id] = w.assignable[0].device_id;
          }
        }
        return next;
      });
      setSessionHoursByClaim((prev) => {
        const next = { ...prev };
        for (const w of rows) {
          if (next[w.claim.id] === undefined) {
            const remaining = Math.max(w.claim.claimed_hours - Number(w.claim.executed_hours), 0);
            next[w.claim.id] = remaining > 0 ? String(Math.min(1, remaining)) : "1";
          }
        }
        return next;
      });
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "加载失败";
      setErr(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCheckout(claimId: string) {
    const deviceId = checkoutDeviceByClaim[claimId];
    if (!deviceId) {
      setErr("请选择要借出的设备");
      return;
    }
    setBusyId(`checkout-${claimId}`);
    setErr("");
    try {
      await checkoutDeviceForClaim(claimId, deviceId);
      await load();
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "借出失败";
      setErr(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function onSettle(w: ClaimWorkbench) {
    const raw = sessionHoursByClaim[w.claim.id] ?? "1";
    const hours = parseFloat(raw);
    const remaining = Math.max(w.claim.claimed_hours - Number(w.claim.executed_hours), 0);
    if (!Number.isFinite(hours) || hours <= 0) {
      setErr("本次小时须为正数");
      return;
    }
    if (hours > remaining) {
      setErr(`本次不能超过剩余 ${remaining} 小时`);
      return;
    }
    if (!w.checkout && !w.claim.device_returned_at) {
      setErr("请先借出设备后再结算");
      return;
    }
    const rate = w.claim.bounties?.hourly_rate ?? 0;
    const amount = estimateSettlementAmount(hours, rate);
    const cashPart = rate > 0 ? `，入账 ${formatCny(amount)}` : "";
    if (!window.confirm(`结算：本次 ${hours} h${cashPart}。确认？`)) return;
    setBusyId(`settle-${w.claim.id}`);
    setErr("");
    try {
      await settleClaimSession(w.claim.id, hours, sessionNoteByClaim[w.claim.id]?.trim() || undefined);
      await load();
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "结算失败";
      setErr(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function onReturn(w: ClaimWorkbench) {
    if (!w.checkout) {
      setErr("当前无借出设备");
      return;
    }
    if (w.claim.device_returned_at) {
      setErr("该接单已归还过设备");
      return;
    }
    if (!window.confirm("确认执行员已归还设备？设备将回到可分配库（不含本次结算）。")) return;
    setBusyId(`return-${w.claim.id}`);
    setErr("");
    try {
      await returnDeviceForClaim(w.claim.id);
      await load();
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "归还失败";
      setErr(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function onReject(c: BountyClaim) {
    const note = window.prompt("驳回原因（可选）", "运维审核未通过");
    if (note === null) return;
    setBusyId(`reject-${c.id}`);
    setErr("");
    try {
      await operatorRejectBountyClaim(c.id, note || undefined);
      await load();
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "驳回失败";
      setErr(msg);
    } finally {
      setBusyId(null);
    }
  }

  const stats = useMemo(
    () => [
      {
        label: "进行中接单",
        value: workbenches.length,
        hint: "待结算",
        tone: workbenches.length ? ("warn" as const) : ("default" as const),
      },
      {
        label: "已借出",
        value: workbenches.filter((w) => w.checkout).length,
        hint: "待归还",
      },
      {
        label: "离线设备",
        value: offlineDevices.filter((d) => d.external_status === "normal").length,
        hint: "本群正常",
      },
      {
        label: "联网设备",
        value: onlineDevices.length,
        hint: "需关联甲方类型",
      },
    ],
    [workbenches, offlineDevices, onlineDevices]
  );

  if (loading) {
    return (
      <div className="py-24 flex justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <PageShell>
      <RefreshStrip active={refreshing} />
      <PageHero
        eyebrow="设备运维"
        title="执行员结算"
        description="借出设备 → 多次结算入账 → 归还设备回库（归还每单仅一次）。"
        accent="violet"
        icon={<IconWrench />}
        onRefresh={() => {
          setRefreshing(true);
          void load();
        }}
        refreshing={refreshing}
      />

      <StatGrid items={stats} />

      {!groupId && <Alert variant="warn">请先加入工作群后再使用运维功能。</Alert>}
      {err && <Alert variant="error">{err}</Alert>}

      <Alert variant="info">
        借出后可持续<strong>结算</strong>（可多次）；执行员<strong>归还</strong>设备时单独操作，每接单仅可归还一次。
      </Alert>

      {workbenches.length === 0 ? (
        <EmptyState title="暂无进行中接单" description="执行员接单后会出现在此" icon={<IconClipboard />} />
      ) : (
        <CardList>
          {workbenches.map((w) => {
            const c = w.claim;
            const title = c.bounties?.title ?? "悬赏单";
            const executed = Number(c.executed_hours);
            const remaining = Math.max(c.claimed_hours - executed, 0);
            const rate = c.bounties?.hourly_rate ?? 0;
            const sessionH = parseFloat(sessionHoursByClaim[c.id] ?? "1") || 0;
            const previewAmount =
              rate > 0 && sessionH > 0 ? estimateSettlementAmount(Math.min(sessionH, remaining), rate) : 0;
            const deviceReturned = Boolean(c.device_returned_at);
            const canCheckout = !w.checkout && !deviceReturned;
            const canReturn = Boolean(w.checkout) && !deviceReturned;
            const canSettle = remaining > 0 && (Boolean(w.checkout) || deviceReturned || w.logs.length > 0);
            const deviceLabel = w.checkout
              ? deviceLabelById[w.checkout.device_id] ?? w.checkout.device_id
              : w.logs[0]
                ? deviceLabelById[w.logs[0].device_id] ?? w.logs[0].device_id
                : null;

            return (
              <CardListItem key={c.id}>
              <div className="glass-panel rounded-2xl p-5 space-y-4 h-full">
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
                    <p className="text-sm text-slate-600 mt-1">
                      {executorNames[c.executor_id] ?? c.executor_id.slice(0, 8)} · 领取{" "}
                      <span className="font-semibold text-indigo-600">{c.claimed_hours} h</span>
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                    {claimStatusLabel(c.status)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-emerald-800">
                    已结算 {executed} / {c.claimed_hours} h
                  </span>
                  <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-600">剩余 {remaining} h</span>
                  {rate > 0 && (
                    <span className="rounded-lg bg-indigo-50 px-2.5 py-1 text-indigo-700">
                      {formatCny(rate)}/h
                    </span>
                  )}
                  <span className="rounded-lg bg-indigo-50 px-2.5 py-1 text-indigo-700">{formatDueCountdown(c.due_at)}</span>
                </div>

                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all"
                    style={{
                      width: `${c.claimed_hours > 0 ? Math.min(100, Math.round((executed / c.claimed_hours) * 100)) : 0}%`,
                    }}
                  />
                </div>

                {!canCheckout ? null : (
                  <Panel title="借出设备" description="从可分配库选择一台设备" icon={<IconDevices />}>
                    {w.assignable.length === 0 ? (
                      <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                        无可借设备：请确认悬赏已配置甲方类型，且有正常状态、未占用的设备（离线设备在设备管理登记；联网设备需关联甲方业务）。
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="block flex-1 min-w-[200px]">
                          <span className={uiLabel}>设备</span>
                          <select
                            className={uiSelect}
                            value={checkoutDeviceByClaim[c.id] ?? ""}
                            onChange={(e) =>
                              setCheckoutDeviceByClaim((prev) => ({ ...prev, [c.id]: e.target.value }))
                            }
                          >
                            {w.assignable.map((d) => (
                              <option key={d.device_id} value={d.device_id}>
                                {d.kind === "offline" ? "离线 · " : "联网 · "}
                                {d.label}
                                {d.device_type ? ` (${d.device_type})` : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <UiButton
                          disabled={busyId === `checkout-${c.id}`}
                          onClick={() => void onCheckout(c.id)}
                        >
                          {busyId === `checkout-${c.id}` ? "借出中…" : "确认借出"}
                        </UiButton>
                      </div>
                    )}
                  </Panel>
                )}

                {(w.checkout || deviceReturned) && deviceLabel && (
                  <p className="text-sm text-slate-700">
                    {w.checkout ? "借出中：" : "已归还："}
                    <span className="font-semibold text-slate-900 ml-1">{deviceLabel}</span>
                    {w.checkout && isOfflineDeviceAssignmentId(w.checkout.device_id) && (
                      <span className="ml-1.5 text-[10px] font-semibold uppercase text-violet-700">离线</span>
                    )}
                  </p>
                )}

                {canSettle && (
                  <Panel title="结算" description="录入本次小时并当场入账（可多次，直至结清）" icon={<IconClipboard />}>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="block">
                        <span className={uiLabel}>本次小时</span>
                        <input
                          type="number"
                          min={0.01}
                          step={0.01}
                          max={remaining}
                          className={`${uiInput} !w-28`}
                          value={sessionHoursByClaim[c.id] ?? "1"}
                          onChange={(e) =>
                            setSessionHoursByClaim((prev) => ({ ...prev, [c.id]: e.target.value }))
                          }
                        />
                      </label>
                      {rate > 0 && previewAmount > 0 && (
                        <span className="text-sm text-emerald-700 pb-2">预估 {formatCny(previewAmount)}</span>
                      )}
                      <label className="block flex-1 min-w-[160px]">
                        <span className={uiLabel}>备注（可选）</span>
                        <input
                          className={uiInput}
                          value={sessionNoteByClaim[c.id] ?? ""}
                          onChange={(e) =>
                            setSessionNoteByClaim((prev) => ({ ...prev, [c.id]: e.target.value }))
                          }
                        />
                      </label>
                      <UiButton
                        variant="success"
                        disabled={busyId === `settle-${c.id}`}
                        onClick={() => void onSettle(w)}
                      >
                        {busyId === `settle-${c.id}` ? "结算中…" : "确认结算"}
                      </UiButton>
                    </div>
                  </Panel>
                )}

                {canReturn && (
                  <div className="flex flex-wrap gap-3">
                    <UiButton
                      variant="secondary"
                      disabled={busyId === `return-${c.id}`}
                      onClick={() => void onReturn(w)}
                    >
                      {busyId === `return-${c.id}` ? "提交中…" : "确认归还设备"}
                    </UiButton>
                    <span className="text-xs text-slate-500 self-center">每接单仅可归还一次，不含结算</span>
                  </div>
                )}

                {deviceReturned && !w.checkout && (
                  <p className="text-xs text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">
                    设备已于 {new Date(c.device_returned_at!).toLocaleString()} 归还；未完成部分可继续结算。
                  </p>
                )}

                {w.logs.length > 0 && (
                  <div className="border-t border-slate-100 pt-3">
                    <p className={uiLabel}>结算记录</p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {w.logs.map((log) => (
                        <li key={log.id} className="text-xs text-slate-600 rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-200/80">
                          <span>
                            {deviceLabelById[log.device_id] ?? log.device_id} ·{" "}
                            <span className="font-medium text-indigo-600">{log.registered_hours} h</span>
                          </span>
                          <span className="text-slate-400">{new Date(log.created_at).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex justify-end border-t border-slate-100 pt-3">
                  <UiButton
                    variant="secondary"
                    className="!text-red-600 !ring-red-100"
                    disabled={busyId === `reject-${c.id}`}
                    onClick={() => void onReject(c)}
                  >
                    驳回接单
                  </UiButton>
                </div>
              </div>
              </CardListItem>
            );
          })}
        </CardList>
      )}
    </PageShell>
  );
}
