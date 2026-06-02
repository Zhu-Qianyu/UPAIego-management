import { supabase } from "./supabase";

export type BountyStatus = "open" | "fulfilled" | "closed";
export type BountyClaimStatus = "active" | "completed" | "failed" | "expired" | "abandoned";
export type PointLedgerReason = "complete" | "penalty" | "admin_adjust" | "abandon";

/** 每台（并发槽位）每个自然日最多可领取的小时数（与 DB bounty_hours_per_slot_per_day 一致） */
export const BOUNTY_HOURS_PER_SLOT_PER_DAY = 8;
export const BOUNTY_CLAIM_DAY_TIMEZONE = "Asia/Shanghai";

export interface DailyClaimUsage {
  claimed_today: number;
  daily_limit: number;
  remaining_today: number;
  slots: number;
  hours_per_slot: number;
  claim_date: string;
  timezone: string;
}

export interface Bounty {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  total_hours: number;
  remaining_hours: number;
  hourly_rate: number;
  completion_days: 1 | 2 | 3;
  points_per_hour: number;
  status: BountyStatus;
  created_by: string;
  assigned_operator_id: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface BountyAllowedPartyDemand {
  party_demand_id: string;
  client_company: string | null;
  title: string | null;
  device_type: string | null;
}

export interface AssignableDevice {
  device_id: string;
  kind: "online" | "offline";
  label: string;
  device_type: string | null;
}

export interface ClaimCheckout {
  id: string;
  device_id: string;
  executor_id: string;
  created_at: string;
}

export interface ReturnSettleResult {
  assignment_id: string;
  hour_log_id: string;
  settlement_line_id: string | null;
  session_hours: number;
  amount: number;
  executed_hours: number;
  claimed_hours: number;
  claim_completed: boolean;
}

export interface BountyClaim {
  id: string;
  bounty_id: string;
  executor_id: string;
  claimed_hours: number;
  executed_hours: number;
  due_at: string;
  status: BountyClaimStatus;
  completed_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  created_at: string;
  bounties?: Pick<
    Bounty,
    "title" | "hourly_rate" | "points_per_hour" | "completion_days" | "assigned_operator_id" | "group_id"
  >;
  approved_by?: string | null;
  approved_at?: string | null;
}

export interface DeviceExecutorAssignment {
  id: string;
  group_id: string;
  device_id: string;
  executor_id: string;
  bounty_claim_id: string | null;
  assigned_by: string;
  status: "active" | "revoked";
  created_at: string;
  revoked_at: string | null;
}

export interface DeviceDataHourLog {
  id: string;
  group_id: string;
  device_id: string;
  bounty_claim_id: string | null;
  assignment_id: string | null;
  registered_hours: number;
  registered_by: string;
  note: string | null;
  created_at: string;
}

export interface ExecutorTier {
  tier_id: string;
  name: string;
  min_points: number;
  max_concurrent_claims: number;
  sort_order: number;
}

export interface ExecutorStats {
  user_id: string;
  points_balance: number;
  tier_id: string;
  active_claim_count: number;
  updated_at: string;
  executor_tiers?: ExecutorTier;
}

export interface PointLedgerEntry {
  id: string;
  user_id: string;
  delta: number;
  reason: PointLedgerReason;
  ref_claim_id: string | null;
  note: string | null;
  balance_after: number;
  created_at: string;
}

export interface ExecutorProfileView {
  stats: ExecutorStats;
  tier: ExecutorTier;
  nextTier: ExecutorTier | null;
  pointsToNext: number | null;
  ledger: PointLedgerEntry[];
  tiers: ExecutorTier[];
}

const BOUNTIES = "bounties";
const CLAIMS = "bounty_claims";
const STATS = "executor_stats";
const TIERS = "executor_tiers";
const LEDGER = "executor_point_ledger";

export async function processOverdueBountyClaims(): Promise<void> {
  const { error } = await supabase.rpc("process_overdue_bounty_claims");
  if (error) throw new Error(error.message);
}

export async function listBountiesForGroup(groupId: string): Promise<Bounty[]> {
  const { data, error } = await supabase
    .from(BOUNTIES)
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Bounty[];
}

export async function listOpenBountiesForGroup(groupId: string): Promise<Bounty[]> {
  await processOverdueBountyClaims();
  const { data, error } = await supabase
    .from(BOUNTIES)
    .select("*")
    .eq("group_id", groupId)
    .eq("status", "open")
    .gt("remaining_hours", 0)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Bounty[];
}

export async function listClaimsForBounty(bountyId: string): Promise<BountyClaim[]> {
  const { data, error } = await supabase
    .from(CLAIMS)
    .select("*")
    .eq("bounty_id", bountyId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BountyClaim[];
}

export function dailyClaimLimitForSlots(slots: number): number {
  return slots * BOUNTY_HOURS_PER_SLOT_PER_DAY;
}

/** 与 DB 一致：按 Asia/Shanghai 自然日汇总当日所有领取的 claimed_hours */
export function sumClaimedHoursToday(claims: BountyClaim[]): number {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: BOUNTY_CLAIM_DAY_TIMEZONE });
  return claims
    .filter(
      (c) =>
        new Date(c.created_at).toLocaleDateString("en-CA", { timeZone: BOUNTY_CLAIM_DAY_TIMEZONE }) === today
    )
    .reduce((s, c) => s + c.claimed_hours, 0);
}

