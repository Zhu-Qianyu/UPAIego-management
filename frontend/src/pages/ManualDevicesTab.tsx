import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  createManualTrackedDevice,
  deleteManualTrackedDevice,
  formatManualTrackedDeviceLabel,
  labelExternalDeviceStatus,
  listManualTrackedDevices,
  listPartyDemands,
  updateManualTrackedDevice,
  normalizeExternalDeviceStatus,
  type ExternalDeviceStatus,
  type ManualTrackedDevice,
  type PartyDemand,
} from "../api/operations";
import { fetchActiveGroupId } from "../api/groups";
import { CardList, CardListItem, CompactList, CompactListRow, ListViewSection } from "../components/ui/PageLayout";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import { openManualDevicesPrint } from "../utils/manualDevicesExport";
import { buildManualTrackedDeviceQrText } from "../utils/manualDeviceQrPayload";

function ManualTrackedDeviceRow({
  row,
  onChanged,
}: {
  row: ManualTrackedDevice;
  onChanged: () => void;
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
    QRCode.toDataURL(qrPayload, { width: 168, margin: 1, errorCorrectionLevel: "M" })
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
      <div className="shrink-0 flex flex-col items-center gap-1">
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
              if (!confirm("删除该离线设备登记？登记编号将作废。")) return;
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
            删除离线设备
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ManualDevicesTab() {
  const [groupId, setGroupId] = useState<string | null>(null);
  const [rows, setRows] = useState<ManualTrackedDevice[]>([]);
  const [demands, setDemands] = useState<PartyDemand[]>([]);
  const [boot, setBoot] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [partyId, setPartyId] = useState("");
  const [shortLabel, setShortLabel] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const gid = await fetchActiveGroupId();
    setGroupId(gid);
    if (!gid) {
      setRows([]);
      setDemands([]);
      return;
    }
    const [list, pd] = await Promise.all([listManualTrackedDevices(gid), listPartyDemands(gid)]);
    setRows(list);
    setDemands(pd);
  }, []);

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

  if (!groupId) {
    return (
      <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
        请先加入已审批的工作群组后再登记离线设备。
      </p>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <RefreshStrip active={refreshing} />
      <p className="text-sm text-gray-600">
        <strong>离线设备</strong>指无法接入本站心跳的设备，由<strong>设备运维员</strong>据现场或人员反馈维护。
        每条保留<strong>运行是否正常</strong>、系统分配的<strong>登记编号与二维码</strong>，以及由<strong>甲方公司名 + 设备简称</strong>组成的设备类型（甲方请在「场景业务 → 甲方业务」中维护）。列表仅展示<strong>当前工作群</strong>内登记。
      </p>
      {err && <p className="text-sm text-red-600">{err}</p>}

      <form onSubmit={onAdd} className="bg-white rounded-xl border border-indigo-100 p-4 space-y-3">
        <p className="text-xs font-medium text-gray-800">新增离线设备</p>
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
        {demands.length === 0 && (
          <p className="text-xs text-amber-700">当前群尚无甲方业务，请场景业务员先在「场景业务」里添加。</p>
        )}
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-800">本群已登记</h2>
        <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 max-sm:w-full">含二维码（纯文本）与备查网页链接，可打印贴签或归档：</span>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                if (!groupId) return;
                setErr("");
                try {
                  await openManualDevicesPrint("离线设备贴签列表", `工作群 ${groupId}`, rows);
                } catch (e: unknown) {
                  setErr(e instanceof Error ? e.message : "无法打开打印窗口");
                }
              })();
            }}
            className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs bg-white hover:bg-gray-50"
          >
            打印列表
          </button>
          <button type="button" onClick={() => void refresh()} className="text-xs text-indigo-700 hover:underline">
            刷新
          </button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6 text-center">暂无离线设备</p>
      ) : (
        <ListViewSection
          storageKey="manual-devices"
          compact={
            <CompactList>
              {rows.map((r) => (
                <CompactListRow
                  key={`${r.id}-${r.updated_at}`}
                  primary={formatManualTrackedDeviceLabel(r)}
                  secondary={`登记编号 ${r.public_code}`}
                  meta={labelExternalDeviceStatus(r.external_status)}
                />
              ))}
            </CompactList>
          }
        >
        <CardList>
          {rows.map((r) => (
            <CardListItem key={`${r.id}-${r.updated_at}`}>
              <ManualTrackedDeviceRow row={r} onChanged={() => void refresh()} />
            </CardListItem>
          ))}
        </CardList>
        </ListViewSection>
      )}
    </div>
  );
}
