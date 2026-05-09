import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { listDevices, harvestDevice, type Device } from "../api/client";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import { useAuth } from "../auth/AuthContext";
import { readRouteViewCache, routeViewCacheKey, writeRouteViewCache } from "../utils/routeViewCache";

L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const CN_CENTER: L.LatLngExpression = [35.0, 105.0];

/** 默认 OSM；国内若底图全灰，可在 .env 设 VITE_MAP_TILE_URL 为下方 Esri 示例（无需 Key）。 */
const DEFAULT_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_TILE_ATTRIB =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function tileLayerOptions(url: string): L.TileLayerOptions {
  const envAttrib = (import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined)?.trim();
  const attribution =
    envAttrib ||
    (url.includes("openstreetmap") ? DEFAULT_TILE_ATTRIB
      : url.includes("arcgisonline.com") ? "Tiles &copy; Esri"
      : "Map");
  const opt: L.TileLayerOptions = { attribution };
  if (url.includes("{s}")) {
    if (url.includes("openstreetmap")) opt.subdomains = "abc";
    else if (url.includes("cartocdn")) opt.subdomains = "abcd";
  }
  return opt;
}

function storageRatio(d: Device): number {
  const cap = Number(d.storage_capacity_mb) || 1024;
  const used = Number(d.storage_used_mb) || 0;
  return Math.min(1, Math.max(0, used / cap));
}

type MapCacheV1 = { v: 1; devices: Device[] };

export default function ExecutorMapPage() {
  const { session } = useAuth();
  const location = useLocation();
  const cacheKey = useMemo(
    () => routeViewCacheKey(session?.user?.id, location.pathname),
    [session?.user?.id, location.pathname]
  );

  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [tileHint, setTileHint] = useState("");
  const fetchedOnceRef = useRef(false);

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
    } catch (e: any) {
      setErr(e.message ?? "加载设备失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView(CN_CENTER, 4);
    const tileUrl = (import.meta.env.VITE_MAP_TILE_URL as string | undefined)?.trim() || DEFAULT_TILE_URL;
    const base = L.tileLayer(tileUrl, tileLayerOptions(tileUrl)).addTo(map);
    let tileErrors = 0;
    base.on("tileerror", () => {
      tileErrors += 1;
      if (tileErrors === 3) {
        setTileHint(
          "底图瓦片多次加载失败（常见于网络无法访问 OpenStreetMap）。请在 frontend/.env 设置 VITE_MAP_TILE_URL 为文档中的备用地址后重启 dev。"
        );
      }
    });
    markersLayer.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const relayout = () => {
      map.invalidateSize({ animate: false });
    };
    requestAnimationFrame(() => requestAnimationFrame(relayout));
    window.addEventListener("resize", relayout);
    return () => {
      window.removeEventListener("resize", relayout);
      map.remove();
      mapRef.current = null;
      markersLayer.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markersLayer.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const withCoords = devices.filter((d) => d.map_lat != null && d.map_lng != null);
    const corners: L.LatLngTuple[] = [];
    for (const d of withCoords) {
      const lat = Number(d.map_lat);
      const lng = Number(d.map_lng);
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
      const ll: L.LatLngTuple = [lat, lng];
      corners.push(ll);
      const m = L.marker(ll).addTo(layer);
      const pct = Math.round(storageRatio(d) * 100);
      m.bindPopup(
        `<strong>${d.readable_name}</strong><br/>存储 ${pct}%<br/><span style="font-size:11px;color:#666">${d.device_id}</span>`
      );
    }
    if (corners.length > 0) {
      map.fitBounds(L.latLngBounds(corners), { padding: [40, 40], maxZoom: 14 });
    }
  }, [devices]);

  async function onHarvest(d: Device) {
    setBusyId(d.device_id);
    setErr("");
    try {
      await harvestDevice(d.device_id);
      await load();
    } catch (e: any) {
      setErr(e.message ?? "回收失败（需已在数据库执行 harvest_device RPC）");
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
            仅展示当前工作群内成员名下设备。存储条满后点击「回收数据」清空计数。设备需在库中有经纬度（map_lat /
            map_lng）；存储由板端上报或手工维护。
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
      {tileHint && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {tileHint}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 rounded-2xl overflow-hidden border border-gray-200 shadow-sm h-[420px] min-h-[320px]">
          <div ref={containerRef} className="h-full w-full z-0" />
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