export async function fetchMyDailyClaimUsage(): Promise<DailyClaimUsage | null> {
  const { data, error } = await supabase.rpc("get_my_daily_claim_usage");
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object") return null;
  return data as DailyClaimUsage;
}

export async function listMyClaims(): Promise<BountyClaim[]> {
  await processOverdueBountyClaims();
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) return [];
  const { data, error } = await supabase
    .from(CLAIMS)
    .select(
      "*, bounties(title, hourly_rate, points_per_hour, completion_days, assigned_operator_id, group_id)"
    )
    .eq("executor_id", u.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BountyClaim[];
}

export async function listActiveClaimsForGroup(groupId: string): Promise<BountyClaim[]> {
  await processOverdueBountyClaims();
  const { data, error } = await supabase
    .from(CLAIMS)
    .select(
      "*, bounties!inner(title, hourly_rate, points_per_hour, completion_days, assigned_operator_id, group_id)"
    )
    .eq("status", "active")
    .eq("bounties.group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as BountyClaim[];
}

export async function listAllTiers(): Promise<ExecutorTier[]> {
  const { data, error } = await supabase.from(TIERS).select("*").order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ExecutorTier[];
}

export async function fetchMyExecutorProfile(): Promise<ExecutorProfileView | null> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) return null;
  const tiers = await listAllTiers();
  const { data: statsRow, error: statsErr } = await supabase
    .from(STATS)
    .select("*, executor_tiers(*)")
    .eq("user_id", u.id)
    .maybeSingle();
  if (statsErr) throw new Error(statsErr.message);

  const balance = statsRow?.points_balance ?? 0;
  const tier =
    (statsRow?.executor_tiers as ExecutorTier | undefined) ??
    tiers.find((t) => balance >= t.min_points) ??
    tiers[0];
  const nextTier = tiers.find((t) => t.min_points > balance) ?? null;
  const pointsToNext = nextTier ? Math.max(0, nextTier.min_points - balance) : null;

  const { data: ledger, error: ledgerErr } = await supabase
    .from(LEDGER)
    .select("*")
    .eq("user_id", u.id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (ledgerErr) throw new Error(ledgerErr.message);

  return {
    stats: statsRow
      ? (statsRow as ExecutorStats)
      : {
          user_id: u.id,
          points_balance: 0,
          tier_id: tier.tier_id,
          active_claim_count: 0,
          updated_at: new Date().toISOString(),
        },
    tier,
    nextTier,
    pointsToNext,
    ledger: (ledger ?? []) as PointLedgerEntry[],
    tiers,
  };
}

