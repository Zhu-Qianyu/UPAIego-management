---
name: dou-xiaomi-form-fill
description: >-
  扩展或维护豆小秘（scene-ai-agent）代填表单能力：formCatalog、agentForms
  执行器、Edge 上下文注入、前端确认流。用户要求豆小秘帮填甲方业务、场景岗位、
  排班、群话题、设备、悬赏、个人资料时使用。
---

# 豆小秘代填表单 Skill

## 何时使用

- 用户说「帮我填」「录入」「创建」「发布」「登记」某业务表单
- 新增/修改一种可代填表单类型
- 调试 form_fills 权限、字段校验或确认后未入库

## 架构（三层）

| 层 | 文件 | 职责 |
|----|------|------|
| LLM 目录 | `supabase/functions/scene-ai-agent/formCatalog.ts` | `FORM_FILL_SKILL_PROMPT`、`FORM_ROLES` |
| Edge | `supabase/functions/scene-ai-agent/index.ts` | `fetchFormContext`、`parseFormFills` → `pending_form_fills` |
| 前端执行 | `frontend/src/api/agentForms.ts` | `executeAgentFormFill(s)`，占位图上传 |
| UI | `frontend/src/components/SceneAiAssistant.tsx` | 「这样帮您填写可以吗？」→ 可以/不行 |

**铁律**：LLM 只输出 `form_fills`；**禁止**在 `assistant_message` 假装已写入。用户点「可以」后前端才调用 API。

## 新增一种表单（ checklist ）

1. 在 `formCatalog.ts` 增加 `### form_name` 文档 + `FORM_ROLES` 条目
2. 在 `frontend/src/aitebot/agentFormTypes.ts` 增加 `AgentFormKind` 与 `*FormData` 类型
3. 在 `agentForms.ts` 的 `FORM_ROLES` 与 `executeAgentFormFill` switch 实现
4. 若创建需图片，用 `placeholderImageFile()` + 现有 upload 辅助函数
5. 同步 Edge `FORM_ROLES`（与前端一致）
6. 更新 `docs/AGENT_FORM_FILL_CATALOG.md`

## 字段与上下文

- Edge 注入：`fetchFormContext` 提供甲方/大场景/小岗位 UUID 列表
- 成员 UUID：`fetchGroupMemberSummary` 供排班 `executor_user_id`、悬赏 `assigned_operator_id`
- `scene_categories`：`industrial` | `home` | `special`
- 一次最多 **3** 条 `form_fills`

## 占位图

`party_demand_create`、`scene_macro_create`、`scenario_position_create` 需快照字段；代填时用 1×1 JPEG 占位，用户可在页面后续替换。

## 未覆盖（勿承诺代填）

- 管理台 KPI/公告纯后台表单
- 需真实现场照片的 OCR/视觉录入
- 悬赏运维借还、钱包提现等**非创建类**运维动作

## 部署

改 Edge 后重启 CVM 上 `scene-ai-agent` 容器；改前端后 `npm run build` 并 push。

**form_fills 优先于跳转**：用户已给出字段并要求创建/填写时，禁止仅 `scene_tab`。Edge 与前端均有 `formFillInfer.ts` 兜底解析（如「创建大场景：华东仓，联系人…」）。

## 冒烟话术

> 帮我填一条甲方业务：公司「测试公司」，设备类型「协作臂」，单场景上限 8 小时，场景 industrial。

期望：豆小秘复述字段并问是否可以 → 点可以 → 场景页甲方业务出现新记录。
