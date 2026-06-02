import { supabase } from "./supabase";

export interface WalletSummary {
  available_balance: number;
  pending_balance: number;
  total_settled: number;
  total_withdrawn: number;
}

export interface SettlementPreview {
  claim_id: string;
  claim_status: string;
  claimed_hours: number;
  registered_hours_sum: number;
  hourly_rate: number;
  bounty_title: string;
  already_settled: boolean;
  estimated_amount: number;
}

export type SettlementLineStatus = "pending" | "settled" | "reversed";

export interface SettlementLine {
  id: string;
  user_id: string;
  group_id: string;
  bounty_claim_id: string;
  bounty_id: string;
  confirmed_hours: number;
  registered_hours_sum: number;
  hourly_rate_snapshot: number;
  amount: number;
  status: SettlementLineStatus;
  operator_note: string | null;
  approved_by: string | null;
  settled_at: string;
  created_at: string;
}

export type WalletLedgerReason = "settlement" | "withdraw_hold" | "withdraw_paid" | "admin_adjust" | "reversal";

export interface WalletLedgerEntry {
  id: string;
  user_id: string;
  delta: number;
  balance_after: number;
  reason: WalletLedgerReason;
  ref_settlement_line_id: string | null;
  note: string | null;
  created_at: string;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchMyWalletSummary(): Promise<WalletSummary> {
  const { data, error } = await supabase.rpc("get_my_wallet_summary");
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    available_balance: num(row.available_balance),
    pending_balance: num(row.pending_balance),
    total_settled: num(row.total_settled),
    total_withdrawn: num(row.total_withdrawn),
  };
}

export async function previewSettlementForClaim(claimId: string): Promise<SettlementPreview> {
  const { data, error } = await supabase.rpc("preview_settlement_for_claim", {
    p_claim_id: claimId,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    claim_id: String(row.claim_id ?? claimId),
    claim_status: String(row.claim_status ?? ""),
    claimed_hours: num(row.claimed_hours),
    registered_hours_sum: num(row.registered_hours_sum),
    hourly_rate: num(row.hourly_rate),
    bounty_title: String(row.bounty_title ?? "悬赏单"),
    already_settled: Boolean(row.already_settled),
    estimated_amount: num(row.estimated_amount),
  };
}

export async function settleBountyClaim(
  claimId: string,
  confirmedHours: number,
  note?: string
): Promise<void> {
  const { error } = await supabase.rpc("settle_bounty_claim", {
    p_claim_id: claimId,
    p_confirmed_hours: confirmedHours,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function listMySettlementLines(limit = 50): Promise<SettlementLine[]> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) return [];
  const { data, error } = await supabase
    .from("executor_settlement_lines")
    .select("*")
    .eq("user_id", u.id)
    .order("settled_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SettlementLine[];
}

export async function listMyWalletLedger(limit = 50): Promise<WalletLedgerEntry[]> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) return [];
  const { data, error } = await supabase
    .from("executor_wallet_ledger")
    .select("*")
    .eq("user_id", u.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as WalletLedgerEntry[];
}

export function formatCny(amount: number): string {
  return `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function walletLedgerReasonLabel(r: WalletLedgerReason): string {
  const map: Record<WalletLedgerReason, string> = {
    settlement: "悬赏结算",
    withdraw_hold: "提现冻结",
    withdraw_paid: "提现到账",
    admin_adjust: "管理员调账",
    reversal: "冲正",
  };
  return map[r];
}

export function estimateSettlementAmount(confirmedHours: number, hourlyRate: number): number {
  return Math.round(confirmedHours * hourlyRate * 100) / 100;
}
