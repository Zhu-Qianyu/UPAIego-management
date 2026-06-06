# 场景智能助手 — AI 接入说明（国内 Token）

## 推荐：豆包 · 火山方舟（默认）

**本项目的豆小秘当前为纯文本对话**（视觉/发图/场景照片录入已下架）。请使用 **火山引擎火山方舟上的豆包文本模型**，不要用 DeepSeek 官方 `api.deepseek.com` 的 V3/R1 接口。

| 对比 | 豆包（火山方舟） | DeepSeek 官方 API |
|------|------------------|-------------------|
| 国内 Token | ✅ 火山引擎控制台充值 | ✅ 可用 |
| **图片输入** | ❌ 豆小秘已下架 | ❌ V3/R1 **仅文本** |
| 现场工位/全景图 | 请到「场景业务」页面手动录入 | 需另找 VL 或第三方 |
| OpenAI 兼容 | ✅ `/api/v3/chat/completions` | 部分兼容但无 Vision |

**结论：豆小秘默认 `AI_PROVIDER=doubao`，`ARK_MODEL` 选任意文本对话接入点即可（无需视觉模型）。**

---

## 1. 开通豆包 API

1. 注册 [火山引擎](https://www.volcengine.com/) 并完成实名
2. 打开 **火山方舟** → 创建 **API Key**
3. **模型广场** 开通文本对话模型，例如 Doubao-Seed 系列文本版（**无需**开通视觉/图片理解）
4. 在 **在线推理 → 推理接入点** 创建接入点，复制 **Endpoint ID**（形如 `ep-202406xxxxxx-xxxxx`）

文档：[图片理解 - 火山方舟](https://www.volcengine.com/docs/82379/1362931)

---

## 2. 部署 Edge Function 并配置 Secrets

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# 默认使用豆包（可不设 AI_PROVIDER）
supabase secrets set AI_PROVIDER=doubao
supabase secrets set ARK_API_KEY=你的火山方舟APIKey
supabase secrets set ARK_MODEL=你的推理接入点ID

# 可选，默认北京
# supabase secrets set ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3

supabase functions deploy scene-ai-agent
```

### 环境变量说明

| Secret | 必填 | 说明 |
|--------|------|------|
| `AI_PROVIDER` | 否 | `doubao`（默认）或 `openai` |
| `ARK_API_KEY` | 豆包必填 | 火山方舟 API Key |
| `ARK_MODEL` | 豆包必填 | 推理接入点 ID / 模型 endpoint |
| `ARK_BASE_URL` | 否 | 默认 `https://ark.cn-beijing.volces.com/api/v3` |
| `OPENAI_API_KEY` | 仅 openai | 海外 OpenAI 时使用 |
| `OPENAI_MODEL` | 否 | 默认 `gpt-4o-mini` |

---

## 3. 前端开关

```
VITE_SCENE_AI_ENABLED=true
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

---

## 4. 计费与用量

- Token 在 **火山引擎控制台** 充值，按方舟模型定价计费
- 豆小秘为纯文本对话，不含图片 token

---

## 5. 可选：OpenAI（海外）

仅当 `AI_PROVIDER=openai` 且配置 `OPENAI_API_KEY` 时走 OpenAI；使用文本模型（如 `gpt-4o-mini`）即可。

---

## 6. 群组智能体（豆小秘）

- **全群服务**：`admin` / `scene_operator` / `device_operator` / `collection_executor` 均可对话（须已加入 active 工作群）
- **分角色**：系统注入当前用户角色、页面与群内成员概况；回答与跳转按角色定制
- **群发收件箱**：管理员可对全员或指定角色群发（如「通知所有人明天放假」）；场景业务员可向数采执行员群发排班通知
- **数据库**：在 Supabase SQL Editor 执行 **`docs/AGENT_INBOX_MIGRATION.sql`**（表 `agent_inbox_messages` + RPC `send_agent_group_broadcast`）
- 用户登录后右下角豆小秘头像显示未读角标；打开面板可查看群通知
- **聊天记录**：执行 **`docs/AGENT_CHAT_HISTORY_MIGRATION.sql`**（表 `agent_chat_messages`）；每人每群对话持久保存，刷新/重新打开可继续查看
- **本群规定**：执行 **`docs/AGENT_GROUP_RULES_MIGRATION.sql`**；管理员口头写入的群制度入库，**全员**豆小秘对话时自动加载并优先遵守

## 7. 安全边界

- 助手**不能删除**任何数据
- 场景录入写入前必须用户点击「确认写入系统」
- 群发仅 admin（任意角色）或 scene_operator（仅 collection_executor）
