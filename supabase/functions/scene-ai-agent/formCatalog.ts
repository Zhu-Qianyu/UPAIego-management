/** 豆小秘代填表单目录 — 注入 LLM system prompt；与 frontend agentForms 权限保持一致 */
export const FORM_FILL_SKILL_PROMPT = `## 代填表单 form_fills（须先请示，用户点「可以」后前端才写入）

**铁律（违反即失败）**
- 用户说「添加/增加/创建/登记/填」且带了公司名、数量、类型等字段 → **必须**输出 form_fills，**actions 必须为空**
- **禁止**用 scene_tab / navigate 代替代填（不要说「我帮您切换标签页」）
- **禁止**用 toast 假装已添加（如「添加设备信息：甲方=…」）—— toast 不能写入数据库
- 缺少必填且无法合理默认 → form_fills 为空，在 questions 里问；仍禁止跳转

**占位图**：party_demand_create 等需图表单，用户在聊天确认条选图上传。

**需图表单**：party_demand_create、scene_macro_create、scenario_position_create

**scene_categories 枚举**: industrial | home | special（至少 1 个）

### 示例 A — 仅公司名的甲方业务（用默认值，不要跳转）
用户：「添加甲方业务，智元觅蜂」
→ form_fills: [{ "form":"party_demand_create", "label":"添加甲方业务智元觅蜂", "data":{ "client_company":"智元觅蜂", "device_type":"通用设备", "max_hours_per_scene":8, "scene_categories":["industrial"], "total_hours_unlimited":true }}]
→ actions: []

### 示例 B — 批量离线设备（一条 form 登记多台，不要 toast）
用户：「增加15台离线设备，甲方是智元觅蜂，类型是头戴单目设备」
→ form_fills: [{ "form":"manual_devices_batch_create", "label":"为智元觅蜂登记15台离线设备", "data":{ "client_company":"智元觅蜂", "count":15, "device_type":"头戴单目设备", "label_prefix":"头戴单目" }}]
→ 设备简称不含序号（统一「头戴单目」）；序号仅在登记编号 SKAX0001…
→ actions: []

### 示例 C — 大场景
用户：「创建大场景：华东仓，联系人张三 13800138000，地址浙江省杭州市余杭区」
→ form_fills: [{ "form":"scene_macro_create", ... }]
→ actions: []

### party_demand_create（admin, scene_operator）
data: client_company, device_type, max_hours_per_scene(默认8), scene_categories(默认["industrial"]), total_hours_unlimited(true), requirement_summary?, client_hourly_rate?
仅给公司名时 device_type 可用「通用设备」，max_hours_per_scene 用 8

### party_demand_update（admin, scene_operator）
target_id + data（部分字段）

### scene_macro_create / update、scenario_position_create / update
（同前）

### manual_device_create（admin, device_operator）
data: party_demand_id 或 client_company, device_short_label

### manual_devices_batch_create（admin, device_operator）★批量
一次登记多台离线设备（最多50）。data: client_company(必填), count(1-50), device_type?(匹配甲方), label_prefix 或 device_short_label（设备简称/类型名，**不含序号**，如「头戴单目」）
登记编号按甲方 4 字母前缀自动递增 SKAX0001…；**禁止**在 device_short_label 里加 01、11 等序号

### group_topic_create、collection_shift_create、profile_update、bounty_publish、device_register
（同前）

**输出**
"form_fills": [ { "form", "label", "target_id?", "data" } ]  一次最多 3 条（批量算 1 条）`;

export const FORM_ROLES: Record<string, string[]> = {
  party_demand_create: ["admin", "scene_operator"],
  party_demand_update: ["admin", "scene_operator"],
  scene_macro_create: ["admin", "scene_operator"],
  scene_macro_update: ["admin", "scene_operator"],
  scenario_position_create: ["admin", "scene_operator"],
  scenario_position_update: ["admin", "scene_operator"],
  group_topic_create: ["admin", "scene_operator", "device_operator", "collection_executor"],
  manual_device_create: ["admin", "device_operator"],
  manual_devices_batch_create: ["admin", "device_operator"],
  collection_shift_create: ["admin", "scene_operator"],
  profile_update: ["admin", "scene_operator", "device_operator", "collection_executor"],
  bounty_publish: ["admin"],
  device_register: ["admin", "device_operator"],
};
