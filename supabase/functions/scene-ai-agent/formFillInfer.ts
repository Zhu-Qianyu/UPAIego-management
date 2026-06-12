import { FORM_ROLES } from "./formCatalog.ts";

export type FormFillSpec = {
  form: string;
  label: string;
  target_id?: string;
  data: Record<string, unknown>;
};

function extractQuotedOrPlain(s: string): string {
  const q = s.match(/[「"']([^」"']+)[」"']/);
  if (q) return q[1].trim();
  return s.trim();
}

function fieldValue(body: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}[为是]?[：:]?\\s*[「"']?([^」"',，\\n]+)[」"']?`, "i");
    const m = body.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

function parseDeviceCount(text: string): number | null {
  const m = text.match(/(\d+)\s*台/);
  if (m) {
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function extractClientCompany(text: string): string | null {
  const fromLabel = fieldValue(text, ["甲方", "公司", "公司名", "客户"]);
  if (fromLabel) return fromLabel;
  const m = text.match(/甲方[是为：:\s]+([^，,\n]+)/);
  if (m?.[1]?.trim()) return m[1].trim();
  return null;
}

function extractDeviceType(text: string): string | null {
  return fieldValue(text, ["类型", "设备类型", "设备"]);
}

function defaultLabelPrefix(deviceType: string): string {
  const t = deviceType.trim().replace(/设备$/u, "").trim();
  return t || "设备";
}

function partyDemandDefaults(client_company: string, device_type?: string | null) {
  return {
    client_company,
    device_type: device_type?.trim() || "通用设备",
    max_hours_per_scene: 8,
    scene_categories: ["industrial"],
    total_hours_unlimited: true,
  };
}

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
  return { address_province: province, address_city: city, address_district: district, address_detail: rest.trim() || undefined };
}

function normalizePhone(p: string): string {
  return p.replace(/\s+/g, "").replace(/-/g, "");
}

function extractExecutorName(text: string): string | null {
  return fieldValue(text, ["执行员", "执行人", "分给", "分配给"]);
}

function extractExecutorPhone(text: string): string | null {
  const m = text.match(/1[3-9]\d{9}/);
  return m ? m[0] : null;
}

function extractPublicCodes(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z]{2,8}\d{4})\b/gi)) {
    found.add(m[1].toUpperCase());
  }
  for (const m of text.matchAll(/\b([0-9A-F]{10})\b/gi)) {
    found.add(m[1].toUpperCase());
  }
  return [...found];
}

function inferManualDevicesBatchDelete(text: string, role: string): FormFillSpec | null {
  if (!FORM_ROLES.manual_devices_batch_delete?.includes(role)) return null;
  if (!/(?:删除|移除|作废).*(?:离线)?设备|(?:离线)?设备.*(?:删除|移除|作废)/i.test(text)) return null;
  const public_codes = extractPublicCodes(text);
  const client_company = extractClientCompany(text);
  const device_type = extractDeviceType(text);
  const label_prefix = device_type ? defaultLabelPrefix(device_type) : null;
  if (public_codes.length === 0 && !client_company) return null;
  return {
    form: "manual_devices_batch_delete",
    label: public_codes.length ? `删除 ${public_codes.length} 台设备登记` : `删除「${client_company}」下离线设备`,
    data: {
      ...(public_codes.length ? { public_codes } : {}),
      ...(client_company ? { client_company } : {}),
      ...(label_prefix ? { label_prefix } : {}),
    },
  };
}

function inferManualDevicesBatchAssign(text: string, role: string): FormFillSpec | null {
  if (!FORM_ROLES.manual_devices_batch_assign?.includes(role)) return null;
  const release = /(?:设为空闲|取消分配|释放设备|收回设备)/i.test(text);
  const assign = /(?:分配|分给|指派).*(?:设备|执行员)|把.*设备.*(?:给|到)/i.test(text);
  if (!release && !assign) return null;
  const public_codes = extractPublicCodes(text);
  const client_company = extractClientCompany(text);
  const device_type = extractDeviceType(text);
  const label_prefix = device_type ? defaultLabelPrefix(device_type) : null;
  const executor_name = extractExecutorName(text);
  const executor_phone = extractExecutorPhone(text);
  const only_idle = /空闲.*(?:设备|台)/i.test(text);
  if (!release && !executor_name && !executor_phone) return null;
  if (public_codes.length === 0 && !client_company && !label_prefix) return null;
  return {
    form: "manual_devices_batch_assign",
    label: release
      ? public_codes.length
        ? `将 ${public_codes.length} 台设备设为空闲`
        : `将「${client_company ?? "匹配"}」设备设为空闲`
      : `分配设备给${executor_name ?? executor_phone ?? "执行员"}`,
    data: {
      ...(release ? { executor_user_id: "idle" } : { executor_name, executor_phone }),
      ...(public_codes.length ? { public_codes } : {}),
      ...(client_company ? { client_company } : {}),
      ...(label_prefix ? { label_prefix } : {}),
      ...(only_idle ? { only_idle: true } : {}),
    },
  };
}

function inferManualDevicesBatch(text: string, role: string): FormFillSpec | null {
  if (!FORM_ROLES.manual_devices_batch_create?.includes(role)) return null;
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

function inferPartyDemandCreate(text: string, role: string): FormFillSpec | null {
  if (!FORM_ROLES.party_demand_create?.includes(role)) return null;
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
  return {
    form: "party_demand_create",
    label: `添加甲方业务「${client_company}」`,
    data: { ...partyDemandDefaults(client_company, device_type), max_hours_per_scene },
  };
}

function inferSceneMacroCreate(text: string, role: string): FormFillSpec | null {
  if (!FORM_ROLES.scene_macro_create?.includes(role)) return null;
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
  const addr = parseChineseAddress(addrMatch[1]);
  return {
    form: "scene_macro_create",
    label: `创建大场景「${title}」`,
    data: {
      title,
      contact_name: contactMatch[1],
      contact_phone: normalizePhone(contactMatch[2]),
      ...addr,
    },
  };
}

export function inferFormFillsFromUserText(text: string, role: string): FormFillSpec[] {
  const t = text.trim();
  if (!t) return [];
  const out: FormFillSpec[] = [];
  const batchDelete = inferManualDevicesBatchDelete(t, role);
  if (batchDelete) out.push(batchDelete);
  const batchAssign = inferManualDevicesBatchAssign(t, role);
  if (batchAssign) out.push(batchAssign);
  const batch = inferManualDevicesBatch(t, role);
  if (batch && !batchDelete && !batchAssign) out.push(batch);
  const party = inferPartyDemandCreate(t, role);
  if (party && !batch && !batchDelete && !batchAssign) out.push(party);
  const macro = inferSceneMacroCreate(t, role);
  if (macro) out.push(macro);
  return out.slice(0, 3);
}

export function buildFormFillConfirmMessage(fills: FormFillSpec[]): string {
  const summary = fills.map((f) => {
    if (f.form === "manual_devices_batch_create") {
      const d = f.data;
      const typeLabel =
        (typeof d.label_prefix === "string" && d.label_prefix.trim()) ||
        (typeof d.device_type === "string" && d.device_type.trim()) ||
        "设备";
      return `为「${d.client_company}」登记 ${d.count} 台「${typeLabel}」离线设备`;
    }
    if (f.form === "party_demand_create") {
      return `甲方业务「${f.data.client_company}」，设备类型 ${f.data.device_type}`;
    }
    if (f.form === "scene_macro_create") {
      return `大场景「${f.data.title}」`;
    }
    if (f.form === "manual_devices_batch_delete") {
      const codes = f.data.public_codes;
      if (Array.isArray(codes) && codes.length) return `删除 ${codes.length} 台设备`;
      return `删除「${f.data.client_company}」下离线设备`;
    }
    if (f.form === "manual_devices_batch_assign") {
      if (f.data.executor_user_id === "idle") return "将选中设备设为空闲";
      const who =
        (typeof f.data.executor_name === "string" && f.data.executor_name) ||
        (typeof f.data.executor_phone === "string" && f.data.executor_phone) ||
        "执行员";
      return `分配设备给 ${who}`;
    }
    return f.label;
  });
  return `好的，我帮您写入：${summary.join("；")}。`;
}

function isFakeFormFillToast(message: string): boolean {
  return /添加设备信息|甲方\s*=|数量\s*=|设备信息：|已提示添加/.test(message);
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

/** @deprecated use stripActionsWhenFormFills */
export function stripNavigationActionsForFormFill(actions: unknown): unknown[] {
  return stripActionsWhenFormFills(actions);
}
