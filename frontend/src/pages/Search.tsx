import { useState } from "react";
import { Link } from "react-router-dom";
import { searchDevices, type Device } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import Spinner from "../components/Spinner";

export default function Search() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Device[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

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
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Search Devices</h1>

      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by device ID, name, serial ID, or notes..."
          className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
        >
          Search
        </button>
      </form>

      {loading && <Spinner />}

      {!loading && total !== null && (
        <>
          <p className="text-sm text-gray-500 mb-4">
            {total} result{total !== 1 && "s"} found
          </p>

          {results.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              No devices match your query.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Name</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Device ID</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Serial ID</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Status</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Calibration</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Notes</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {results.map((d) => (
                    <tr key={d.device_id} className="hover:bg-indigo-50/40 transition-colors">
                      <td className="px-4 py-3 font-medium text-indigo-700">{d.readable_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{d.device_id}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{d.serial_id ?? "-"}</td>
                      <td className="px-4 py-3"><StatusBadge value={d.status} /></td>
                      <td className="px-4 py-3"><StatusBadge value={d.calibration_status} /></td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">
                        {d.notes ?? "-"}
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
          )}
        </>
      )}
    </div>
  );
}
