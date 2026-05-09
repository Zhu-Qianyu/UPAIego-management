/** 后台刷新时顶部细条，避免用户误以为页面卡住 */
export default function RefreshStrip({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="mb-3 h-1 w-full overflow-hidden rounded-full bg-indigo-100"
      role="progressbar"
      aria-label="正在更新数据"
    >
      <div className="h-full w-1/3 max-w-[40%] animate-pulse rounded-full bg-indigo-500 motion-reduce:animate-none" />
    </div>
  );
}
