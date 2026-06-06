import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { FORM_FILL_SKILL_PROMPT, FORM_ROLES } from "./formCatalog.ts";
import {
  buildFormFillConfirmMessage,
  inferFormFillsFromUserText,
  isFakeFormFillToast,
  stripActionsWhenFormFills,
} from "./formFillInfer.ts";
import { AGENT_TASK_CHOICE_PROMPT } from "./selfServiceNavigation.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ChatTurn = { role: "user" | "assistant"; content: string };

type PageContext = {
  route: string;
  pageTitle: string;
  role: string;
  sceneTab?: string | null;
  navItems?: { path: string; label: string }[];
};

type AgentRequest = {
  messages: ChatTurn[];
  groupId: string;
  pageContext?: PageContext | null;
};

type AiProvider = "doubao" | "openai";

type BroadcastSpec = {
  title: string;
  body: string;
  target_roles: string[];
  category?: string;
};

type GroupRulesUpdate = {
  mode: "append" | "replace" | "clear";
  content: string;
};

const VALID_ROLES = ["admin", "device_operator", "scene_operator", "collection_executor"] as const;

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  device_operator: "设备运维员",
  scene_operator: "场景业务员",
  collection_executor: "数采执行员",
};

const WORKFLOW_RULES = `## 平台数采执行制度（豆小秘须熟悉并按角色引导）

### 组织
- 管理员创建唯一工作群；其他角色凭入群码申请，管理员在「群组管理」审批为 active 后方能使用业务功能。
- 群内成员按 profiles.role 分为四类，各司其职。

### 角色职责
| 角色 | 职责 |
| admin | 管理台、KPI、全员公告、建群审批、发布悬赏令、可维护全部场景数据 |
| scene_operator | 甲方业务、场景岗位、采集排班（创建/发布/关闭）；不可群发通知 |
| device_operator | 设备管理、登记离线设备、运维工作台（悬赏借还设备、登记小时） |
| collection_executor | 采集排班打卡、悬赏接单、数采地图、钱包结算 |

### 主数据链
甲方业务(party_demands) → 大场景(scene_macro_sites) → 小岗位(scenario_positions) → 运维登记离线设备(manual_tracked_devices)

### 执行路径 A：采集排班
场景业务员/管理员：选岗位+执行员+设备数 → 草稿 → 发布（自动分配离线设备编号）→ 执行员打卡上下班 → 关闭排班释放设备

### 执行路径 B：悬赏令
管理员发布 bounty + 指定运维员 → 执行员 claim（有 due_at 截止）→ 运维 checkout/登记小时/归还 → 钱包结算

### 主动通知场景（仅管理员可经 broadcast 下发）
- 放假、开会、制度变更 → 全员或指定角色
`;

