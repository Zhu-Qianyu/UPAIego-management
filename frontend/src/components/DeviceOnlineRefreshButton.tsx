type Props = {
  onRefresh: () => void | Promise<void>;
  disabled?: boolean;
};

export default function DeviceOnlineRefreshButton({ onRefresh, disabled }: Props) {
  return (
    <button
      type="button"
      className="inline-flex shrink-0 items-center justify-center rounded-lg border border-indigo-200 bg-white p-1.5 text-indigo-600 shadow-sm hover:border-indigo-300 hover:bg-indigo-50 disabled:pointer-events-none disabled:opacity-40"
      title="立刻刷新在线状态（重新同步 last_seen）"
      aria-label="立刻刷新在线状态"
      disabled={disabled}
      onClick={() => void onRefresh()}
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
    </button>
  );
}
