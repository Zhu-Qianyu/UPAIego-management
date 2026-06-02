import { qrDataUrlCached } from "../utils/qrDataUrlCache";

/** 联网设备贴签二维码：纯文本，扫码后直接显示设备标识（非网址）。 */
export function buildOnlineDeviceQrText(opts: {
  readable_name: string;
  device_id: string;
  serial_id?: string | null;
}): string {
  const lines = ["UPAIEGO联网设备", `设备名称：${opts.readable_name}`, `设备ID：${opts.device_id}`];
  const s = opts.serial_id?.trim();
  if (s) lines.push(`出厂序列号：${s}`);
  return lines.join("\n");
}

/**
 * Generate a QR code as a data-URL (PNG) encoding plain-text device identity.
 */
export async function generateQrDataUrl(
  deviceId: string,
  readableName: string,
  serialId?: string | null
): Promise<string> {
  const payload = buildOnlineDeviceQrText({
    readable_name: readableName,
    device_id: deviceId,
    serial_id: serialId ?? null,
  });

  return qrDataUrlCached(payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 300,
  });
}

/**
 * Generate a QR code as a Blob (for downloading).
 */
export async function generateQrBlob(
  deviceId: string,
  readableName: string,
  serialId?: string | null
): Promise<Blob> {
  const dataUrl = await generateQrDataUrl(deviceId, readableName, serialId);
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Trigger a download of the QR code PNG.
 */
export async function downloadQr(
  deviceId: string,
  readableName: string,
  serialId?: string | null
): Promise<void> {
  const blob = await generateQrBlob(deviceId, readableName, serialId);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${readableName}-qr.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