export async function publishBounty(input: {
  groupId: string;
  title: string;
  totalHours: number;
  hourlyRate: number;
  completionDays: 1 | 2 | 3;
  description?: string;
  pointsPerHour?: number;
  assignedOperatorId: string;
  partyDemandIds: string[];
}): Promise<string> {
  if (!input.partyDemandIds.length) {
    throw new Error("请至少选择一种可用设备类型（甲方业务）");
  }
  const { data, error } = await supabase.rpc("publish_bounty", {
    p_group_id: input.groupId,
    p_title: input.title,
    p_total_hours: input.totalHours,
    p_hourly_rate: input.hourlyRate,
    p_completion_days: input.completionDays,
    p_description: input.description ?? null,
    p_points_per_hour: input.pointsPerHour ?? 1,
    p_assigned_operator_id: input.assignedOperatorId,
    p_party_demand_ids: input.partyDemandIds,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function listBountyAllowedPartyDemands(bountyId: string): Promise<BountyAllowedPartyDemand[]> {
  const { data, error } = await supabase
    .from("bounty_allowed_party_demands")
    .select("party_demand_id, party_demands(client_company, title, device_type)")
    .eq("bounty_id", bountyId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const pd = row.party_demands as
      | { client_company: string | null; title: string | null; device_type: string | null }
      | { client_company: string | null; title: string | null; device_type: string | null }[]
      | null;
    const p = Array.isArray(pd) ? pd[0] : pd;
    return {
      party_demand_id: row.party_demand_id as string,
      client_company: p?.client_company ?? null,
      title: p?.title ?? null,
      device_type: p?.device_type ?? null,
    };
  });
}

export async function checkoutDeviceForClaim(claimId: string, deviceId: string): Promise<string> {
  const { data, error } = await supabase.rpc("checkout_device_for_claim", {
    p_claim_id: claimId,
    p_device_id: deviceId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function returnAndSettleSession(
  assignmentId: string,
  sessionHours: number,
  note?: string
): Promise<ReturnSettleResult> {
  const { data, error } = await supabase.rpc("return_and_settle_session", {
    p_assignment_id: assignmentId,
    p_session_hours: sessionHours,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    assignment_id: String(row.assignment_id ?? assignmentId),
    hour_log_id: String(row.hour_log_id ?? ""),
    settlement_line_id: row.settlement_line_id ? String(row.settlement_line_id) : null,
    session_hours: Number(row.session_hours) || 0,
    amount: Number(row.amount) || 0,
    executed_hours: Number(row.executed_hours) || 0,
    claimed_hours: Number(row.claimed_hours) || 0,
    claim_completed: Boolean(row.claim_completed),
  };
}

export async function listAssignableDevicesForClaim(claimId: string): Promise<AssignableDevice[]> {
  const { data, error } = await supabase.rpc("list_assignable_devices_for_claim", {
    p_claim_id: claimId,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) return [];
  return data as AssignableDevice[];
}

export async function getActiveCheckoutForClaim(claimId: string): Promise<ClaimCheckout | null> {
  const { data, error } = await supabase.rpc("get_active_checkout_for_claim", {
    p_claim_id: claimId,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    device_id: String(row.device_id),
    executor_id: String(row.executor_id),
    created_at: String(row.created_at),
  };
}

export async function listMyActiveCheckouts(): Promise<DeviceExecutorAssignment[]> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) return [];
  const { data, error } = await supabase
    .from("device_executor_assignments")
    .select("*")
    .eq("executor_id", u.id)
    .eq("status", "active")
    .not("bounty_claim_id", "is", null)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DeviceExecutorAssignment[];
}

export async function listClaimHourLogs(claimId: string): Promise<DeviceDataHourLog[]> {
  const { data, error } = await supabase
    .from("device_data_hour_logs")
    .select("*")
    .eq("bounty_claim_id", claimId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DeviceDataHourLog[];
}

export async function closeBounty(bountyId: string): Promise<void> {
  const { error } = await supabase.rpc("close_bounty", { p_bounty_id: bountyId });
  if (error) throw new Error(error.message);
}

export async function claimBounty(bountyId: string, hours: number): Promise<string> {
  const { data, error } = await supabase.rpc("claim_bounty", {
    p_bounty_id: bountyId,
    p_hours: hours,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function completeBountyClaim(claimId: string, executedHours: number): Promise<void> {
  const { error } = await supabase.rpc("complete_bounty_claim", {
    p_claim_id: claimId,
    p_executed_hours: executedHours,
  });
  if (error) throw new Error(error.message);
}

export async function abandonBountyClaim(claimId: string): Promise<void> {
  const { error } = await supabase.rpc("abandon_bounty_claim", { p_claim_id: claimId });
  if (error) throw new Error(error.message);
}

export async function adminFailBountyClaim(claimId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc("admin_fail_bounty_claim", {
    p_claim_id: claimId,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function operatorApproveBountyClaim(claimId: string, confirmedHours: number): Promise<void> {
  const { error } = await supabase.rpc("operator_approve_bounty_claim", {
    p_claim_id: claimId,
    p_confirmed_hours: confirmedHours,
  });
  if (error) throw new Error(error.message);
}

export async function operatorRejectBountyClaim(claimId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc("operator_reject_bounty_claim", {
    p_claim_id: claimId,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function assignDeviceToExecutor(deviceId: string, executorId: string): Promise<string> {
  const { data, error } = await supabase.rpc("assign_device_to_executor", {
    p_device_id: deviceId,
    p_executor_id: executorId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function revokeDeviceAssignment(assignmentId: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_device_assignment", {
    p_assignment_id: assignmentId,
  });
  if (error) throw new Error(error.message);
}

export async function registerDeviceDataHours(input: {
  deviceId: string;
  registeredHours: number;
  bountyClaimId?: string;
  note?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("register_device_data_hours", {
    p_device_id: input.deviceId,
    p_registered_hours: input.registeredHours,
    p_bounty_claim_id: input.bountyClaimId ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function listMyDeviceAssignments(): Promise<DeviceExecutorAssignment[]> {
  const { data, error } = await supabase
    .from("device_executor_assignments")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DeviceExecutorAssignment[];
}

export async function listMyDeviceHourLogs(limit = 50): Promise<DeviceDataHourLog[]> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) return [];
  const { data, error } = await supabase
    .from("device_data_hour_logs")
    .select("*")
    .eq("registered_by", u.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as DeviceDataHourLog[];
}

export async function sumRegisteredHoursForClaim(claimId: string): Promise<number> {
  const { data, error } = await supabase
    .from("device_data_hour_logs")
    .select("registered_hours")
    .eq("bounty_claim_id", claimId);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((s, r) => s + Number(r.registered_hours), 0);
}

export function bountyStatusLabel(s: BountyStatus): string {
  if (s === "open") return "开放领取";
  if (s === "fulfilled") return "已领满";
  return "已关闭";
}

export function claimStatusLabel(s: BountyClaimStatus): string {
  const map: Record<BountyClaimStatus, string> = {
    active: "进行中",
    completed: "已完成",
    failed: "未完成",
    expired: "已超时",
    abandoned: "已放弃",
  };
  return map[s];
}

export function ledgerReasonLabel(r: PointLedgerReason): string {
  const map: Record<PointLedgerReason, string> = {
    complete: "完成加分",
    penalty: "未完成扣分",
    admin_adjust: "管理员调账",
    abandon: "主动放弃",
  };
  return map[r];
}

export function formatDueCountdown(dueAt: string): string {
  const ms = new Date(dueAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return "—";
  if (ms <= 0) return "已到期";
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  const rh = h % 24;
  if (d > 0) return `剩余 ${d} 天 ${rh} 小时`;
  return `剩余 ${h} 小时`;
}

export function estimatePenaltyPoints(claimedHours: number, pointsPerHour: number): number {
  return Math.ceil(claimedHours * pointsPerHour);
}
