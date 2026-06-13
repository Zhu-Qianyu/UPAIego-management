import { SITE_COMPANY_NAME, SITE_ICP_NUMBER, SITE_ICP_URL } from "../branding";

export default function SiteFooter({ className = "" }: { className?: string }) {
  return (
    <footer
      className={`shrink-0 border-t border-gray-200/80 bg-white/60 px-4 py-4 text-center text-[11px] leading-relaxed text-gray-500 ${className}`}
    >
      <p>{SITE_COMPANY_NAME}</p>
      <p className="mt-1">
        <a
          href={SITE_ICP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 hover:text-indigo-700 underline-offset-2 hover:underline"
        >
          {SITE_ICP_NUMBER}
        </a>
      </p>
    </footer>
  );
}
