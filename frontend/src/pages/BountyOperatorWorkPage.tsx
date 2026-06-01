import { useCallback, useEffect, useState } from "react";
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
          <h1 className="text-xl font-semibold text-gray-900">运维工作台</h1>
          <p className="text-sm text-gray-500 mt-1">设备分发 · 数采小时登记 · 悬赏接单审核（与场景业务独立）</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setRefreshing(true);
            void load();
          }}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          刷新
        </button>
      </div>

      {!groupId && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          请先加入工作群后再使用运维功能。
        </div>
      )}

      {err && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
      )}

      <div className="flex gap-2 border-b border-gray-200 pb-px flex-wrap">
        {(
          [
            ["audit", "悬赏审核"],
            ["assign", "设备分发"],
            ["hours", "数采登记"],
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

      {tab === "assign" && (
        <section className="space-y-4">
          <form onSubmit={onAssign} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">
            <h2 className="font-medium text-gray-900">分发设备给执行员</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-sm block">
                <span className="text-gray-600">设备</span>
                <select
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  value={assignDeviceId}
                  onChange={(e) => setAssignDeviceId(e.target.value)}
                  required
                >
                  <option value="">选择设备</option>
                  {devices.map((d) => (
                    <option key={d.device_id} value={d.device_id}>
                      {d.readable_name || d.device_id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm block">
                <span className="text-gray-600">执行员</span>
                <select
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  value={assignExecutorId}
                  onChange={(e) => setAssignExecutorId(e.target.value)}
                  required
                >
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
            <button
              type="submit"
              disabled={busyId === "assign"}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {busyId === "assign" ? "提交中…" : "确认分发"}
            </button>
          </form>

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">当前绑定</h3>
            {assignments.length === 0 ? (
              <p className="text-sm text-gray-500 border border-dashed rounded-xl py-8 text-center">暂无活跃分发</p>
            ) : (
              <ul className="space-y-2">
                {assignments.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap justify-between gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm"
                  >
                    <span>
                      设备 <strong>{a.device_id}</strong> → 执行员{" "}
                      <strong>{executorNames[a.executor_id] ?? a.executor_id.slice(0, 8)}</strong>
                    </span>
                    <button
                      type="button"
                      disabled={busyId === a.id}
                      onClick={() => void onRevoke(a.id)}
                      className="text-red-700 hover:underline disabled:opacity-50"
                    >
                      撤销
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {tab === "hours" && (
        <section className="space-y-4">
          <form onSubmit={onRegisterHours} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">
            <h2 className="font-medium text-gray-900">登记设备数采小时</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-sm block">
                <span className="text-gray-600">设备</span>
                <select
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  value={hourDeviceId}
                  onChange={(e) => setHourDeviceId(e.target.value)}
                  required
                >
                  <option value="">选择设备</option>
                  {devices.map((d) => (
                    <option key={d.device_id} value={d.device_id}>
                      {d.readable_name || d.device_id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm block">
                <span className="text-gray-600">小时数</span>
                <input
                  type="number"
                  min={0.01}
                  step={0.01}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                  value={hourAmount}
                  onChange={(e) => setHourAmount(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm block sm:col-span-2">
                <span className="text-gray-600">关联悬赏接单 ID（可选）</span>
                <input
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
                  value={hourClaimId}
                  onChange={(e) => setHourClaimId(e.target.value)}
                  placeholder="uuid"
                />
              </label>
            </div>
            <label className="text-sm block">
              <span className="text-gray-600">备注</span>
              <input
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                value={hourNote}
                onChange={(e) => setHourNote(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={busyId === "hours"}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {busyId === "hours" ? "提交中…" : "登记"}
            </button>
          </form>

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">最近登记</h3>
            {hourLogs.length === 0 ? (
              <p className="text-sm text-gray-500 border border-dashed rounded-xl py-8 text-center">暂无记录</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {hourLogs.map((log) => (
                  <li key={log.id} className="rounded-lg border border-gray-200 bg-white px-4 py-2">
                    {log.device_id} · {log.registered_hours} h
                    {log.bounty_claim_id && (
                      <span className="text-gray-500"> · 接单 {log.bounty_claim_id.slice(0, 8)}…</span>
                    )}
                    <span className="text-gray-400 text-xs block">{new Date(log.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {tab === "audit" && (
        <section className="space-y-3">
          <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            审核通过时执行小时 = min(领取小时, 您确认的小时)；积分按执行小时 × 悬赏积分系数发放。驳回将按现有规则扣分并退回未执行工时。
          </p>
          {claims.length === 0 ? (
            <p className="text-sm text-gray-500 py-10 text-center border border-dashed rounded-xl">暂无待审核接单</p>
          ) : (
            <ul className="space-y-3">
              {claims.map((c) => {
                const title = c.bounties?.title ?? "悬赏单";
                const reg = registeredByClaim[c.id] ?? 0;
                return (
                  <li key={c.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <h3 className="font-medium text-gray-900">{title}</h3>
                        <p className="text-sm text-gray-600 mt-1">
                          执行员 {executorNames[c.executor_id] ?? c.executor_id.slice(0, 8)} · 领取{" "}
                          {c.claimed_hours} h · {claimStatusLabel(c.status)}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          已登记数采 {reg} h（参考） · {formatDueCountdown(c.due_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="text-sm">
                        <span className="text-gray-600">确认执行（小时）</span>
                        <input
                          type="number"
                          min={1}
                          max={c.claimed_hours}
                          className="mt-1 block w-28 rounded-lg border border-gray-300 px-3 py-2"
                          value={confirmHours[c.id] ?? String(c.claimed_hours)}
                          onChange={(e) =>
                            setConfirmHours((prev) => ({ ...prev, [c.id]: e.target.value }))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => void onApprove(c)}
                        className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        通过
                      </button>
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => void onReject(c)}
                        className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        驳回
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
