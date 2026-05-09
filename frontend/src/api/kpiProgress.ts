import { supabase } from "./supabase";
import { listDevices } from "./client";
import type { KpiMetricId } from "./kpiMetrics";

/**
 * 与 admin KPI 绑定的「当前完成值」：
 * - 场景数：本人创建且非草稿的场景任务数量
 * - 设备完好率：本人名下非退役设备中，校准状态为已校准的占比（0–100）
 * - 数据量：工作群可见全系设备已用存储之和（MB），与数采地图范围一致
 */
export async function getKpiCurrentValue(metric: KpiMetricId): Promise<number> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("未登录");

  if (metric === "scene_count") {
    const { count, error } = await supabase
      .from("scene_tasks")
      .select("*", { count: "exact", head: true })
      .eq("created_by", userId)
      .neq("status", "draft");
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  if (metric === "device_health_rate") {
    const { devices } = await listDevices({ scope: "own", limit: 5000, offset: 0 });
    const active = devices.filter((d) => d.status !== "retired");
    if (active.length === 0) return 0;
    const good = active.filter((d) => d.calibration_status === "calibrated").length;
    return (good / active.length) * 100;
  }

  if (metric === "data_volume") {
    const { devices } = await listDevices({ scope: "fleet", limit: 5000, offset: 0 });
    let sum = 0;
    for (const d of devices) {
      sum += Number(d.storage_used_mb) || 0;
    }
    return sum;
  }

  return 0;
}

export function formatKpiCurrent(metric: KpiMetricId, value: number): string {
  if (metric === "device_health_rate") return `${value.toFixed(1)}`;
  if (metric === "scene_count") return String(Math.round(value));
  return Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
}

/** 完成进度 0–100，用于进度条（当前值相对目标值，封顶 100%） */
export function kpiProgressPercent(current: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(current)) return 0;
  return Math.min(100, Math.max(0, (current / target) * 100));
}
