# 场景智能助手 — AI 接入说明（国内 Token）

## 推荐：豆包 · 火山方舟（默认）

**本项目的场景助手需要「看现场照片 + 理解模糊描述」**，请优先使用 **火山引擎火山方舟上的豆包多模态模型**，不要用 DeepSeek 官方 `api.deepseek.com` 的 V3/R1 接口。

| 对比 | 豆包（火山方舟） | DeepSeek 官方 API |
|------|------------------|-------------------|
| 国内 Token | ✅ 火山引擎控制台充值 | ✅ 可用 |
| **图片输入** | ✅ 原生多模态（图片理解文档） | ❌ V3/R1 **仅文本**，不支持传图 |
| 现场工位/全景图 | ✅ Seed 1.6 等视觉模型 | 需另找 VL 开源部署或第三方 |
| OpenAI 兼容 | ✅ `/api/v3/chat/completions` | 部分兼容但无 Vision |

DeepSeek-VL2 等视觉模型主要是**开源权重**，官方对话 API 并不等同于「发图就能聊」。若坚持用 DeepSeek 品牌做视觉，需走**阿里云百炼的 Qwen-VL** 或**硅基流动等平台的 DeepSeek-VL 推理**，集成成本更高。

**结论：场景录入助手默认 `AI_PROVIDER=doubao`，模型选带视觉能力的 Doubao-Seed-1.6（或方舟控制台标注「图片理解」的接入点）。**

---

## 1. 开通豆包 API

1. 注册 [火山引擎](https://www.volcengine.com/) 并完成实名
2. 打开 **火山方舟** → 创建 **API Key**
3. **模型广场** 开通多模态模型，例如：
   - `Doubao-Seed-1.6` / `Doubao-Seed-1.6-flash`（支持图像理解，性价比高）
   - 或文档中的「图片理解」推荐模型
4. 在 **在线推理 → 推理接入点** 创建接入点，复制 **Endpoint ID**（形如 `ep-202406xxxxxx-xxxxx` 或模型名）

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
- 每次对话会发送文本 + 最多 8 张图片（base64），图片 token 高于纯文本，建议现场人员一次发全再确认写入

---

## 5. 可选：OpenAI（海外）

仅当 `AI_PROVIDER=openai` 且配置 `OPENAI_API_KEY` 时走 OpenAI；需使用支持 Vision 的模型（如 `gpt-4o-mini`）。

---

## 6. 群组智能体（豆小秘）

- **全群服务**：`admin` / `scene_operator` / `device_operator` / `collection_executor` 均可对话（须已加入 active 工作群）
- **分角色**：系统注入当前用户角色、页面与群内成员概况；回答与跳转按角色定制
- **群发收件箱**：管理员可对全员或指定角色群发（如「通知所有人明天放假」）；场景业务员可向数采执行员群发排班通知
- **数据库**：在 Supabase SQL Editor 执行 **`docs/AGENT_INBOX_MIGRATION.sql`**（表 `agent_inbox_messages` + RPC `send_agent_group_broadcast`）
- 用户登录后右下角豆小秘头像显示未读角标；打开面板可查看群通知

## 7. 安全边界

- 助手**不能删除**任何数据
- 场景录入写入前必须用户点击「确认写入系统」
- 群发仅 admin（任意角色）或 scene_operator（仅 collection_executor）
