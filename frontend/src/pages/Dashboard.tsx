import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { listDevices, type Device, type DeviceListScope } from "../api/client";
import {
  formatManualTrackedDeviceLabel,
  listAllManualTrackedDevices,
  listManualTrackedDevices,
  type ManualTrackedDevice,
} from "../api/operations";
import { fetchActiveGroupId } from "../api/groups";
import StatusBadge from "../components/StatusBadge";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import DeviceOnlineRefreshButton from "../components/DeviceOnlineRefreshButton";
import {
  getEffectiveDeviceStatus,
  onlineDeviceAttentionRank,
  resetDeviceConnectivityHysteresis,
} from "../utils/deviceStatus";
import { useAuth } from "../auth/AuthContext";
import { readRouteViewCache, routeViewCacheKey, writeRouteViewCache } from "../utils/routeViewCache";

const PAGE_SIZE = 20;

type DashboardCacheV1 = {
  v: 1;
  devices: Device[];
  total: number;
  page: number;
  statusFilter: string;
  calFilter: string;
};

type DashboardProps = { listScopeOverride?: DeviceListScope };

export default function Dashboard({ listScopeOverride }: DashboardProps = {}) {
  const { profile, session } = useAuth();
  const location = useLocation();
  const listScope: DeviceListScope =
    listScopeOverride ??
    (location.pathname === "/fleet" && profile?.role === "admin" ? "fleet" : "own");

  const cacheKey = useMemo(
    () =>
      routeViewCacheKey(
        session?.user?.id,
        listScopeOverride === "fleet" ? "/devices/manage?tab=fleet" : location.pathname
      ),
    [session?.user?.id, location.pathname, listScopeOverride]
  );

  const [devices, setDevices] = useState<Device[]>([]);
  const [manualRows, setManualRows] = useState<ManualTrackedDevice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [calFilter, setCalFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortCol, setSortCol] = useState<keyof Device>("registered_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  useLayoutEffect(() => {
    if (!cacheKey) return;
    const snap = readRouteViewCache<DashboardCacheV1>(cacheKey);
    if (!snap || snap.v !== 1) return;
    setDevices(snap.devices);
    setTotal(snap.total);
    setPage(snap.page);
    setStatusFilter(snap.statusFilter);
    setCalFilter(snap.calFilter);
    setLoading(false);
  }, [cacheKey]);

  const load = useCallback(async () => {
    const stale = cacheKey ? readRouteViewCache<DashboardCacheV1>(cacheKey) : null;
    if (stale) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await listDevices({
        offset: page * PAGE_SIZE,
        limit: PAGE_SIZE,
        status: statusFilter || undefined,
        calibration_status: calFilter || undefined,
        scope: listScope,
      });
      setDevices(res.devices);
      setTotal(res.total);
      let manuals: ManualTrackedDevice[] = [];
      try {
        if (listScope === "fleet") {
          manuals = await listAllManualTrackedDevices();
        } else {
          const gid = await fetchActiveGroupId();
          if (gid) manuals = await listManualTrackedDevices(gid);
        }
      } catch {
        manuals = [];
      }
      setManualRows(manuals);
      if (cacheKey) {
        writeRouteViewCache(cacheKey, {
          v: 1,
          devices: res.devices,
          total: res.total,
          page,
          statusFilter,
          calFilter,
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, statusFilter, calFilter, listScope, cacheKey]);

  const refreshDeviceStatuses = useCallback(async () => {
    resetDeviceConnectivityHysteresis();
    setNowMs(Date.now());
    await load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const sorted = [...devices].sort((a, b) => {
    const ra = onlineDeviceAttentionRank(a, nowMs);
    const rb = onlineDeviceAttentionRank(b, nowMs);
    if (rb !== ra) return rb - ra;
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
      <RefreshStrip active={refreshing} />
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {listScope === "fleet" ? "全平台设备总览" : "设备总览"}
          </h1>
          <p className="text-xs text-gray-500 mt-1 max-w-xl">
            在线设备列表已优先展示<strong>心跳离线</strong>、<strong>非 active 状态</strong>与<strong>待校准/需重校准</strong>项；外部设备列表优先展示<strong>状态异常</strong>项。
          </p>
          {listScope === "fleet" && (
            <p className="text-xs text-gray-500 mt-1 max-w-xl">
              仅展示当前工作群内成员名下的设备（与入群、群主范围一致）；未入群或群外用户设备不会出现在此列表。
            </p>
          )}
        </div>
        <span className="text-sm text-gray-500 shrink-0 text-right">
          在线 <span className="font-semibold text-gray-800">{total}</span> 台
          {manualRows.length > 0 && (
            <>
              {" "}
              · 外部设备 <span className="font-semibold text-slate-800">{manualRows.length}</span> 台
            </>
          )}
        </span>
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

      {loading && devices.length === 0 ? (
        <Spinner />
      ) : devices.length === 0 && manualRows.length === 0 && !loading ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">暂无设备数据</p>
          <Link to="/devices/manage" className="text-indigo-600 underline text-sm mt-2 inline-block">
            去注册第一台设备
          </Link>
        </div>
      ) : (
        <>
          {devices.length > 0 && (
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
                  ] as [keyof Device, string][]).map(([col, label]) =>
                    col === "status" ? (
                      <th
                        key={col}
                        className="px-4 py-3 text-left font-semibold text-gray-600 select-none"
                      >
                        <div className="flex items-center gap-2">
                          <DeviceOnlineRefreshButton
                            disabled={refreshing || loading}
                            onRefresh={refreshDeviceStatuses}
                          />
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleSort(col)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleSort(col);
                              }
                            }}
                            className="inline-flex cursor-pointer items-center hover:bg-gray-100 rounded px-0.5 -mx-0.5"
                          >
                            {label}
                            <SortIcon col={col} />
                          </span>
                        </div>
                      </th>
                    ) : (
                      <th
                        key={col}
                        onClick={() => toggleSort(col)}
                        className="px-4 py-3 text-left font-semibold text-gray-600 cursor-pointer select-none hover:bg-gray-100"
                      >
                        {label}
                        <SortIcon col={col} />
                      </th>
                    )
                  )}
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
          )}

          {manualRows.length > 0 && (
            <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50/90 shadow-sm">
              <p className="text-xs font-semibold text-slate-800 px-4 py-2 border-b border-slate-200 bg-slate-100/80">
                外部设备（无法连接本站）
              </p>
              <table className="min-w-full divide-y divide-slate-200 text-sm bg-white">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">设备类型</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">登记编号</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">内部 ID</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">状态</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">登记时间</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...manualRows]
                    .sort((a, b) => {
                      if (a.status_ok !== b.status_ok) return (a.status_ok ? 1 : 0) - (b.status_ok ? 1 : 0);
                      return b.created_at.localeCompare(a.created_at);
                    })
                    .map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-medium text-slate-900">{formatManualTrackedDeviceLabel(m)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-indigo-700">{m.public_code}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500 max-w-[140px] truncate" title={m.id}>
                          {m.id}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className={m.status_ok ? "text-emerald-700" : "text-amber-800"}>
                            {m.status_ok ? "正常" : "异常"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {new Date(m.created_at).toLocaleString()}
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
