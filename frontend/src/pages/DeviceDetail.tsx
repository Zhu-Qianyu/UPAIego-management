import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getDevice, updateDevice, deleteDevice, type Device } from "../api/client";
import { generateQrDataUrl, downloadQr } from "../api/qr";
import StatusBadge from "../components/StatusBadge";
import Spinner from "../components/Spinner";

export default function DeviceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [device, setDevice] = useState<Device | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
      .catch(() => setError("Device not found"))
      .finally(() => setLoading(false));
  }, [id]);

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
      setSuccess("Changes saved.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message ?? "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id || !confirm("Retire this device? It will be soft-deleted.")) return;
    try {
      await deleteDevice(id);
      navigate("/");
    } catch (err: any) {
      setError(err.message ?? "Delete failed");
    }
  }

  if (loading) return <Spinner />;
  if (!device) return <p className="text-center text-gray-500 py-12">{error || "Device not found"}</p>;

  return (
    <div className="max-w-4xl mx-auto">
      <button onClick={() => navigate("/")} className="text-sm text-indigo-600 hover:underline mb-4 inline-block">
        &larr; Back to Dashboard
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Info Card */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{device.readable_name}</h1>
              <p className="text-sm font-mono text-gray-400 mt-1">{device.device_id}</p>
            </div>
            <StatusBadge value={device.status} />
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm mb-6">
            <div>
              <span className="text-gray-500">Serial ID</span>
              <p className="font-mono text-gray-800 mt-0.5">{device.serial_id ?? "-"}</p>
            </div>
            <div>
              <span className="text-gray-500">Registered</span>
              <p className="text-gray-800 mt-0.5">
                {device.registered_at ? new Date(device.registered_at).toLocaleString() : "-"}
              </p>
            </div>
            <div>
              <span className="text-gray-500">Last Seen</span>
              <p className="text-gray-800 mt-0.5">
                {device.last_seen ? new Date(device.last_seen).toLocaleString() : "-"}
              </p>
            </div>
            <div>
              <span className="text-gray-500">Calibration</span>
              <p className="mt-0.5"><StatusBadge value={device.calibration_status} /></p>
            </div>
            <div>
              <span className="text-gray-500">Firmware</span>
              <p className="text-gray-800 mt-0.5">{device.firmware_version ?? "-"}</p>
            </div>
          </div>

          {device.notes && (
            <div className="text-sm">
              <span className="text-gray-500">Notes</span>
              <p className="text-gray-700 mt-0.5 whitespace-pre-wrap">{device.notes}</p>
            </div>
          )}

          {/* Edit Form */}
          <div className="border-t border-gray-100 mt-6 pt-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Edit Device</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="retired">Retired</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Calibration</label>
                <select value={editCal} onChange={(e) => setEditCal(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="pending">Pending</option>
                  <option value="calibrated">Calibrated</option>
                  <option value="needs_recalibration">Needs Recalibration</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Firmware Version</label>
                <input value={editFw} onChange={(e) => setEditFw(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
              <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>

            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            {success && <p className="text-sm text-green-600 mb-3">{success}</p>}

            <div className="flex gap-3">
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                {saving ? "Saving..." : "Save Changes"}
              </button>
              <button onClick={handleDelete}
                className="px-4 py-2 bg-red-50 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition-colors">
                Retire Device
              </button>
            </div>
          </div>
        </div>

        {/* QR Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 flex flex-col items-center">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">QR Code</h2>
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="Device QR Code"
              className="w-48 h-48 rounded-xl border border-gray-200 mb-4"
            />
          ) : (
            <div className="w-48 h-48 rounded-xl border border-gray-200 mb-4 flex items-center justify-center text-gray-300">
              Loading...
            </div>
          )}
          <button
            onClick={() => downloadQr(device.device_id, device.readable_name)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            Download QR
          </button>
          <p className="text-xs text-gray-400 mt-3 text-center">
            Scan to identify this device
          </p>
        </div>
      </div>
    </div>
  );
}
