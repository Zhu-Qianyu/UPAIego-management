import type { AgentPendingFormFill } from "./agentFormTypes";
import type { UserRole } from "../types/roles";
import {
  defaultLabelPrefix,
  extractClientCompany,
  extractDeviceType,
  extractQuotedOrPlain,
  fieldValue,
  isFakeFormFillToast,
  parseDeviceCount,
  partyDemandDefaults,
} from "./formFillInferShared";

const FORM_ROLES: Record<string, UserRole[]> = {
  scene_macro_create: ["admin", "scene_operator"],
  party_demand_create: ["admin", "scene_operator"],
  manual_devices_batch_create: ["admin", "device_operator"],
};

function parseChineseAddress(raw: string) {
  let rest = raw.trim().replace(/^[「"']|[」"']$/g, "");
  let province = "待补充";
  let city = "待补充";
  let district = "待补充";

  const direct = rest.match(/^(北京市|上海市|天津市|重庆市)/);
  if (direct) {
    province = direct[1];
    city = direct[1];
    rest = rest.slice(direct[1].length);
  } else {
    const pm = rest.match(/^(.+?(?:省|自治区|特别行政区))/);
    if (pm) {
      province = pm[1];
      rest = rest.slice(province.length);
    }
  }

  const cm = rest.match(/^(.+?(?:市|州|盟|地区))/);
  if (cm) {
    city = cm[1];
    rest = rest.slice(city.length);
  }

  const dm = rest.match(/^(.+?[区县])/);
  if (dm) {
    district = dm[1];
    rest = rest.slice(district.length);
  }

  return {
    address_province: province,
    address_city: city,
    address_district: district,
    address_detail: rest.trim() || undefined,
  };
}

function normalizePhone(p: string): string {
  return p.replace(/\s+/g, "").replace(/-/g, "");
}

function inferManualDevicesBatch(text: string, role: UserRole): AgentPendingFormFill | null {
  if (!FORM_ROLES.manual_devices_batch_create.includes(role)) return null;
  if (!/(?:增加|添加|登记|创建).*(?:离线)?设备|(?:离线)?设备.*(?:增加|添加|登记)/i.test(text)) return null;

  const count = parseDeviceCount(text);
  const client_company = extractClientCompany(text);
  if (!count || !client_company) return null;

  const device_type = extractDeviceType(text);
  const label_prefix = device_type ? defaultLabelPrefix(device_type) : "设备";

  return {
    form: "manual_devices_batch_create",
    label: `为「${client_company}」登记 ${count} 台离线设备`,
    data: {
      client_company,
      count,
      ...(device_type ? { device_type, label_prefix } : { label_prefix }),
    },
  };
}

function inferPartyDemandCreate(text: string, role: UserRole): AgentPendingFormFill | null {
  if (!FORM_ROLES.party_demand_create.includes(role)) return null;

  const patterns = [
    /(?:添加|创建|填(?:写)?|录入)(?:一?[条个])?甲方业务\s*[，,：:\s]+([^，,\n]+)/i,
    /(?:添加|创建)甲方业务[，,]\s*([^，,\n]+)/i,
  ];

  let client_company: string | null = null;
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]?.trim()) {
      client_company = extractQuotedOrPlain(m[1].split(/[，,]/)[0] ?? m[1]);
      break;
    }
  }

  if (!client_company) return null;

  const device_type = extractDeviceType(text);
  const maxHoursRaw = text.match(/(?:单场景上限|上限)[^\d]*(\d+)/i)?.[1];
  const max_hours_per_scene = maxHoursRaw ? Math.max(1, parseInt(maxHoursRaw, 10)) : 8;

  let scene_categories: string[] = ["industrial"];
  const catMatch = text.match(/场景(?:类型|分类)?\s*[：:]?\s*(\w+)/i);
  if (catMatch && ["industrial", "home", "special"].includes(catMatch[1])) {
    scene_categories = [catMatch[1]];
  }

  return {
    form: "party_demand_create",
    label: `添加甲方业务「${client_company}」`,
    data: {
      ...partyDemandDefaults(client_company, device_type),
      max_hours_per_scene,
      scene_categories,
    },
  };
}

