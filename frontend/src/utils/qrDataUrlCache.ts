import QRCode, { type QRCodeToDataURLOptions } from "qrcode";

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

export async function qrDataUrlCached(
  payload: string,
  options: QRCodeToDataURLOptions
): Promise<string> {
  const key = `${payload}\0${JSON.stringify(options)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const task = QRCode.toDataURL(payload, options)
    .then((dataUrl) => {
      cache.set(key, dataUrl);
      inflight.delete(key);
      return dataUrl;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, task);
  return task;
}
