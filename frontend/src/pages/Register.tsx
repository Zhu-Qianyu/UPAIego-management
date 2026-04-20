import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { registerDevice, type Device } from "../api/client";
import { generateQrDataUrl, downloadQr } from "../api/qr";
import Spinner from "../components/Spinner";

export default function Register() {
  const navigate = useNavigate();

  const [serialId, setSerialId] = useState("");

  const [registered, setRegistered] = useState<Device | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!registered) return;
    generateQrDataUrl(
      registered.device_id,
      registered.readable_name
    ).then(setQrDataUrl);
  }, [registered]);

  async function handleRegister() {
    setLoading(true);
    setError("");
    try {
      const device = await registerDevice({
        serial_id: serialId.trim() || undefined,
      });
      setRegistered(device);
    } catch (err: any) {
      setError(err.message ?? "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  if (registered) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="text-green-600 text-5xl mb-4">&#10003;</div>
          <h2 className="text-xl font-bold text-gray-900 mb-1">Device Registered</h2>
          <p className="text-gray-500 mb-2">
            <span className="font-semibold text-indigo-700">{registered.readable_name}</span>
            {" "}has been added to the fleet.
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
            Print this QR code and attach it to the device.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() =>
                downloadQr(
                  registered.device_id,
                  registered.readable_name
                )
              }
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              Download QR
            </button>
            <button
              onClick={() => navigate(`/devices/${encodeURIComponent(registered.device_id)}`)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              View Device
            </button>
            <button
              onClick={() => {
                setRegistered(null);
                setQrDataUrl(null);
                setSerialId("");
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Register Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Register New Device</h1>

      <p className="text-sm text-gray-500 mb-4">
        Optionally provide the Serial ID (CPU serial) from the board using the CLI:&nbsp;
        <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">python cli.py detect --port /dev/ttyUSB0</code>
      </p>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Device Information</h2>
        <p className="text-xs text-gray-400 mb-4">
          A unique Device ID and readable name will be generated automatically.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Serial ID (optional)</label>
            <input
              value={serialId}
              onChange={(e) => setSerialId(e.target.value)}
              placeholder="CPU serial number from rk_board_config.py"
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
              Register Device
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
