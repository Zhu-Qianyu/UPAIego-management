import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  listKpis,
  upsertKpi,
  deleteKpi,
  createAdminMessage,
  listAdminMessages,
  isKpiActiveAt,
  type KpiRow,
  type AdminMessageRow,
  type KpiTargetRole,
} from "../api/adminContent";
import { ROLE_LABELS } from "../auth/roleLabels";
import Spinner from "../components/Spinner";
import RefreshStrip from "../components/RefreshStrip";
import { readRouteViewCache, routeViewCacheKey, writeRouteViewCache } from "../utils/routeViewCache";
import { useAuth } from "../auth/AuthContext";
import { KPI_METRIC_BY_ROLE, labelForMetricId, metricIdForRole, parseKpiMetricId } from "../api/kpiMetrics";

const KPI_TARGET_ROLES: KpiTargetRole[] = ["device_operator", "scene_operator", "collection_executor"];

function kpiMetricHint(role: KpiTargetRole): string {
  switch (role) {
    case "device_operator":
      return "目标为百分比数值（如 95 表示 95% 完好率）；单位可填 %。";
    case "scene_operator":
      return "目标为场景个数（非草稿任务数）；单位可填 个 等。";
    case "collection_executor":
      return "目标为数据量数字，与右侧单位一致（如单位填 MB 则累计已用存储 MB）。";
    default:
      return "";
  }
}

function listMetricTitle(k: KpiRow): string {
  const mid = parseKpiMetricId(k.title);
  return mid ? labelForMetricId(mid) : k.title;
}

function kpiRangeLabel(k: KpiRow): string {
  if (!k.valid_from && !k.valid_until) return "起止：未设置（始终有效）";
  const one = (s: string | null) =>
    s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—";
  return `起止：${one(k.valid_from)} ～ ${one(k.valid_until)}`;
}

type AdminConsoleCacheV1 = { v: 1; kpis: KpiRow[]; messages: AdminMessageRow[] };

