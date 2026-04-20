import QRCode from "qrcode";

/**
 * Generate a QR code as a data-URL (PNG) encoding the device identity.
 * Payload: {"readable_name": "...", "device_id": "..."}
 */
export async function generateQrDataUrl(
  deviceId: string,
  readableName: string
): Promise<string> {
  const payload = JSON.stringify({
    readable_name: readableName,
    device_id: deviceId,
  });

  return QRCode.toDataURL(payload, {
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
  readableName: string
): Promise<Blob> {
  const dataUrl = await generateQrDataUrl(deviceId, readableName);
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Trigger a download of the QR code PNG.
 */
export async function downloadQr(
  deviceId: string,
  readableName: string
): Promise<void> {
  const blob = await generateQrBlob(deviceId, readableName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${readableName}-qr.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
