export const SCENE_CATEGORY_KEYS = ["industrial", "home", "special"] as const;
export type SceneCategoryKey = (typeof SCENE_CATEGORY_KEYS)[number];

/** 前端不再分类；写入数据库时统一使用默认值以满足 NOT NULL 约束。 */
export const DEFAULT_SCENE_CATEGORIES: SceneCategoryKey[] = ["industrial"];

export const SCENE_CATEGORY_LABELS: Record<SceneCategoryKey, string> = {
  industrial: "工业",
  home: "家庭",
  special: "特种",
};

export function labelSceneCategories(cats: string[] | null | undefined): string {
  if (!cats?.length) return "—";
  return cats.map((c) => SCENE_CATEGORY_LABELS[c as SceneCategoryKey] ?? c).join("、");
}

export function sceneCategoriesOverlap(d: string[], p: string[]): boolean {
  const ps = new Set(p);
  return d.some((x) => ps.has(x));
}
