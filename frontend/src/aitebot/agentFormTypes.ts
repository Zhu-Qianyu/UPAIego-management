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

export type ManualDeviceFormData = {
  party_demand_id: string;
  device_short_label: string;
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
