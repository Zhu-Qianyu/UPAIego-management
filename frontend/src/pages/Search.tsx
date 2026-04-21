import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { searchDevices, type Device } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import Spinner from "../components/Spinner";
import { getEffectiveDeviceStatus } from "../utils/deviceStatus";

export default function Search() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Device[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await searchDevices(query.trim());
      setResults(res.devices);
      setTotal(res.total);
    } catch {
      setResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">搜索设备</h1>

      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按设备 ID、设备名称、序列号或备注搜索..."
          className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >
          搜索
        </button>
      </form>

      {loading && <Spinner />}

      {!loading && total !== null && (
        <>
          <p className="text-sm text-gray-500 mb-4">
            共找到 {total} 条结果
          </p>

          {results.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              没有匹配的设备。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">设备名称</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">设备 ID</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">序列号</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">状态</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">校准</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">备注</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {results.map((d) => (
                    <tr key={d.device_id} className="hover:bg-indigo-50/40 transition-colors">
                      <td className="px-4 py-3 font-medium text-indigo-700">{d.readable_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{d.device_id}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{d.serial_id ?? "-"}</td>
                      <td className="px-4 py-3"><StatusBadge value={getEffectiveDeviceStatus(d, nowMs)} /></td>
                      <td className="px-4 py-3"><StatusBadge value={d.calibration_status} /></td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">
                        {d.notes ?? "-"}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/devices/${encodeURIComponent(d.device_id)}`}
                          className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                        >
                          查看
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
