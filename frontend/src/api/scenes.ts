import { supabase } from "./supabase";

export type SceneTaskStatus = "draft" | "published" | "closed";

export interface SceneTask {
  id: string;
  title: string;
  description: string | null;
  status: SceneTaskStatus;
  created_by: string;
  created_at: string;
  due_at: string | null;
}

export interface CollectionRequirement {
  id: string;
  scene_task_id: string;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  created_by: string;
  created_at: string;
}

export async function listSceneTasks(): Promise<SceneTask[]> {
  const { data, error } = await supabase.from("scene_tasks").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SceneTask[];
}

export async function createSceneTask(input: {
  title: string;
  description?: string;
  status?: SceneTaskStatus;
  due_at?: string | null;
}): Promise<SceneTask> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error("未登录");
  const { data, error } = await supabase
    .from("scene_tasks")
    .insert({
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? "draft",
      due_at: input.due_at ?? null,
      created_by: user.id,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as SceneTask;
}

export async function updateSceneTask(
  id: string,
  patch: Partial<Pick<SceneTask, "title" | "description" | "status" | "due_at">>
): Promise<void> {
  const { error } = await supabase.from("scene_tasks").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteSceneTask(id: string): Promise<void> {
  const { error } = await supabase.from("scene_tasks").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listRequirementsForTask(sceneTaskId: string): Promise<CollectionRequirement[]> {
  const { data, error } = await supabase
    .from("collection_requirements")
    .select("*")
    .eq("scene_task_id", sceneTaskId)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CollectionRequirement[];
}

export async function createRequirement(input: {
  scene_task_id: string;
  title: string;
  description?: string;
  priority?: number;
  status?: string;
}): Promise<CollectionRequirement> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error("未登录");
  const { data, error } = await supabase
    .from("collection_requirements")
    .insert({
      scene_task_id: input.scene_task_id,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 0,
      status: input.status ?? "open",
      created_by: user.id,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as CollectionRequirement;
}

export async function updateRequirement(
  id: string,
  patch: Partial<Pick<CollectionRequirement, "title" | "description" | "priority" | "status">>
): Promise<void> {
  const { error } = await supabase.from("collection_requirements").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}
