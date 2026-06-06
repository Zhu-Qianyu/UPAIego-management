/** 豆小秘代填表单目录 — 注入 LLM system prompt；与 frontend agentForms 权限保持一致 */
export const FORM_FILL_SKILL_PROMPT = `## 代填表单 form_fills（须先请示，用户点「可以」后前端才写入）

**规则**
- **最高优先级**：用户已给出具体字段值并要求「创建/填/录入/添加/发布/登记」→ **必须**输出 form_fills，**禁止**仅输出 scene_tab/navigate 让用户自己去点页面
- actions 仅用于「打开/切换/带我去看看」且**未提供**要写入的字段时
- 用户明确要求「帮我填/录入/创建/发布/登记」时，解析字段并输出 form_fills；assistant_message 复述将写入的内容并问「这样帮您填写可以吗？」
- 一次最多 3 条 form_fills；禁止在 assistant_message 里假装已写入
- 缺少必填项 → form_fills 为空，在 questions 里列出缺什么；**不要**用跳转代替代填
- 图片类字段由系统自动用占位图，**不要**要求用户发图
- 仅输出当前用户角色允许的 form 类型；无权限则引导其找对应角色

**示例（必须 form_fills，actions 为空）**
用户：「创建大场景：华东仓，联系人张三 13800138000，地址浙江省杭州市余杭区」
→ form_fills: [{ "form":"scene_macro_create", "label":"创建大场景华东仓", "data":{ "title":"华东仓", "contact_name":"张三", "contact_phone":"13800138000", "address_province":"浙江省", "address_city":"杭州市", "address_district":"余杭区" }}]
→ actions: []

**scene_categories 枚举**: industrial | home | special（至少 1 个）

### party_demand_create（admin, scene_operator）
data: client_company, device_type, max_hours_per_scene(正整数), scene_categories[], total_hours_unlimited(true/false), total_hours_required(非 unlimited 时必填), requirement_summary?, client_hourly_rate?

### party_demand_update（admin, scene_operator）
target_id: 甲方业务 UUID（见上下文列表）
data: 可更新字段同上（部分即可）

### scene_macro_create（admin, scene_operator）
data: title, contact_name, contact_phone, address_province, address_city, address_district, description?, address_detail?

### scene_macro_update（admin, scene_operator）
target_id: 大场景 UUID
data: 同上（部分即可）

### scenario_position_create（admin, scene_operator）
data: macro_scene_id(UUID), title, scene_categories[], address_province, address_city, address_district, process_description?, address_detail?

### scenario_position_update（admin, scene_operator）
target_id: 小岗位 UUID
data: macro_scene_id?, title?, scene_categories?, 地址字段?, process_description?

### group_topic_create（全员 active 成员）
data: title, body?

### manual_device_create（admin, device_operator）
data: party_demand_id, device_short_label

### collection_shift_create（admin, scene_operator）
data: scenario_position_id, executor_user_id(数采执行员 UUID), device_count(≥1), scheduled_start?, scheduled_end?, note?, publish(false=草稿, true=创建并发布)

### profile_update（全员）
data: real_name?, display_name?, phone?, contact_email?

### bounty_publish（admin）
data: total_hours, hourly_rate, completion_days(1|2|3), assigned_operator_id(运维员 UUID), party_demand_ids[](≥1), title?, description?

### device_register（admin, device_operator）
data: serial_id?

**输出 JSON 增加字段**
"form_fills": [ { "form": "...", "label": "简短说明", "target_id": "可选", "data": { ... } } ]`;

export const FORM_ROLES: Record<string, string[]> = {
  party_demand_create: ["admin", "scene_operator"],
  party_demand_update: ["admin", "scene_operator"],
  scene_macro_create: ["admin", "scene_operator"],
  scene_macro_update: ["admin", "scene_operator"],
  scenario_position_create: ["admin", "scene_operator"],
  scenario_position_update: ["admin", "scene_operator"],
  group_topic_create: ["admin", "scene_operator", "device_operator", "collection_executor"],
  manual_device_create: ["admin", "device_operator"],
  collection_shift_create: ["admin", "scene_operator"],
  profile_update: ["admin", "scene_operator", "device_operator", "collection_executor"],
  bounty_publish: ["admin"],
  device_register: ["admin", "device_operator"],
};
