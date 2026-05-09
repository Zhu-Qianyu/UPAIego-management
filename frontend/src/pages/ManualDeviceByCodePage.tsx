import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import QRCode from "qrcode";
import { formatManualTrackedDeviceLabel, getManualTrackedDeviceByPublicCode, type ManualTrackedDevice } from "../api/operations";
import Spinner from "../components/Spinner";

function stickerLandingUrl(publicCode: string): string {
  const base = `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/+$/, "");
  return `${base}/devices/manual/${encodeURIComponent(publicCode)}`;
}

export default function ManualDeviceByCodePage() {
  const { code } = useParams<{ code: string }>();
  const normalized = (code ?? "").trim().toUpperCase();
  const codeInvalid = normalized.length > 0 && !/^[0-9A-F]{10}$/.test(normalized);
  const [row, setRow] = useState<ManualTrackedDevice | null | undefined>(undefined);
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const url = useMemo(() => (normalized ? stickerLandingUrl(normalized) : ""), [normalized]);

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
    if (!url || !row) {
      setQr(null);
      return;
    }
    let cancel = false;
    QRCode.toDataURL(url, { width: 200, margin: 1, errorCorrectionLevel: "M" })
      .then((d) => {
        if (!cancel) setQr(d);
      })
      .catch(() => {
        if (!cancel) setQr(null);
      });
    return () => {
      cancel = true;
    };
  }, [url, row]);

  if (codeInvalid) {
    return (
      <div className="max-w-lg mx-auto py-8 space-y-3">
        <p className="text-sm text-gray-700">登记编号格式无效（应为 10 位十六进制）。</p>
        <Link to="/devices/manage?tab=offline" className="text-sm text-indigo-700 underline">
          返回离线登记
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
        <Link to="/devices/manage?tab=offline" className="text-sm text-indigo-700 underline">
          返回离线登记
        </Link>
      </div>
    );
  }

  if (!normalized || !row) {
    return (
      <div className="max-w-lg mx-auto py-8 space-y-3">
        <p className="text-sm text-gray-700">未找到该登记编号，或您不在对应工作群内。</p>
        <Link to="/devices/manage?tab=offline" className="text-sm text-indigo-700 underline">
          返回离线登记
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-8 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">离线登记设备</h1>
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-4">
        <p className="font-medium text-gray-900">{formatManualTrackedDeviceLabel(row)}</p>
        <p className="text-sm text-gray-600">
          运行状态：
          <span className={row.status_ok ? "text-emerald-700 font-medium" : "text-amber-800 font-medium"}>
            {row.status_ok ? "正常" : "异常"}
          </span>
        </p>
        <p className="text-xs text-gray-500 font-mono">
          登记编号：<span className="font-semibold text-indigo-800">{row.public_code}</span>
        </p>
        {qr && (
          <div className="flex flex-col items-center gap-2 pt-2 border-t border-gray-100">
            <img src={qr} alt="" className="w-48 h-48 object-contain" />
            <p className="text-xs text-gray-500 text-center">与贴签相同的链接二维码</p>
          </div>
        )}
      </div>
      <Link to="/devices/manage?tab=offline" className="text-sm text-indigo-700 underline inline-block">
        返回设备管理 · 离线登记
      </Link>
    </div>
  );
}