export default function AdminConsole() {
  const { session } = useAuth();
  const location = useLocation();
  const cacheKey = useMemo(
    () => routeViewCacheKey(session?.user?.id, location.pathname),
    [session?.user?.id, location.pathname]
  );

  const [kpis, setKpis] = useState<KpiRow[]>([]);
  const [messages, setMessages] = useState<AdminMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");

  const [kTarget, setKTarget] = useState("");
  const [kUnit, setKUnit] = useState("");
  const [kNotes, setKNotes] = useState("");
  const [kRole, setKRole] = useState<KpiTargetRole>("device_operator");
  const [kValidFrom, setKValidFrom] = useState("");
  const [kValidUntil, setKValidUntil] = useState("");

  const [mTitle, setMTitle] = useState("");
  const [mBody, setMBody] = useState("");

  useLayoutEffect(() => {
    if (!cacheKey) return;
    const snap = readRouteViewCache<AdminConsoleCacheV1>(cacheKey);
    if (!snap || snap.v !== 1) return;
    setKpis(snap.kpis);
    setMessages(snap.messages);
    setLoading(false);
  }, [cacheKey]);

  const refresh = useCallback(async () => {
    const stale = cacheKey ? readRouteViewCache<AdminConsoleCacheV1>(cacheKey) : null;
    if (stale) setRefreshing(true);
    else setLoading(true);
    setErr("");
    try {
      const [k, msg] = await Promise.all([listKpis(), listAdminMessages(30)]);
      setKpis(k);
      setMessages(msg);
      if (cacheKey) writeRouteViewCache(cacheKey, { v: 1, kpis: k, messages: msg });
    } catch (e: any) {
      setErr(e.message ?? "加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cacheKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleAddKpi(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (kValidFrom.trim() !== "" && kValidUntil.trim() !== "") {
      const a = new Date(kValidFrom).getTime();
      const b = new Date(kValidUntil).getTime();
      if (Number.isFinite(a) && Number.isFinite(b) && a > b) {
        setErr("考核开始时间不能晚于结束时间");
        return;
      }
    }
    try {
      const targetNum = Number(kTarget);
      if (kTarget.trim() === "" || !Number.isFinite(targetNum) || targetNum <= 0) {
        setErr("目标值须为大于 0 的数字");
        return;
      }
      await upsertKpi({
        title: metricIdForRole(kRole),
        target_value: targetNum,
        unit: kUnit.trim() || null,
        notes: kNotes.trim() || null,
        target_role: kRole,
        valid_from: kValidFrom.trim() === "" ? null : new Date(kValidFrom).toISOString(),
        valid_until: kValidUntil.trim() === "" ? null : new Date(kValidUntil).toISOString(),
      });
      setKTarget("");
      setKUnit("");
      setKNotes("");
      setKRole("device_operator");
      setKValidFrom("");
      setKValidUntil("");
      await refresh();
    } catch (e: any) {
      setErr(e.message ?? "保存 KPI 失败");
    }
  }

  async function handlePostMessage(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await createAdminMessage(mTitle.trim(), mBody.trim());
      setMTitle("");
      setMBody("");
      await refresh();
    } catch (e: any) {
      setErr(e.message ?? "发布留言失败");
    }
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <RefreshStrip active={refreshing} />
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">管理员工作台</h1>
        <p className="text-sm text-gray-500 mt-1">
          左侧菜单可打开其它功能页；注册/搜索与全量设备列表请用「设备管理」内的各标签页。
        </p>
      </div>

      {err && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <section className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">KPI 设置</h2>
          <p className="text-xs text-gray-500 mb-4">
            每个角色仅对应一项固定指标（不可自定义名称）；目标值须为大于 0 的数字以便计算完成进度；单位可按业务习惯填写。
          </p>

          <form onSubmit={handleAddKpi} className="space-y-3 mb-6">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">适用角色</label>
              <select
                value={kRole}
                onChange={(e) => setKRole(e.target.value as KpiTargetRole)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
              >
                {KPI_TARGET_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2.5 text-sm">
              <p className="text-xs font-medium text-gray-600 mb-1">指标（系统自动绑定）</p>
              <p className="font-semibold text-gray-900">{KPI_METRIC_BY_ROLE[kRole].label}</p>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{kpiMetricHint(kRole)}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">考核开始（可选）</label>
                <input
                  type="datetime-local"
                  value={kValidFrom}
                  onChange={(e) => setKValidFrom(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">考核结束（可选）</label>
                <input
                  type="datetime-local"
                  value={kValidUntil}
                  onChange={(e) => setKValidUntil(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <input
                required
                type="number"
                min={0.0001}
                step="any"
                placeholder="目标值（必填，正数）"
                value={kTarget}
                onChange={(e) => setKTarget(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="单位（可选）"
                value={kUnit}
                onChange={(e) => setKUnit(e.target.value)}
                className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <textarea
              placeholder="备注说明"
              value={kNotes}
              onChange={(e) => setKNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
            >
              添加 / 更新 KPI
            </button>
          </form>

          <ul className="divide-y divide-gray-100 text-sm">
            {kpis.length === 0 && <li className="py-4 text-gray-400">暂无 KPI</li>}
            {kpis.map((k) => (
              <li key={k.id} className="py-3 flex justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900">{listMetricTitle(k)}</p>
                  <p className="text-xs mt-1">
                    <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-gray-700">
                      {ROLE_LABELS[k.target_role ?? "device_operator"]}
                    </span>
                    {!isKpiActiveAt(k) && (
                      <span className="ml-2 text-amber-700">（当前不在有效期内）</span>
                    )}
                  </p>
                  <p className="text-gray-500 text-xs mt-1">
                    目标：{k.target_value ?? "—"} {k.unit ?? ""}
                    {k.notes ? ` · ${k.notes}` : ""}
                  </p>
                  <p className="text-gray-500 text-xs mt-0.5">{kpiRangeLabel(k)}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    更新于 {new Date(k.updated_at).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm("删除该 KPI？")) return;
                    await deleteKpi(k.id);
                    await refresh();
                  }}
                  className="text-red-600 text-xs shrink-0 h-fit"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">全员留言</h2>
          <p className="text-xs text-gray-500 mb-4">发布后所有角色登录即可在顶部公告区看到。</p>

          <form onSubmit={handlePostMessage} className="space-y-3 mb-8">
            <input
              required
              placeholder="标题"
              value={mTitle}
              onChange={(e) => setMTitle(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <textarea
              required
              placeholder="正文"
              value={mBody}
              onChange={(e) => setMBody(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700"
            >
              发布公告
            </button>
          </form>

          <h3 className="text-sm font-semibold text-gray-700 mb-2">近期公告</h3>
          <ul className="space-y-3 text-sm max-h-80 overflow-y-auto">
            {messages.map((m) => (
              <li key={m.id} className="rounded-lg border border-gray-100 p-3 bg-gray-50/80">
                <p className="font-medium text-gray-900">{m.title}</p>
                <p className="text-gray-600 mt-1 whitespace-pre-wrap">{m.body}</p>
                <p className="text-xs text-gray-400 mt-2">{new Date(m.created_at).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
