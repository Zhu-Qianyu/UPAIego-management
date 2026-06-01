import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { listDevices, harvestDevice, type Device } from "../api/client";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import { useAuth } from "../auth/AuthContext";
import { readRouteViewCache, routeViewCacheKey, writeRouteViewCache } from "../utils/routeViewCache";
import { amapConfigured, loadAmap } from "../utils/amapLoader";
import { mapCoordSourceFromEnv, toAmapLngLat } from "../utils/mapCoords";

const CN_CENTER: [number, number] = [105.0, 35.0];

function storageRatio(d: Device): number {
  const cap = Number(d.storage_capacity_mb) || 1024;
  const used = Number(d.storage_used_mb) || 0;
  return Math.min(1, Math.max(0, used / cap));
}

function markerPopupHtml(d: Device): string {
  const pct = Math.round(storageRatio(d) * 100);
  const name = d.readable_name.replace(/</g, "&lt;");
  const id = d.device_id.replace(/</g, "&lt;");
  return `<div style="font-size:13px;line-height:1.5"><strong>${name}</strong><br/>存储 ${pct}%<br/><span style="font-size:11px;color:#666">${id}</span></div>`;
}

type MapCacheV1 = { v: 1; devices: Device[] };

/** 数采地图开关：默认关闭（显示暂未上线）。开放时改为 true 并重新构建部署。 */
const MAP_PAGE_LIVE = false;
// 若需用环境变量控制，可改为：
// const MAP_PAGE_LIVE = import.meta.env.VITE_MAP_FEATURE_ENABLED === "true";

function MapComingSoon() {
  return (
    <div className="page-shell max-w-2xl mx-auto px-4 py-12 sm:py-16 text-center">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-sky-500 via-indigo-600 to-violet-700 p-10 sm:p-14 text-white shadow-2xl shadow-indigo-300/40">
        <div className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rounded-full bg-white/20 blur-2xl" aria-hidden />
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-white/20 ring-1 ring-white/30 backdrop-blur-sm">
          <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
        <h1 className="mt-6 text-2xl sm:text-3xl font-bold tracking-tight">数采地图</h1>
        <p className="mt-4 text-lg text-white/90">地图功能暂未上线</p>
        <p className="mt-2 text-sm text-white/70">高德地图 · 设备点位 · 一键采集</p>
        <div className="mt-8 inline-flex items-center gap-2 rounded-full bg-white/15 px-5 py-2 text-sm font-medium ring-1 ring-white/25">
          <span className="h-2 w-2 rounded-full bg-emerald-300 animate-pulse" aria-hidden />
          敬请期待
        </div>
      </div>
    </div>
  );
}

