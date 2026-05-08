import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { listDevices, harvestDevice, type Device } from "../api/client";
import Spinner from "../components/Spinner";

L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const CN_CENTER: L.LatLngExpression = [35.0, 105.0];

function storageRatio(d: Device): number {
  const cap = Number(d.storage_capacity_mb) || 1024;
  const used = Number(d.storage_used_mb) || 0;
  return Math.min(1, Math.max(0, used / cap));
}

export default function ExecutorMapPage() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersLayer = useRef<L.LayerGroup | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await listDevices({ scope: "fleet", limit: 500, offset: 0 });
      setDevices(res.devices);
    } catch (e: any) {
      setErr(e.message ?? "加载设备失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView(CN_CENTER, 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    markersLayer.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">数采地图</h1>
          <p className="text-sm text-gray-500 mt-1">
            存储条满后点击「回收数据」清空计数。设备需在库中有经纬度（map_lat / map_lng）；存储由板端上报或手工维护。
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
