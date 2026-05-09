import type { Device } from "../api/client";

/**
 * 滞回判定：避免单阈值夹在「心跳间隔」里导致正常 ↔ 离线抖动。
 *
 * - `≤ SEEN_RECENT`：最近一次上报很近 → 一律按在线展示（恢复快、灵敏）。
 * - `≥ SEEN_ABSENT`：长时间没有上报 → 一律按离线（真掉线能及时反映）。
 * - 中间盲区：沿用该设备上一轮 UI 结论，不因中间时刻越过单阈值乱跳。
 *
 * SEEN_ABSENT 应大于板端最坏上报间隔（含网络抖动）；若整机心跳很慢（例如 120s+），可把
 * `VITE_DEVICE_OFFLINE_ABSENT_MS` 设为更大数字（毫秒）后重新构建。
 */
const SEEN_RECENT_MS =
  Number.parseInt(import.meta.env?.VITE_DEVICE_OFFLINE_RECENT_MS ?? "", 10) || 15_000;
const SEEN_ABSENT_MS =
  Number.parseInt(import.meta.env?.VITE_DEVICE_OFFLINE_ABSENT_MS ?? "", 10) || 90_000;

const lastConnectivity = new Map<string, boolean>();

export function getEffectiveDeviceStatus(device: Device, nowMs = Date.now()): string {
  const id = device.device_id;

  if (["retired", "maintenance"].includes(device.status)) {
    lastConnectivity.delete(id);
    return device.status;
  }

  if (!device.last_seen) {
    lastConnectivity.set(id, false);
    return "offline";
  }

  const lastSeenMs = Date.parse(device.last_seen);
  if (Number.isNaN(lastSeenMs)) {
    lastConnectivity.set(id, false);
    return "offline";
  }

  const staleMs = nowMs - lastSeenMs;

  let connected: boolean;
  if (staleMs <= SEEN_RECENT_MS) {
    connected = true;
  } else if (staleMs >= SEEN_ABSENT_MS) {
    connected = false;
  } else {
    connected = lastConnectivity.get(id) ?? device.status === "active";
  }

  lastConnectivity.set(id, connected);
  return connected ? device.status : "offline";
}
