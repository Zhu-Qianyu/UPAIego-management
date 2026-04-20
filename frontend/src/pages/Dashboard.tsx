import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { listDevices, type Device } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import Spinner from "../components/Spinner";

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
        <h1 className="text-2xl font-bold text-gray-900">Device Dashboard</h1>
        <span className="text-sm text-gray-500">{total} device{total !== 1 && "s"} total</span>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="maintenance">Maintenance</option>
          <option value="retired">Retired</option>
        </select>
        <select
          value={calFilter}
          onChange={(e) => { setCalFilter(e.target.value); setPage(0); }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All calibration</option>
          <option value="pending">Pending</option>
          <option value="calibrated">Calibrated</option>
          <option value="needs_recalibration">Needs recalibration</option>
        </select>
      </div>

      {loading ? (
        <Spinner />
      ) : devices.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No devices found</p>
          <Link to="/register" className="text-indigo-600 underline text-sm mt-2 inline-block">
            Register your first device
          </Link>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {([
                    ["readable_name", "Name"],
                    ["device_id", "Device ID"],
                    ["serial_id", "Serial ID"],
                    ["status", "Status"],
                    ["calibration_status", "Calibration"],
                    ["registered_at", "Registered"],
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
                    <td className="px-4 py-3"><StatusBadge value={d.status} /></td>
                    <td className="px-4 py-3"><StatusBadge value={d.calibration_status} /></td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {d.registered_at ? new Date(d.registered_at).toLocaleDateString() : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/devices/${encodeURIComponent(d.device_id)}`}
                        className="text-indigo-600 hover:text-indigo-800 text-xs font-medium"
                      >
                        View
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
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {page + 1} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage(page + 1)}
                className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-40 hover:bg-gray-100"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
