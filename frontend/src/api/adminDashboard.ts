import { supabase } from "./supabase";
import { listDevices } from "./client";
import {
  listAssignmentsForWorkGroup,
  listManualTrackedDevices,
  listPartyDemands,
  type PartyDemand,
} from "./operations";
import { isOnOrAfter, shanghaiPeriodStarts } from "../utils/shanghaiPeriod";

export interface PartyDemandDashboardRow {
  id: string;
  label: string;
  client_company: string | null;
  device_type: string | null;
  client_hourly_rate: number | null;
  device_count: number;
  hours_week: number;
  hours_month: number;
  hours_year: number;
  hours_total: number;
  scene_hours_total: number;
  income_week: number | null;
  income_month: number | null;
  income_year: number | null;
  income_total: number | null;
}

export interface AdminFinanceSummary {
  cost_week: number;
  cost_month: number;
  cost_year: number;
  cost_total: number;
  income_week: number | null;
  income_month: number | null;
  income_year: number | null;
  income_total: number | null;
  income_configured: boolean;
}

export interface AdminDashboardStats {
  group_id: string;
  party_demand_count: number;
  device_count: number;
  finance: AdminFinanceSummary;
  party_demands: PartyDemandDashboardRow[];
}

interface HourLogRow {
  device_id: string;
  registered_hours: number;
  created_at: string;
}

