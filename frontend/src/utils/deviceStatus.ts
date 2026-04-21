import type { Device } from "../api/client";

const OFFLINE_THRESHOLD_MS = 10_000;

export function getEffectiveDeviceStatus(device: Device, nowMs = Date.now()): string {
  // Do not override non-running lifecycle states.
  if (["retired", "maintenance"].includes(device.status)) {
    return device.status;
  }
  if (!device.last_seen) {
    return "offline";
  }
  const lastSeenMs = Date.parse(device.last_seen);
  if (Number.isNaN(lastSeenMs)) {
    return "offline";
  }
  return nowMs - lastSeenMs > OFFLINE_THRESHOLD_MS ? "offline" : device.status;
}

