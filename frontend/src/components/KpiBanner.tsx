import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS } from "../auth/roleLabels";
import { listActiveKpisForRole, type KpiRow, type KpiTargetRole } from "../api/adminContent";
import {
  getKpiCurrentValue,
  kpiProgressPercent,
  formatKpiCurrent,
} from "../api/kpiProgress";
import { labelForMetricId, parseKpiMetricId, type KpiMetricId } from "../api/kpiMetrics";
import type { UserRole } from "../types/roles";

function roleTargetsKpi(role: UserRole): role is KpiTargetRole {
  return role === "device_operator" || role === "scene_operator" || role === "collection_executor";
}

function formatRange(k: KpiRow): string {
  if (!k.valid_from && !k.valid_until) return "考核时间：未限制";
  const fmt = (s: string | null) =>
    s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—";
  return `考核时间：${fmt(k.valid_from)} ～ ${fmt(k.valid_until)}`;
}

export default function KpiBanner() {
  const { profile } = useAuth();
  const [items, setItems] = useState<KpiRow[]>([]);
  const [currentById, setCurrentById] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!profile || !roleTargetsKpi(profile.role)) {
      setItems([]);
      return;
    }
    listActiveKpisForRole(profile.role)
      .then(setItems)
      .catch(() => setItems([]));
  }, [profile?.role]);

  useEffect(() => {
    if (items.length === 0) {
      setCurrentById({});
      return;
    }
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      await Promise.all(
        items.map(async (k) => {
          const mid = parseKpiMetricId(k.title);
          if (!mid) return;
          try {
            const v = await getKpiCurrentValue(mid as KpiMetricId);
            if (!cancelled) next[k.id] = v;
          } catch {
            if (!cancelled) next[k.id] = 0;
          }
        })
      );
      if (!cancelled) setCurrentById(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  if (!profile || !roleTargetsKpi(profile.role) || items.length === 0) return null;

  return (
    <div className="mb-6 space-y-3">
      <p className="text-xs font-medium text-indigo-800/90">
        {ROLE_LABELS[profile.role]} · KPI 完成进度
      </p>
      {items.map((k) => {
        const mid = parseKpiMetricId(k.title);
        const label = mid ? labelForMetricId(mid) : k.title;
        const target = k.target_value != null && Number.isFinite(Number(k.target_value)) ? Number(k.target_value) : 0;
        const current = mid ? (currentById[k.id] ?? 0) : 0;
        const pct = mid && target > 0 ? kpiProgressPercent(mid, current, target) : 0;
        const unit = (k.unit ?? "").trim();

        return (
          <div
            key={k.id}
            className="rounded-xl border border-indigo-200 bg-indigo-50/90 px-4 py-3 text-sm text-indigo-950 shadow-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-indigo-950">{label}</p>
              <p className="text-indigo-900/90 tabular-nums">
                当前 {mid ? formatKpiCurrent(mid, current) : "—"}
                {unit ? ` ${unit}` : ""}
                <span className="text-indigo-800/70"> / 目标 {target || "—"}</span>
                {unit ? ` ${unit}` : ""}
              </p>
            </div>
            {mid && target > 0 && (
              <div className="mt-3">
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-indigo-200/60">
                  <div
                    className="h-full rounded-full bg-indigo-600 transition-[width] duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-indigo-800/75 mt-1.5">{Math.round(pct)}% 完成</p>
              </div>
            )}
            {!mid && (
              <p className="text-amber-900/90 mt-2 text-xs">指标未识别，请管理员使用固定指标重新保存 KPI。</p>
            )}
            {mid && target <= 0 && (
              <p className="text-amber-900/90 mt-2 text-xs">请管理员设置大于 0 的目标值以显示进度条。</p>
            )}
            {k.notes && <p className="text-indigo-900/75 mt-2 text-xs whitespace-pre-wrap">{k.notes}</p>}
            <p className="text-xs text-indigo-800/65 mt-2">{formatRange(k)}</p>
          </div>
        );
      })}
    </div>
  );
}
