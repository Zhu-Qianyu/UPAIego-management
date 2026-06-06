import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
- **先请示、后执行**：凡会改动系统、发通知、写群规定、跳转页面的操作，assistant_message 里先说明打算做什么，末尾用口语请示；**禁止**在 assistant_message 里假装已经执行。
- 用户会在界面点「可以」或「不行」后才真正执行；你只需输出对应的 broadcast / group_rules_update / actions 字段供前端展示确认按钮。

## 当前对话者
- 系统注入：当前用户角色、本群规定、群内成员、当前页面。
- 按角色回答：执行员讲排班/悬赏，运维讲设备，业务员讲甲方与岗位，管理员讲审批与群发。

## 职责
- 泛业务探讨、合规与流程答疑。
- **页面操作 actions**：navigate / scene_tab / refresh / toast（须用户点「可以」后前端才执行）。
- **群发通知 broadcast**：**仅 admin**；拟好标题正文后，assistant_message **必须**包含「那我发通知啦？」，并输出 broadcast 对象（系统不会立刻发送，等用户点「可以」）。
- **当前不支持图片/视觉输入**；若用户发图或要求看现场照片，请说明暂不支持，并引导其到「场景业务」页面手动录入；**proposals 必须恒为 []**。

## actions 格式
- navigate: { "type":"navigate", "path":"/scene?tab=stations", "label":"..." }
- scene_tab: { "type":"scene_tab", "tab":"demands|tasks|stations", "label":"..." }
- refresh: { "type":"refresh", "target":"scene" }
- toast: { "type":"toast", "message":"..." }
规则：用户要求打开/切换 → 输出 actions 并在 assistant_message 请示「我帮您打开…可以吗？」；一次最多 3 个。

## broadcast（仅 admin，须请示）
- 非 admin → broadcast 必须为 null；请对方找管理员发通知。
- 格式: { "title":"标题", "body":"正文", "target_roles":["all"] 或角色列表, "category":"notice|holiday|task|workflow" }
- assistant_message 复述通知对象与要点，**必须问「那我发通知啦？」**；不要说「已发送」。

## group_rules_update（仅 admin，须请示）
- append / replace / clear；assistant_message 复述将写入的内容并问「这样写入群规定可以吗？」
- 格式: { "mode":"append|replace|clear", "content":"..." }

## 回复引用
- 用户消息含 \`[回复 …]\` 时，结合被回复内容作答。

## 输出格式（仅 JSON）
{
  "assistant_message": "自然语言回复（含请示）",
  "proposals": [],
  "questions": [],
  "actions": [],
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
  groupId: string
): Promise<string> {
  const { data, error } = await supabase
    .from("agent_group_rules")
    .select("rules_text, updated_at")
    .eq("group_id", groupId)
    .maybeSingle();

  if (error || !data?.rules_text?.trim()) {
    return "（尚未配置本群规定；管理员可通过对话「定为群规定」写入，写入后全员豆小秘遵守。）";
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

  return `群内 active 成员 ${members.length} 人：${countLine}。\n成员：${names.slice(0, 20).join("；")}${names.length > 20 ? "…" : ""}`;
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
  const memberSummary = await fetchGroupMemberSummary(supabase, body.groupId);
  const groupRulesBlock = await fetchGroupRules(supabase, body.groupId);
  const roleLabel = ROLE_LABELS[role] ?? role;
  const displayName = profile?.display_name?.trim() || "用户";

  const contextNote = [
    WORKFLOW_RULES,
    groupRulesBlock,
    `当前工作群 ID: ${body.groupId}`,
    memberSummary,
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
          : "【权限】管理员可输出 broadcast / group_rules_update（须请示，由用户点可以/不行后执行）。",
    "【限制】当前豆小秘仅支持纯文本对话，不支持图片理解或场景照片录入（proposals 恒为 []）。",
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

  const jsonText = extractJsonObject(raw);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return jsonResponse({
      assistant_message: raw,
      proposals: [],
      questions: [],
      actions: [],
      broadcast_result: null,
      group_rules_result: null,
      pending_broadcast: null,
      pending_group_rules: null,
    });
  }

  const broadcastSpec = parseBroadcast(parsed.broadcast, role);
  const rulesUpdate = parseGroupRulesUpdate(parsed.group_rules_update, role);

  const assistantMessage =
    String(parsed.assistant_message ?? "").trim() || "我在呢～您刚才说的我没听清，能再说一遍吗？";

  return jsonResponse({
    assistant_message: assistantMessage,
    proposals: [],
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    pending_broadcast: broadcastSpec,
    pending_group_rules: rulesUpdate,
    broadcast_result: null,
    group_rules_result: null,
  });
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
