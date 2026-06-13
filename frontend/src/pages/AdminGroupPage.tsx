import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  createWorkGroup,
  fetchOwnedWorkGroup,
  listPendingMembers,
  listRejectedMembers,
  setMembershipStatus,
  type GroupMember,
  type WorkGroup,
} from "../api/groups";
import { adminUpdateMemberRoles, fetchProfilesByIds, profileDisplayName } from "../api/profiles";
import { ROLE_LABELS } from "../auth/roleLabels";
import { formatRolesLabel, sortRolesByPriority } from "../auth/roleUtils";
import type { UserRole } from "../types/roles";
import { NON_ADMIN_ROLES } from "../types/roles";
import { formatPhoneDisplay } from "../utils/phoneAuth";
import { CardList, CardListItem, CompactList, CompactListRow, ListViewSection } from "../components/ui/PageLayout";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import { readRouteViewCache, routeViewCacheKey, writeRouteViewCache } from "../utils/routeViewCache";
import { useAuth } from "../auth/AuthContext";
import GroupTabs from "../components/GroupTabs";

type AdminGroupCacheV1 = { v: 1; owned: WorkGroup | null; pending: GroupMember[]; rejected: GroupMember[] };

type MemberInfo = { name: string; phone: string; role: string; roles: UserRole[] };

type MemberProfileMap = Record<string, MemberInfo>;

const EDITABLE_ROLES: UserRole[] = [...NON_ADMIN_ROLES];

async function loadMemberProfiles(members: GroupMember[]): Promise<MemberProfileMap> {
  if (!members.length) return {};
  const profs = await fetchProfilesByIds(members.map((m) => m.user_id));
  const map: MemberProfileMap = {};
  for (const row of members) {
    const prof = profs.find((x) => x.id === row.user_id);
    const roles = prof?.roles?.length ? sortRolesByPriority(prof.roles) : (["device_operator"] as UserRole[]);
    map[row.user_id] = {
      name: prof ? profileDisplayName(prof) : row.user_id.slice(0, 8),
      phone: formatPhoneDisplay(prof?.phone ?? row.request_phone),
      roles,
      role: formatRolesLabel(roles),
    };
  }
  return map;
}

