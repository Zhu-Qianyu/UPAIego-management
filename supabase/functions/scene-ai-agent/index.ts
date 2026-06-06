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

type BroadcastSpec = {
  title: string;
  body: string;
  target_roles: string[];
  category?: string;
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
| scene_operator | 甲方业务、场景岗位、采集排班（创建/发布/关闭）；可向执行员群发排班相关通知 |
| device_operator | 设备管理、登记离线设备、运维工作台（悬赏借还设备、登记小时） |
| collection_executor | 采集排班打卡、悬赏接单、数采地图、钱包结算 |

### 主数据链
甲方业务(party_demands) → 大场景(scene_macro_sites) → 小岗位(scenario_positions) → 运维登记离线设备(manual_tracked_devices)

### 执行路径 A：采集排班
场景业务员/管理员：选岗位+执行员+设备数 → 草稿 → 发布（自动分配离线设备编号）→ 执行员打卡上下班 → 关闭排班释放设备

### 执行路径 B：悬赏令
管理员发布 bounty + 指定运维员 → 执行员 claim（有 due_at 截止）→ 运维 checkout/登记小时/归还 → 钱包结算

### 主动通知场景（管理员/业务员可经 broadcast 下发）
- 放假、开会、制度变更 → 全员或指定角色
- 新排班发布 → collection_executor
- 排班临期未发布 → scene_operator（对话提醒，非自动）
- 设备故障/借还 → device_operator
`;

const SYSTEM_PROMPT = `你是豆小秘，UPAIego 工作群的**群组智能体**（不是普通客服）。你服务群内所有角色，每人对话时你都知道其账户角色，并据此回答与操作。

## 身份
- 名字：**豆小秘**。语气亲切、专业，像团队里熟悉数采制度的小姑娘同事。
- 你是嵌入 Web 的**数字员工**：能讨论、能带路、能整理录入方案；**管理员/场景业务员**还可经你向群成员**群发通知**到各人账户收件箱。

## 当前对话者
- 系统会在上下文注入：当前用户角色、所在页面、群内成员概况。
- 回答时必须结合对方角色：给执行员讲排班/悬赏，给运维讲设备，给业务员讲甲方与岗位，给管理员讲审批与悬赏。

## 职责范围
- **泛业务探讨**：新场景采集可行性、合规、排班与悬赏流程。
- **系统操作（actions）**：跳转页面、切换场景子标签、刷新（见下）。
- **方案整理**：信息或图片足够时输出 proposals（仅 admin/scene_operator 场景录入；其他角色 proposals 应为空）。
- **群发通知（broadcast）**：当**管理员**明确要求通知全员/某类角色（如「通知所有人明天放假」「告诉所有执行员明早八点集合」）时，输出 broadcast 字段；正文要完整、可直接送达。

## 可用 actions（前端自动执行）
- navigate: { "type":"navigate", "path":"/scene?tab=stations", "label":"..." }
  常用: /scene, /scene?tab=tasks|demands|stations, /group, /admin, /bounties, /map, /operator-work, /wallet, /devices/manage
- scene_tab: { "type":"scene_tab", "tab":"demands|tasks|stations", "label":"..." }
- refresh: { "type":"refresh", "target":"scene" }
- toast: { "type":"toast", "message":"..." }
规则：用户要求打开/切换功能 → 必须输出 action；纯讨论 → actions 为 []；一次最多 3 个；禁止站外 URL 与 delete。

## broadcast 规则（写入各人「豆小秘收件箱」）
- **仅当**当前用户是 admin，或 scene_operator 且目标仅为 collection_executor 时，才可输出 broadcast。
- 格式: { "title":"简短标题", "body":"完整通知正文", "target_roles":["all"] 或 ["collection_executor",...], "category":"notice|holiday|task|workflow" }
- target_roles 用 "all" 表示群内四类角色全员；或指定 admin/device_operator/scene_operator/collection_executor。
- 用户说「通知所有人/全员/每个账户」→ target_roles: ["all"]。
- 确认将要发送后再写 broadcast；assistant_message 说明已安排发送给谁。

## proposals（仅 admin/scene_operator 需要录入时）
大场景 macro / 小岗位 position — 规则同前；其他角色禁止输出 proposals。

## 输出格式（仅 JSON）
{
  "assistant_message": "自然语言回复",
  "proposals": [],
  "questions": [],
  "actions": [],
  "broadcast": null
}
broadcast 无群发时为 null；有群发时为对象。`;

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

  if (callerRole === "admin") {
    // ok
  } else if (callerRole === "scene_operator") {
    if (targetRoles.length !== 1 || targetRoles[0] !== "collection_executor") {
      return null;
    }
  } else {
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

  const images = (body.images ?? []).slice(0, 8);
  const existingMacros = body.existingMacros ?? [];
  const pc = body.pageContext;
  const memberSummary = await fetchGroupMemberSummary(supabase, body.groupId);
  const roleLabel = ROLE_LABELS[role] ?? role;
  const displayName = profile?.display_name?.trim() || "用户";

  const contextNote = [
    WORKFLOW_RULES,
    `当前工作群 ID: ${body.groupId}`,
    memberSummary,
    `【当前对话者】${displayName}，角色：${roleLabel}（${role}）`,
    existingMacros.length
      ? `已有大场景：${existingMacros.map((m) => `${m.title}(${m.id})`).join("；")}`
      : role === "admin" || role === "scene_operator"
        ? "当前尚无大场景，需先方案中大场景再挂小岗位。"
        : "",
    pc
      ? `【用户当前页面】${pc.pageTitle} (${pc.route})${pc.sceneTab ? `，场景子标签：${pc.sceneTab}` : ""}`
      : "",
    pc?.navItems?.length
      ? `【该角色可跳转菜单】${pc.navItems.map((n) => `${n.label}:${n.path}`).join("；")}`
      : "",
    role !== "admin" && role !== "scene_operator"
      ? "【限制】当前用户不可输出 proposals（场景录入）或向非授权角色群发。"
      : role === "scene_operator"
        ? "【限制】群发仅可 target_roles: [\"collection_executor\"]。"
        : "【权限】管理员可向全员或任意角色群发 broadcast。",
  ]
    .filter(Boolean)
    .join("\n");

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
    });
  }

  const broadcastSpec = parseBroadcast(parsed.broadcast, role);
  let broadcastResult: Record<string, unknown> | null = null;

  if (broadcastSpec) {
    const targetRoles =
      broadcastSpec.target_roles[0] === "all" ? null : broadcastSpec.target_roles;

    const { data: rpcData, error: rpcErr } = await supabase.rpc("send_agent_group_broadcast", {
      p_group_id: body.groupId,
      p_title: broadcastSpec.title,
      p_body: broadcastSpec.body,
      p_target_roles: targetRoles,
      p_category: broadcastSpec.category ?? "notice",
    });

    if (rpcErr) {
      broadcastResult = { ok: false, error: rpcErr.message };
    } else {
      broadcastResult = { ok: true, ...(rpcData as Record<string, unknown>) };
    }
  }

  const proposals =
    role === "admin" || role === "scene_operator"
      ? Array.isArray(parsed.proposals)
        ? parsed.proposals
        : []
      : [];

  return jsonResponse({
    assistant_message: String(parsed.assistant_message ?? ""),
    proposals,
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    broadcast_result: broadcastResult,
  });
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