interface SettlementRow {
  amount: number;
  settled_at: string;
  status: string;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function partyLabel(pd: PartyDemand): string {
  const company = (pd.client_company || pd.title || "甲方").trim();
  return pd.device_type?.trim() ? `${company} · ${pd.device_type.trim()}` : company;
}

function resolvePartyDemandIdForDevice(
  deviceId: string,
  onlineById: Map<string, string | null | undefined>,
  manualByCode: Map<string, string>
): string | null {
  if (deviceId.startsWith("offline:")) {
    const code = deviceId.slice(8).trim().toUpperCase();
    return manualByCode.get(code) ?? null;
  }
  return onlineById.get(deviceId) ?? null;
}

function incomeFromHours(hours: number, rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(hours * rate * 100) / 100;
}

function sumIncome(rows: PartyDemandDashboardRow[], key: "week" | "month" | "year" | "total"): number | null {
  const field =
    key === "week"
      ? "income_week"
      : key === "month"
        ? "income_month"
        : key === "year"
          ? "income_year"
          : "income_total";
  let hasAny = false;
  let sum = 0;
  for (const row of rows) {
    const v = row[field];
    if (v != null) {
      hasAny = true;
      sum += v;
    }
  }
  return hasAny ? Math.round(sum * 100) / 100 : null;
}

/** Aggregate admin dashboard metrics for the given work group (client-side). */
export async function fetchAdminDashboardStats(groupId: string): Promise<AdminDashboardStats> {
  const periods = shanghaiPeriodStarts();

  const [demands, manuals, deviceRes, hourLogsRes, settlementRes, assignments] = await Promise.all([
    listPartyDemands(groupId),
    listManualTrackedDevices(groupId),
    listDevices({ scope: "fleet", limit: 5000, offset: 0 }),
    supabase
      .from("device_data_hour_logs")
      .select("device_id, registered_hours, created_at")
      .eq("group_id", groupId),
    supabase
      .from("executor_settlement_lines")
      .select("amount, settled_at, status")
      .eq("group_id", groupId)
      .eq("status", "settled"),
    listAssignmentsForWorkGroup(groupId),
  ]);

  if (hourLogsRes.error) throw new Error(hourLogsRes.error.message);
  if (settlementRes.error) throw new Error(settlementRes.error.message);

  const hourLogs = (hourLogsRes.data ?? []) as HourLogRow[];
  const settlements = (settlementRes.data ?? []) as SettlementRow[];

  const onlineById = new Map<string, string | null | undefined>();
  for (const d of deviceRes.devices) {
    onlineById.set(d.device_id, (d as { party_demand_id?: string | null }).party_demand_id);
  }

  const manualByCode = new Map<string, string>();
  for (const m of manuals) {
    manualByCode.set(m.public_code.toUpperCase(), m.party_demand_id);
  }

  const deviceCountByParty = new Map<string, number>();
  for (const m of manuals) {
    deviceCountByParty.set(m.party_demand_id, (deviceCountByParty.get(m.party_demand_id) ?? 0) + 1);
  }
  for (const d of deviceRes.devices) {
    const pdId = (d as { party_demand_id?: string | null }).party_demand_id;
    if (pdId) {
      deviceCountByParty.set(pdId, (deviceCountByParty.get(pdId) ?? 0) + 1);
    }
  }

  const hoursByParty = new Map<
    string,
    { week: number; month: number; year: number; total: number }
  >();
  const bump = (pdId: string, h: number, createdAt: string) => {
    const cur = hoursByParty.get(pdId) ?? { week: 0, month: 0, year: 0, total: 0 };
    cur.total += h;
    if (isOnOrAfter(createdAt, periods.year)) cur.year += h;
    if (isOnOrAfter(createdAt, periods.month)) cur.month += h;
    if (isOnOrAfter(createdAt, periods.week)) cur.week += h;
    hoursByParty.set(pdId, cur);
  };

  for (const log of hourLogs) {
    const h = num(log.registered_hours);
    if (h <= 0) continue;
    const pdId = resolvePartyDemandIdForDevice(log.device_id, onlineById, manualByCode);
    if (!pdId) continue;
    bump(pdId, h, log.created_at);
  }

  const sceneHoursByParty = new Map<string, number>();
  for (const a of assignments) {
    const h = num(a.executed_hours);
    if (h <= 0) continue;
    sceneHoursByParty.set(a.party_demand_id, (sceneHoursByParty.get(a.party_demand_id) ?? 0) + h);
  }

  const rateByParty = new Map<string, number | null>();
  for (const pd of demands) {
    const rate = pd.client_hourly_rate;
    rateByParty.set(pd.id, rate == null ? null : num(rate));
  }

  const partyRows: PartyDemandDashboardRow[] = demands.map((pd) => {
    const hours = hoursByParty.get(pd.id) ?? { week: 0, month: 0, year: 0, total: 0 };
    const sceneTotal = sceneHoursByParty.get(pd.id) ?? 0;
    const rate = rateByParty.get(pd.id) ?? null;
    const totalHours = hours.total + sceneTotal;
    return {
      id: pd.id,
      label: partyLabel(pd),
      client_company: pd.client_company,
      device_type: pd.device_type ?? null,
      client_hourly_rate: rate,
      device_count: deviceCountByParty.get(pd.id) ?? 0,
      hours_week: Math.round(hours.week * 100) / 100,
      hours_month: Math.round(hours.month * 100) / 100,
      hours_year: Math.round(hours.year * 100) / 100,
      hours_total: Math.round(totalHours * 100) / 100,
      scene_hours_total: Math.round(sceneTotal * 100) / 100,
      income_week: incomeFromHours(hours.week, rate),
      income_month: incomeFromHours(hours.month, rate),
      income_year: incomeFromHours(hours.year, rate),
      income_total: incomeFromHours(totalHours, rate),
    };
  });

  partyRows.sort((a, b) => b.hours_year - a.hours_year || a.label.localeCompare(b.label, "zh-CN"));

  let costWeek = 0;
  let costMonth = 0;
  let costYear = 0;
  let costTotal = 0;
  for (const line of settlements) {
    const amt = num(line.amount);
    if (amt <= 0) continue;
    costTotal += amt;
    const at = line.settled_at;
    if (isOnOrAfter(at, periods.year)) costYear += amt;
    if (isOnOrAfter(at, periods.month)) costMonth += amt;
    if (isOnOrAfter(at, periods.week)) costWeek += amt;
  }

  const incomeConfigured = demands.some((pd) => num(pd.client_hourly_rate) > 0);

  const finance: AdminFinanceSummary = {
    cost_week: Math.round(costWeek * 100) / 100,
    cost_month: Math.round(costMonth * 100) / 100,
    cost_year: Math.round(costYear * 100) / 100,
    cost_total: Math.round(costTotal * 100) / 100,
    income_week: sumIncome(partyRows, "week"),
    income_month: sumIncome(partyRows, "month"),
    income_year: sumIncome(partyRows, "year"),
    income_total: sumIncome(partyRows, "total"),
    income_configured: incomeConfigured,
  };

  const distinctDevices = manuals.length + deviceRes.devices.length;

  return {
    group_id: groupId,
    party_demand_count: demands.length,
    device_count: distinctDevices,
    finance,
    party_demands: partyRows,
  };
}
