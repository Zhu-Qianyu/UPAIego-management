const PREFIX = "upai:v1:view:";

/** 当前用户 + 路径的视图快照键（用于返回上一页时先展示上次内容） */
export function routeViewCacheKey(userId: string | undefined, pathname: string): string | null {
  if (!userId) return null;
  const p = pathname || "/";
  return `${PREFIX}${userId}:${p}`;
}

/** 设备详情等子路径单独缓存 */
export function routeViewCacheKeyExtra(userId: string | undefined, pathname: string, extra: string): string | null {
  if (!userId) return null;
  return `${PREFIX}${userId}:${pathname}?${extra}`;
}

export function readRouteViewCache<T>(key: string | null): T | null {
  if (!key || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeRouteViewCache(key: string | null, value: unknown): void {
  if (!key || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode */
  }
}
