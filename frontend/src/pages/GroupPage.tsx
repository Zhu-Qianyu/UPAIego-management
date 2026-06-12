import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  fetchActiveGroupId,
  fetchMyMemberships,
  fetchWorkGroupById,
  kickGroupMember,
  listAllGroupMembers,
  setMembershipStatus,
  submitJoinRequest,
  type GroupMember,
  type WorkGroup,
} from "../api/groups";
import { fetchProfilesByIds } from "../api/profiles";
import ImShell from "../components/im/ImShell";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import { readRouteViewCache, routeViewCacheKey, writeRouteViewCache } from "../utils/routeViewCache";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS } from "../auth/roleLabels";
import { isUserRole } from "../types/roles";
import GroupTabs from "../components/GroupTabs";

function membershipLabel(s: GroupMember["membership_status"]): string {
  if (s === "active") return "已加入";
  if (s === "pending") return "待审核";
  return "已拒绝";
}

type GroupPageCacheV1 = {
  v: 1;
  groupId: string | null;
  workGroup: WorkGroup | null;
  hasPending: boolean;
  members: (GroupMember & { displayName: string; roleLabel: string })[];
};

export default function GroupPage() {
  const { profile, session } = useAuth();
  const location = useLocation();
  const cacheKey = useMemo(
    () => routeViewCacheKey(session?.user?.id, location.pathname),
    [session?.user?.id, location.pathname]
  );

  const [groupId, setGroupId] = useState<string | null>(null);
  const [workGroup, setWorkGroup] = useState<WorkGroup | null>(null);
  const [hasPending, setHasPending] = useState(false);
  const [members, setMembers] = useState<
    (GroupMember & { displayName: string; roleLabel: string })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");

  const [joinCode, setJoinCode] = useState("");
  const [joinMsg, setJoinMsg] = useState("");
  const [joinErr, setJoinErr] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  useLayoutEffect(() => {
    if (!cacheKey) return;
    const snap = readRouteViewCache<GroupPageCacheV1>(cacheKey);
    if (!snap || snap.v !== 1) return;
    setGroupId(snap.groupId);
    setWorkGroup(snap.workGroup);
    setHasPending(snap.hasPending);
    setMembers(snap.members);
    setLoading(false);
  }, [cacheKey]);

  const load = useCallback(async () => {
    const stale = cacheKey ? readRouteViewCache<GroupPageCacheV1>(cacheKey) : null;
    if (stale) setRefreshing(true);
    else setLoading(true);
    setErr("");
    try {
      const memberships = await fetchMyMemberships();
      const pending = memberships.some((r) => r.membership_status === "pending");
      setHasPending(pending);

      const gid = await fetchActiveGroupId();
      setGroupId(gid);
      if (!gid) {
        setWorkGroup(null);
        setMembers([]);
        if (cacheKey) {
          const snap: GroupPageCacheV1 = {
            v: 1,
            groupId: null,
            workGroup: null,
            hasPending: pending,
            members: [],
          };
          writeRouteViewCache(cacheKey, snap);
        }
        return;
      }

      const [wg, gmRows] = await Promise.all([fetchWorkGroupById(gid), listAllGroupMembers(gid)]);
      setWorkGroup(wg);

      const profs = await fetchProfilesByIds(gmRows.map((r) => r.user_id));
      const pMap = new Map(profs.map((p) => [p.id, p]));
      const enriched = gmRows.map((m) => {
        const p = pMap.get(m.user_id);
        const role = p?.role && isUserRole(p.role) ? p.role : null;
        const displayName =
          (p?.display_name?.trim() || "").length > 0
            ? p!.display_name!
            : (m.request_email?.trim() || "").length > 0
              ? m.request_email!
              : `用户 ${m.user_id.slice(0, 8)}…`;
        const roleLabel = role ? ROLE_LABELS[role] : "—";
        return { ...m, displayName, roleLabel };
      });
      setMembers(enriched);

      if (cacheKey) {
        writeRouteViewCache(cacheKey, {
          v: 1,
          groupId: gid,
          workGroup: wg,
          hasPending: pending,
          members: enriched,
        });
      }
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "加载失败";
      setErr(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleKick(member: GroupMember & { displayName: string }) {
    if (
      !confirm(
        `确定将「${member.displayName}」移出本群？对方需重新申请或使用新邀请码入群（如规则允许）。`
      )
    ) {
      return;
    }
    setErr("");
    try {
      await kickGroupMember(member.id);
      await load();
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "操作失败";
      setErr(msg);
    }
  }

  async function handleMembershipReview(memberId: string, status: "active" | "rejected") {
    setErr("");
    try {
      await setMembershipStatus(memberId, status);
      await load();
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "操作失败";
      setErr(msg);
    }
  }

  async function onJoinSubmit(e: React.FormEvent) {
    e.preventDefault();
    setJoinErr("");
    setJoinMsg("");
    setJoinBusy(true);
    try {
      await submitJoinRequest(joinCode);
      setJoinMsg("申请已提交，请等待该群管理员审批。");
      setJoinCode("");
      await load();
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "message" in e ? String((e as Error).message) : "提交失败";
      setJoinErr(msg);
    } finally {
      setJoinBusy(false);
    }
  }

  const uid = session?.user?.id;
  const displayNameByUserId = useMemo(
    () => new Map(members.map((m) => [m.user_id, m.displayName])),
    [members]
  );
  const isPlatformAdmin = profile?.role === "admin";
  const ownerId = workGroup?.owner_user_id;
  const canModerateMembers = isPlatformAdmin || (!!uid && !!ownerId && uid === ownerId);
  const myMembership = members.find((m) => m.user_id === uid);
  const canSendChat = myMembership?.membership_status === "active";

  function canKickRow(m: GroupMember): boolean {
    if (!canModerateMembers) return false;
    if (!uid || !ownerId) return false;
    if (m.user_id === uid) return false;
    if (m.user_id === ownerId) return false;
    if (m.membership_status !== "active") return false;
    return true;
  }

  function canReviewRow(m: GroupMember): boolean {
    if (!canModerateMembers) return false;
    if (!uid || !ownerId) return false;
    if (m.user_id === uid) return false;
    if (m.user_id === ownerId) return false;
    return m.membership_status === "pending" || m.membership_status === "rejected";
  }

  if (loading) return <Spinner />;

  if (!groupId) {
    if (hasPending) {
      return (
        <div className="max-w-xl mx-auto space-y-6">
          <RefreshStrip active={refreshing} />
          <GroupTabs />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">群组</h1>
            <p className="text-sm text-gray-500 mt-1">入群申请处理中</p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-6 text-sm text-amber-950">
            <p className="font-medium mb-2">你的入群申请正在等待审批</p>
            <p className="text-amber-900/90">
              通过后即可在本页查看群名称、成员与聊天室。审批由群主（创建该群的）或平台管理员处理。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="text-sm text-indigo-600 font-medium hover:underline"
          >
            刷新状态
          </button>
        </div>
      );
    }

    return (
      <div className="max-w-lg mx-auto space-y-6">
        <RefreshStrip active={refreshing} />
        <GroupTabs />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">群组</h1>
          <p className="text-sm text-gray-500 mt-1">
            工作群组<strong>仅由平台管理员创建</strong>
            {isPlatformAdmin ? (
              <>
                。你若需要负责本群的入群审批与邀请码分发，请先打开<strong>群组管理</strong>创建群组。
              </>
            ) : (
              <>
                ，个人无法自建。若需加入已有群，请输入管理员提供的<strong>入群代码</strong>提交申请。
              </>
            )}
          </p>
        </div>
        <form
          onSubmit={onJoinSubmit}
          className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-6 space-y-4"
        >
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">入群代码</label>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="例如：A1B2C3D4"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono tracking-wide uppercase"
              required
            />
          </div>
          {joinErr && <p className="text-sm text-red-600">{joinErr}</p>}
          {joinMsg && <p className="text-sm text-green-600">{joinMsg}</p>}
          <button
            type="submit"
            disabled={joinBusy || !joinCode.trim()}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {joinBusy ? "提交中..." : "提交申请"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-4">
      <RefreshStrip active={refreshing} />
      <GroupTabs />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 mb-1">群组</p>
        <h1 className="text-2xl font-bold text-gray-900">{workGroup?.display_name ?? "本群"}</h1>
        <p className="text-sm text-gray-500 mt-1">
          微信式聊天：左侧切换群聊、豆小秘与成员私聊；群主或管理员可在「群成员管理」审批与移出成员。
        </p>
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
      </div>

      {groupId && profile?.role && isUserRole(profile.role) && (
        <ImShell
          groupId={groupId}
          groupName={workGroup?.display_name ?? "本工作群"}
          members={members}
          userRole={profile.role}
          userId={uid}
          canSend={canSendChat}
          displayNameByUserId={displayNameByUserId}
          setErr={setErr}
          canModerateMembers={canModerateMembers}
          onOpenMembers={() => setMembersOpen(true)}
        />
      )}

      {membersOpen && (
        <>
          <button
            type="button"
            aria-label="关闭成员管理"
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setMembersOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-lg flex flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">群成员 · {members.length} 人</h2>
              <button
                type="button"
                onClick={() => setMembersOpen(false)}
                className="text-sm text-gray-500 hover:text-gray-800"
              >
                关闭
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {members.length === 0 ? (
                <p className="text-sm text-gray-400 px-4 py-6">暂无成员数据</p>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
                      <th className="px-4 py-2 font-medium">成员</th>
                      <th className="px-4 py-2 font-medium">角色</th>
                      <th className="px-4 py-2 font-medium">状态</th>
                      {canModerateMembers && <th className="px-4 py-2 font-medium w-32">操作</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {members.map((m) => (
                      <tr key={m.id} className="hover:bg-indigo-50/30">
                        <td className="px-4 py-2.5 text-gray-900">
                          <span className="font-medium">{m.displayName}</span>
                          {uid === m.user_id && <span className="ml-2 text-xs text-indigo-600">（我）</span>}
                          {ownerId === m.user_id && <span className="ml-2 text-xs text-gray-500">（群主）</span>}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">{m.roleLabel}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${
                              m.membership_status === "active"
                                ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"
                                : m.membership_status === "pending"
                                  ? "bg-amber-50 text-amber-900 ring-1 ring-amber-100"
                                  : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {membershipLabel(m.membership_status)}
                          </span>
                        </td>
                        {canModerateMembers && (
                          <td className="px-4 py-2.5">
                            {canReviewRow(m) ? (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleMembershipReview(m.id, "active")}
                                  className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
                                >
                                  {m.membership_status === "rejected" ? "重新同意" : "同意"}
                                </button>
                                {m.membership_status === "pending" ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleMembershipReview(m.id, "rejected")}
                                    className="text-xs font-medium text-gray-600 hover:text-gray-800"
                                  >
                                    拒绝
                                  </button>
                                ) : null}
                              </div>
                            ) : canKickRow(m) ? (
                              <button
                                type="button"
                                onClick={() => void handleKick(m)}
                                className="text-xs font-medium text-red-600 hover:text-red-800"
                              >
                                移出
                              </button>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
