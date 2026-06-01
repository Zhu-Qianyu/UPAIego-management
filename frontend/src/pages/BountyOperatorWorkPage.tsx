import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchActiveGroupId, listGroupProfilesByRole } from "../api/groups";
import { listDevices, type Device } from "../api/client";
import { fetchProfilesByIds, profileDisplayName, type ProfileContact } from "../api/profiles";
import {
  assignDeviceToExecutor,
  claimStatusLabel,
  formatDueCountdown,
  listActiveClaimsForGroup,
  listMyDeviceAssignments,
  listMyDeviceHourLogs,
  operatorApproveBountyClaim,
  operatorRejectBountyClaim,
  registerDeviceDataHours,
  revokeDeviceAssignment,
  sumRegisteredHoursForClaim,
  type BountyClaim,
  type DeviceDataHourLog,
  type DeviceExecutorAssignment,
} from "../api/bounties";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import {
  Alert,
  EmptyState,
  IconClipboard,
  IconClock,
  IconDevices,
  IconWrench,
  PageHero,
  PageShell,
  Panel,
  SegmentedTabs,
  StatGrid,
  UiButton,
  uiInput,
  uiLabel,
  uiSelect,
} from "../components/ui/PageLayout";

type Tab = "assign" | "hours" | "audit";

export default function BountyOperatorWorkPage() {
  const [tab, setTab] = useState<Tab>("audit");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [executors, setExecutors] = useState<ProfileContact[]>([]);
  const [assignments, setAssignments] = useState<DeviceExecutorAssignment[]>([]);
  const [hourLogs, setHourLogs] = useState<DeviceDataHourLog[]>([]);
  const [claims, setClaims] = useState<BountyClaim[]>([]);
  const [executorNames, setExecutorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [assignDeviceId, setAssignDeviceId] = useState("");
  const [assignExecutorId, setAssignExecutorId] = useState("");

  const [hourDeviceId, setHourDeviceId] = useState("");
  const [hourAmount, setHourAmount] = useState("1");
  const [hourClaimId, setHourClaimId] = useState("");
  const [hourNote, setHourNote] = useState("");

  const [confirmHours, setConfirmHours] = useState<Record<string, string>>({});
  const [registeredByClaim, setRegisteredByClaim] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setErr("");
    try {
      const gid = await fetchActiveGroupId();
      setGroupId(gid);
      const [devRes, execs, assigns, logs, activeClaims] = await Promise.all([
        listDevices({ scope: "own", limit: 500, offset: 0 }),
        gid ? listGroupProfilesByRole(gid, "collection_executor") : Promise.resolve([]),
        listMyDeviceAssignments(),
        listMyDeviceHourLogs(),
        gid ? listActiveClaimsForGroup(gid) : Promise.resolve([]),
      ]);
      setDevices(devRes.devices);
      setExecutors(execs);
      setAssignments(assigns);
      setHourLogs(logs);
      setClaims(activeClaims);
      const execIds = [...new Set(activeClaims.map((c) => c.executor_id))];
      if (execIds.length) {
        const profiles = await fetchProfilesByIds(execIds);
        const map: Record<string, string> = {};
        for (const p of profiles) map[p.id] = profileDisplayName(p);
        setExecutorNames(map);
      }
      const regMap: Record<string, number> = {};
      await Promise.all(
        activeClaims.map(async (c) => {
          regMap[c.id] = await sumRegisteredHoursForClaim(c.id);
        })
      );
      setRegisteredByClaim(regMap);
      const nextConfirm: Record<string, string> = {};
      for (const c of activeClaims) {
        const reg = regMap[c.id] ?? 0;
        const suggested = Math.min(c.claimed_hours, Math.max(0, Math.floor(reg)) || c.claimed_hours);
        nextConfirm[c.id] = String(suggested);
      }
      setConfirmHours(nextConfirm);
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

  async function onAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignDeviceId || !assignExecutorId) {
      setErr("请选择设备与执行员");
      return;
    }
    setBusyId("assign");
    setErr("");
    try {
      await assignDeviceToExecutor(assignDeviceId, assignExecutorId);
      await load();
      setAssignDeviceId("");
      setAssignExecutorId("");
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "分发失败";
      setErr(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function onRevoke(assignmentId: string) {
    if (!window.confirm("撤销后执行员将不再绑定该设备，确认？")) return;
    setBusyId(assignmentId);
    setErr("");
    try {
      await revokeDeviceAssignment(assignmentId);
      await load();
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "撤销失败";
      setErr(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function onRegisterHours(e: React.FormEvent) {
    e.preventDefault();
    const hours = parseFloat(hourAmount);
    if (!hourDeviceId || !Number.isFinite(hours) || hours <= 0) {
      setErr("请选择设备并填写正数小时");
      return;
    }
    setBusyId("hours");
    setErr("");
    try {
      await registerDeviceDataHours({
        deviceId: hourDeviceId,
        registeredHours: hours,
        bountyClaimId: hourClaimId.trim() || undefined,
        note: hourNote.trim() || undefined,
      });
      await load();
      setHourAmount("1");
      setHourNote("");
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "登记失败";
      setErr(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function onApprove(c: BountyClaim) {
    const raw = confirmHours[c.id] ?? String(c.claimed_hours);
    const h = parseInt(raw, 10);
    if (!Number.isFinite(h) || h <= 0) {
      setErr("确认小时须为正整数");
      return;
    }
    if (h > c.claimed_hours) {
      setErr(`确认小时不能超过领取的 ${c.claimed_hours} 小时`);
      return;
    }
    if (!window.confirm(`通过审核：确认执行 ${h} 小时（领取 ${c.claimed_hours} h），按 min 规则计分？`)) return;
    setBusyId(c.id);
    setErr("");
    try {
      await operatorApproveBountyClaim(c.id, h);
      await load();
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "审核失败";
      setErr(msg);
    } finally {
      setBusyId(null);
    }
  }

  async function onReject(c: BountyClaim) {
    const note = window.prompt("驳回原因（可选）", "运维审核未通过");
    if (note === null) return;
    setBusyId(c.id);
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
      { label: "待审核", value: claims.length, hint: "进行中接单", tone: claims.length ? ("warn" as const) : ("default" as const) },
      { label: "设备分发", value: assignments.length, hint: "活跃绑定" },
      { label: "我的设备", value: devices.length, hint: "可管理" },
      { label: "执行员", value: executors.length, hint: "群内" },
    ],
    [claims.length, assignments.length, devices.length, executors.length]
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
        title="运维工作台"
        description="设备分发给执行员、登记数采小时、审核悬赏接单。与场景业务模块独立运行。"
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

      <SegmentedTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "audit", label: "悬赏审核", icon: <IconClipboard />, badge: claims.length },
          { id: "assign", label: "设备分发", icon: <IconDevices /> },
          { id: "hours", label: "数采登记", icon: <IconClock /> },
        ]}
      />

      {tab === "assign" && (
        <section className="space-y-4">
          <Panel title="分发设备给执行员" description="同一设备新分发将自动撤销旧绑定" icon={<IconDevices />}>
            <form onSubmit={onAssign} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className={uiLabel}>设备</span>
                  <select className={uiSelect} value={assignDeviceId} onChange={(e) => setAssignDeviceId(e.target.value)} required>
                    <option value="">选择设备</option>
                    {devices.map((d) => (
                      <option key={d.device_id} value={d.device_id}>
                        {d.readable_name || d.device_id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={uiLabel}>执行员</span>
                  <select className={uiSelect} value={assignExecutorId} onChange={(e) => setAssignExecutorId(e.target.value)} required>
                    <option value="">选择执行员</option>
                    {executors.map((p) => (
                      <option key={p.id} value={p.id}>
                        {profileDisplayName(p)}
                        {p.phone ? ` · ${p.phone}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <UiButton type="submit" disabled={busyId === "assign"}>
                {busyId === "assign" ? "提交中…" : "确认分发"}
              </UiButton>
            </form>
          </Panel>

          <Panel title="当前绑定" icon={<IconClipboard />}>
            {assignments.length === 0 ? (
              <EmptyState title="暂无活跃分发" description="选择设备与执行员后点击确认分发" icon={<IconDevices />} />
            ) : (
              <ul className="space-y-2">
                {assignments.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50/80 ring-1 ring-slate-200/80 px-4 py-3 text-sm"
                  >
                    <span className="text-slate-700">
                      <span className="font-semibold text-slate-900">{a.device_id}</span>
                      <span className="mx-2 text-slate-300">→</span>
                      {executorNames[a.executor_id] ?? a.executor_id.slice(0, 8)}
                    </span>
                    <UiButton variant="ghost" size="sm" className="!text-red-600" disabled={busyId === a.id} onClick={() => void onRevoke(a.id)}>
                      撤销
                    </UiButton>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
      )}

      {tab === "hours" && (
        <section className="space-y-4">
          <Panel title="登记设备数采小时" description="可关联悬赏接单 ID，供审核时参考" icon={<IconClock />}>
            <form onSubmit={onRegisterHours} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className={uiLabel}>设备</span>
                  <select className={uiSelect} value={hourDeviceId} onChange={(e) => setHourDeviceId(e.target.value)} required>
                    <option value="">选择设备</option>
                    {devices.map((d) => (
                      <option key={d.device_id} value={d.device_id}>
                        {d.readable_name || d.device_id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={uiLabel}>小时数</span>
                  <input type="number" min={0.01} step={0.01} className={uiInput} value={hourAmount} onChange={(e) => setHourAmount(e.target.value)} required />
                </label>
                <label className="block sm:col-span-2">
                  <span className={uiLabel}>关联悬赏接单 ID（可选）</span>
                  <input className={`${uiInput} font-mono text-xs`} value={hourClaimId} onChange={(e) => setHourClaimId(e.target.value)} placeholder="uuid" />
                </label>
              </div>
              <label className="block">
                <span className={uiLabel}>备注</span>
                <input className={uiInput} value={hourNote} onChange={(e) => setHourNote(e.target.value)} />
              </label>
              <UiButton type="submit" disabled={busyId === "hours"}>
                {busyId === "hours" ? "提交中…" : "登记"}
              </UiButton>
            </form>
          </Panel>

          <Panel title="最近登记" icon={<IconClock />}>
            {hourLogs.length === 0 ? (
              <EmptyState title="暂无登记记录" icon={<IconClock />} />
            ) : (
              <ul className="space-y-2">
                {hourLogs.map((log) => (
                  <li key={log.id} className="rounded-xl bg-slate-50/90 ring-1 ring-slate-200/80 px-4 py-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium text-slate-900">
                        {log.device_id} · <span className="text-indigo-600">{log.registered_hours} h</span>
                      </span>
                      <span className="text-xs text-slate-400">{new Date(log.created_at).toLocaleString()}</span>
                    </div>
                    {log.bounty_claim_id && (
                      <p className="mt-1 text-xs text-slate-500 font-mono">接单 {log.bounty_claim_id.slice(0, 8)}…</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
      )}

      {tab === "audit" && (
        <section className="space-y-4">
          <Alert variant="info">
            审核通过：执行小时 = min(领取小时, 您确认的小时)；积分按执行小时 × 系数发放。驳回将扣分并退回未执行工时。
          </Alert>
          {claims.length === 0 ? (
            <EmptyState title="暂无待审核接单" description="执行员接单后会出现在这里" icon={<IconClipboard />} />
          ) : (
            <ul className="space-y-4">
              {claims.map((c) => {
                const title = c.bounties?.title ?? "悬赏单";
                const reg = registeredByClaim[c.id] ?? 0;
                return (
                  <li key={c.id} className="glass-panel rounded-2xl p-5 space-y-4">
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
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-600">数采登记 {reg} h</span>
                      <span className="rounded-lg bg-indigo-50 px-2.5 py-1 text-indigo-700">{formatDueCountdown(c.due_at)}</span>
                    </div>
                    <div className="flex flex-wrap items-end gap-3 pt-1 border-t border-slate-100">
                      <label className="block">
                        <span className={uiLabel}>确认执行（小时）</span>
                        <input
                          type="number"
                          min={1}
                          max={c.claimed_hours}
                          className={`${uiInput} !w-28`}
                          value={confirmHours[c.id] ?? String(c.claimed_hours)}
                          onChange={(e) => setConfirmHours((prev) => ({ ...prev, [c.id]: e.target.value }))}
                        />
                      </label>
                      <UiButton variant="success" disabled={busyId === c.id} onClick={() => void onApprove(c)}>
                        通过
                      </UiButton>
                      <UiButton variant="secondary" className="!text-red-600 !ring-red-100" disabled={busyId === c.id} onClick={() => void onReject(c)}>
                        驳回
                      </UiButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </PageShell>
  );
}
