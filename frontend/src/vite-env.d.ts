/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_AMAP_KEY?: string;
  readonly VITE_AMAP_SECURITY_CODE?: string;
  /** Device coordinates in DB: wgs84 (GPS) or gcj02. Default wgs84. */
  readonly VITE_MAP_COORD_SOURCE?: "wgs84" | "gcj02";
  /** 设为 true 时开放数采地图（高德 + 设备列表）；未设置或为其他值时仅显示「暂未上线」 */
  readonly VITE_MAP_FEATURE_ENABLED?: string;
  readonly VITE_MAP_TILE_URL?: string;
  readonly VITE_MAP_TILE_ATTRIBUTION?: string;
  /** 设为 true 时显示右下角「场景助手」（需部署 scene-ai-agent Edge Function） */
  readonly VITE_SCENE_AI_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
