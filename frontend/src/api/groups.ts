import { supabase } from "./supabase";
import { fetchProfile, fetchProfilesByIds, type ProfileContact } from "./profiles";
import type { UserRole } from "../types/roles";

const WG = "work_groups";
const GM = "group_members";
const GT = "group_topics";

export interface WorkGroup {
  id: string;
  invite_code: string;
  display_name: string;
  owner_user_id: string;
  created_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  membership_status: "pending" | "active" | "rejected";
  request_email: string | null;
  request_phone: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface GroupTopic {
  id: string;
  group_id: string;
  title: string;
  body: string | null;
  created_by: string;
  created_at: string;
}

export async function fetchOwnedWorkGroup(): Promise<WorkGroup | null> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) return null;
  const { data, error } = await supabase.from(WG).select("*").eq("owner_user_id", u.id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as WorkGroup | null;
}

export async function fetchMyMemberships(): Promise<(GroupMember & { work_groups?: WorkGroup })[]> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) return [];
  const { data, error } = await supabase
    .from(GM)
    .select("*, work_groups(*)")
    .eq("user_id", u.id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as any[];
}

export async function fetchActiveGroupId(): Promise<string | null> {
  const rows = await fetchMyMemberships();
  const active = rows.find((r) => r.membership_status === "active");
  return active?.group_id ?? null;
}

/** 当前用户作为成员可读的群详情（含 display_name） */
export async function fetchWorkGroupById(groupId: string): Promise<WorkGroup | null> {
  const { data, error } = await supabase.from(WG).select("*").eq("id", groupId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as WorkGroup | null;
}

/** 群内全部成员行（含 pending / rejected），需 gm_select 策略允许 */
export async function listAllGroupMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await supabase
    .from(GM)
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const statusOrder = (s: string) => (s === "active" ? 0 : s === "pending" ? 1 : 2);
  return ([...(data ?? [])] as GroupMember[]).sort(
    (a, b) => statusOrder(a.membership_status) - statusOrder(b.membership_status) || a.created_at.localeCompare(b.created_at)
  );
}

/** 群内指定角色的活跃成员资料（用于悬赏指定运维员、设备分发选执行员等） */
export async function listGroupProfilesByRole(groupId: string, role: UserRole): Promise<ProfileContact[]> {
  const members = await listAllGroupMembers(groupId);
  const ids = members.filter((m) => m.membership_status === "active").map((m) => m.user_id);
  const profiles = await fetchProfilesByIds(ids);
  return profiles.filter((p) => p.role === role);
}

export async function createWorkGroup(displayName: string, inviteCode?: string): Promise<WorkGroup> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");
  const prof = await fetchProfile(u.id);
  if (prof?.role !== "admin") {
    throw new Error("仅平台管理员可创建工作群组；其他角色请使用入群代码加入已有群组。");
  }
  const payload: Record<string, string> = {
    display_name: displayName.trim(),
    owner_user_id: u.id,
  };
  if (inviteCode?.trim()) payload.invite_code = inviteCode.trim();
  const { data, error } = await supabase.from(WG).insert(payload).select().single();
  if (error) throw new Error(error.message);
  return data as WorkGroup;
}

export async function submitJoinRequest(invite: string): Promise<void> {
  const { error } = await supabase.rpc("submit_group_join_request", {
    p_invite_code: invite.trim(),
  });
  if (error) throw new Error(error.message);
}

/** 注册完成后绑定群组号并进入待审批状态（非 admin） */
export async function completeSignupGroupRequest(inviteCode: string): Promise<void> {
  const { error } = await supabase.rpc("complete_signup_group_request", {
    p_invite_code: inviteCode.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function listPendingMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await supabase
    .from(GM)
    .select("*")
    .eq("group_id", groupId)
    .eq("membership_status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as GroupMember[];
}

/** 群主或平台管理员将成员移出（标记为已拒绝） */
export async function kickGroupMember(memberId: string): Promise<void> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");
  const { error } = await supabase
    .from(GM)
    .update({
      membership_status: "rejected",
      decided_at: new Date().toISOString(),
      decided_by: u.id,
    })
    .eq("id", memberId);
  if (error) throw new Error(error.message);
}

export async function setMembershipStatus(
  memberId: string,
  status: "active" | "rejected"
): Promise<void> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");
  const { error } = await supabase
    .from(GM)
    .update({
      membership_status: status,
      decided_at: new Date().toISOString(),
      decided_by: u.id,
    })
    .eq("id", memberId);
  if (error) throw new Error(error.message);
}

export async function listGroupTopics(groupId: string): Promise<GroupTopic[]> {
  const { data, error } = await supabase
    .from(GT)
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as GroupTopic[];
}

export async function createGroupTopic(groupId: string, title: string, body: string): Promise<GroupTopic> {
  const u = (await supabase.auth.getUser()).data.user;
  if (!u) throw new Error("未登录");
  const { data, error } = await supabase
    .from(GT)
    .insert({ group_id: groupId, title: title.trim(), body: body.trim() || null, created_by: u.id })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as GroupTopic;
}

export async function deleteGroupTopic(topicId: string): Promise<void> {
  const { error } = await supabase.from(GT).delete().eq("id", topicId);
  if (error) throw new Error(error.message);
}
