import type { ReactNode } from "react";

export const uiInput =
  "mt-1.5 w-full rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-400";
export const uiLabel = "block text-xs font-semibold uppercase tracking-wider text-slate-500";
export const uiSelect = uiInput;

type Accent = "indigo" | "emerald" | "violet" | "amber";

const heroGradients: Record<Accent, string> = {
  indigo: "from-indigo-600 via-violet-600 to-purple-700 shadow-indigo-300/40",
  emerald: "from-emerald-600 via-teal-600 to-cyan-700 shadow-emerald-300/40",
  violet: "from-violet-600 via-purple-600 to-fuchsia-700 shadow-violet-300/40",
  amber: "from-amber-500 via-orange-500 to-rose-600 shadow-amber-300/40",
};

export function PageShell({ children }: { children: ReactNode }) {
  return <div className="page-shell max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">{children}</div>;
}

export function PageHero({
  eyebrow,
  title,
  description,
  accent = "indigo",
  icon,
  onRefresh,
  refreshing,
  footer,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  accent?: Accent;
  icon?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  footer?: ReactNode;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${heroGradients[accent]} p-6 sm:p-8 text-white shadow-xl`}
    >
      <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/15 blur-2xl" aria-hidden />
      <div className="pointer-events-none absolute -left-6 bottom-0 h-32 w-32 rounded-full bg-black/10 blur-2xl" aria-hidden />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-4 min-w-0">
          {icon && (
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30 backdrop-blur-sm">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            {eyebrow && (
              <p className="text-[11px] font-semibold uppercase tracking-widest text-white/75">{eyebrow}</p>
            )}
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
            {description && <p className="mt-2 text-sm text-white/85 max-w-xl leading-relaxed">{description}</p>}
          </div>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-sm font-medium ring-1 ring-white/25 hover:bg-white/25 disabled:opacity-60 transition"
          >
            <svg
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {refreshing ? "刷新中" : "刷新"}
          </button>
        )}
      </div>
      {footer && <div className="relative mt-6">{footer}</div>}
    </div>
  );
}

export function StatGrid({
  items,
}: {
  items: { label: string; value: string | number; hint?: string; tone?: "default" | "warn" | "ok" }[];
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="glass-panel rounded-2xl p-4 transition hover:shadow-md hover:-translate-y-0.5"
        >
          <p className="text-xs font-medium text-slate-500">{item.label}</p>
          <p
            className={`mt-1 text-2xl font-bold tabular-nums ${
              item.tone === "warn"
                ? "text-amber-600"
                : item.tone === "ok"
                  ? "text-emerald-600"
                  : "text-slate-900"
            }`}
          >
            {item.value}
          </p>
          {item.hint && <p className="mt-0.5 text-[11px] text-slate-400">{item.hint}</p>}
        </div>
      ))}
    </div>
  );
}

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; icon?: ReactNode; badge?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-slate-100/80 ring-1 ring-slate-200/60">
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition ${
              active
                ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200/80"
                : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
            }`}
          >
            {t.icon}
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span
                className={`min-w-[1.25rem] rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  active ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Panel({
  title,
  description,
  icon,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass-panel overflow-hidden ${className}`}>
      <div className="flex items-start gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white px-5 py-4">
        {icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100">
            {icon}
          </div>
        )}
        <div>
          <h2 className="font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200/80 bg-slate-50/50 px-6 py-14 text-center">
      {icon && (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 text-slate-400">
          {icon}
        </div>
      )}
      <p className="font-medium text-slate-700">{title}</p>
      {description && <p className="mt-1 text-sm text-slate-500 max-w-sm">{description}</p>}
    </div>
  );
}

export function Alert({
  variant = "info",
  children,
}: {
  variant?: "info" | "warn" | "error" | "success";
  children: ReactNode;
}) {
  const styles = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-200 bg-amber-50 text-amber-950",
    error: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${styles[variant]}`}>{children}</div>
  );
}

export function UiButton({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "success" | "ghost";
  size?: "sm" | "md";
}) {
  const base =
    "inline-flex items-center justify-center font-medium rounded-xl transition focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none";
  const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2.5 text-sm" };
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500 shadow-sm shadow-indigo-200/50",
    secondary:
      "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 focus:ring-slate-300 shadow-sm",
    danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-sm",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500 shadow-sm",
    ghost: "text-slate-600 hover:bg-slate-100 focus:ring-slate-300",
  };
  return (
    <button type={type} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function IconClipboard() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

export function IconDevices() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

export function IconClock() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export function IconSparkles() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  );
}

export function IconMap() {
  return (
    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
    </svg>
  );
}

export function IconWrench() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
