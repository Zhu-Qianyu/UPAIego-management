import gcoord from "gcoord";

export type MapCoordSource = "wgs84" | "gcj02";

export function mapCoordSourceFromEnv(): MapCoordSource {
  const v = (import.meta.env.VITE_MAP_COORD_SOURCE as string | undefined)?.trim().toLowerCase();
  return v === "gcj02" ? "gcj02" : "wgs84";
}

/** AMap uses [lng, lat]. Converts WGS84 → GCJ-02 when needed. */
export function toAmapLngLat(lat: number, lng: number, source: MapCoordSource = mapCoordSourceFromEnv()): [number, number] {
  if (source === "gcj02") return [lng, lat];
  const [outLng, outLat] = gcoord.transform([lng, lat], gcoord.WGS84, gcoord.GCJ02);
  return [outLng, outLat];
}
