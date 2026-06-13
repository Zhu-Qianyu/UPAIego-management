import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  externalDeviceStatusAttentionRank,
  formatManualTrackedDeviceLabel,
  labelExternalDeviceStatus,
  searchManualTrackedDevices,
  type ManualTrackedDevice,
} from "../api/operations";
import { fetchActiveGroupId } from "../api/groups";
import { useAuth } from "../auth/AuthContext";
import Spinner from "../components/Spinner";

export default function Search({ embedded }: { embedded?: boolean }) {
  const { hasRole } = useAuth();
  const searchScope = hasRole("admin") ? "fleet" : "own";

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ManualTrackedDevice[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const sortedResults = useMemo(
    () =>
      [...results].sort((a, b) => {
        const ra = externalDeviceStatusAttentionRank(a.external_status);
        const rb = externalDeviceStatusAttentionRank(b.external_status);
        if (rb !== ra) return rb - ra;
        return b.created_at.localeCompare(a.created_at);
      }),
    [results]
  );

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const groupId = await fetchActiveGroupId();
      const rows = await searchManualTrackedDevices(query.trim(), { scope: searchScope, groupId });
      setResults(rows);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full min-w-0">
      {!embedded && <h1 className="text-2xl font-bold text-gray-900 mb-6">搜索设备</h1>}
      {embedded && <h2 className="sr-only">搜索设备</h2>}

      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="登记编号、设备简称、甲方名称或内部 ID…"
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

      {!loading && searched && (
        <>
          <p className="text-sm text-gray-500 mb-4">共 {sortedResults.length} 条</p>

          {sortedResults.length === 0 ? (
            <div className="text-center py-12 text-gray-400">没有匹配的设备。</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">设备类型</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">登记编号</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">内部 ID</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">状态</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedResults.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-900">{formatManualTrackedDeviceLabel(m)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-indigo-700">{m.public_code}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 break-all max-w-[200px]">{m.id}</td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={
                            m.external_status === "normal"
                              ? "text-emerald-700"
                              : m.external_status === "fault"
                                ? "text-amber-800"
                                : "text-violet-800"
                          }
                        >
                          {labelExternalDeviceStatus(m.external_status)}
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
    </div>
  );
}
