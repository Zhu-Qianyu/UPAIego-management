import type { AgentFormKind } from "./agentFormTypes";
import { validateImageFileType } from "../utils/compressImageFile";

const IMAGE_UPLOAD_FORMS: Partial<Record<AgentFormKind, string>> = {
  party_demand_create: "甲方设备快照",
  scene_macro_create: "大场景全景图",
  scenario_position_create: "小岗位工位快照",
};

export function formRequiresImage(form: AgentFormKind): boolean {
  return form in IMAGE_UPLOAD_FORMS;
}

export function getFormImageUploadLabel(form: AgentFormKind): string {
  return IMAGE_UPLOAD_FORMS[form] ?? "图片";
}

/** @deprecated 仅校验类型；大小超限请用 prepareImageFileForUpload 自动压缩 */
export function validateAgentImageFile(file: File): string | null {
  return validateImageFileType(file);
}

export function pendingFormFillsNeedImages(
  fills: { form: AgentFormKind }[]
): { index: number; form: AgentFormKind; label: string }[] {
  return fills
    .map((f, index) => ({ index, form: f.form, label: getFormImageUploadLabel(f.form) }))
    .filter((x) => formRequiresImage(x.form));
}

export function allRequiredFormImagesSelected(
  fills: { form: AgentFormKind }[],
  images: Record<number, File> | undefined
): boolean {
  const needed = pendingFormFillsNeedImages(fills);
  if (!needed.length) return true;
  return needed.every((n) => images?.[n.index] instanceof File);
}
