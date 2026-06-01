import { supabase } from "./supabase";

export type BountyStatus = "open" | "fulfilled" | "closed";
export type BountyClaimStatus = "active" | "completed" | "failed" | "expired" | "abandoned";
export type PointLedgerReason = "complete" | "penalty" | "admin_adjust" | "abandon";

export interface Bounty {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  total_hours: number;
  remaining_hours: number;
  total_reward: number;
  completion_days: 1 | 2 | 3;
  points_per_hour: number;
  status: BountyStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
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
  bounties?: Pick<Bounty, "title" | "total_reward" | "points_per_hour" | "completion_days">;
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

export async function listMyClaims(): Promise<BountyClaim[]> {
  await processOverdueBountyClaims();
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) return [];
  const { data, error } = await supabase
    .from(CLAIMS)
    .select("*, bounties(title, total_reward, points_per_hour, completion_days)")
    .eq("executor_id", u.id)
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
  totalReward: number;
  completionDays: 1 | 2 | 3;
  description?: string;
  pointsPerHour?: number;
}): Promise<string> {
  const { data, error } = await supabase.rpc("publish_bounty", {
    p_group_id: input.groupId,
    p_title: input.title,
    p_total_hours: input.totalHours,
    p_total_reward: input.totalReward,
    p_completion_days: input.completionDays,
    p_description: input.description ?? null,
    p_points_per_hour: input.pointsPerHour ?? 1,
  });
  if (error) throw new Error(error.message);
  return data as string;
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
