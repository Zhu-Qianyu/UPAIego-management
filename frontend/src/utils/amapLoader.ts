import AMapLoader from "@amap/amap-jsapi-loader";

let cached: Promise<typeof AMap> | null = null;

export function amapConfigured(): boolean {
  return Boolean(import.meta.env.VITE_AMAP_KEY?.trim());
}

export function loadAmap(): Promise<typeof AMap> {
  const key = import.meta.env.VITE_AMAP_KEY?.trim();
  if (!key) {
    return Promise.reject(new Error("未配置 VITE_AMAP_KEY，请在 frontend/.env 中设置高德 Web 端 Key"));
  }
  if (!cached) {
    const securityJsCode = import.meta.env.VITE_AMAP_SECURITY_CODE?.trim();
    if (securityJsCode) {
      window._AMapSecurityConfig = { securityJsCode };
    }
    cached = AMapLoader.load({
      key,
      version: "2.0",
      plugins: ["AMap.Scale", "AMap.ToolBar"],
    }) as Promise<typeof AMap>;
  }
  return cached;
}
