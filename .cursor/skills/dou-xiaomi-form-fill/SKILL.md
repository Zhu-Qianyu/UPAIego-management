---
name: dou-xiaomi-form-fill
description: >-
  扩展或维护豆小秘代填：formCatalog、formFillInfer 兜底、agentForms 执行器。
  用户说添加甲方/批量登记离线设备/创建场景时使用；禁止 toast 或跳转代替写入。
---

# 豆小秘代填表单 Skill

## 铁律

1. **有字段 + 添加/创建/登记** → 必须 `form_fills`，`actions` 为空
2. **禁止** `scene_tab` / `navigate` 代填
3. **禁止** `toast` 假写入（如「添加设备信息：甲方=…」）
4. 用户点「可以」后前端 `executeAgentFormFills` 才入库

## 关键话术 → form 类型

| 用户说法 | form |
|---------|------|
| 添加甲方业务，智元觅蜂 | `party_demand_create`（缺省 device_type=通用设备, max_hours=8） |
| 增加15台离线设备，甲方智元觅蜂，类型头戴单目 | `manual_devices_batch_create` |
| 创建大场景：…联系人…地址… | `scene_macro_create` |

## 批量离线设备

- 表单：`manual_devices_batch_create`
- 字段：`client_company`, `count`(1-50), `device_type?`, `label_prefix?`
- 执行：按甲方查 `party_demand_id`，循环 `createManualTrackedDevice`，简称如 头戴单目01…15，编号 ZYMF0001 递增
- **一条 form_fill 可登记多台**，不算 3 条上限里的 3 台

## 兜底推断（LLM 失败时）

Edge + 前端 `formFillInfer.ts`（逻辑须同步）：
- `inferManualDevicesBatch` — 优先于甲方业务
- `inferPartyDemandCreate` — 支持「添加甲方业务，公司名」无冒号
- `stripActionsWhenFormFills` — 去掉跳转与假 toast

## 改代码 checklist

1. `formCatalog.ts` + `index.ts` SYSTEM_PROMPT 示例
2. `formFillInfer.ts`（frontend + edge 同步）
3. `agentFormTypes.ts` + `agentForms.ts` 执行器
4. `sceneAgent.ts` 合并 infer、strip actions
5. 需图：`party_demand_create` 在聊天确认条选图

## 部署

改 Edge → 重启 `scene-ai-agent`；改前端 → build + push。
