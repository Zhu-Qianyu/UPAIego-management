import { useEffect, useRef, useState } from "react";
import { IMAGE_UPLOAD_ACCEPT, applyPickedImageFile } from "../../utils/compressImageFile";

export function ImageFileInput({
  label,
  required,
  optionalHint,
  file,
  onFileChange,
  onError,
  onProcessingChange,
}: {
  label: string;
  required?: boolean;
  optionalHint?: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  onError: (message: string) => void;
  onProcessingChange?: (processing: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [processing, setProcessing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    onProcessingChange?.(processing);
  }, [processing, onProcessingChange]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div>
      <p className="text-xs text-gray-500 mb-1">
        {label}
        {required ? "（必填）" : optionalHint ? `（${optionalHint}）` : "（可选）"}
      </p>
      {processing ? (
        <p className="text-xs text-indigo-600 mb-2">图片处理中，请稍候…</p>
      ) : file ? (
        <p className="text-xs text-emerald-700 mb-2">已选：{file.name}</p>
      ) : required ? (
        <p className="text-xs text-gray-400 mb-2">尚未选择图片</p>
      ) : null}
      {previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          className="mb-2 max-h-32 w-full max-w-xs rounded-lg border border-gray-200 object-cover"
        />
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const raw = e.target.files?.[0];
          if (!raw) {
            onFileChange(null);
            e.target.value = "";
            return;
          }
          setProcessing(true);
          void applyPickedImageFile(raw, onFileChange, onError).finally(() => {
            setProcessing(false);
            e.target.value = "";
          });
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={processing}
        className="px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm hover:bg-gray-50 disabled:opacity-50"
      >
        {processing ? "处理中…" : file ? "重新选择图片" : "选择图片"}
      </button>
    </div>
  );
}
