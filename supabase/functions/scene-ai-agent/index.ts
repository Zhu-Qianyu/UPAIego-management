import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ChatTurn = { role: "user" | "assistant"; content: string };

type IncomingImage = {
  index: number;
  mimeType: string;
  base64: string;
  hint?: "macro" | "position" | "unknown";
};

type ExistingMacro = { id: string; title: string };

type PageContext = {
  route: string;
  pageTitle: string;
  role: string;
  sceneTab?: string | null;
  navItems?: { path: string; label: string }[];
};

type AgentRequest = {
  messages: ChatTurn[];
  images?: IncomingImage[];
  groupId: string;
  existingMacros?: ExistingMacro[];
  pageContext?: PageContext | null;
};

type AiProvider = "doubao" | "openai";

const SYSTEM_PROMPT = `你是豆小秘，UPAIego 平台的数据采集业务数字员工（不是普通客服）。你嵌入在 Web 系统里，能根据对话**驱动页面操作**。

## 身份
- 名字：**豆小秘**。语气亲切、专业，像团队里熟悉业务的小姑娘同事。
- 场景业务员、管理员的**在岗数字员工**：能讨论、能带路、能整理方案。
- 用户说「打开场景岗位」「带我去甲方业务」「刷新一下」时，应通过 actions 真正操作页面，而不是只告诉用户点哪里。

## 职责范围
- **泛业务探讨**：新场景是否适合采集、风险、甲方授权、现场安全、排班与合规提醒。
- **系统操作（actions）**：跳转页面、切换场景业务子标签、提示刷新。
- **方案整理**：信息或图片足够时输出 proposals，由用户确认后写入。

## 可用 actions（通过前端自动执行，禁止伪造已执行）
- navigate: { "type":"navigate", "path":"/scene?tab=stations", "label":"打开场景岗位" }
  常用 path: /scene, /scene?tab=tasks, /scene?tab=demands, /scene?tab=stations, /group, /admin, /bounties
- scene_tab: { "type":"scene_tab", "tab":"demands|tasks|stations", "label":"切换到甲方业务" }（用户已在 /scene 时优先用这个）
- refresh: { "type":"refresh", "target":"scene" }（用户要求刷新场景数据时）
- toast: { "type":"toast", "message":"..." }（短提示，可选）

规则：
- 用户明确要求去看/打开/切换某功能 → **必须**输出对应 action，并在 assistant_message 说明正在带路。
- 纯讨论、无可执行操作 → actions 为 []。
- 一次最多 3 个 action；禁止 navigate 到 /auth 或站外 URL。
- **禁止** delete/remove 类 action；不能假装已写入数据库。

## 采集可行性（讨论新场景）
- 业务、现场、组织、合规四个维度给出可落地建议。

## 硬性限制
- 不能删除数据；写入仅 via proposals + 用户确认。

## proposals 数据规则（仅需要录入时）
### 大场景 macro：title, contact_name, contact_phone, address_*, imageIndex
### 小岗位 position：title, scene_categories, address_*, imageIndex, macroProposalId 或 existingMacroId

## 输出格式（仅 JSON）
{
  "assistant_message": "自然语言回复",
  "proposals": [],
  "questions": [],
  "actions": []
}`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function resolveProvider(): AiProvider {
  const p = (Deno.env.get("AI_PROVIDER") ?? "doubao").toLowerCase();
  return p === "openai" ? "openai" : "doubao";
}

