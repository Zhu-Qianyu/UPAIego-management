import type { UserRole } from "../types/roles";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "管理员",
  device_operator: "设备运维员",
  scene_operator: "场景业务员",
  collection_executor: "数采执行员",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: "查看全平台数据，设置 KPI 与发布全员留言；可创建一个工作群组（他人仅可加入）",
  device_operator:
    "注册联网设备并监控在线与状态；在设备管理「注册设备」页下方可登记离线设备（登记编号与二维码）；加入由平台管理员提供的入群代码进入工作群",
  scene_operator: "发布场景任务并管理采集需求；加入由平台管理员提供的入群代码进入工作群",
  collection_executor:
    "在地图查看数采设备位置与存储进度，满条后到现场回收数据；加入由平台管理员提供的入群代码进入工作群",
};
