import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  createWorkGroup,
  fetchOwnedWorkGroup,
  listPendingMembers,
  setMembershipStatus,
  type GroupMember,
  type WorkGroup,
} from "../api/groups";
import { fetchProfilesByIds, profileDisplayName } from "../api/profiles";
import { ROLE_LABELS } from "../auth/roleLabels";
import { formatPhoneDisplay } from "../utils/phoneAuth";
import { CardList, CardListItem, CompactList, CompactListRow, ListViewSection } from "../components/ui/PageLayout";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import { readRouteViewCache, routeViewCacheKey, writeRouteViewCache } from "../utils/routeViewCache";
import { useAuth } from "../auth/AuthContext";
import GroupTabs from "../components/GroupTabs";

type AdminGroupCacheV1 = { v: 1; owned: WorkGroup | null; pending: GroupMember[] };

export default function AdminGroupPage() {
  const { session } = useAuth();
  const location = useLocation();
  const cacheKey = useMemo(
    () => routeViewCacheKey(session?.user?.id, location.pathname),
    [session?.user?.id, location.pathname]
  );

  const [owned, setOwned] = useState<WorkGroup | null | undefined>(undefined);
  const [pending, setPending] = useState<GroupMember[]>([]);
  const [pendingProfiles, setPendingProfiles] = useState<
    Record<string, { name: string; phone: string; role: string }>
  >({});
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
        const p = await listPendingMembers(g.id);
        setPending(p);
        if (p.length) {
          const profs = await fetchProfilesByIds(p.map((m) => m.user_id));
          const map: Record<string, { name: string; phone: string; role: string }> = {};
          for (const row of p) {
            const prof = profs.find((x) => x.id === row.user_id);
            map[row.user_id] = {
              name: prof ? profileDisplayName(prof) : row.user_id.slice(0, 8),
              phone: formatPhoneDisplay(prof?.phone ?? row.request_phone),
              role: prof?.role ? ROLE_LABELS[prof.role] : "—",
            };
          }
          setPendingProfiles(map);
        } else {
          setPendingProfiles({});
        }
        if (cacheKey) writeRouteViewCache(cacheKey, { v: 1, owned: g, pending: p });
      } else {
        setPending([]);
        if (cacheKey) writeRouteViewCache(cacheKey, { v: 1, owned: null, pending: [] });
      }
    } catch (e: any) {
      setErr(e.message ?? "加载失败");
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
    } catch (e: any) {
      setErr(e.message ?? "创建失败：每位平台管理员仅可拥有一个作为群主的工作群组。");
    }
  }

  async function approve(m: GroupMember, ok: boolean) {
    setBusyId(m.id);
    setErr("");
    try {
      await setMembershipStatus(m.id, ok ? "active" : "rejected");
      await refresh();
    } catch (e: any) {
      setErr(e.message ?? "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && owned === undefined) return <Spinner />;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <RefreshStrip active={refreshing} />
      <GroupTabs />
      <div>
        <h1 className="text-2xl font-bold text-gray-900">群组管理</h1>
        <p className="text-sm text-gray-500 mt-1">
          仅<strong>平台管理员</strong>可在此<strong>创建一个</strong>工作群组（各有独立群组号）。
          成员注册时填写<strong>你的群组号</strong>即归入本群，申请会出现在下方「待审批入群」；不同管理员的群组号不同，填哪个归哪个。
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
                  return (
                    <CompactListRow
                      key={m.id}
                      primary={info?.name ?? m.user_id.slice(0, 8)}
                      secondary={`${info?.role ?? "—"} · 手机 ${info?.phone ?? "—"}`}
                      meta={new Date(m.created_at).toLocaleString()}
                    />
                  );
                })}
              </CompactList>
            }>
            <CardList>
              {pending.map((m) => {
                const info = pendingProfiles[m.user_id];
                return (
                <CardListItem key={m.id}>
                <div className="rounded-xl border border-gray-200 bg-white p-4 h-full flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{info?.name ?? m.user_id.slice(0, 8)}</p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {info?.role ?? "—"} · 手机 {info?.phone ?? "—"}
                      {m.request_email && !m.request_email.endsWith("@upaiego.auth") && (
                        <span> · {m.request_email}</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">{new Date(m.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      onClick={() => void approve(m, true)}
                      className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-medium disabled:opacity-50"
                    >
                      同意
                    </button>
                    <button
                      type="button"
                      disabled={busyId === m.id}
                      onClick={() => void approve(m, false)}
                      className="px-3 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 disabled:opacity-50"
                    >
                      拒绝
                    </button>
                  </div>
                </div>
                </CardListItem>
                );
              })}
            </CardList>
            </ListViewSection>
          )}
        </div>
      )}
    </div>
  );
}
