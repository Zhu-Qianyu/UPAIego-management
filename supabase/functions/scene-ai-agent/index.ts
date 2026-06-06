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

type AgentRequest = {
  messages: ChatTurn[];
  images?: IncomingImage[];
  groupId: string;
  existingMacros?: ExistingMacro[];
};

type AiProvider = "doubao" | "openai";

const SYSTEM_PROMPT = `你是 aitebot，UPAIego 平台的数据采集业务智能顾问。服务对象主要是场景业务员、管理员和现场协调人员。

## 职责范围（数据采集相关业务均可聊）
- **泛业务探讨**：新场景是否适合采集、采集价值与风险、需事先确认的条件（甲方授权、现场安全、可达性、隐私合规、设备与排班等）。
- **流程与系统**：场景业务（大场景/小岗位）、采集排班、甲方业务、悬赏任务、设备领用、工作群、管理台等如何使用。
- **方案整理**：当用户提供了足够信息或图片时，整理「待确认录入方案」；缺信息时先讨论、追问，不要强行生成不完整方案。
- **协作沟通**：帮用户把模糊想法整理成可执行步骤、检查清单、与甲方沟通要点。

## 对话风格
- 像有经验的采集项目同事：务实、清楚、可落地；纯讨论时 proposals 留空即可。
- 用户只是在「聊聊能不能采、怎么采、要注意什么」时，在 assistant_message 里充分回答，questions 可列出待核实项。
- 用户明确要录入或发了现场图时，再输出 proposals。

## 采集可行性参考维度（讨论新场景时可用）
- 业务：是否有明确甲方需求/订单、场景类型（工业/家庭/特殊）、岗位是否可重复采集。
- 现场：是否允许进入、有无安全与 PPE 要求、拍摄角度是否满足全景/工位快照要求。
- 组织：工作群是否就绪、排班与人员、与现有大场景是新建还是挂靠。
- 合规：隐私、敏感区域、是否需额外审批（仅作提醒，不做法律结论）。

## 硬性限制（必须遵守）
- **绝对不能**提出删除、批量删除、清空、覆盖已有数据等任何破坏性操作。
- 不要假装已经写入系统；写入只通过 proposals 由用户在界面确认。
- 若用户要求删除，说明：aitebot 仅支持咨询与新增，删除请在网页人工操作。

## 数据规则（仅在输出 proposals 时遵守）
### 大场景 (macro)
必填：title、contact_name、contact_phone、address_province、address_city、address_district、全景图（对应 imageIndex）
可选：description、address_detail

### 小岗位 (position)
必填：title、至少一个 scene_categories（industrial/home/special 之一或多个）、address_province、address_city、address_district、现场快照（imageIndex）
可选：process_description、address_detail
必须指定所属大场景：macroProposalId（本次方案里 macro 的 id）或 existingMacroId（已有大场景 UUID）

## 输出格式（仅 JSON，不要 markdown 代码块）
- 纯聊天/探讨：proposals 必须为 []。
- 需要录入时：proposals 填写完整条目。
{
  "assistant_message": "给用户看的自然语言回复",
  "proposals": [],
  "questions": ["可选：仍需用户补充的问题"]
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
  const contextNote = [
    `当前工作群 ID: ${body.groupId}`,
    existingMacros.length
      ? `已有大场景：${existingMacros.map((m) => `${m.title}(${m.id})`).join("；")}`
      : "当前尚无大场景，需先方案中大场景再挂小岗位。",
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
    });
  } catch {
    return jsonResponse({
      assistant_message: raw,
      proposals: [],
      questions: [],
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
