import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { listDevices, type Device } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import Spinner from "../components/Spinner";
import { getEffectiveDeviceStatus } from "../utils/deviceStatus";

const PAGE_SIZE = 20;

export default function Dashboard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [calFilter, setCalFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState<keyof Device>("registered_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listDevices({
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        status: statusFilter || undefined,
        calibration_status: calFilter || undefined,
      });
      setDevices(res.devices);
      setTotal(res.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, calFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const sorted = [...devices].sort((a, b) => {
    const va = (a[sortCol] as string) ?? "";
    const vb = (b[sortCol] as string) ?? "";
    return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
  });

  const totalPages = Math.ceil(total / PAGE_SIZE);

  function toggleSort(col: keyof Device) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else {
      setSortCol(col);
      setSortAsc(true);
    }
  }

  function SortIcon({ col }: { col: keyof Device }) {
    if (sortCol !== col) return <span className="text-gray-300 ml-1">&#x25B4;&#x25BE;</span>;
    return <span className="ml-1 text-indigo-500">{sortAsc ? "\u25B4" : "\u25BE"}</span>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">设备总览</h1>
        <span className="text-sm text-gray-500">共 {total} 台设备</span>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4 bg-white border border-indigo-100 rounded-xl p-3 shadow-sm">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="inactive">未激活</option>
          <option value="maintenance">维护中</option>
          <option value="retired">已退役</option>
        </select>
        <select
          value={calFilter}
          onChange={(e) => { setCalFilter(e.target.value); setPage(0); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">全部校准状态</option>
          <option value="pending">待校准</option>
          <option value="calibrated">已校准</option>
          <option value="needs_recalibration">需重校准</option>
        </select>
      </div>

      {loading ? (
        <Spinner />
      ) : devices.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">暂无设备数据</p>
          <Link to="/register" className="text-indigo-600 underline text-sm mt-2 inline-block">
            去注册第一台设备
          </Link>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {([
                    ["readable_name", "设备名称"],
                    ["device_id", "设备 ID"],
                    ["serial_id", "序列号"],
                    ["status", "状态"],
                    ["calibration_status", "校准"],
                    ["registered_at", "注册时间"],
                  ] as [keyof Device, string][]).map(([col, label]) => (
                    <th
                      key={col}
                      onClick={() => toggleSort(col)}
                      className="px-4 py-3 text-left font-semibold text-gray-600 cursor-pointer select-none hover:bg-gray-100"
                    >
                      {label}
                      <SortIcon col={col} />
                    </th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((d) => (
                  <tr key={d.device_id} className="hover:bg-indigo-50/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-indigo-700">{d.readable_name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{d.device_id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{d.serial_id ?? "-"}</td>
                    <td className="px-4 py-3"><StatusBadge value={getEffectiveDeviceStatus(d, nowMs)} /></td>
                    <td className="px-4 py-3"><StatusBadge value={d.calibration_status} /></td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {d.registered_at ? new Date(d.registered_at).toLocaleDateString() : "-"}
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
                className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40 hover:bg-gray-100"
              >
                上一页
              </button>
              <span className="text-sm text-gray-600">
                第 {page + 1} / {totalPages} 页
              </span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
                className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40 hover:bg-gray-100"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
