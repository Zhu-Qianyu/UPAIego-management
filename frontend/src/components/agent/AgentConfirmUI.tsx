import { useRef } from "react";
import { IMAGE_UPLOAD_ACCEPT, prepareImageFileForUpload } from "../../utils/compressImageFile";

export function PendingConfirmBar({
  prompt,
  detail,
  okLabel = "直接帮我干",
  selfLabel = "跳转页面我自己搞",
  okDisabled,
  onOk,
  onSelfService,
}: {
  prompt: string;
  detail?: React.ReactNode;
  okLabel?: string;
  selfLabel?: string;
  okDisabled?: boolean;
  onOk: () => void;
  onSelfService: () => void;
}) {
  return (
    <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/80 p-2.5 space-y-2">
      <p className="text-xs text-amber-950 font-medium">{prompt}</p>
      {detail ? <div className="text-xs text-gray-700">{detail}</div> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={okDisabled}
          onClick={onOk}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium disabled:opacity-50"
        >
          {okLabel}
        </button>
        <button
          type="button"
          onClick={onSelfService}
          className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700"
        >
          {selfLabel}
        </button>
      </div>
    </div>
  );
}

export function FormFillImageUpload({
  label,
  previewUrl,
  fileName,
  onPick,
  inputRef,
}: {
  label: string;
  previewUrl?: string;
  fileName?: string;
  onPick: (file: File) => void;
  inputRef: (el: HTMLInputElement | null) => void;
}) {
  const localRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="rounded-xl border border-dashed border-rose-200 bg-rose-50/60 p-2.5 space-y-2">
      <p className="text-xs text-gray-700">
        📷 {label}
        {fileName ? (
          <span className="text-emerald-700"> · 已选</span>
        ) : (
          <span className="text-rose-600 font-medium"> · 请上传</span>
        )}
      </p>
      {previewUrl ? (
        <img src={previewUrl} alt={label} className="max-h-32 w-full rounded-lg object-cover border border-gray-100" />
      ) : null}
      <input
        ref={(el) => {
          localRef.current = el;
          inputRef(el);
        }}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => localRef.current?.click()}
        className="w-full rounded-full border border-rose-200 bg-white py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
      >
        {fileName ? "重新选择图片" : "选择图片"}
      </button>
    </div>
  );
}

export async function pickFormFillImage(
  raw: File,
  onSet: (file: File, previewUrl: string) => void,
  onErr: (msg: string) => void
): Promise<void> {
  try {
    const file = await prepareImageFileForUpload(raw);
    onSet(file, URL.createObjectURL(file));
  } catch (e: unknown) {
    onErr(e instanceof Error ? e.message : "图片处理失败");
  }
}