function ExecutorMapPageLive() {
  const { session } = useAuth();
  const location = useLocation();
  const cacheKey = useMemo(
    () => routeViewCacheKey(session?.user?.id, location.pathname),
    [session?.user?.id, location.pathname]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMap.Map | null>(null);
  const amapNsRef = useRef<typeof AMap | null>(null);
  const markersRef = useRef<AMap.Marker[]>([]);
  const infoRef = useRef<AMap.InfoWindow | null>(null);

  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [mapErr, setMapErr] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const fetchedOnceRef = useRef(false);

  const coordSource = mapCoordSourceFromEnv();

  useLayoutEffect(() => {
    if (!cacheKey) return;
    const s = readRouteViewCache<MapCacheV1>(cacheKey);
    if (!s || s.v !== 1) return;
    setDevices(s.devices);
    fetchedOnceRef.current = true;
    setLoading(false);
  }, [cacheKey]);

  const load = useCallback(async () => {
    if (fetchedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    setErr("");
    try {
      const res = await listDevices({ scope: "fleet", limit: 500, offset: 0 });
      setDevices(res.devices);
      fetchedOnceRef.current = true;
      if (cacheKey) writeRouteViewCache(cacheKey, { v: 1, devices: res.devices });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "加载设备失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    if (!MAP_PAGE_LIVE) return;
    void load();
    const t = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!MAP_PAGE_LIVE || !amapConfigured() || !containerRef.current) return;
    let cancelled = false;

    void (async () => {
      setMapErr("");
      try {
        const AMapNS = await loadAmap();
        if (cancelled || !containerRef.current) return;
        amapNsRef.current = AMapNS;
        if (mapRef.current) {
          mapRef.current.destroy();
          mapRef.current = null;
        }
        const map = new AMapNS.Map(containerRef.current, {
          viewMode: "2D",
          zoom: 4,
          center: CN_CENTER,
        });
        map.addControl(new AMapNS.Scale());
        map.addControl(new AMapNS.ToolBar({ position: "RB" }));
        infoRef.current = new AMapNS.InfoWindow({ offset: new AMapNS.Pixel(0, -28) });
        mapRef.current = map;
        setMapReady(true);
      } catch (e: unknown) {
        if (!cancelled) {
          setMapErr(e instanceof Error ? e.message : "高德地图加载失败");
          setMapReady(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      setMapReady(false);
      markersRef.current = [];
      infoRef.current = null;
      amapNsRef.current = null;
      mapRef.current?.destroy();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const AMapNS = amapNsRef.current;
    if (!map || !mapReady || !AMapNS) return;

    for (const m of markersRef.current) {
      m.setMap(null);
    }
    markersRef.current = [];

    const nextMarkers: AMap.Marker[] = [];
    for (const d of devices) {
      if (d.map_lat == null || d.map_lng == null) continue;
      const lat = Number(d.map_lat);
      const lng = Number(d.map_lng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
      const position = toAmapLngLat(lat, lng, coordSource);
      const marker = new AMapNS.Marker({ position, title: d.readable_name });
      marker.on("click", () => {
        infoRef.current?.setContent(markerPopupHtml(d));
        infoRef.current?.open(map, position);
      });
      map.add(marker);
      nextMarkers.push(marker);
    }
    markersRef.current = nextMarkers;

    if (nextMarkers.length > 0) {
      map.setFitView(nextMarkers, false, [48, 48, 48, 48], 14);
    } else {
      map.setZoom(4);
      map.setCenter(CN_CENTER);
    }
  }, [devices, mapReady, coordSource]);

  async function onHarvest(d: Device) {
    setBusyId(d.device_id);
    setErr("");
    try {
      await harvestDevice(d.device_id);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "回收失败（需已在数据库执行 harvest_device RPC）");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && devices.length === 0) return <Spinner />;

  return (
    <div>
      <RefreshStrip active={refreshing} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">数采地图</h1>
          <p className="text-sm text-gray-500 mt-1">
            高德地图展示当前工作群内设备。存储条满后可「回收数据」。设备需有 map_lat / map_lng
            {coordSource === "wgs84" ? "（GPS 将自动转换为高德坐标）" : "（已为 GCJ-02）"}。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="px-4 py-2 rounded-lg border border-gray-300 text-sm hover:bg-gray-50"
        >
          刷新
        </button>
      </div>

      {err && <div className="mb-4 text-sm text-red-600">{err}</div>}

      {!amapConfigured() && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          请在 <code className="bg-white px-1 rounded">frontend/.env</code> 配置{" "}
          <code className="bg-white px-1 rounded">VITE_AMAP_KEY</code> 与{" "}
          <code className="bg-white px-1 rounded">VITE_AMAP_SECURITY_CODE</code>（高德开放平台 Web
          端 Key + 安全密钥），并在控制台绑定本站域名后重启 dev。
        </div>
      )}

      {mapErr && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {mapErr}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-2xl overflow-hidden border border-gray-200 shadow-sm h-[420px] min-h-[320px] relative">
          <div ref={containerRef} className="h-full w-full" />
          {!amapConfigured() && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100 text-sm text-gray-500">
              地图未配置
            </div>
          )}
        </div>
        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {devices.length === 0 && <p className="text-sm text-gray-400">暂无设备</p>}
          {devices.map((d) => {
            const r = storageRatio(d);
            const full = r >= 0.95;
            return (
              <div
                key={d.device_id}
                className={`rounded-xl border p-3 text-sm ${
                  full ? "border-amber-400 bg-amber-50/80" : "border-gray-200 bg-white"
                }`}
              >
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-gray-900">{d.readable_name}</span>
                  {full && <span className="text-amber-800 text-xs font-medium">可收菜</span>}
                </div>
                <p className="text-xs font-mono text-gray-400 mt-1 truncate">{d.device_id}</p>
                <div className="mt-2 h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${full ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.round(r * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {Number(d.storage_used_mb) || 0} / {Number(d.storage_capacity_mb) || 1024} MB
                  {d.map_lat == null || d.map_lng == null ? " · 未标定地图坐标" : ""}
                </p>
                <button
                  type="button"
                  disabled={busyId === d.device_id || !full}
                  onClick={() => void onHarvest(d)}
                  className="mt-2 w-full py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-700"
                >
                  {busyId === d.device_id ? "处理中..." : full ? "回收数据" : "存储未满"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ExecutorMapPage() {
  if (!MAP_PAGE_LIVE) return <MapComingSoon />;
  return <ExecutorMapPageLive />;
}
