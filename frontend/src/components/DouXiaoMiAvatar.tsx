/** 豆小秘 — 可爱人类女生头像（非机器人） */
export default function DouXiaoMiAvatar({
  className = "",
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dim = size === "sm" ? "h-7 w-7" : size === "lg" ? "h-14 w-14" : "h-8 w-8";

  return (
    <span
      className={`inline-flex shrink-0 overflow-hidden rounded-full bg-gradient-to-b from-sky-100 via-rose-50 to-pink-100 ring-2 ring-white shadow-sm ${dim} ${className}`}
      role="img"
      aria-label="豆小秘"
    >
      <svg viewBox="0 0 100 100" className="h-full w-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* 背景 */}
        <rect width="100" height="100" fill="#FFF0F3" />

        {/* 长发 */}
        <path
          d="M18 58c-2-22 10-38 32-38s34 16 32 38c-8 18-22 28-32 28S26 76 18 58z"
          fill="#3D2314"
        />
        <path
          d="M22 52c0-20 8-32 22-34 14 2 22 14 22 34-6 14-14 22-22 22s-16-8-22-22z"
          fill="#4A2F1F"
        />
        {/* 侧发 */}
        <path d="M16 48c-4 12-2 28 8 36 2-10 0-24-8-36z" fill="#3D2314" />
        <path d="M84 48c4 12 2 28-8 36-2-10 0-24 8-36z" fill="#3D2314" />

        {/* 脸 */}
        <ellipse cx="50" cy="54" rx="24" ry="26" fill="#FAD0B8" />
        <ellipse cx="50" cy="56" rx="21" ry="22" fill="#FFDBC4" />

        {/* 刘海 */}
        <path
          d="M26 38c4-10 12-16 24-16s20 6 24 16c-6-4-14-6-24-6s-18 2-24 6z"
          fill="#3D2314"
        />
        <path d="M34 36c2-6 8-10 16-10s14 4 16 10c-4-2-10-3-16-3s-12 1-16 3z" fill="#4A2F1F" />

        {/* 蝴蝶结 */}
        <ellipse cx="62" cy="30" rx="5" ry="3.5" fill="#FF8FAB" />
        <ellipse cx="72" cy="30" rx="5" ry="3.5" fill="#FF8FAB" />
        <circle cx="67" cy="30" r="2.2" fill="#FF6B9D" />

        {/* 眉毛 */}
        <path d="M38 48c3-2 7-2 10 0" stroke="#8B5E4A" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M52 48c3-2 7-2 10 0" stroke="#8B5E4A" strokeWidth="1.6" strokeLinecap="round" />

        {/* 眼睛 */}
        <ellipse cx="40" cy="54" rx="4.5" ry="5.5" fill="#2C1810" />
        <ellipse cx="60" cy="54" rx="4.5" ry="5.5" fill="#2C1810" />
        <circle cx="41.5" cy="52.5" r="1.6" fill="#fff" />
        <circle cx="61.5" cy="52.5" r="1.6" fill="#fff" />
        <circle cx="39" cy="55.5" r="0.9" fill="#fff" opacity="0.45" />

        {/* 腮红 */}
        <ellipse cx="32" cy="60" rx="4.5" ry="2.8" fill="#FF9EB5" opacity="0.45" />
        <ellipse cx="68" cy="60" rx="4.5" ry="2.8" fill="#FF9EB5" opacity="0.45" />

        {/* 嘴 */}
        <path
          d="M44 66c3 3 9 3 12 0"
          stroke="#E57373"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />

        {/* 衣领 */}
        <path d="M34 82h32l-6 10H40l-6-10z" fill="#FFFFFF" />
        <path d="M42 82l8 10 8-10" stroke="#FFD6E0" strokeWidth="1.2" fill="none" />
      </svg>
    </span>
  );
}