function resolveAiConfig(provider: AiProvider): { apiKey: string; baseUrl: string; model: string } | { error: string } {
  if (provider === "openai") {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      return {
        error:
          "未配置 OPENAI_API_KEY。国内场景请使用豆包：设置 AI_PROVIDER=doubao 与 ARK_API_KEY（火山方舟）。",
      };
    }
    return {
      apiKey,
      baseUrl: Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
      model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
    };
  }

  const apiKey = Deno.env.get("ARK_API_KEY") ?? Deno.env.get("DOUBAO_API_KEY");
  if (!apiKey) {
    return {
      error:
        "未配置 ARK_API_KEY（火山方舟 API Key）。请在火山引擎控制台 → 火山方舟 → API Key 创建，并用 supabase secrets set ARK_API_KEY=... 写入。",
    };
  }
  const model = Deno.env.get("ARK_MODEL") ?? Deno.env.get("DOUBAO_MODEL");
  if (!model) {
    return {
      error:
        "未配置 ARK_MODEL（推理接入点 ID）。请在火山方舟控制台开通多模态模型（推荐 Doubao-Seed-1.6 视觉理解），复制 endpoint id 设为 ARK_MODEL。",
    };
  }
  return {
    apiKey,
    baseUrl: Deno.env.get("ARK_BASE_URL") ?? "https://ark.cn-beijing.volces.com/api/v3",
    model,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const provider = resolveProvider();
  const aiCfg = resolveAiConfig(provider);
  if ("error" in aiCfg) {
    return jsonResponse({ error: aiCfg.error }, 503);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "未登录" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: "登录无效" }, 401);
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileErr) {
    return jsonResponse({ error: profileErr.message }, 500);
  }
  const role = profile?.role as string | undefined;
  if (role !== "admin" && role !== "scene_operator") {
    return jsonResponse({ error: "仅管理员和场景业务员可使用智能助手" }, 403);
  }

  let body: AgentRequest;
  try {
    body = (await req.json()) as AgentRequest;
  } catch {
    return jsonResponse({ error: "请求体无效" }, 400);
  }

  if (!body.groupId?.trim()) {
    return jsonResponse({ error: "缺少 groupId" }, 400);
  }

  const images = (body.images ?? []).slice(0, 8);
  const existingMacros = body.existingMacros ?? [];
  const pc = body.pageContext;
  const contextNote = [
    `当前工作群 ID: ${body.groupId}`,
    existingMacros.length
      ? `已有大场景：${existingMacros.map((m) => `${m.title}(${m.id})`).join("；")}`
      : "当前尚无大场景，需先方案中大场景再挂小岗位。",
    pc
      ? `【用户当前页面】${pc.pageTitle} (${pc.route})${pc.sceneTab ? `，场景子标签：${pc.sceneTab}` : ""}，角色：${pc.role}`
      : "",
    pc?.navItems?.length
      ? `【可跳转菜单】${pc.navItems.map((n) => `${n.label}:${n.path}`).join("；")}`
      : "",
  ].join("\n");

  const chatMessages: Array<Record<string, unknown>> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: contextNote },
  ];

  for (const m of body.messages ?? []) {
    if (m.role === "user" || m.role === "assistant") {
      chatMessages.push({ role: m.role, content: m.content });
    }
  }

  const lastUser = (body.messages ?? []).filter((m) => m.role === "user").pop();
  const userText =
    lastUser?.content?.trim() ||
    (images.length > 0 ? "请结合附件图片与上下文回复。" : "请根据对话上下文回复。");

  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: userText }];
  for (const img of images) {
    const mime = img.mimeType?.startsWith("image/") ? img.mimeType : "image/jpeg";
    const hint =
      img.hint === "macro"
        ? "（用户标注：大场景全景图）"
        : img.hint === "position"
          ? "（用户标注：小岗位现场图）"
          : "";
    userContent.push({
      type: "text",
      text: `图片 index=${img.index}${hint}`,
    });
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${img.base64}` },
    });
  }

  chatMessages.push({ role: "user", content: userContent });

  const url = `${aiCfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const aiRes = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${aiCfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: aiCfg.model,
      messages: chatMessages,
      response_format: { type: "json_object" },
      max_tokens: 4096,
      temperature: 0.3,
    }),
  });

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    const label = provider === "doubao" ? "豆包/火山方舟" : "OpenAI";
    return jsonResponse({ error: `${label} 服务错误: ${errText.slice(0, 400)}` }, 502);
  }

  const aiJson = await aiRes.json();
  const raw = aiJson?.choices?.[0]?.message?.content;
  if (!raw || typeof raw !== "string") {
    return jsonResponse({ error: "AI 未返回有效内容" }, 502);
  }

  const jsonText = extractJsonObject(raw);
  try {
    const parsed = JSON.parse(jsonText);
    return jsonResponse({
      assistant_message: String(parsed.assistant_message ?? ""),
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    });
  } catch {
    return jsonResponse({
      assistant_message: raw,
      proposals: [],
      questions: [],
      actions: [],
    });
  }
});

/** 兼容模型在 JSON 外包裹 markdown 代码块的情况 */
function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}
