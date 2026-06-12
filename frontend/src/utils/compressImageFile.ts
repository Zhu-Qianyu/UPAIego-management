export const IMAGE_UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp";

const SKIP_COMPRESS_BELOW_BYTES = 900_000;
const TARGET_MAX_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 2048;

const IMAGE_FILE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
const IMAGE_FILE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

function imageFileExtension(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

export function validateImageFileType(file: File): string | null {
  const ext = imageFileExtension(file);
  const okExt = IMAGE_FILE_EXTENSIONS.includes(ext as (typeof IMAGE_FILE_EXTENSIONS)[number]);
  const okMime = IMAGE_FILE_MIMES.includes(file.type as (typeof IMAGE_FILE_MIMES)[number]);
  // 手机/微信选图时常出现 type 为空，仅根据扩展名放行。
  if (okExt || okMime) return null;
  if (file.type.startsWith("image/")) return null;
  return "仅支持 jpg、png、webp";
}

function isJpegFile(file: File): boolean {
  const ext = imageFileExtension(file);
  return file.type === "image/jpeg" || ext === "jpg" || ext === "jpeg";
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法读取图片，请换一张试试"));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片压缩失败"))),
      type,
      quality
    );
  });
}

/** 缩小尺寸并压成 JPEG，大图自动压到约 2MB 以内 */
export async function compressImageFile(
  file: File,
  options?: { maxBytes?: number; maxDimension?: number }
): Promise<File> {
  const maxBytes = options?.maxBytes ?? TARGET_MAX_BYTES;
  const maxDimension = options?.maxDimension ?? MAX_DIMENSION;

  const typeErr = validateImageFileType(file);
  if (typeErr) throw new Error(typeErr);

  if (file.size <= SKIP_COMPRESS_BELOW_BYTES && isJpegFile(file)) {
    return file;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadHtmlImage(objectUrl);
    let width = img.naturalWidth;
    let height = img.naturalHeight;
    const scale = Math.min(1, maxDimension / Math.max(width, height, 1));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法处理图片");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    let quality = 0.9;
    let blob = await canvasToBlob(canvas, "image/jpeg", quality);
    for (let i = 0; i < 7 && blob.size > maxBytes; i++) {
      quality = Math.max(0.45, quality - 0.08);
      blob = await canvasToBlob(canvas, "image/jpeg", quality);
    }

    const stem = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${stem}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** 选图后统一走压缩，超大图不再报错 */
export async function prepareImageFileForUpload(file: File): Promise<File> {
  return compressImageFile(file);
}

export async function applyPickedImageFile(
  raw: File | undefined,
  setFile: (file: File | null) => void,
  setErr: (message: string) => void
): Promise<void> {
  if (!raw) {
    setFile(null);
    return;
  }
  setErr("");
  try {
    setFile(await prepareImageFileForUpload(raw));
  } catch (e: unknown) {
    setFile(null);
    setErr(e instanceof Error ? e.message : "图片处理失败");
  }
}
