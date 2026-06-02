import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { registerDevice, type Device, type DeviceListScope } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { generateQrDataUrl, downloadQr } from "../api/qr";
import Spinner from "../components/Spinner";
import ManualDevicesTab from "./ManualDevicesTab";

export default function Register({ embedded }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const listScope: DeviceListScope = profile?.role === "admin" ? "fleet" : "own";

  const [serialId, setSerialId] = useState("");

  const [registered, setRegistered] = useState<Device | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!registered) return;
    generateQrDataUrl(registered.device_id, registered.readable_name, registered.serial_id).then(setQrDataUrl);
  }, [registered]);

  async function handleRegister() {
    setLoading(true);
    setError("");
    try {
      const device = await registerDevice({
        serial_id: serialId.trim() || undefined,
        listScope,
      });
      setRegistered(device);
    } catch (err: any) {
      setError(err.message ?? "注册失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  if (registered) {
    return (
      <div className={embedded ? "w-full min-w-0 max-w-lg" : "max-w-lg mx-auto"}>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-green-600 text-5xl mb-4">&#10003;</div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">设备注册成功</h2>
          <p className="text-gray-500 mb-2">
            <span className="font-semibold text-indigo-700">{registered.readable_name}</span>
            {" "}已添加到你的设备列表。
          </p>
          <p className="text-xs text-gray-400 mb-6 font-mono">{registered.device_id}</p>
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt="QR Code"
              className="mx-auto w-48 h-48 rounded-xl border border-gray-200 mb-4"
            />
          )}
          <p className="text-xs text-gray-400 mb-6">
            二维码为纯文本：扫码可显示设备名称、设备ID与序列号（非网址）。请下载并打印后贴到设备上。
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() =>
                downloadQr(registered.device_id, registered.readable_name, registered.serial_id)
              }
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              下载二维码
            </button>
            <button
              onClick={() => navigate(`/devices/${encodeURIComponent(registered.device_id)}`)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              查看设备
            </button>
            <button
              onClick={() => {
                setRegistered(null);
                setQrDataUrl(null);
                setSerialId("");
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              继续注册
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? "w-full min-w-0" : "max-w-2xl mx-auto"}>
      {!embedded && <h1 className="text-2xl font-bold text-gray-900 mb-6">注册新设备</h1>}
      {embedded && <h2 className="sr-only">注册新设备</h2>}

      <p className="text-sm text-gray-500 mb-4">
        注册可接入本站心跳的<strong>联网设备</strong>。你可以选填设备序列号（CPU Serial），可通过 CLI 获取：&nbsp;
        <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">python cli.py detect --port /dev/ttyUSB0</code>
      </p>

      <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">联网设备信息</h2>
        <p className="text-xs text-gray-400 mb-4">
          系统会自动生成唯一设备 ID 和设备名称。
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">序列号（可选）</label>
            <input
              value={serialId}
              onChange={(e) => setSerialId(e.target.value)}
              placeholder="例如：通过 rk_board_config.py 获取的 CPU 序列号"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-6 border-t border-gray-100 pt-4">
          {loading ? (
            <Spinner />
          ) : (
            <button
              onClick={handleRegister}
              className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              确认注册设备
            </button>
          )}
        </div>
      </div>

      <div className="mt-10 pt-8 border-t border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">离线设备（无法连接本站）</h2>
        <p className="text-sm text-gray-500 mb-4">
          无法接入本站心跳时，在此登记为<strong>离线设备</strong>：系统分配<strong>登记编号与二维码</strong>，类型由<strong>甲方业务 + 设备简称</strong>组成；可在详情页或此处更新运行状态。仅显示与登记<strong>本工作群</strong>内的离线设备。
        </p>
        <ManualDevicesTab />
      </div>
    </div>
  );
}
