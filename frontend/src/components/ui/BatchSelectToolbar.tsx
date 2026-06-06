import { UiButton } from "./PageLayout";

export function BatchSelectToolbar({
  total,
  selectedCount,
  onSelectAll,
  onClear,
  onDelete,
  deleting,
  deleteLabel = "删除选中",
}: {
  total: number;
  selectedCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
  deleting?: boolean;
  deleteLabel?: string;
}) {
  if (total === 0) return null;
  const allSelected = total > 0 && selectedCount === total;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2 text-sm">
      <span className="text-slate-600">
        已选 <strong className="text-slate-900">{selectedCount}</strong> / {total}
      </span>
      <button type="button" onClick={onSelectAll} className="text-indigo-600 hover:text-indigo-800 text-xs font-medium">
        {allSelected ? "取消全选" : "全选"}
      </button>
      {selectedCount > 0 && (
        <>
          <button type="button" onClick={onClear} className="text-slate-500 hover:text-slate-700 text-xs">
            清空选择
          </button>
          <UiButton
            type="button"
            variant="danger"
            size="sm"
            disabled={deleting}
            onClick={onDelete}
            className="ml-auto"
          >
            {deleting ? "删除中…" : deleteLabel}
          </UiButton>
        </>
      )}
    </div>
  );
}

export function BatchSelectCheckbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label?: string;
}) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        aria-label={label ?? "选择此项"}
      />
    </label>
  );
}
