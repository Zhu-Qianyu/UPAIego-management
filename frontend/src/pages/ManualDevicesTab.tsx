import { useCallback, useEffect, useMemo, useState, memo } from "react";
import {
  createManualTrackedDevice,
  createManualTrackedDevicesBatch,
  deleteManualTrackedDevice,
  deleteManualTrackedDevices,
  formatManualTrackedDeviceLabel,
  groupManualTrackedDevicesByParty,
  labelExternalDeviceStatus,
  listAllManualTrackedDevices,
  listManualTrackedDevices,
  listPartyDemands,
  updateManualTrackedDevice,
  normalizeExternalDeviceStatus,
  type ExternalDeviceStatus,
  type ManualTrackedDevice,
  type PartyDemand,
} from "../api/operations";
import {
  assignManualTrackedDevicesToExecutor,
  buildOfflineAssignmentMap,
  executorOptionLabel,
  formatManualDeviceExecutorLabel,
  isManualDeviceAssignable,
  releaseManualTrackedDevices,
  type OfflineDeviceAssignmentView,
} from "../api/deviceAssignments";
import { fetchActiveGroupId, listGroupProfilesByRole } from "../api/groups";
import type { ProfileContact } from "../api/profiles";
import { CardList, CardListItem, CompactList, CompactListRow, ListViewSection } from "../components/ui/PageLayout";
import { BatchSelectCheckbox, BatchSelectToolbar } from "../components/ui/BatchSelectToolbar";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import { useBatchSelection } from "../hooks/useBatchSelection";
import { openManualDevicesPrint } from "../utils/manualDevicesExport";
import { buildManualTrackedDeviceQrText } from "../utils/manualDeviceQrPayload";
import { qrDataUrlCached } from "../utils/qrDataUrlCache";

