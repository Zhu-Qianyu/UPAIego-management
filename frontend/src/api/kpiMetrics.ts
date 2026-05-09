import type { KpiTargetRole } from "./adminContent";

/** 存于 admin_kpis.title 的稳定键 */
export type KpiMetricId = "device_health_rate" | "scene_count" | "data_volume";

export const KPI_METRIC_BY_ROLE: Record<KpiTargetRole, { id: KpiMetricId; label: string }> = {
  device_operator: { id: "device_health_rate", label: "设备完好率" },
  scene_operator: { id: "scene_count", label: "场景数" },
  collection_executor: { id: "data_volume", label: "数据量" },
};

const LEGACY_TITLE_MAP: Partial<Record<string, KpiMetricId>> = {
  设备完好率: "device_health_rate",
  场景数: "scene_count",
  数据量: "data_volume",
};

export function metricIdForRole(role: KpiTargetRole): KpiMetricId {
  return KPI_METRIC_BY_ROLE[role].id;
}

export function labelForMetricId(id: KpiMetricId): string {
  const row = Object.values(KPI_METRIC_BY_ROLE).find((m) => m.id === id);
  return row?.label ?? id;
}

export function parseKpiMetricId(title: string | null | undefined): KpiMetricId | null {
  if (!title) return null;
  if (title === "device_health_rate" || title === "scene_count" || title === "data_volume") {
    return title;
  }
  return LEGACY_TITLE_MAP[title] ?? null;
}
