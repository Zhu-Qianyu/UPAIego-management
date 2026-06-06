/** 豆小秘 — 小女生形象头像 */
export default function DouXiaoMiAvatar({
  className = "h-8 w-8",
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-14 w-14" : "h-8 w-8";
  const cls = className || dim;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-rose-100 to-pink-50 ring-2 ring-white shadow-sm ${cls}`}
      aria-hidden
    >
      <svg viewBox="0 0 64 64" className="h-full w-full" fill="none">
        <circle cx="32" cy="32" r="32" fill="#FFE4EC" />
        <path
          d="M10 38c4-14 14-22 22-22s18 8 22 22c-6 2-14 4-22 4s-16-2-22-4z"
          fill="#5C4033"
        />
        <path
          d="M14 28c2-8 10-14 18-14s16 6 18 14c-4 6-10 10-18 10S18 34 14 28z"
          fill="#6B4423"
        />
        <ellipse cx="32" cy="36" rx="14" ry="16" fill="#FFDAB9" />
        <ellipse cx="24" cy="38" rx="2.2" ry="2.8" fill="#3D2314" />
        <ellipse cx="40" cy="38" rx="2.2" ry="2.8" fill="#3D2314" />
        <circle cx="25" cy="37" r="0.8" fill="#fff" opacity="0.7" />
        <circle cx="41" cy="37" r="0.8" fill="#fff" opacity="0.7" />
        <path d="M28 44 Q32 47 36 44" stroke="#E57373" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <ellipse cx="20" cy="42" rx="3" ry="1.8" fill="#FFB6C1" opacity="0.55" />
        <ellipse cx="44" cy="42" rx="3" ry="1.8" fill="#FFB6C1" opacity="0.55" />
        <path
          d="M18 22c2-6 8-10 14-10s12 4 14 10"
          stroke="#6B4423"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
