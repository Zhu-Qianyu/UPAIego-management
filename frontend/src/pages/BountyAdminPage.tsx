import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchActiveGroupId, listGroupProfilesByRole } from "../api/groups";
import { listPartyDemands, type PartyDemand } from "../api/operations";
import { fetchProfilesByIds, profileDisplayName } from "../api/profiles";
import {
  adminFailBountyClaim,
  bountyStatusLabel,
  claimStatusLabel,
  closeBounty,
  listBountiesForGroup,
  listBountyAllowedPartyDemands,
  listClaimsForBounty,
  publishBounty,
  type Bounty,
  type BountyClaim,
} from "../api/bounties";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import {
  Alert,
  CardList,
  CardListItem,
  CompactList,
  CompactListRow,
  ListViewSection,
  listCardInnerClass,
  IconSparkles,
  PageHero,
  PageShell,
  Panel,
  StatGrid,
  uiInput,
  uiLabel,
  uiSelect,
  UiButton,
} from "../components/ui/PageLayout";

export default function BountyAdminPage() {
  const [groupId, setGroupId] = useState<string | null>(null);
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [claimsByBounty, setClaimsByBounty] = useState<Record<string, BountyClaim[]>>({});
  const [executorNames, setExecutorNames] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [totalHours, setTotalHours] = useState("8");
  const [hourlyRate, setHourlyRate] = useState("0");
  const [completionDays, setCompletionDays] = useState<"1" | "2" | "3">("2");
  const [publishBusy, setPublishBusy] = useState(false);
  const [deviceOperators, setDeviceOperators] = useState<{ id: string; label: string }[]>([]);
  const [assignedOperatorId, setAssignedOperatorId] = useState("");
  const [partyDemands, setPartyDemands] = useState<PartyDemand[]>([]);
  const [selectedPartyDemandIds, setSelectedPartyDemandIds] = useState<string[]>([]);
  const [allowedByBounty, setAllowedByBounty] = useState<Record<string, string[]>>({});

  const loadClaims = useCallback(async (bountyId: string) => {
    const claims = await listClaimsForBounty(bountyId);
    setClaimsByBounty((prev) => ({ ...prev, [bountyId]: claims }));
    const ids = [...new Set(claims.map((c) => c.executor_id))];
    if (ids.length) {
      const profiles = await fetchProfilesByIds(ids);
      setExecutorNames((prev) => {
        const next = { ...prev };
        for (const p of profiles) {
          next[p.id] = p.display_name?.trim() || p.id.slice(0, 8);
        }
        return next;
      });
    }
  }, []);

  const load = useCallback(async () => {
    setErr("");
    try {
      const gid = await fetchActiveGroupId();
      setGroupId(gid);
      if (!gid) {
        setBounties([]);
        return;
      }
      const rows = await listBountiesForGroup(gid);
      setBounties(rows);
      const allowedEntries = await Promise.all(
        rows.map(async (b) => {
          try {
            const allowed = await listBountyAllowedPartyDemands(b.id);
            const labels = allowed.map(
              (a) =>
                `${a.client_company || a.title || "甲方"}${a.device_type ? ` · ${a.device_type}` : ""}`
            );
            return [b.id, labels] as const;
          } catch {
            return [b.id, [] as string[]] as const;
          }
        })
      );
      setAllowedByBounty(Object.fromEntries(allowedEntries));
    } catch (e: any) {
      setErr(e.message ?? "加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!groupId) {
      setDeviceOperators([]);
      setAssignedOperatorId("");
      setPartyDemands([]);
      setSelectedPartyDemandIds([]);
      return;
    }
    void listGroupProfilesByRole(groupId, "device_operator").then((rows) => {
      const opts = rows.map((p) => ({
        id: p.id,
        label: `${profileDisplayName(p)}${p.phone ? ` · ${p.phone}` : ""}`,
      }));
      setDeviceOperators(opts);
      setAssignedOperatorId((prev) => (prev && opts.some((o) => o.id === prev) ? prev : opts[0]?.id ?? ""));
    });
    void listPartyDemands(groupId).then((rows) => {
      setPartyDemands(rows);
      setSelectedPartyDemandIds((prev) =>
        prev.length ? prev.filter((id) => rows.some((r) => r.id === id)) : rows.slice(0, 1).map((r) => r.id)
      );
    });
  }, [groupId]);

  useEffect(() => {
    if (expandedId) void loadClaims(expandedId);
  }, [expandedId, loadClaims]);

  async function onPublish(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId) {
      setErr("请先加入工作群");
      return;
    }
    const hours = parseInt(totalHours, 10);
    const rate = parseFloat(hourlyRate);
    if (!Number.isFinite(hours) || hours <= 0) {
      setErr("总工时必须为正整数");
      return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      setErr("单价不能为负数");
      return;
    }
    if (!assignedOperatorId) {
      setErr("请选择负责结算的设备运维员");
      return;
    }
    if (selectedPartyDemandIds.length === 0) {
      setErr("请至少选择一种可用设备类型（甲方业务）");
      return;
    }
    setPublishBusy(true);
    setErr("");
    try {
      await publishBounty({
        groupId,
        title: title.trim() || "悬赏单",
        totalHours: hours,
        hourlyRate: rate,
        completionDays: parseInt(completionDays, 10) as 1 | 2 | 3,
        description: description.trim() || undefined,
        assignedOperatorId,
        partyDemandIds: selectedPartyDemandIds,
      });
      setTitle("");
      setDescription("");
      await load();
    } catch (e: any) {
      setErr(e.message ?? "发布失败");
    } finally {
      setPublishBusy(false);
    }
  }

  async function onClose(bountyId: string) {
    if (!window.confirm("关闭后执行员将无法继续领取，已有进行中的接单不受影响。确认关闭？")) return;
    setBusyId(bountyId);
    setErr("");
    try {
      await closeBounty(bountyId);
      await load();
    } catch (e: any) {
      setErr(e.message ?? "关闭失败");
    } finally {
      setBusyId(null);
    }
  }

  async function onFailClaim(claimId: string) {
    const note = window.prompt("判定未完成（可选备注）", "管理员判定未完成");
    if (note === null) return;
    setBusyId(claimId);
    setErr("");
    try {
      await adminFailBountyClaim(claimId, note || undefined);
      if (expandedId) await loadClaims(expandedId);
      await load();
    } catch (e: any) {
      setErr(e.message ?? "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  const openCount = useMemo(() => bounties.filter((b) => b.status === "open").length, [bounties]);

  if (loading) {
    return (
      <div className="py-16 flex justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <PageShell>
      <RefreshStrip active={refreshing} />
      <PageHero
        eyebrow="平台管理"
        title="悬赏令管理"
        description="发布工时池；指定运维员与可用设备类型（甲方业务）。"
        accent="amber"
        icon={<IconSparkles />}
        onRefresh={() => { setRefreshing(true); void load(); }}
        refreshing={refreshing}
        footer={
          <StatGrid
            items={[
              { label: "悬赏总数", value: bounties.length },
              { label: "开放中", value: openCount, tone: "ok" },
              { label: "运维员", value: deviceOperators.length, hint: "可指定" },
            ]}
          />
        }
      />

      {!groupId && (
        <Alert variant="warn">未检测到工作群。请先在「群组」加入或创建工作群后再发布悬赏令。</Alert>
      )}
      {err && <Alert variant="error">{err}</Alert>}

      <Panel title="发布悬赏令" description="指定群内设备运维员与可借用的甲方设备类型" icon={<IconSparkles />}>
      <form onSubmit={onPublish} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={uiLabel}>标题</span>
            <input
              className={uiInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：本周数据采集"
            />
          </label>
          <label className="block">
            <span className={uiLabel}>总工时（小时）</span>
            <input
              type="number"
              min={1}
              step={1}
              className={uiInput}
              value={totalHours}
              onChange={(e) => setTotalHours(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className={uiLabel}>单价（元/小时）</span>
            <input
              type="number"
              min={0}
              step={0.01}
              className={uiInput}
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              required
            />
          </label>
          <label className="block">
            <span className={uiLabel}>完成期限（接单后）</span>
            <select
              className={uiSelect}
              value={completionDays}
              onChange={(e) => setCompletionDays(e.target.value as "1" | "2" | "3")}
            >
              <option value="1">1 天内</option>
              <option value="2">2 天内</option>
              <option value="3">3 天内</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className={uiLabel}>指定设备运维员（执行员联系人）</span>
            <select
              className={uiSelect}
              value={assignedOperatorId}
              onChange={(e) => setAssignedOperatorId(e.target.value)}
              required
              disabled={deviceOperators.length === 0}
            >
              {deviceOperators.length === 0 ? (
                <option value="">群内暂无设备运维员</option>
              ) : (
                deviceOperators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))
              )}
            </select>
          </label>
          <div className="block sm:col-span-2">
            <span className={uiLabel}>可用设备类型（甲方业务，可多选）</span>
            {partyDemands.length === 0 ? (
              <p className="text-xs text-amber-700 mt-2">
                当前群尚无甲方业务，请场景业务员先在「场景业务 → 甲方业务」中添加。
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2 max-h-48 overflow-y-auto rounded-xl border border-slate-200/80 p-3 bg-slate-50/50">
                {partyDemands.map((pd) => {
                  const checked = selectedPartyDemandIds.includes(pd.id);
                  const label = `${pd.client_company?.trim() || pd.title?.trim() || "甲方"}${
                    pd.device_type?.trim() ? ` · ${pd.device_type.trim()}` : ""
                  }`;
                  return (
                    <li key={pd.id} className="min-w-0">
                      <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={checked}
                          onChange={() => {
                            setSelectedPartyDemandIds((prev) =>
                              checked ? prev.filter((id) => id !== pd.id) : [...prev, pd.id]
                            );
                          }}
                        />
                        <span>{label}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        <label className="block">
          <span className={uiLabel}>说明（可选）</span>
          <textarea
            className={`${uiInput} min-h-[72px]`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <UiButton type="submit" disabled={!groupId || publishBusy || partyDemands.length === 0}>
          {publishBusy ? "发布中…" : "发布悬赏令"}
        </UiButton>
      </form>
      </Panel>

      <section className="space-y-4">
        {bounties.length === 0 ? (
          <>
            <h2 className="text-lg font-semibold text-slate-900">
              悬赏列表 <span className="text-slate-400 font-normal text-sm">（开放 {openCount}）</span>
            </h2>
            <p className="text-sm text-gray-500 py-8 text-center border border-dashed rounded-xl">暂无悬赏令</p>
          </>
        ) : (
          <ListViewSection
            storageKey="admin-bounties"
            header={
              <h2 className="text-lg font-semibold text-slate-900">
                悬赏列表 <span className="text-slate-400 font-normal text-sm">（开放 {openCount}）</span>
              </h2>
            }
            compact={
              <CompactList>
                {bounties.map((b) => {
                  const claimedHours = b.total_hours - b.remaining_hours;
                  return (
                    <CompactListRow
                      key={b.id}
                      primary={b.title}
                      secondary={b.description ?? undefined}
                      meta={`${bountyStatusLabel(b.status)} · 剩 ${b.remaining_hours}/${b.total_hours}h · 已领 ${claimedHours}h`}
                    />
                  );
                })}
              </CompactList>
            }
          >
          <CardList>
            {bounties.map((b) => {
              const claims = claimsByBounty[b.id] ?? [];
              const expanded = expandedId === b.id;
              const claimedHours = b.total_hours - b.remaining_hours;
              return (
                <CardListItem key={b.id}>
                <div className={`${listCardInnerClass} !p-0 overflow-hidden`}>
                  <div className="p-4 flex flex-wrap gap-3 items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium text-gray-900">{b.title}</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                          {bountyStatusLabel(b.status)}
                        </span>
                      </div>
                      {b.description && <p className="text-sm text-gray-600 mt-1">{b.description}</p>}
                      {allowedByBounty[b.id]?.length ? (
                        <div className="mt-2 text-xs text-slate-500">
                          可用类型：{allowedByBounty[b.id].join("；")}
                        </div>
                      ) : null}
                      <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-600">
                        <div>
                          <dt className="text-gray-400">总工时</dt>
                          <dd className="font-medium text-gray-800">{b.total_hours} h</dd>
                        </div>
                        <div>
                          <dt className="text-gray-400">剩余</dt>
                          <dd className="font-medium text-indigo-700">{b.remaining_hours} h</dd>
                        </div>
                        <div>
                          <dt className="text-gray-400">已领</dt>
                          <dd>{claimedHours} h</dd>
                        </div>
                        <div>
                          <dt className="text-gray-400">单价 / 期限</dt>
                          <dd>
                            ¥{Number(b.hourly_rate).toFixed(2)}/h · {b.completion_days} 天
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : b.id)}
                        className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
                      >
                        {expanded ? "收起明细" : "领取明细"}
                      </button>
                      {b.status !== "closed" && (
                        <button
                          type="button"
                          disabled={busyId === b.id}
                          onClick={() => void onClose(b.id)}
                          className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          关闭
                        </button>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div className="border-t border-gray-100 bg-gray-50/80 p-4">
                      {claims.length === 0 ? (
                        <p className="text-sm text-gray-500">尚无领取记录</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="text-left text-gray-500 text-xs">
                                <th className="pb-2 pr-4">执行员</th>
                                <th className="pb-2 pr-4">领取 h</th>
                                <th className="pb-2 pr-4">截止</th>
                                <th className="pb-2 pr-4">状态</th>
                                <th className="pb-2">操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {claims.map((c) => (
                                <tr key={c.id} className="border-t border-gray-200/80">
                                  <td className="py-2 pr-4">{executorNames[c.executor_id] ?? c.executor_id.slice(0, 8)}</td>
                                  <td className="py-2 pr-4">{c.claimed_hours}</td>
                                  <td className="py-2 pr-4">{new Date(c.due_at).toLocaleString()}</td>
                                  <td className="py-2 pr-4">{claimStatusLabel(c.status)}</td>
                                  <td className="py-2">
                                    {c.status === "active" && (
                                      <button
                                        type="button"
                                        disabled={busyId === c.id}
                                        onClick={() => void onFailClaim(c.id)}
                                        className="text-red-600 hover:underline text-xs disabled:opacity-50"
                                      >
                                        判定未完成
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                </CardListItem>
              );
            })}
          </CardList>
          </ListViewSection>
        )}
      </section>
    </PageShell>
  );
}