const ManualTrackedDeviceRow = memo(function ManualTrackedDeviceRow({
  row,
  onChanged,
  selected,
  onToggleSelect,
  executorLabel,
}: {
  row: ManualTrackedDevice;
  onChanged: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  executorLabel: string;
}) {
  const [localStatus, setLocalStatus] = useState<ExternalDeviceStatus>(normalizeExternalDeviceStatus(row.external_status));
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const qrPayload = useMemo(() => buildManualTrackedDeviceQrText(row), [row]);

  useEffect(() => {
    setLocalStatus(normalizeExternalDeviceStatus(row.external_status));
  }, [row.external_status, row.id, row.updated_at]);

  useEffect(() => {
    let cancel = false;
    qrDataUrlCached(qrPayload, { width: 168, margin: 1, errorCorrectionLevel: "M" })
      .then((dataUrl) => {
        if (!cancel) setQr(dataUrl);
      })
      .catch(() => {
        if (!cancel) setQr(null);
      });
    return () => {
      cancel = true;
    };
  }, [qrPayload]);

  const dirty = normalizeExternalDeviceStatus(localStatus) !== normalizeExternalDeviceStatus(row.external_status);

  async function saveStatus() {
    setErr("");
    setBusy(true);
    try {
      await updateManualTrackedDevice(row.id, { external_status: normalizeExternalDeviceStatus(localStatus) });
      await onChanged();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row gap-4 h-full w-full min-w-0 max-w-full overflow-hidden box-border">
      {onToggleSelect ? (
        <div className="shrink-0 pt-1">
          <BatchSelectCheckbox checked={!!selected} onChange={onToggleSelect} label={`选择 ${row.public_code}`} />
        </div>
      ) : null}
      <div className="shrink-0 flex flex-col items-center gap-1">
        <p className="font-mono text-lg font-bold tracking-wide text-indigo-900">{row.public_code}</p>
        {qr ? (
          <img src={qr} alt="" className="w-40 h-40 object-contain rounded-lg border border-gray-100 bg-white" />
        ) : (
          <div className="w-40 h-40 rounded-lg border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center text-xs text-gray-400">
            二维码生成中…
          </div>
        )}
        <p className="text-[10px] text-gray-400 text-center max-w-[10rem] break-all">扫码显示登记编号与设备信息（纯文本）</p>
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <p className="font-medium text-gray-900">{formatManualTrackedDeviceLabel(row)}</p>
        <p className="text-xs text-gray-500">
          登记编号（贴签）：
          <span className="font-mono font-semibold text-indigo-800">{row.public_code}</span>
        </p>
        <p className="text-xs text-gray-400 font-mono break-all">内部 ID：{row.id}</p>
        <p className="text-xs text-gray-600">
          分配：
          <span
            className={
              executorLabel === "空闲"
                ? "text-emerald-700 font-medium"
                : executorLabel === "—"
                  ? "text-gray-400"
                  : "text-indigo-800 font-medium"
            }
          >
            {executorLabel}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-sm text-gray-700">设备状态</span>
          <select
            value={localStatus}
            onChange={(e) => setLocalStatus(normalizeExternalDeviceStatus(e.target.value))}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
          >
            <option value="normal">正常</option>
            <option value="fault">异常（据人员反馈）</option>
            <option value="factory_repair">返厂维修</option>
          </select>
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={() => void saveStatus()}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-600 text-white disabled:opacity-40"
          >
            {busy ? "保存中…" : "保存状态"}
          </button>
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="pt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="text-xs text-red-600"
            onClick={() => {
              if (!confirm("删除该设备登记？登记编号将作废。")) return;
              void (async () => {
                try {
                  await deleteManualTrackedDevice(row.id);
                  await onChanged();
                } catch (e: unknown) {
                  setErr(e instanceof Error ? e.message : "删除失败");
                }
              })();
            }}
          >
            删除设备
          </button>
        </div>
      </div>
    </div>
  );
});

export default function ManualDevicesTab({ fleetMode = false }: { fleetMode?: boolean }) {
  const [groupId, setGroupId] = useState<string | null>(null);
  const [rows, setRows] = useState<ManualTrackedDevice[]>([]);
  const [demands, setDemands] = useState<PartyDemand[]>([]);
  const [boot, setBoot] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [partyId, setPartyId] = useState("");
  const [shortLabel, setShortLabel] = useState("");
  const [partyFilter, setPartyFilter] = useState<string>("all");
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<"single" | "batch">("single");
  const [batchCount, setBatchCount] = useState("5");
  const [batchAdding, setBatchAdding] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchAssigning, setBatchAssigning] = useState(false);
  const [assignExecutorId, setAssignExecutorId] = useState("");
  const [assignExecutors, setAssignExecutors] = useState<ProfileContact[]>([]);
  const [assignmentByCode, setAssignmentByCode] = useState<Map<string, OfflineDeviceAssignmentView>>(() => new Map());
  const deviceBatch = useBatchSelection();

  const partyGroups = useMemo(() => groupManualTrackedDevicesByParty(rows, demands), [rows, demands]);

  const visibleGroups = useMemo(() => {
    if (partyFilter === "all") return partyGroups;
    return partyGroups.filter((g) => g.partyDemandId === partyFilter);
  }, [partyFilter, partyGroups]);

  const visibleRows = useMemo(
    () => visibleGroups.flatMap((g) => g.devices),
    [visibleGroups]
  );

  const visibleRowIds = useMemo(() => visibleRows.map((r) => r.id), [visibleRows]);

  const selectedAssignRows = useMemo(() => {
    const ids = new Set(deviceBatch.selectedIds);
    return visibleRows.filter((r) => ids.has(r.id));
  }, [visibleRows, deviceBatch.selectedIds]);

  const assignTargetGroupId = useMemo(() => {
    if (selectedAssignRows.length > 0) {
      const g = selectedAssignRows[0].group_id;
      return selectedAssignRows.every((r) => r.group_id === g) ? g : null;
    }
    return groupId;
  }, [selectedAssignRows, groupId]);

  const assignGroupConflict = deviceBatch.count > 0 && selectedAssignRows.length > 0 && assignTargetGroupId === null;

  const getAssignment = useCallback(
    (row: ManualTrackedDevice) => assignmentByCode.get(row.public_code.toUpperCase()),
    [assignmentByCode]
  );

  const load = useCallback(async () => {
    const gid = await fetchActiveGroupId();
    setGroupId(gid);
    if (fleetMode) {
      const list = await listAllManualTrackedDevices();
      setRows(list);
      setDemands(gid ? await listPartyDemands(gid) : []);
      setAssignmentByCode(await buildOfflineAssignmentMap(list.map((r) => r.public_code)));
      return;
    }
    if (!gid) {
      setRows([]);
      setDemands([]);
      setAssignmentByCode(new Map());
      return;
    }
    const [list, pd] = await Promise.all([listManualTrackedDevices(gid), listPartyDemands(gid)]);
    setRows(list);
    setDemands(pd);
    setAssignmentByCode(await buildOfflineAssignmentMap(list.map((r) => r.public_code)));
  }, [fleetMode]);

  useEffect(() => {
    const gid = assignTargetGroupId;
    if (!gid) {
      setAssignExecutors([]);
      return;
    }
    let cancel = false;
    void listGroupProfilesByRole(gid, "collection_executor").then((list) => {
      if (!cancel) setAssignExecutors(list);
    });
    return () => {
      cancel = true;
    };
  }, [assignTargetGroupId]);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      setErr("");
      try {
        await load();
      } catch (e: unknown) {
        if (!cancel) setErr(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (!cancel) setBoot(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    setErr("");
    try {
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "刷新失败");
    } finally {
      setRefreshing(false);
    }
  }

  async function onBatchAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!groupId) {
      setErr("请先加入工作群并设为在册成员。");
      return;
    }
    if (!partyId) {
      setErr("请选择甲方业务。");
      return;
    }
    if (!shortLabel.trim()) {
      setErr("请填写设备简称（多台共用，不要加序号）。");
      return;
    }
    const count = Math.floor(Number(batchCount));
    if (!Number.isFinite(count) || count < 1 || count > 50) {
      setErr("批量数量须为 1～50 的整数。");
      return;
    }
    setBatchAdding(true);
    try {
      const created = await createManualTrackedDevicesBatch({
        group_id: groupId,
        party_demand_id: partyId,
        device_short_label: shortLabel.trim(),
        count,
      });
      const range =
        created.length === 1
          ? created[0].public_code
          : `${created[0].public_code}～${created[created.length - 1].public_code}`;
      setShortLabel("");
      setPartyId("");
      setBatchCount("5");
      deviceBatch.clear();
      await load();
      setErr("");
      window.alert(`已批量登记 ${created.length} 台设备，编号 ${range}`);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "批量添加失败");
    } finally {
      setBatchAdding(false);
    }
  }

  async function onBatchDelete() {
    const ids = deviceBatch.selectedIds;
    if (ids.length === 0) return;
    if (!confirm(`确定删除选中的 ${ids.length} 台设备？登记编号将作废。`)) return;
    setErr("");
    setBatchDeleting(true);
    try {
      await deleteManualTrackedDevices(ids);
      deviceBatch.clear();
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "批量删除失败");
      await load();
    } finally {
      setBatchDeleting(false);
    }
  }

  async function onBatchAssign() {
    if (!assignExecutorId || selectedAssignRows.length === 0) return;
    if (assignGroupConflict || !assignTargetGroupId) {
      setErr("所选设备须属于同一工作群才能批量分配。");
      return;
    }

    const assignable = selectedAssignRows.filter((r) => isManualDeviceAssignable(r, getAssignment(r)));
    if (assignable.length === 0) {
      setErr("所选设备均不可分配（须为正常状态，且非悬赏借用中）。");
      return;
    }

    setErr("");
    setBatchAssigning(true);
    try {
      if (assignExecutorId === "__idle__") {
        if (!confirm(`将 ${assignable.length} 台设备的分配设为空闲？`)) return;
        const { released, failures } = await releaseManualTrackedDevices(assignable.map((r) => r.public_code));
        deviceBatch.clear();
        setAssignExecutorId("");
        await load();
        if (failures.length > 0) {
          setErr(`已取消 ${released} 台分配；${failures.length} 台未能取消：${failures[0]}`);
        }
        return;
      }

      const executor = assignExecutors.find((e) => e.id === assignExecutorId);
      const executorName = executor ? executorOptionLabel(executor) : "所选执行员";
      if (!confirm(`将 ${assignable.length} 台正常设备分配给 ${executorName}？`)) return;

      const { assigned, failures } = await assignManualTrackedDevicesToExecutor(
        assignable.map((r) => r.public_code),
        assignExecutorId
      );
      deviceBatch.clear();
      setAssignExecutorId("");
      await load();
      if (failures.length > 0) {
        setErr(`已分配 ${assigned} 台；${failures.length} 台失败：${failures[0]}`);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "分配失败");
      await load();
    } finally {
      setBatchAssigning(false);
    }
  }

  async function onBatchPrint() {
    const selected = visibleRows.filter((r) => deviceBatch.isSelected(r.id));
    if (selected.length === 0) return;
    setErr("");
    try {
      await openManualDevicesPrint(
        "设备贴签列表（选中）",
        fleetMode ? "全量设备" : `工作群 ${groupId}`,
        selected
      );
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "无法打开打印窗口");
    }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!groupId) {
      setErr("请先加入工作群并设为在册成员。");
      return;
    }
    if (!partyId) {
      setErr("请选择甲方业务。");
      return;
    }
    if (!shortLabel.trim()) {
      setErr("请填写设备简称。");
      return;
    }
    setAdding(true);
    try {
      await createManualTrackedDevice({
        group_id: groupId,
        party_demand_id: partyId,
        device_short_label: shortLabel.trim(),
      });
      setShortLabel("");
      setPartyId("");
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "添加失败");
    } finally {
      setAdding(false);
    }
  }

  if (boot) return <Spinner />;

  if (!fleetMode && !groupId) {
    return (
      <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
        请先加入已审批的工作群组后再登记设备。
      </p>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <RefreshStrip active={refreshing} />
      {!fleetMode && (
        <p className="text-sm text-gray-600">
          由<strong>设备运维员</strong>维护运行状态与贴签；列表为<strong>当前工作群</strong>内登记。同一甲方共用 4 位字母登记编号前缀，顺序递增（如 SKAX0001）。
        </p>
      )}
      {fleetMode && (
        <p className="text-sm text-gray-600">
          管理员可见范围内全部登记设备；新增登记仍归属<strong>当前工作群</strong>。
        </p>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}

      {!fleetMode && (
        <div className="bg-white rounded-xl border border-indigo-100 p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAddMode("single")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                addMode === "single"
                  ? "bg-indigo-100 text-indigo-800"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              单台登记
            </button>
            <button
              type="button"
              onClick={() => setAddMode("batch")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                addMode === "batch"
                  ? "bg-indigo-100 text-indigo-800"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              批量登记
            </button>
          </div>

          {addMode === "single" ? (
            <form onSubmit={onAdd} className="space-y-3">
              <p className="text-xs font-medium text-gray-800">新增单台设备</p>
              <label className="block text-xs text-gray-500">关联甲方业务（取公司名）</label>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">请选择甲方业务…</option>
                {demands.map((d) => (
                  <option key={d.id} value={d.id}>
                    {(d.client_company || d.title || "未命名").trim()}
                    {d.device_type?.trim() ? `（${d.device_type.trim()}）` : ""}
                  </option>
                ))}
              </select>
              <input
                placeholder="设备简称（必填），如：产线 A 控制柜"
                value={shortLabel}
                onChange={(e) => setShortLabel(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={adding || demands.length === 0}
                className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {adding ? "提交中…" : "生成登记编号与二维码"}
              </button>
            </form>
          ) : (
            <form onSubmit={onBatchAdd} className="space-y-3">
              <p className="text-xs font-medium text-gray-800">批量新增设备（最多 50 台）</p>
              <p className="text-xs text-gray-500">
                同一甲方、同一设备简称；登记编号按前缀自动递增（如 SKAX0001、SKAX0002…）。简称里不要写 01、02 等序号。
              </p>
              <label className="block text-xs text-gray-500">关联甲方业务</label>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">请选择甲方业务…</option>
                {demands.map((d) => (
                  <option key={d.id} value={d.id}>
                    {(d.client_company || d.title || "未命名").trim()}
                    {d.device_type?.trim() ? `（${d.device_type.trim()}）` : ""}
                  </option>
                ))}
              </select>
              <input
                placeholder="设备简称（必填），如：头戴单目"
                value={shortLabel}
                onChange={(e) => setShortLabel(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <label className="block text-xs text-gray-500">登记数量（1～50）</label>
              <input
                type="number"
                min={1}
                max={50}
                value={batchCount}
                onChange={(e) => setBatchCount(e.target.value)}
                className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                disabled={batchAdding || demands.length === 0}
                className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {batchAdding ? "批量生成中…" : "批量生成登记编号与二维码"}
              </button>
            </form>
          )}

          {demands.length === 0 && (
            <p className="text-xs text-amber-700">当前群尚无甲方业务，请场景业务员先在「场景业务」里添加。</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-800">{fleetMode ? "全量已登记" : "本群已登记"}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-600">
            <span>按甲方</span>
            <select
              value={partyFilter}
              onChange={(e) => setPartyFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs bg-white min-w-[10rem]"
            >
              <option value="all">全部甲方（{rows.length} 台）</option>
              {partyGroups.map((g) => (
                <option key={g.partyDemandId} value={g.partyDemandId}>
                  {g.label}
                  {g.codePrefix ? ` · ${g.codePrefix}` : ""}（{g.devices.length} 台）
                </option>
              ))}
            </select>
          </label>
            <span className="text-xs text-gray-500 max-sm:w-full">含二维码（纯文本）与备查网页链接，可打印贴签或归档：</span>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                if ((!fleetMode && !groupId) || visibleRows.length === 0) return;
                setErr("");
                try {
                  await openManualDevicesPrint("设备贴签列表", fleetMode ? "全量设备" : `工作群 ${groupId}`, visibleRows);
                } catch (e: unknown) {
                  setErr(e instanceof Error ? e.message : "无法打开打印窗口");
                }
              })();
            }}
            disabled={visibleRows.length === 0}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs bg-white hover:bg-gray-50 disabled:opacity-40"
          >
            打印{partyFilter === "all" ? "全部" : "当前甲方"}
          </button>
          <button type="button" onClick={() => void refresh()} className="text-xs text-indigo-700 hover:underline">
            刷新
          </button>
        </div>
      </div>
      {visibleRows.length > 0 && (
        <div className="space-y-2">
          <BatchSelectToolbar
            total={visibleRows.length}
            selectedCount={deviceBatch.count}
            onSelectAll={() => deviceBatch.toggleAll(visibleRowIds)}
            onClear={deviceBatch.clear}
            onDelete={() => void onBatchDelete()}
            deleting={batchDeleting}
            deleteLabel="删除选中设备"
          />
          {deviceBatch.count > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onBatchPrint()}
                className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs bg-white hover:bg-gray-50"
              >
                打印选中（{deviceBatch.count} 台）
              </button>
              {!assignGroupConflict && assignTargetGroupId ? (
                <>
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <span>分配给</span>
                    <select
                      value={assignExecutorId}
                      onChange={(e) => setAssignExecutorId(e.target.value)}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs bg-white min-w-[10rem]"
                    >
                      <option value="">选择执行员…</option>
                      <option value="__idle__">设为空闲</option>
                      {assignExecutors.map((e) => (
                        <option key={e.id} value={e.id}>
                          {executorOptionLabel(e)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={
                      !assignExecutorId ||
                      batchAssigning ||
                      (assignExecutors.length === 0 && assignExecutorId !== "__idle__")
                    }
                    onClick={() => void onBatchAssign()}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40"
                  >
                    {batchAssigning ? "分配中…" : "确认分配"}
                  </button>
                </>
              ) : assignGroupConflict ? (
                <span className="text-xs text-amber-700">所选设备分属不同工作群，请按群分别分配。</span>
              ) : null}
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6 text-center">暂无设备</p>
      ) : visibleGroups.length === 0 ? (
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6 text-center">该甲方下暂无设备</p>
      ) : (
        <div className="space-y-8">
          {visibleGroups.map((group) => (
            <section key={group.partyDemandId} className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-200 pb-2">
                <h3 className="text-sm font-semibold text-gray-900">{group.label}</h3>
                {group.codePrefix && (
                  <span className="text-xs font-mono text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded">
                    编号前缀 {group.codePrefix}
                  </span>
                )}
                <span className="text-xs text-gray-500">{group.devices.length} 台</span>
              </div>
              <ListViewSection
                storageKey={`manual-devices-${group.partyDemandId}`}
                compact={
                  <CompactList>
                    {group.devices.map((r) => (
                      <CompactListRow
                        key={`${r.id}-${r.updated_at}`}
                        primary={
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <BatchSelectCheckbox
                              checked={deviceBatch.isSelected(r.id)}
                              onChange={() => deviceBatch.toggle(r.id)}
                            />
                            <span className="truncate">{formatManualTrackedDeviceLabel(r)}</span>
                          </span>
                        }
                        secondary={`登记编号 ${r.public_code} · 分配：${formatManualDeviceExecutorLabel(r, getAssignment(r))}`}
                        meta={labelExternalDeviceStatus(r.external_status)}
                      />
                    ))}
                  </CompactList>
                }
              >
                <CardList>
                  {group.devices.map((r) => (
                    <CardListItem key={`${r.id}-${r.updated_at}`}>
                      <ManualTrackedDeviceRow
                        row={r}
                        onChanged={() => void refresh()}
                        selected={deviceBatch.isSelected(r.id)}
                        onToggleSelect={() => deviceBatch.toggle(r.id)}
                        executorLabel={formatManualDeviceExecutorLabel(r, getAssignment(r))}
                      />
                    </CardListItem>
                  ))}
                </CardList>
              </ListViewSection>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
