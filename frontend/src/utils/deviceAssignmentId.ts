/** 离线设备在分发/数采登记中使用的 synthetic device_id（前缀 + 登记编号） */
export const OFFLINE_DEVICE_ID_PREFIX = "offline:";

export function toOfflineDeviceAssignmentId(publicCode: string): string {
  return `${OFFLINE_DEVICE_ID_PREFIX}${publicCode.trim().toUpperCase()}`;
}

export function isOfflineDeviceAssignmentId(deviceId: string): boolean {
  return deviceId.startsWith(OFFLINE_DEVICE_ID_PREFIX);
}

export function offlinePublicCodeFromAssignmentId(deviceId: string): string | null {
  if (!isOfflineDeviceAssignmentId(deviceId)) return null;
  const code = deviceId.slice(OFFLINE_DEVICE_ID_PREFIX.length).trim().toUpperCase();
  return code || null;
}