function RoleCheckboxRow({
  roles,
  onChange,
}: {
  roles: UserRole[];
  onChange: (next: UserRole[]) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {EDITABLE_ROLES.map((r) => {
        const checked = roles.includes(r);
        return (
          <label
            key={r}
            className={`inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${
              checked ? "border-indigo-400 bg-indigo-50 text-indigo-900" : "border-gray-200 text-gray-600"
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              className="sr-only"
              onChange={() => {
                if (checked) {
                  const next = roles.filter((x) => x !== r);
                  if (next.length) onChange(sortRolesByPriority(next));
                } else {
                  onChange(sortRolesByPriority([...roles, r]));
                }
              }}
            />
            {ROLE_LABELS[r]}
          </label>
        );
      })}
    </div>
  );
}

function MemberReviewCard({
  m,
  info,
  busyId,
  onApprove,
  onReject,
  rejectLabel = "拒绝",
  approveLabel = "同意",
  editRoles,
  roles,
  onRolesChange,
}: {
  m: GroupMember;
  info?: MemberInfo;
  busyId: string | null;
  onApprove: () => void;
  onReject?: () => void;
  rejectLabel?: string;
  approveLabel?: string;
  editRoles?: boolean;
  roles?: UserRole[];
  onRolesChange?: (roles: UserRole[]) => void;
}) {
  return (
    <CardListItem>
      <div className="rounded-xl border border-gray-200 bg-white p-4 h-full w-full min-w-0 overflow-hidden box-border flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">{info?.name ?? m.user_id.slice(0, 8)}</p>
          <p className="text-xs text-gray-600 mt-0.5">
            {info?.role ?? "—"} · 手机 {info?.phone ?? "—"}
            {m.request_email && !m.request_email.endsWith("@upaiego.auth") && (
              <span> · {m.request_email}</span>
            )}
          </p>
          {editRoles && roles && onRolesChange ? (
            <>
              <p className="text-[11px] text-gray-500 mt-1">审批前可调整职能（可多选）</p>
              <RoleCheckboxRow roles={roles} onChange={onRolesChange} />
            </>
          ) : null}
          <p className="text-xs text-gray-400 mt-1">
            申请 {new Date(m.created_at).toLocaleString()}
            {m.decided_at ? ` · 处理 ${new Date(m.decided_at).toLocaleString()}` : ""}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            disabled={busyId === m.id}
            onClick={onApprove}
            className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-medium disabled:opacity-50"
          >
            {approveLabel}
          </button>
          {onReject ? (
            <button
              type="button"
              disabled={busyId === m.id}
              onClick={onReject}
              className="px-3 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 disabled:opacity-50"
            >
              {rejectLabel}
            </button>
          ) : null}
        </div>
      </div>
    </CardListItem>
  );
}

export default function AdminGroupPage() {
  const { session } = useAuth();
  const location = useLocation();
  const cacheKey = useMemo(
    () => routeViewCacheKey(session?.user?.id, location.pathname),
    [session?.user?.id, location.pathname]
  );

  const [owned, setOwned] = useState<WorkGroup | null | undefined>(undefined);
  const [pending, setPending] = useState<GroupMember[]>([]);
  const [rejected, setRejected] = useState<GroupMember[]>([]);
  const [pendingProfiles, setPendingProfiles] = useState<MemberProfileMap>({});
  const [rejectedProfiles, setRejectedProfiles] = useState<MemberProfileMap>({});
  const [roleEdits, setRoleEdits] = useState<Record<string, UserRole[]>>({});
  const [name, setName] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!cacheKey) return;
    const snap = readRouteViewCache<AdminGroupCacheV1>(cacheKey);
    if (!snap || snap.v !== 1) return;
    setOwned(snap.owned);
    setPending(snap.pending);
    setRejected(snap.rejected ?? []);
    setLoading(false);
  }, [cacheKey]);

  const refresh = useCallback(async () => {
    const stale = cacheKey ? readRouteViewCache<AdminGroupCacheV1>(cacheKey) : null;
    if (stale) setRefreshing(true);
    else setLoading(true);
    setErr("");
    try {
      const g = await fetchOwnedWorkGroup();
      setOwned(g);
      if (g) {
        const [p, rej] = await Promise.all([listPendingMembers(g.id), listRejectedMembers(g.id)]);
        setPending(p);
        setRejected(rej);
        const [pProf, rProf] = await Promise.all([loadMemberProfiles(p), loadMemberProfiles(rej)]);
        setPendingProfiles(pProf);
        setRejectedProfiles(rProf);
        setRoleEdits(
          Object.fromEntries(p.map((m) => [m.user_id, pProf[m.user_id]?.roles ?? ["device_operator"]]))
        );
        if (cacheKey) writeRouteViewCache(cacheKey, { v: 1, owned: g, pending: p, rejected: rej });
      } else {
        setPending([]);
        setRejected([]);
        setPendingProfiles({});
        setRejectedProfiles({});
        setRoleEdits({});
        if (cacheKey) writeRouteViewCache(cacheKey, { v: 1, owned: null, pending: [], rejected: [] });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "加载失败";
      setErr(msg);
      setOwned(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await createWorkGroup(name, customCode || undefined);
      setName("");
      setCustomCode("");
      await refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "创建失败：每位平台管理员仅可拥有一个作为群主的工作群组。");
    }
  }

  async function approve(m: GroupMember, ok: boolean) {
    setBusyId(m.id);
    setErr("");
    try {
      if (ok) {
        const roles = roleEdits[m.user_id] ?? pendingProfiles[m.user_id]?.roles ?? ["device_operator"];
        await adminUpdateMemberRoles(m.user_id, roles);
      }
      await setMembershipStatus(m.id, ok ? "active" : "rejected");
      await refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && owned === undefined) return <Spinner />;

  return (
    <div className="w-full min-w-0 space-y-8">
      <RefreshStrip active={refreshing} />
      <GroupTabs />
      <div>
        <h1 className="text-2xl font-bold text-gray-900">群组管理</h1>
        <p className="text-sm text-gray-500 mt-1">
          仅<strong>平台管理员</strong>可在此<strong>创建一个</strong>工作群组（各有独立群组号）。
          成员注册时填写<strong>你的群组号</strong>即归入本群，申请会出现在下方「待审批入群」；审批时可调整其职能组合。
        </p>
      </div>

      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{err}</div>}

      {!owned ? (
        <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-indigo-100 p-6 space-y-4 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-800">创建工作群组</h2>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="群组显示名称"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            value={customCode}
            onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
            placeholder="自定义入群代码（可空，将自动生成 8 位）"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono"
          />
          <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">
            创建群组
          </button>
        </form>
      ) : (
        <div className="bg-white rounded-2xl border border-indigo-100 p-6 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-gray-800">{owned.display_name}</h2>
          <p className="text-xs text-gray-500">入群代码（可复制给用户）：</p>
          <p className="text-2xl font-mono font-bold tracking-widest text-indigo-800 bg-indigo-50 rounded-lg px-4 py-3 inline-block">
            {owned.invite_code}
          </p>
        </div>
      )}

      {owned && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-800">待审批入群</h2>
            <button type="button" onClick={() => void refresh()} className="text-xs text-indigo-600 hover:underline">
              刷新
            </button>
          </div>
          {pending.length === 0 ? (
            <p className="text-sm text-gray-400">暂无待处理申请</p>
          ) : (
            <ListViewSection storageKey="admin-pending-members" compact={
              <CompactList>
                {pending.map((m) => {
                  const info = pendingProfiles[m.user_id];
                  const roles = roleEdits[m.user_id] ?? info?.roles ?? ["device_operator"];
                  return (
                    <CompactListRow
                      key={m.id}
                      primary={info?.name ?? m.user_id.slice(0, 8)}
                      secondary={`${formatRolesLabel(roles)} · 手机 ${info?.phone ?? "—"}`}
                      meta={new Date(m.created_at).toLocaleString()}
                    />
                  );
                })}
              </CompactList>
            }>
            <CardList>
              {pending.map((m) => (
                <MemberReviewCard
                  key={m.id}
                  m={m}
                  info={pendingProfiles[m.user_id]}
                  busyId={busyId}
                  editRoles
                  roles={roleEdits[m.user_id] ?? pendingProfiles[m.user_id]?.roles ?? ["device_operator"]}
                  onRolesChange={(next) =>
                    setRoleEdits((prev) => ({ ...prev, [m.user_id]: next }))
                  }
                  onApprove={() => void approve(m, true)}
                  onReject={() => void approve(m, false)}
                />
              ))}
            </CardList>
            </ListViewSection>
          )}
        </div>
      )}

      {owned && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">已拒绝（可重新同意）</h2>
              <p className="text-xs text-gray-500 mt-0.5">误拒后可在此恢复入群，无需用户重新申请</p>
            </div>
            <button type="button" onClick={() => void refresh()} className="text-xs text-indigo-600 hover:underline">
              刷新
            </button>
          </div>
          {rejected.length === 0 ? (
            <p className="text-sm text-gray-400">暂无已拒绝记录</p>
          ) : (
            <CardList>
              {rejected.map((m) => (
                <MemberReviewCard
                  key={m.id}
                  m={m}
                  info={rejectedProfiles[m.user_id]}
                  busyId={busyId}
                  approveLabel="重新同意"
                  editRoles
                  roles={roleEdits[m.user_id] ?? rejectedProfiles[m.user_id]?.roles ?? ["device_operator"]}
                  onRolesChange={(next) =>
                    setRoleEdits((prev) => ({ ...prev, [m.user_id]: next }))
                  }
                  onApprove={() => void approve(m, true)}
                />
              ))}
            </CardList>
          )}
        </div>
      )}
    </div>
  );
}
