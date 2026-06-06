import type { AgentFormKind, AgentPendingFormFill } from "./agentFormTypes";
import type { UserRole } from "../types/roles";

const FORM_ROLES: Record<string, UserRole[]> = {
  scene_macro_create: ["admin", "scene_operator"],
  party_demand_create: ["admin", "scene_operator"],
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

function extractQuotedOrPlain(s: string): string {
  const q = s.match(/[「"']([^」"']+)[」"']/);
  if (q) return q[1].trim();
  return s.trim();
}

function normalizePhone(p: string): string {
  return p.replace(/\s+/g, "").replace(/-/g, "");
}

function fieldValue(body: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label}[为是]?[：:]?\\s*[「"']?([^」"',，\\n]+)[」"']?`, "i");
    const m = body.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

/** 与 edge formFillInfer.ts 保持同步：LLM 漏填时从用户原文推断 */
export function inferFormFillsFromUserText(text: string, role: UserRole): AgentPendingFormFill[] {
  const t = text.trim();
  if (!t) return [];

  const out: AgentPendingFormFill[] = [];

  if (FORM_ROLES.scene_macro_create.includes(role)) {
    const macroMatch = t.match(/(?:帮我)?(?:创建|填|录入|添加)(?:一?[条个])?大场景[：:]\s*([\s\S]+)/i);
    if (macroMatch) {
      const body = macroMatch[1];
      const titleFromLabel = fieldValue(body, ["标题", "名称", "大场景名称"]);
      let title = titleFromLabel ?? "";
      if (!title) {
        const firstPart = body.split(/[，,]/)[0]?.trim() ?? "";
        title = extractQuotedOrPlain(firstPart.replace(/^(?:标题|名称)[为是]?[：:]?\s*/i, ""));
      }
      const contactMatch = body.match(/联系人\s*[：:]?\s*(\S+?)\s+(\d[\d\s-]{10,15})/);
      const addrMatch = body.match(/地址\s*[：:]?\s*([^，,\n]+)/);
      if (title && contactMatch && addrMatch) {
        out.push({
          form: "scene_macro_create" as AgentFormKind,
          label: `创建大场景「${title}」`,
          data: {
            title,
            contact_name: contactMatch[1],
            contact_phone: normalizePhone(contactMatch[2]),
            ...parseChineseAddress(addrMatch[1]),
          },
        });
      }
    }
  }

  if (FORM_ROLES.party_demand_create.includes(role) && !out.length) {
    const m = t.match(/(?:帮我)?(?:填|录入|创建|添加)(?:一?[条个])?甲方业务[：:]\s*([\s\S]+)/i);
    if (m) {
      const body = m[1];
      const client_company =
        fieldValue(body, ["公司名", "公司", "客户", "甲方"]) ??
        extractQuotedOrPlain(body.split(/[，,]/)[0]?.trim() ?? "");
      const device_type = fieldValue(body, ["设备类型", "设备"]);
      const maxHoursRaw = body.match(/(?:单场景上限|上限)[^\d]*(\d+)/i)?.[1];
      const max_hours_per_scene = maxHoursRaw ? Math.max(1, parseInt(maxHoursRaw, 10)) : 0;
      let scene_categories: string[] = ["industrial"];
      const catMatch = body.match(/场景(?:类型|分类)?\s*[：:]?\s*(\w+)/i);
      if (catMatch && ["industrial", "home", "special"].includes(catMatch[1])) {
        scene_categories = [catMatch[1]];
      }
      if (client_company && device_type && max_hours_per_scene) {
        out.push({
          form: "party_demand_create" as AgentFormKind,
          label: `创建甲方业务「${client_company}」`,
          data: {
            client_company,
            device_type,
            max_hours_per_scene,
            scene_categories,
            total_hours_unlimited: true,
          },
        });
      }
    }
  }

  return out.slice(0, 3);
}

export function buildFormFillConfirmMessage(fills: AgentPendingFormFill[]): string {
  const summary = fills.map((f) => {
    if (f.form === "scene_macro_create") {
      const d = f.data;
      return `大场景「${d.title}」，联系人 ${d.contact_name} ${d.contact_phone}，${d.address_province}${d.address_city}${d.address_district}`;
    }
    if (f.form === "party_demand_create") {
      return `甲方业务「${f.data.client_company}」，设备 ${f.data.device_type}`;
    }
    return f.label;
  });
  return `好的，我帮您写入：${summary.join("；")}。`;
}