const SYSTEM_PROMPT = `你是豆小秘，UPAIego 工作群的**群组智能体**。你是可爱、上进、靠谱的**职场女秘书**：语气亲切干练，像团队里让人安心的妹妹同事，做事前先请示，不擅自行动。

## 身份与风格
- 名字：**豆小秘**。自称「我」；对用户用「您」或自然称呼。
- **先请示、后执行**：凡会改动系统、发通知、写群规定、代填表单的操作，assistant_message 里先说明打算做什么；**禁止**在 assistant_message 里假装已经执行。
- 用户会在界面选择 **「直接帮我干」**（代为写入/发送）或 **「跳转页面我自己搞」**（只打开相关页面，不自动写入）。

## 当前对话者
- 系统注入：当前用户角色、本群规定、群内成员、业务数据 ID 列表、当前页面。
- 按角色回答：执行员讲排班/悬赏，运维讲设备，业务员讲甲方与岗位，管理员讲审批与群发。

## 职责
- 泛业务探讨、合规与流程答疑。
- **页面操作 actions**：navigate / scene_tab / refresh / toast — **toast 不能代替 form_fills 写入**；禁止 toast「添加设备信息」类假操作
- **群发通知 broadcast**：**仅 admin**；拟好标题正文后，说明拟发送对象与内容即可（界面会出「直接帮我干 / 跳转页面我自己搞」）。
- **群规定 group_rules_update**：**仅 admin**；说明拟写入的群规定内容即可。
- **代填表单 form_fills**：用户要求创建/填写/录入且**已给出字段** → **必须**输出 form_fills，**禁止**只 scene_tab 跳转；说明拟写入内容即可（界面会出「直接帮我干 / 跳转页面我自己搞」）。需图的创建类表单，用户在聊天确认条里选图上传，勿要求用户发图给 AI。
- **不支持图片对话**；若用户发图，说明暂不支持视觉，可代填文字字段。

## actions 格式
- navigate: { "type":"navigate", "path":"/scene?tab=stations", "label":"..." }
- scene_tab: { "type":"scene_tab", "tab":"demands|tasks|stations", "label":"..." }
- refresh: { "type":"refresh", "target":"scene" }
- toast: { "type":"toast", "message":"..." }
规则：用户**仅**要求打开/切换页面、且**没有**给出要写入的字段 → 输出 actions 并请示；**若已给出创建/填写字段，actions 必须为空，改用 form_fills**。一次最多 3 个 actions。

## broadcast（仅 admin）
- 格式: { "title":"标题", "body":"正文", "target_roles":["all"] 或角色列表, "category":"notice|holiday|task|workflow" }

## group_rules_update（仅 admin）
- 格式: { "mode":"append|replace|clear", "content":"..." }

## 回复引用
- 用户消息含 \`[回复 …]\` 时，结合被回复内容作答。

${FORM_FILL_SKILL_PROMPT}

## 输出格式（仅 JSON）
{
  "assistant_message": "自然语言回复（含请示）",
  "proposals": [],
  "questions": [],
  "actions": [],
  "form_fills": [],
  "broadcast": null,
  "group_rules_update": null
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
        "未配置 ARK_MODEL（推理接入点 ID）。请在火山方舟控制台创建文本对话接入点，复制 endpoint id 设为 ARK_MODEL。",
    };
  }
  return {
    apiKey,
    baseUrl: Deno.env.get("ARK_BASE_URL") ?? "https://ark.cn-beijing.volces.com/api/v3",
    model,
  };
}

function normalizeTargetRoles(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: string[] = [];
  for (const r of raw) {
    const s = String(r).trim();
    if (s === "all") return ["all"];
    if ((VALID_ROLES as readonly string[]).includes(s) && !out.includes(s)) out.push(s);
  }
  return out.length ? out : null;
}

function parseBroadcast(raw: unknown, callerRole: string): BroadcastSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title = String(o.title ?? "").trim();
  const body = String(o.body ?? "").trim();
  const targetRoles = normalizeTargetRoles(o.target_roles);
  if (!title || !body || !targetRoles) return null;

  if (callerRole !== "admin") {
    return null;
  }

  const category = String(o.category ?? "notice").trim();
  const allowed = ["notice", "task", "workflow", "holiday"];
  return {
    title: title.slice(0, 120),
    body: body.slice(0, 4000),
    target_roles: targetRoles,
    category: allowed.includes(category) ? category : "notice",
  };
}

function parseGroupRulesUpdate(raw: unknown, callerRole: string): GroupRulesUpdate | null {
  if (callerRole !== "admin") return null;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const mode = String(o.mode ?? "").trim().toLowerCase();
  if (mode !== "append" && mode !== "replace" && mode !== "clear") return null;
  const content = String(o.content ?? "").trim();
  if (mode === "clear") return { mode: "clear", content: "" };
  if (!content) return null;
  return { mode: mode as GroupRulesUpdate["mode"], content: content.slice(0, 4000) };
}

async function fetchGroupRules(
  supabase: ReturnType<typeof createClient>,
  groupId: string,
  brief: boolean
): Promise<string> {
  const { data, error } = await supabase
    .from("agent_group_rules")
    .select("rules_text, updated_at")
    .eq("group_id", groupId)
    .maybeSingle();

  if (error || !data?.rules_text?.trim()) {
    return "（尚未配置本群规定；管理员可通过对话「定为群规定」写入，写入后全员豆小秘遵守。）";
  }

  if (brief) {
    const at = data.updated_at ? String(data.updated_at).slice(0, 19) : "";
    return `【本群已生效规定 — 全员须遵守】已配置（${data.rules_text.trim().length} 字${at ? `，最近更新 ${at}` : ""}；涉及制度或群规定时会注入全文）`;
  }

  const text = String(data.rules_text).trim();
  const injected = text.length > 6000 ? `${text.slice(0, 6000)}…（已截断）` : text;
  const at = data.updated_at ? String(data.updated_at).slice(0, 19) : "";
  return `【本群已生效规定 — 全员须遵守，优先于平台默认制度】\n${injected}${at ? `\n（最近更新：${at}）` : ""}`;
}

async function fetchGroupMemberSummary(
  supabase: ReturnType<typeof createClient>,
  groupId: string
): Promise<string> {
  const { data: members, error } = await supabase
    .from("group_members")
    .select("user_id, membership_status")
    .eq("group_id", groupId)
    .eq("membership_status", "active");

  if (error || !members?.length) return "群内暂无 active 成员。";

  const ids = members.map((m) => m.user_id);
  const { data: profiles } = await supabase.from("profiles").select("id, role, display_name").in("id", ids);

  const counts: Record<string, number> = {};
  const names: string[] = [];
  for (const p of profiles ?? []) {
    const role = String(p.role ?? "unknown");
    counts[role] = (counts[role] ?? 0) + 1;
    const label = ROLE_LABELS[role] ?? role;
    const name = p.display_name?.trim() || "未命名";
    names.push(`${name}(${label})`);
  }

  const countLine = Object.entries(counts)
    .map(([r, n]) => `${ROLE_LABELS[r] ?? r} ${n} 人`)
    .join("，");

  return `群内 active 成员 ${members.length} 人：${countLine}。\n成员（含 UUID 供 form_fills 引用）：${names.slice(0, 20).join("；")}${names.length > 20 ? "…" : ""}`;
}

async function fetchFormContext(
  supabase: ReturnType<typeof createClient>,
  groupId: string
): Promise<string> {
  const [{ data: demands }, { data: macros }, { data: positions }] = await Promise.all([
    supabase
      .from("party_demands")
      .select("id, title, client_company, device_type")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("scene_macro_sites")
      .select("id, title")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("scenario_positions")
      .select("id, title, macro_scene_id")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const demandLines = (demands ?? [])
    .map((p) => `${p.client_company ?? p.title}(${p.id}) 设备:${p.device_type ?? "—"}`)
    .join("；");
  const macroLines = (macros ?? []).map((m) => `${m.title}(${m.id})`).join("；");
  const posLines = (positions ?? [])
    .map((p) => `${p.title}(${p.id})→宏观:${p.macro_scene_id ?? "?"}`)
    .join("；");

  return [
    demandLines ? `【甲方业务 ID 列表】${demandLines}` : "【甲方业务】暂无",
    macroLines ? `【大场景 ID 列表】${macroLines}` : "【大场景】暂无",
    posLines ? `【小岗位 ID 列表】${posLines}` : "【小岗位】暂无",
  ].join("\n");
}

type FormFillSpec = {
  form: string;
  label: string;
  target_id?: string;
  data: Record<string, unknown>;
};

function parseFormFills(raw: unknown, callerRole: string): FormFillSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: FormFillSpec[] = [];
  for (const item of raw.slice(0, 3)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const form = String(o.form ?? "").trim();
    const allowed = FORM_ROLES[form];
    if (!allowed?.includes(callerRole)) continue;
    const label = String(o.label ?? "").trim();
    if (!label) continue;
    const data = o.data && typeof o.data === "object" ? (o.data as Record<string, unknown>) : null;
    if (!data) continue;
    const target_id = o.target_id != null ? String(o.target_id).trim() : undefined;
    out.push({ form, label, target_id: target_id || undefined, data });
  }
  return out;
}

function needsFormContext(turns: ChatTurn[]): boolean {
  const recentUser = turns
    .filter((m) => m.role === "user")
    .slice(-3)
    .map((m) => m.content)
    .join("\n");
  return /添加|创建|登记|填写|录入|更新|修改|甲方|大场景|小岗位|离线设备|排班|悬赏|发布|设备类型|公司名/i.test(
    recentUser
  );
}

function needsGroupRulesDetail(turns: ChatTurn[]): boolean {
  const recentUser = turns
    .filter((m) => m.role === "user")
    .slice(-2)
    .map((m) => m.content)
    .join("\n");
  return /群规定|本群规定|制度|定为群规定|查看.*规定/i.test(recentUser);
}

function buildAgentPayload(args: {
  parsed: Record<string, unknown>;
  role: string;
  lastUserText: string;
  rawAssistantFallback?: string;
}) {
  const { parsed, role, lastUserText, rawAssistantFallback } = args;
  const broadcastSpec = parseBroadcast(parsed.broadcast, role);
  const rulesUpdate = parseGroupRulesUpdate(parsed.group_rules_update, role);
  const llmFormFills = parseFormFills(parsed.form_fills, role);
  const formFills = llmFormFills.length ? llmFormFills : inferFormFillsFromUserText(lastUserText, role);

  let assistantMessage =
    String(parsed.assistant_message ?? "").trim() ||
    rawAssistantFallback?.trim() ||
    "我在呢～您刚才说的我没听清，能再说一遍吗？";
  if (formFills.length && !llmFormFills.length) {
    assistantMessage = buildFormFillConfirmMessage(formFills);
  } else if (formFills.length && !assistantMessage.includes(AGENT_TASK_CHOICE_PROMPT)) {
    assistantMessage = `${assistantMessage.trim()}\n\n${AGENT_TASK_CHOICE_PROMPT}`;
  }

  let actions = Array.isArray(parsed.actions) ? parsed.actions : [];
  if (formFills.length) {
    actions = stripActionsWhenFormFills(actions);
  }

  return {
    assistant_message: assistantMessage,
    proposals: [] as unknown[],
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    actions,
    pending_broadcast: broadcastSpec,
    pending_group_rules: rulesUpdate,
    pending_form_fills: formFills.length ? formFills : null,
    broadcast_result: null,
    group_rules_result: null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
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
    .select("role, display_name")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileErr) {
    return jsonResponse({ error: profileErr.message }, 500);
  }
  const role = profile?.role as string | undefined;
  if (!role || !(VALID_ROLES as readonly string[]).includes(role)) {
    return jsonResponse({ error: "无效的用户角色" }, 403);
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

  const { data: membership } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", body.groupId)
    .eq("user_id", userData.user.id)
    .eq("membership_status", "active")
    .maybeSingle();

  if (!membership) {
    return jsonResponse({ error: "请先加入并激活工作群后再使用豆小秘" }, 403);
  }

  const pc = body.pageContext;
  const chatTurns = (body.messages ?? []).slice(-24);
  const includeFormContext = needsFormContext(chatTurns);
  const includeGroupRulesDetail = needsGroupRulesDetail(chatTurns);
  const memberSummary = await fetchGroupMemberSummary(supabase, body.groupId);
  const formContext = includeFormContext
    ? await fetchFormContext(supabase, body.groupId)
    : "【业务 ID 列表】用户未涉及录入/创建时省略；需要引用甲方/场景 ID 时请说明具体名称。";
  const groupRulesBlock = await fetchGroupRules(supabase, body.groupId, !includeGroupRulesDetail);
  const roleLabel = ROLE_LABELS[role] ?? role;
  const displayName = profile?.display_name?.trim() || "用户";

  const contextNote = [
    WORKFLOW_RULES,
    groupRulesBlock,
    `当前工作群 ID: ${body.groupId}`,
    memberSummary,
    formContext,
    `【当前对话者】${displayName}，角色：${roleLabel}（${role}）`,
    pc
      ? `【用户当前页面】${pc.pageTitle} (${pc.route})${pc.sceneTab ? `，场景子标签：${pc.sceneTab}` : ""}`
      : "",
    pc?.navItems?.length
      ? `【该角色可跳转菜单】${pc.navItems.map((n) => `${n.label}:${n.path}`).join("；")}`
      : "",
    role !== "admin" && role !== "scene_operator"
      ? "【限制】不可向非授权角色群发。"
      : role === "scene_operator"
        ? "【限制】不可群发 broadcast；不可输出 group_rules_update。"
        : role !== "admin"
          ? "【限制】不可群发、不可改群规定。"
          : "【权限】管理员可输出 broadcast / group_rules_update / form_fills（须请示；用户选「直接帮我干」或「跳转页面我自己搞」后执行）。",
    "【能力】可代填表单见 form_fills 目录；用户给出具体字段并要求创建/填写时，必须输出 form_fills，禁止仅 scene_tab 跳转。",
  ]
    .filter(Boolean)
    .join("\n");

  const chatMessages: Array<Record<string, unknown>> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: contextNote },
  ];

  for (const m of chatTurns) {
    if (m.role === "user" || m.role === "assistant") {
      chatMessages.push({ role: m.role, content: m.content });
    }
  }

  if (chatTurns.length === 0) {
    chatMessages.push({ role: "user", content: "请根据对话上下文回复。" });
  }

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

  const usage = aiJson?.usage;
  if (usage && typeof usage === "object") {
    console.log(
      "scene-ai-agent usage",
      JSON.stringify({
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        form_context: includeFormContext,
        group_rules_full: includeGroupRulesDetail,
      })
    );
  }

  const lastUserText = [...chatTurns].reverse().find((m) => m.role === "user")?.content ?? "";
  const jsonText = extractJsonObject(raw);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    console.warn("scene-ai-agent JSON parse failed, infer fallback");
    const fallbackParsed: Record<string, unknown> = {
      assistant_message: raw,
      questions: [],
      actions: [],
      form_fills: [],
      broadcast: null,
      group_rules_update: null,
    };
    return jsonResponse(
      buildAgentPayload({
        parsed: fallbackParsed,
        role,
        lastUserText,
        rawAssistantFallback: raw,
      })
    );
  }

  return jsonResponse(
    buildAgentPayload({
      parsed,
      role,
      lastUserText,
    })
  );
  } catch (e) {
    console.error("scene-ai-agent unhandled:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: `豆小秘服务异常：${msg}` }, 500);
  }
});

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}
