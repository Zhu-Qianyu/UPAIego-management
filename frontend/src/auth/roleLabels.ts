import type { UserRole } from "../types/roles";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "管理员",
  device_operator: "设备运维员",
  scene_operator: "场景业务员",
  collection_executor: "数采执行员",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: "查看全平台数据，设置 KPI 与发布全员留言；可创建一个工作群组（他人仅可加入）",
  device_operator: "注册设备并监控设备在线与状态；加入由平台管理员提供的入群代码进入工作群",
  scene_operator: "发布场景任务并管理采集需求；加入由平台管理员提供的入群代码进入工作群",
  collection_executor:
    "在地图查看数采设备位置与存储进度，满条后到现场回收数据；加入由平台管理员提供的入群代码进入工作群",
};
