import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getDevice, updateDevice, deleteDevice, type Device } from "../api/client";
import { generateQrDataUrl, downloadQr } from "../api/qr";
import StatusBadge from "../components/StatusBadge";
import Spinner from "../components/Spinner";
import { getEffectiveDeviceStatus } from "../utils/deviceStatus";

export default function DeviceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [device, setDevice] = useState<Device | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [nowMs, setNowMs] = useState(Date.now());

  const [editStatus, setEditStatus] = useState("");
  const [editCal, setEditCal] = useState("");
  const [editFw, setEditFw] = useState("");
  const [editNotes, setEditNotes] = useState("");

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    getDevice(id)
      .then((d) => {
        setDevice(d);
        setEditStatus(d.status);
        setEditCal(d.calibration_status);
        setEditFw(d.firmware_version ?? "");
        setEditNotes(d.notes ?? "");
        return generateQrDataUrl(d.device_id, d.readable_name);
      })
      .then(setQrDataUrl)
      .catch(() => setError("未找到该设备，或你没有访问权限"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const timer = window.setInterval(async () => {
      try {
        const latest = await getDevice(id);
        setDevice(latest);
      } catch {
        // Keep current UI state; transient polling errors are non-fatal.
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const updated = await updateDevice(id, {
        status: editStatus,
        calibration_status: editCal,
        firmware_version: editFw || undefined,
        notes: editNotes || undefined,
      });
      setDevice(updated);
      setSuccess("修改已保存");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message ?? "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id || !confirm("确认将该设备设为已退役吗？")) return;
    try {
      await deleteDevice(id);
      navigate("/");
    } catch (err: any) {
      setError(err.message ?? "操作失败，请稍后重试");
    }
  }

  if (loading) return <Spinner />;
  if (!device) return <p className="text-center text-gray-500 py-12">{error || "未找到设备"}</p>;

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={() => navigate("/")} className="text-sm text-indigo-600 hover:underline mb-4 inline-block">
        &larr; 返回设备总览
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Info Card */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-indigo-100 p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{device.readable_name}</h1>
              <p className="text-sm font-mono text-gray-400 mt-1">{device.device_id}</p>
            </div>
            <StatusBadge value={getEffectiveDeviceStatus(device, nowMs)} />
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm mb-6">
            <div>
              <span className="text-gray-500">序列号</span>
              <p className="font-mono text-gray-800 mt-0.5">{device.serial_id ?? "-"}</p>
            </div>
            <div>
              <span className="text-gray-500">注册时间</span>
              <p className="text-gray-800 mt-0.5">
                {device.registered_at ? new Date(device.registered_at).toLocaleString() : "-"}
              </p>
            </div>
            <div>
              <span className="text-gray-500">最近在线</span>
              <p className="text-gray-800 mt-0.5">
                {device.last_seen ? new Date(device.last_seen).toLocaleString() : "-"}
              </p>
            </div>
            <div>
              <span className="text-gray-500">校准状态</span>
              <p className="mt-0.5"><StatusBadge value={device.calibration_status} /></p>
            </div>
            <div>
              <span className="text-gray-500">固件版本</span>
              <p className="text-gray-800 mt-0.5">{device.firmware_version ?? "-"}</p>
            </div>
            <div>
              <span className="text-gray-500">实时 CPU 占用率</span>
              <p className="text-gray-800 mt-0.5">
                {typeof device.calibration?.runtime?.cpu_usage_percent === "number"
                  ? `${device.calibration.runtime.cpu_usage_percent.toFixed(1)}%`
                  : "-"}
              </p>
            </div>
            <div>
              <span className="text-gray-500">最新图片帧时间</span>
              <p className="text-gray-800 mt-0.5">
                {device.calibration?.runtime?.latest_frame_at
                  ? new Date(device.calibration.runtime.latest_frame_at).toLocaleString()
                  : "-"}
              </p>
            </div>
          </div>

          <div className="mb-6">
            <span className="text-gray-500 text-sm">设备实时图片帧（每分钟更新）</span>
            {device.calibration?.runtime?.latest_frame_jpeg_base64 ? (
              <img
                src={`data:image/jpeg;base64,${device.calibration.runtime.latest_frame_jpeg_base64}`}
                alt="设备最新帧"
                className="mt-2 w-full max-w-xl rounded-xl border border-gray-200"
              />
            ) : (
              <p className="text-sm text-gray-400 mt-2">暂未收到图片帧</p>
            )}
          </div>

          {device.notes && (
            <div className="text-sm">
              <span className="text-gray-500">备注</span>
              <p className="text-gray-700 mt-0.5 whitespace-pre-wrap">{device.notes}</p>
            </div>
          )}

          {/* Edit Form */}
          <div className="border-t border-gray-100 mt-6 pt-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">编辑设备信息</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">状态</label>
                <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="active">正常</option>
                  <option value="inactive">未激活</option>
                  <option value="maintenance">维护中</option>
                  <option value="retired">已退役</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">校准状态</label>
                <select value={editCal} onChange={(e) => setEditCal(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="pending">待校准</option>
                  <option value="calibrated">已校准</option>
                  <option value="needs_recalibration">需重校准</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">固件版本</label>
                <input value={editFw} onChange={(e) => setEditFw(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">备注</label>
              <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>

            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            {success && <p className="text-sm text-green-600 mb-3">{success}</p>}

            <div className="flex gap-3">
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {saving ? "保存中..." : "保存修改"}
              </button>
              <button onClick={handleDelete}
                className="px-4 py-2 bg-red-50 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors">
                设为退役
              </button>
            </div>
          </div>
        </div>

        {/* QR Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 p-6 flex flex-col items-center">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">设备二维码</h2>
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="设备二维码"
              className="w-48 h-48 rounded-xl border border-gray-200 mb-4"
            />
          ) : (
            <div className="w-48 h-48 rounded-xl border border-gray-200 mb-4 flex items-center justify-center text-gray-300">
              加载中...
            </div>
          )}
          <button
            onClick={() => downloadQr(device.device_id, device.readable_name)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            下载二维码
          </button>
          <p className="text-xs text-gray-400 mt-3 text-center">
            扫码即可快速识别设备信息
          </p>
        </div>
      </div>
    </div>
  );
}
