/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_AMAP_KEY?: string;
  readonly VITE_AMAP_SECURITY_CODE?: string;
  /** Device coordinates in DB: wgs84 (GPS) or gcj02. Default wgs84. */
  readonly VITE_MAP_COORD_SOURCE?: "wgs84" | "gcj02";
  readonly VITE_MAP_TILE_URL?: string;
  readonly VITE_MAP_TILE_ATTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