function inferSceneMacroCreate(text: string, role: UserRole): AgentPendingFormFill | null {
  if (!FORM_ROLES.scene_macro_create.includes(role)) return null;

  const macroMatch = text.match(/(?:帮我)?(?:创建|填|录入|添加)(?:一?[条个])?大场景[：:]\s*([\s\S]+)/i);
  if (!macroMatch) return null;

  const body = macroMatch[1];
  const titleFromLabel = fieldValue(body, ["标题", "名称", "大场景名称"]);
  let title = titleFromLabel ?? "";
  if (!title) {
    const firstPart = body.split(/[，,]/)[0]?.trim() ?? "";
    title = extractQuotedOrPlain(firstPart.replace(/^(?:标题|名称)[为是]?[：:]?\s*/i, ""));
  }
  const contactMatch = body.match(/联系人\s*[：:]?\s*(\S+?)\s+(\d[\d\s-]{10,15})/);
  const addrMatch = body.match(/地址\s*[：:]?\s*([^，,\n]+)/);
  if (!title || !contactMatch || !addrMatch) return null;

  return {
    form: "scene_macro_create",
    label: `创建大场景「${title}」`,
    data: {
      title,
      contact_name: contactMatch[1],
      contact_phone: normalizePhone(contactMatch[2]),
      ...parseChineseAddress(addrMatch[1]),
    },
  };
}

/** LLM 漏填时从用户原文推断 */
export function inferFormFillsFromUserText(text: string, role: UserRole): AgentPendingFormFill[] {
  const t = text.trim();
  if (!t) return [];

  const out: AgentPendingFormFill[] = [];
  const batch = inferManualDevicesBatch(t, role);
  if (batch) out.push(batch);
  const party = inferPartyDemandCreate(t, role);
  if (party && !batch) out.push(party);
  const macro = inferSceneMacroCreate(t, role);
  if (macro) out.push(macro);

  return out.slice(0, 3);
}

export function buildFormFillConfirmMessage(fills: AgentPendingFormFill[]): string {
  const summary = fills.map((f) => {
    if (f.form === "manual_devices_batch_create") {
      const d = f.data;
      const typeLabel =
        (typeof d.device_short_label === "string" && d.device_short_label.trim()) ||
        (typeof d.label_prefix === "string" && d.label_prefix.trim()) ||
        (typeof d.device_type === "string" && d.device_type.trim()) ||
        "设备";
      return `为「${d.client_company}」登记 ${d.count} 台「${typeLabel}」离线设备（登记编号自动递增）`;
    }
    if (f.form === "scene_macro_create") {
      const d = f.data;
      return `大场景「${d.title}」，联系人 ${d.contact_name} ${d.contact_phone}`;
    }
    if (f.form === "party_demand_create") {
      return `甲方业务「${f.data.client_company}」，设备类型 ${f.data.device_type}`;
    }
    return f.label;
  });
  return `好的，我帮您写入：${summary.join("；")}。`;
}

export function stripActionsWhenFormFills(actions: unknown): unknown[] {
  if (!Array.isArray(actions)) return [];
  return actions.filter((item) => {
    if (!item || typeof item !== "object") return true;
    const o = item as Record<string, unknown>;
    if (o.type === "scene_tab") return false;
    if (o.type === "navigate" && typeof o.path === "string") {
      const p = o.path;
      if (p.startsWith("/scene") || p.startsWith("/devices") || p.includes("tab=")) return false;
    }
    if (o.type === "toast" && typeof o.message === "string" && isFakeFormFillToast(o.message)) return false;
    return true;
  });
}

export { isFakeFormFillToast };
