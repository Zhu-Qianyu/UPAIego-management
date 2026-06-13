import { assignDeviceToExecutor } from "./bounties";
import { supabase } from "./supabase";
import { fetchProfilesByIds, profileDisplayName, type ProfileContact } from "./profiles";
import { normalizeExternalDeviceStatus, type ManualTrackedDevice } from "./operations";
import { offlinePublicCodeFromAssignmentId, toOfflineDeviceAssignmentId } from "../utils/deviceAssignmentId";

export type OfflineDeviceAssignmentView = {
  assignmentId: string;
  executorId: string;
  executorName: string;
  bountyClaimId: string | null;
};

type AssignmentRow = {
  id: string;
  device_id: string;
  executor_id: string;
  bounty_claim_id: string | null;
};

export function formatManualDeviceExecutorLabel(
  row: ManualTrackedDevice,
  assignment?: OfflineDeviceAssignmentView
): string {
  if (normalizeExternalDeviceStatus(row.external_status) !== "normal") return "—";
  if (!assignment) return "空闲";
  if (assignment.bountyClaimId) return `${assignment.executorName}（悬赏借用）`;
  return assignment.executorName;
}

export async function listActiveOfflineAssignmentsByPublicCodes(
  publicCodes: string[]
): Promise<AssignmentRow[]> {
  const codes = [...new Set(publicCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (codes.length === 0) return [];
  const deviceIds = codes.map(toOfflineDeviceAssignmentId);
  const { data, error } = await supabase
    .from("device_executor_assignments")
    .select("id, device_id, executor_id, bounty_claim_id")
    .eq("status", "active")
    .in("device_id", deviceIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssignmentRow[];
}

export async function buildOfflineAssignmentMap(
  publicCodes: string[]
): Promise<Map<string, OfflineDeviceAssignmentView>> {
  const assignments = await listActiveOfflineAssignmentsByPublicCodes(publicCodes);
  const executorIds = [...new Set(assignments.map((a) => a.executor_id))];
  const profiles = await fetchProfilesByIds(executorIds);
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const map = new Map<string, OfflineDeviceAssignmentView>();
  for (const row of assignments) {
    const code = offlinePublicCodeFromAssignmentId(row.device_id);
    if (!code) continue;
    const profile = profileById.get(row.executor_id);
    map.set(code, {
      assignmentId: row.id,
      executorId: row.executor_id,
      executorName: profile ? profileDisplayName(profile) : row.executor_id.slice(0, 8),
      bountyClaimId: row.bounty_claim_id,
    });
  }
  return map;
}

async function assignOneManualDevice(publicCode: string, executorId: string): Promise<void> {
  const code = publicCode.trim().toUpperCase();
  const { error } = await supabase.rpc("assign_manual_tracked_device_to_executor", {
    p_public_code: code,
    p_executor_id: executorId,
  });
  if (!error) return;

  const msg = error.message ?? "";
  if (/assign_manual_tracked_device_to_executor|schema cache/i.test(msg)) {
    await assignDeviceToExecutor(toOfflineDeviceAssignmentId(code), executorId);
    return;
  }
  throw new Error(msg);
}

export async function assignManualTrackedDevicesToExecutor(
  publicCodes: string[],
  executorId: string
): Promise<{ assigned: number; failures: string[] }> {
  const unique = [...new Set(publicCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (unique.length === 0) return { assigned: 0, failures: [] };

  let assigned = 0;
  const failures: string[] = [];
  for (const code of unique) {
    try {
      await assignOneManualDevice(code, executorId);
      assigned += 1;
    } catch (e: unknown) {
      failures.push(`${code}：${e instanceof Error ? e.message : "分配失败"}`);
    }
  }

  if (assigned === 0 && failures.length > 0) {
    throw new Error(failures.length === 1 ? failures[0] : `分配失败：${failures[0]}`);
  }
  return { assigned, failures };
}

export async function releaseManualTrackedDevices(publicCodes: string[]): Promise<{ released: number; failures: string[] }> {
  const unique = [...new Set(publicCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (unique.length === 0) return { released: 0, failures: [] };

  let released = 0;
  const failures: string[] = [];
  for (const code of unique) {
    try {
      const { error } = await supabase.rpc("release_manual_tracked_device_assignment", {
        p_public_code: code,
      });
      if (error) {
        if (/release_manual_tracked_device_assignment|schema cache/i.test(error.message)) {
          throw new Error("设备分配功能未就绪，请联系管理员检查服务器数据库");
        }
        throw new Error(error.message);
      }
      released += 1;
    } catch (e: unknown) {
      failures.push(`${code}：${e instanceof Error ? e.message : "取消失败"}`);
    }
  }

  if (released === 0 && failures.length > 0) {
    throw new Error(failures.length === 1 ? failures[0] : `取消分配失败：${failures[0]}`);
  }
  return { released, failures };
}

export function isManualDeviceAssignable(row: ManualTrackedDevice, assignment?: OfflineDeviceAssignmentView): boolean {
  if (normalizeExternalDeviceStatus(row.external_status) !== "normal") return false;
  if (assignment?.bountyClaimId) return false;
  return true;
}

export function executorOptionLabel(p: ProfileContact): string {
  const name = profileDisplayName(p);
  return p.phone?.trim() ? `${name}（${p.phone.trim()}）` : name;
}
