import type { SceneCategoryKey } from "../utils/sceneCategories";

/** 豆小秘可代为填写的表单类型（与 edge formCatalog 保持一致） */
export type AgentFormKind =
  | "party_demand_create"
  | "party_demand_update"
  | "scene_macro_create"
  | "scene_macro_update"
  | "scenario_position_create"
  | "scenario_position_update"
  | "group_topic_create"
  | "manual_device_create"
  | "manual_devices_batch_create"
  | "manual_devices_batch_delete"
  | "manual_devices_batch_assign"
  | "collection_shift_create"
  | "profile_update"
  | "bounty_publish"
  | "device_register";

export type AgentPendingFormFill = {
  form: AgentFormKind;
  label: string;
  target_id?: string;
  data: Record<string, unknown>;
};

export type PartyDemandFormData = {
  client_company: string;
  device_type: string;
  max_hours_per_scene: number;
  scene_categories: SceneCategoryKey[];
  total_hours_unlimited?: boolean;
  total_hours_required?: number | null;
  requirement_summary?: string | null;
  client_hourly_rate?: number | null;
};

export type SceneMacroFormData = {
  title: string;
  contact_name: string;
  contact_phone: string;
  address_province: string;
  address_city: string;
  address_district: string;
  description?: string | null;
  address_detail?: string | null;
};

export type ScenarioPositionFormData = {
  macro_scene_id: string;
  title: string;
  scene_categories: SceneCategoryKey[];
  address_province: string;
  address_city: string;
  address_district: string;
  process_description?: string | null;
  address_detail?: string | null;
};

export type GroupTopicFormData = {
  title: string;
  body?: string | null;
};

export type ManualDevicesBatchFormData = {
  client_company: string;
  count: number;
  device_type?: string | null;
  /** 批量登记共用设备简称（不含序号），如「头戴单目」 */
  label_prefix?: string | null;
  device_short_label?: string | null;
  party_demand_id?: string | null;
};

export type ManualDeviceFormData = {
  party_demand_id: string;
  device_short_label: string;
};

/** 批量删除离线设备：public_codes 或 client_company + 可选筛选 */
export type ManualDevicesBatchDeleteFormData = {
  public_codes?: string[];
  client_company?: string | null;
  label_prefix?: string | null;
  device_short_label?: string | null;
};

/** 批量分配离线设备给执行员；executor_user_id 为空或 idle 表示设为空闲 */
export type ManualDevicesBatchAssignFormData = {
  executor_user_id?: string | null;
  executor_name?: string | null;
  executor_phone?: string | null;
  public_codes?: string[];
  client_company?: string | null;
  label_prefix?: string | null;
  device_short_label?: string | null;
  only_idle?: boolean;
};

export type CollectionShiftFormData = {
  scenario_position_id: string;
  executor_user_id: string;
  device_count: number;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  note?: string | null;
  publish?: boolean;
};

export type ProfileUpdateFormData = {
  real_name?: string | null;
  display_name?: string | null;
  phone?: string | null;
  contact_email?: string | null;
};

export type BountyPublishFormData = {
  title?: string;
  total_hours: number;
  hourly_rate: number;
  completion_days: 1 | 2 | 3;
  assigned_operator_id: string;
  party_demand_ids: string[];
  description?: string | null;
};

export type DeviceRegisterFormData = {
  serial_id?: string | null;
};
