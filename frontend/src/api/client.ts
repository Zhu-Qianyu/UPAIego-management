import { supabase } from "./supabase";

// ---------- Types ----------

export interface Device {
  device_id: string;
  user_id: string;
  readable_name: string;
  serial_id: string | null;
  registered_at: string | null;
  last_seen: string | null;
  calibration_status: string;
  calibration_date: string | null;
  status: string;
  firmware_version: string | null;
  notes: string | null;
  calibration: any | null;
}

export interface DeviceList {
  total: number;
  devices: Device[];
}

export interface GeneratedDevicePair {
  device_id: string;
  readable_name: string;
}

// ---------- Helpers ----------

function throwOnError<T>(result: { data: T | null; error: any; count?: number | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  const userId = data.user?.id;
  if (!userId) throw new Error("You must be logged in.");
  return userId;
}

// ---------- Next readable name ----------

function nextReadableName(existingNames: string[]): string {
  let max = 0;
  for (const name of existingNames) {
    const num = parseInt(name, 10);
    if (!isNaN(num) && num > max) max = num;
  }
  return String(max + 1);
}

// ---------- Generate device_id / readable_name pair ----------

export async function generateDevicePair(): Promise<GeneratedDevicePair> {
  const userId = await requireUserId();
  const { data } = await supabase
    .from("devices")
    .select("readable_name")
    .eq("user_id", userId);

  const names = (data ?? []).map((d: any) => d.readable_name);
  const readable_name = nextReadableName(names);
  const device_id = crypto.randomUUID();

  return { device_id, readable_name };
}

// ---------- API functions ----------

export async function registerDevice(params: {
  serial_id?: string;
}): Promise<Device> {
  const userId = await requireUserId();
  const { device_id, readable_name } = await generateDevicePair();

  const now = new Date().toISOString();

  const result = await supabase
    .from("devices")
    .insert({
      device_id,
      user_id: userId,
      readable_name,
      serial_id: params.serial_id ?? null,
      registered_at: now,
      last_seen: now,
      calibration_status: "pending",
      status: "active",
      calibration_date: null,
      firmware_version: null,
      notes: null,
      calibration: null,
    })
    .select()
    .single();

  return throwOnError(result);
}

export async function listDevices(params?: {
  offset?: number;
  limit?: number;
  status?: string;
  calibration_status?: string;
}): Promise<DeviceList> {
  const userId = await requireUserId();
  const offset = params?.offset ?? 0;
  const limit = params?.limit ?? 50;

  let query = supabase
    .from("devices")
    .select("*", { count: "exact" })
    .eq("user_id", userId);

  if (params?.status) {
    query = query.eq("status", params.status);
  }
  if (params?.calibration_status) {
    query = query.eq("calibration_status", params.calibration_status);
  }

  const result = await query
    .order("registered_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (result.error) throw new Error(result.error.message);

  return {
    total: result.count ?? 0,
    devices: (result.data ?? []) as Device[],
  };
}

export async function getDevice(deviceId: string): Promise<Device> {
  const userId = await requireUserId();
  const result = await supabase
    .from("devices")
    .select("*")
    .eq("user_id", userId)
    .eq("device_id", deviceId)
    .single();

  return throwOnError(result);
}

export async function updateDevice(
  deviceId: string,
  body: Partial<
    Pick<
      Device,
      | "calibration_status"
      | "calibration_date"
      | "status"
      | "firmware_version"
      | "notes"
      | "calibration"
    >
  >
): Promise<Device> {
  const userId = await requireUserId();
  const result = await supabase
    .from("devices")
    .update({ ...body, last_seen: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("device_id", deviceId)
    .select()
    .single();

  return throwOnError(result);
}

export async function deleteDevice(deviceId: string): Promise<Device> {
  const userId = await requireUserId();
  const result = await supabase
    .from("devices")
    .update({ status: "retired", last_seen: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("device_id", deviceId)
    .select()
    .single();

  return throwOnError(result);
}

export async function searchDevices(
  q: string,
  params?: { offset?: number; limit?: number }
): Promise<DeviceList> {
  const userId = await requireUserId();
  const offset = params?.offset ?? 0;
  const limit = params?.limit ?? 50;
  const pattern = `%${q}%`;

  const result = await supabase
    .from("devices")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .or(
      `device_id.ilike.${pattern},readable_name.ilike.${pattern},serial_id.ilike.${pattern},notes.ilike.${pattern}`
    )
    .order("registered_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (result.error) throw new Error(result.error.message);

  return {
    total: result.count ?? 0,
    devices: (result.data ?? []) as Device[],
  };
}
