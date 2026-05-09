import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { searchDevices, type Device, type DeviceListScope } from "../api/client";
import { formatManualTrackedDeviceLabel, searchManualTrackedDevices, type ManualTrackedDevice } from "../api/operations";
import { fetchActiveGroupId } from "../api/groups";
import { useAuth } from "../auth/AuthContext";
import StatusBadge from "../components/StatusBadge";
import Spinner from "../components/Spinner";
import DeviceOnlineRefreshButton from "../components/DeviceOnlineRefreshButton";
import {
  getEffectiveDeviceStatus,
  onlineDeviceAttentionRank,
  resetDeviceConnectivityHysteresis,
} from "../utils/deviceStatus";

export default function Search({ embedded }: { embedded?: boolean }) {
  const { profile } = useAuth();
  const searchScope: DeviceListScope = profile?.role === "admin" ? "fleet" : "own";

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Device[]>([]);
  const [manualResults, setManualResults] = useState<ManualTrackedDevice[]>([]);
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
      const q = query.trim();
      const groupId = await fetchActiveGroupId();
      const [res, manuals] = await Promise.all([
        searchDevices(q, { scope: searchScope }),
        searchManualTrackedDevices(q, { scope: searchScope, groupId }),
      ]);
      setResults(res.devices);
      setTotal(res.total);
      setManualResults(manuals);
    } catch {
      setResults([]);
      setManualResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  async function refreshSearchStatuses() {
    if (!query.trim()) return;
    resetDeviceConnectivityHysteresis();
    setNowMs(Date.now());
    setLoading(true);
    try {
      const q = query.trim();
      const groupId = await fetchActiveGroupId();
      const [res, manuals] = await Promise.all([
        searchDevices(q, { scope: searchScope }),
        searchManualTrackedDevices(q, { scope: searchScope, groupId }),
      ]);
      setResults(res.devices);
      setTotal(res.total);
      setManualResults(manuals);
    } catch {
      setResults([]);
      setManualResults([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      {!embedded && <h1 className="text-2xl font-bold text-gray-900 mb-6">搜索设备</h1>}
      {embedded && <h2 className="sr-only">搜索设备</h2>}

      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="设备 ID、名称、序列号、备注，或外部设备登记编号 / UUID / 设备简称…"
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
            在线设备 {total} 条；外部设备 {manualResults.length} 条
          </p>

          {results.length === 0 && manualResults.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              没有匹配的设备或外部设备。
            </div>
          ) : (
            <>
            {results.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600 w-24">来源</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">设备名称</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">设备 ID</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">序列号</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">
                      <div className="flex items-center gap-2">
                        <DeviceOnlineRefreshButton
                          disabled={loading}
                          onRefresh={refreshSearchStatuses}
                        />
                        <span>状态</span>
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">校准</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">备注</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[...results]
                    .sort((a, b) => onlineDeviceAttentionRank(b, nowMs) - onlineDeviceAttentionRank(a, nowMs))
                    .map((d) => (
                    <tr key={d.device_id} className="hover:bg-indigo-50/40 transition-colors">
                      <td className="px-4 py-3 text-xs text-gray-500">在线</td>
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

            {manualResults.length > 0 && (
              <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50/80 shadow-sm">
                <p className="text-xs font-semibold text-slate-700 px-4 py-2 border-b border-slate-200">外部设备</p>
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-100/80">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">设备类型</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">登记编号</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">内部 ID</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">状态</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {[...manualResults]
                      .sort((a, b) => {
                        if (a.status_ok !== b.status_ok) return (a.status_ok ? 1 : 0) - (b.status_ok ? 1 : 0);
                        return b.created_at.localeCompare(a.created_at);
                      })
                      .map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-900">{formatManualTrackedDeviceLabel(m)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-indigo-700">{m.public_code}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500 break-all max-w-[200px]">{m.id}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={m.status_ok ? "text-emerald-700" : "text-amber-800"}>
                            {m.status_ok ? "正常" : "异常"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            to={`/devices/manual/${encodeURIComponent(m.public_code)}`}
                            className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                          >
                            打开
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
        </>
      )}
    </div>
  );
}
