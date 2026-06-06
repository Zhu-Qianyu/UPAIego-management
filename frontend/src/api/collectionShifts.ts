import { supabase } from "./supabase";

export type CollectionShiftStatus = "draft" | "published" | "closed";

export interface CollectionShift {
  id: string;
  group_id: string;
  scenario_position_id: string;
  executor_id: string;
  device_count: number;
  status: CollectionShiftStatus;
  note: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  published_at: string | null;
  closed_at: string | null;
  created_by: string;
  created_at: string;
}

export interface CollectionShiftDevice {
  id: string;
  shift_id: string;
  manual_device_id: string;
  public_code: string;
  device_label: string;
  sort_order: number;
  created_at: string;
}

export interface CollectionShiftClockSession {
  id: string;
  shift_id: string;
  executor_id: string;
  clock_in_at: string;
  clock_out_at: string | null;
  created_at: string;
}

export interface CollectionShiftBundle {
  shift: CollectionShift;
  devices: CollectionShiftDevice[];
  openSession: CollectionShiftClockSession | null;
}

function statusLabel(st: CollectionShiftStatus): string {
  if (st === "draft") return "草稿";
  if (st === "published") return "已发布";
  return "已关闭";
}

export { statusLabel as collectionShiftStatusLabel };

export async function listCollectionShifts(groupId: string): Promise<CollectionShift[]> {
  const { data, error } = await supabase
    .from("collection_shifts")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CollectionShift[];
}

export async function listMyCollectionShifts(groupId: string): Promise<CollectionShift[]> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) return [];
  const { data, error } = await supabase
    .from("collection_shifts")
    .select("*")
    .eq("group_id", groupId)
    .eq("executor_id", u.id)
    .in("status", ["published", "closed"])
    .order("published_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CollectionShift[];
}

export async function listDevicesForShifts(shiftIds: string[]): Promise<CollectionShiftDevice[]> {
  if (shiftIds.length === 0) return [];
  const { data, error } = await supabase
    .from("collection_shift_devices")
    .select("*")
    .in("shift_id", shiftIds)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CollectionShiftDevice[];
}

export async function listOpenClockSessions(shiftIds: string[]): Promise<CollectionShiftClockSession[]> {
  if (shiftIds.length === 0) return [];
  const { data, error } = await supabase
    .from("collection_shift_clock_sessions")
    .select("*")
    .in("shift_id", shiftIds)
    .is("clock_out_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as CollectionShiftClockSession[];
}

export async function loadCollectionShiftBundles(
  groupId: string,
  opts: { executorOnly: boolean }
): Promise<CollectionShiftBundle[]> {
  const shifts = opts.executorOnly
    ? await listMyCollectionShifts(groupId)
    : await listCollectionShifts(groupId);
  const ids = shifts.map((s) => s.id);
  const [devices, openSessions] = await Promise.all([
    listDevicesForShifts(ids),
    listOpenClockSessions(ids),
  ]);
  const devicesByShift = new Map<string, CollectionShiftDevice[]>();
  for (const d of devices) {
    const list = devicesByShift.get(d.shift_id) ?? [];
    list.push(d);
    devicesByShift.set(d.shift_id, list);
  }
  const openByShift = new Map(openSessions.map((s) => [s.shift_id, s]));
  return shifts.map((shift) => ({
    shift,
    devices: devicesByShift.get(shift.id) ?? [],
    openSession: openByShift.get(shift.id) ?? null,
  }));
}

export async function createCollectionShift(input: {
  groupId: string;
  scenarioPositionId: string;
  executorId: string;
  deviceCount: number;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  note?: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_collection_shift", {
    p_group_id: input.groupId,
    p_scenario_position_id: input.scenarioPositionId,
    p_executor_id: input.executorId,
    p_device_count: input.deviceCount,
    p_scheduled_start: input.scheduledStart ?? null,
    p_scheduled_end: input.scheduledEnd ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw new Error(error.message);
  return String(data);
}

export async function publishCollectionShift(shiftId: string): Promise<void> {
  const { error } = await supabase.rpc("publish_collection_shift", { p_shift_id: shiftId });
  if (error) throw new Error(error.message);
}

export async function closeCollectionShift(shiftId: string): Promise<void> {
  const { error } = await supabase.rpc("close_collection_shift", { p_shift_id: shiftId });
  if (error) throw new Error(error.message);
}

export async function deleteCollectionShiftDraft(shiftId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_collection_shift_draft", { p_shift_id: shiftId });
  if (error) throw new Error(error.message);
}

export async function deleteCollectionShiftDrafts(shiftIds: string[]): Promise<void> {
  for (const id of shiftIds) {
    await deleteCollectionShiftDraft(id);
  }
}

export async function clockInCollectionShift(shiftId: string): Promise<void> {
  const { error } = await supabase.rpc("clock_in_collection_shift", { p_shift_id: shiftId });
  if (error) throw new Error(error.message);
}

export async function clockOutCollectionShift(shiftId: string): Promise<void> {
  const { error } = await supabase.rpc("clock_out_collection_shift", { p_shift_id: shiftId });
  if (error) throw new Error(error.message);
}
