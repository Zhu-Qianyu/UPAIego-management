import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "qrcode";
import {
  formatManualTrackedDeviceLabel,
  getManualTrackedDeviceByPublicCode,
  normalizeExternalDeviceStatus,
  updateManualTrackedDevice,
  type ExternalDeviceStatus,
  type ManualTrackedDevice,
} from "../api/operations";
import Spinner from "../components/Spinner";
import { buildManualTrackedDeviceQrText } from "../utils/manualDeviceQrPayload";
import { isValidManualDevicePublicCode, normalizeManualDevicePublicCode } from "../utils/deviceCodePrefix";

export default function ManualDeviceByCodePage() {
  const { code } = useParams<{ code: string }>();
  const normalized = normalizeManualDevicePublicCode(code ?? "");
  const codeInvalid = normalized.length > 0 && !isValidManualDevicePublicCode(normalized);
  const [row, setRow] = useState<ManualTrackedDevice | null | undefined>(undefined);
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [localStatus, setLocalStatus] = useState<ExternalDeviceStatus>("normal");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusErr, setStatusErr] = useState("");

  useEffect(() => {
    let cancel = false;
    if (!normalized || codeInvalid) {
      setRow(null);
      return;
    }
    setRow(undefined);
    setErr("");
    getManualTrackedDeviceByPublicCode(normalized)
      .then((r) => {
        if (!cancel) setRow(r);
      })
      .catch((e: unknown) => {
        if (!cancel) {
          setRow(null);
          setErr(e instanceof Error ? e.message : "加载失败");
        }
      });
    return () => {
      cancel = true;
    };
  }, [normalized, codeInvalid]);

  useEffect(() => {
    if (!row) {
      setQr(null);
      return;
    }
    const payload = buildManualTrackedDeviceQrText(row);
    let cancel = false;
    QRCode.toDataURL(payload, { width: 200, margin: 1, errorCorrectionLevel: "M" })
      .then((d) => {
        if (!cancel) setQr(d);
      })
      .catch(() => {
        if (!cancel) setQr(null);
      });
    return () => {
      cancel = true;
    };
  }, [row]);

  useEffect(() => {
    if (row) setLocalStatus(normalizeExternalDeviceStatus(row.external_status));
  }, [row?.id, row?.external_status, row?.updated_at]);

  if (codeInvalid) {
    return (
      <div className="max-w-lg mx-auto py-8 space-y-3">
        <p className="text-sm text-gray-700">登记编号格式无效（应为 10 位十六进制）。</p>
        <Link to="/devices/manage" className="text-sm text-indigo-700 underline">
          返回设备管理
        </Link>
      </div>
    );
  }

  if (row === undefined && normalized) {
    return (
      <div className="max-w-lg mx-auto py-12">
        <Spinner />
      </div>
    );
  }

  if (err) {
    return (
      <div className="max-w-lg mx-auto py-8 space-y-4">
        <p className="text-sm text-red-600">{err}</p>
        <Link to="/devices/manage" className="text-sm text-indigo-700 underline">
          返回设备管理
        </Link>
      </div>
    );
  }

  if (!normalized || !row) {
    return (
      <div className="max-w-lg mx-auto py-8 space-y-3">
        <p className="text-sm text-gray-700">未找到该登记编号，或您不在对应工作群内。</p>
        <Link to="/devices/manage" className="text-sm text-indigo-700 underline">
          返回设备管理
        </Link>
      </div>
    );
  }

  const statusDirty =
    row && normalizeExternalDeviceStatus(localStatus) !== normalizeExternalDeviceStatus(row.external_status);

  async function saveStatus() {
    if (!row) return;
    setStatusErr("");
    setStatusBusy(true);
    try {
      await updateManualTrackedDevice(row.id, { external_status: normalizeExternalDeviceStatus(localStatus) });
      const next = await getManualTrackedDeviceByPublicCode(normalized);
      setRow(next);
    } catch (e: unknown) {
      setStatusErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto py-8 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">离线设备</h1>
      <p className="text-sm text-gray-500 -mt-4">无法连接本站心跳的离线设备，由运维据现场或人员反馈维护状态。</p>
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <p className="font-medium text-gray-900">{formatManualTrackedDeviceLabel(row)}</p>
        <div className="space-y-2">
          <p className="text-sm text-gray-700 font-medium">设备状态</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={localStatus}
              onChange={(e) => setLocalStatus(normalizeExternalDeviceStatus(e.target.value))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              <option value="normal">正常</option>
              <option value="fault">异常（据人员反馈）</option>
              <option value="factory_repair">返厂维修</option>
            </select>
            <button
              type="button"
              disabled={!statusDirty || statusBusy}
              onClick={() => void saveStatus()}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white disabled:opacity-40"
            >
              {statusBusy ? "保存中…" : "保存状态"}
            </button>
          </div>
          {statusErr && <p className="text-xs text-red-600">{statusErr}</p>}
        </div>
        <p className="text-xs text-gray-500 font-mono">
          登记编号：<span className="font-semibold text-indigo-800">{row.public_code}</span>
        </p>
        {qr && (
          <div className="flex flex-col items-center gap-2 pt-2 border-t border-gray-100">
            <img src={qr} alt="" className="w-48 h-48 object-contain" />
            <p className="text-xs text-gray-500 text-center">与贴签一致：扫码显示登记编号与设备信息（纯文本，非网址）</p>
          </div>
        )}
      </div>
      <Link to="/devices/manage" className="text-sm text-indigo-700 underline inline-block">
        返回设备管理
      </Link>
    </div>
  );
}
