# -*- coding: utf-8 -*-
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
p = ROOT / "frontend/src/pages/SceneTasksPage.tsx"
text = p.read_text(encoding="utf-8")

start_marker = "function ScenarioRow({ row }: { row: ScenarioPosition })"
end_marker = "type SceneShellCacheV1"

start = text.index(start_marker)
# include scenarioCategoriesToRecord if it's right before ScenarioWorkstationsTab
macro_fn = "function scenarioCategoriesToRecord"
idx = text.rfind(macro_fn, 0, start)
if idx != -1 and text.index("function ScenarioWorkstationsTab", idx) < start:
    start = idx

end = text.index(end_marker)

NEW = r'''function ScenarioRow({ row, macroTitle }: { row: ScenarioPosition; macroTitle?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    getSnapshotPublicUrl(row.snapshot_path)
      .then((u) => {
        if (!cancel) setSrc(u);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [row.snapshot_path]);

  const displayTitle = macroTitle ? `${macroTitle} · ${row.title}` : row.title;

  return (
    <div className="bg-white p-4 flex flex-col sm:flex-row gap-4">
      {src && (
        <img src={src} alt="" className="w-full sm:w-40 h-32 object-cover rounded-lg border border-gray-100" />
      )}
      <div className="flex-1 min-w-0 pr-24">
        <p className="font-medium text-gray-900">{displayTitle}</p>
        <p className="text-xs text-gray-500 mt-1">
          大类：{labelSceneCategories(row.scene_categories)} ·{" "}
          {[row.address_province, row.address_city, row.address_district].filter(Boolean).join(" ")}
          {row.address_detail ? ` ${row.address_detail}` : ""}
        </p>
        {row.process_description && (
          <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{row.process_description}</p>
        )}
      </div>
    </div>
  );
}

function scenarioCategoriesToRecord(cats: string[]): Record<SceneCategoryKey, boolean> {
  const rec: Record<SceneCategoryKey, boolean> = { industrial: false, home: false, special: false };
  for (const c of cats) {
    if (c in rec) rec[c as SceneCategoryKey] = true;
  }
  if (!SCENE_CATEGORY_KEYS.some((k) => rec[k])) rec.industrial = true;
  return rec;
}

function MacroSiteRow({ row }: { row: SceneMacroSite }) {
  return (
    <div className="p-4 space-y-1">
      <p className="font-medium text-gray-900">{row.title}</p>
      {row.description && <p className="text-sm text-gray-600 whitespace-pre-wrap">{row.description}</p>}
      <p className="text-xs text-gray-500">
        {[row.address_province, row.address_city, row.address_district].filter(Boolean).join(" ")}
        {row.address_detail ? ` ${row.address_detail}` : ""}
      </p>
    </div>
  );
}

function ScenarioWorkstationsTab({
  groupId,
  setErr,
}: {
  groupId: string;
  setErr: (s: string) => void;
}) {
  const [macros, setMacros] = useState<SceneMacroSite[]>([]);
  const [rows, setRows] = useState<ScenarioPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadedOnceRef = useRef(false);

  const macroMap = useMemo(() => new Map(macros.map((m) => [m.id, m])), [macros]);

  const [macroTitle, setMacroTitle] = useState("");
  const [macroDesc, setMacroDesc] = useState("");
  const [macroProvince, setMacroProvince] = useState("");
  const [macroCity, setMacroCity] = useState("");
  const [macroDistrict, setMacroDistrict] = useState("");
  const [macroDetail, setMacroDetail] = useState("");
  const [macroBusy, setMacroBusy] = useState(false);
  const [editingMacroId, setEditingMacroId] = useState<string | null>(null);
  const [eMacroTitle, setEMacroTitle] = useState("");
  const [eMacroDesc, setEMacroDesc] = useState("");
  const [eMacroProvince, setEMacroProvince] = useState("");
  const [eMacroCity, setEMacroCity] = useState("");
  const [eMacroDistrict, setEMacroDistrict] = useState("");
  const [eMacroDetail, setEMacroDetail] = useState("");
  const [eMacroBusy, setEMacroBusy] = useState(false);
  const macroBatch = useBatchSelection();
  const [macroBatchDeleting, setMacroBatchDeleting] = useState(false);
  const macroIds = useMemo(() => macros.map((m) => m.id), [macros]);

  const [macroSceneId, setMacroSceneId] = useState("");
  const [title, setTitle] = useState("");
  const [proc, setProc] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [detail, setDetail] = useState("");
  const [selCats, setSelCats] = useState<Record<SceneCategoryKey, boolean>>({
    industrial: true,
    home: false,
    special: false,
  });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [eMacroSceneId, setEMacroSceneId] = useState("");
  const [eTitle, setETitle] = useState("");
  const [eProc, setEProc] = useState("");
  const [eProvince, setEProvince] = useState("");
  const [eCity, setECity] = useState("");
  const [eDistrict, setEDistrict] = useState("");
  const [eDetail, setEDetail] = useState("");
  const [eSelCats, setESelCats] = useState<Record<SceneCategoryKey, boolean>>({
    industrial: true,
    home: false,
    special: false,
  });
  const [eFile, setEFile] = useState<File | null>(null);
  const [eBusy, setEBusy] = useState(false);
  const posBatch = useBatchSelection();
  const [posBatchDeleting, setPosBatchDeleting] = useState(false);
  const posIds = useMemo(() => rows.map((r) => r.id), [rows]);

  const load = useCallback(async () => {
    if (loadedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    try {
      const [m, s] = await Promise.all([listSceneMacroSites(groupId), listScenarioPositions(groupId)]);
      setMacros(m);
      setRows(s);
      loadedOnceRef.current = true;
      if (!macroSceneId && m.length > 0) setMacroSceneId(m[0].id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "加载场景岗位失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [groupId, setErr, macroSceneId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleCat(k: SceneCategoryKey) {
    setSelCats((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  function toggleECat(k: SceneCategoryKey) {
    setESelCats((prev) => ({ ...prev, [k]: !prev[k] }));
  }

  function openMacroEdit(m: SceneMacroSite) {
    setErr("");
    setEditingMacroId(m.id);
    setEMacroTitle(m.title);
    setEMacroDesc(m.description ?? "");
    setEMacroProvince(m.address_province);
    setEMacroCity(m.address_city);
    setEMacroDistrict(m.address_district);
    setEMacroDetail(m.address_detail ?? "");
  }

  async function onSaveMacroEdit(e: React.FormEvent, id: string) {
    e.preventDefault();
    setErr("");
    if (!eMacroProvince.trim() || !eMacroCity.trim() || !eMacroDistrict.trim()) {
      setErr("请填写大场景的省、市、区（县）");
      return;
    }
    setEMacroBusy(true);
    try {
      await updateSceneMacroSite(id, {
        title: eMacroTitle.trim(),
        description: eMacroDesc.trim() || null,
        address_province: eMacroProvince.trim(),
        address_city: eMacroCity.trim(),
        address_district: eMacroDistrict.trim(),
        address_detail: eMacroDetail.trim() || null,
      });
      setEditingMacroId(null);
      await load();
    } catch (err: unknown) {
      setErr(err instanceof Error ? err.message : "保存大场景失败");
    } finally {
      setEMacroBusy(false);
    }
  }

  async function onAddMacro(e: React.FormEvent) {
    e.preventDefault();
    if (!macroTitle.trim()) {
      setErr("请填写大场景名称");
      return;
    }
    if (!macroProvince.trim() || !macroCity.trim() || !macroDistrict.trim()) {
      setErr("请填写大场景的省、市、区（县）");
      return;
    }
    setErr("");
    setMacroBusy(true);
    try {
      const created = await createSceneMacroSite({
        group_id: groupId,
        title: macroTitle.trim(),
        description: macroDesc.trim() || undefined,
        address_province: macroProvince.trim(),
        address_city: macroCity.trim(),
        address_district: macroDistrict.trim(),
        address_detail: macroDetail.trim() || undefined,
      });
      setMacroTitle("");
      setMacroDesc("");
      setMacroProvince("");
      setMacroCity("");
      setMacroDistrict("");
      setMacroDetail("");
      setMacroSceneId(created.id);
      await load();
    } catch (err: unknown) {
      setErr(err instanceof Error ? err.message : "添加大场景失败");
    } finally {
      setMacroBusy(false);
    }
  }

  async function onMacroBatchDelete() {
    if (macroBatch.count === 0) return;
    if (!confirm(`确定删除选中的 ${macroBatch.count} 个大场景？有下属小岗位的大场景将无法删除。`)) return;
    setErr("");
    setMacroBatchDeleting(true);
    try {
      await deleteSceneMacroSites(macroBatch.selectedIds);
      if (editingMacroId && macroBatch.isSelected(editingMacroId)) setEditingMacroId(null);
      macroBatch.clear();
      await load();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "批量删除大场景失败");
    } finally {
      setMacroBatchDeleting(false);
    }
  }

  function openEdit(r: ScenarioPosition) {
    setErr("");
    setEditingId(r.id);
    setEMacroSceneId(r.macro_scene_id ?? "");
    setETitle(r.title);
    setEProc(r.process_description ?? "");
    setEProvince(r.address_province);
    setECity(r.address_city);
    setEDistrict(r.address_district);
    setEDetail(r.address_detail ?? "");
    setESelCats(scenarioCategoriesToRecord(r.scene_categories ?? []));
    setEFile(null);
  }

  async function onSaveEdit(e: React.FormEvent, rowId: string) {
    e.preventDefault();
    setErr("");
    if (!eMacroSceneId) {
      setErr("请选择所属大场景");
      return;
    }
    const cats = SCENE_CATEGORY_KEYS.filter((k) => eSelCats[k]);
    if (cats.length < 1) {
      setErr("请至少勾选一个场景大类");
      return;
    }
    if (!eProvince.trim() || !eCity.trim() || !eDistrict.trim()) {
      setErr("请填写省、市、区（县）");
      return;
    }
    setEBusy(true);
    try {
      let snapshotPath: string | undefined;
      if (eFile) {
        const { path } = await uploadWorkstationSnapshot(groupId, eFile);
        snapshotPath = path;
      }
      await updateScenarioPosition(rowId, {
        title: eTitle.trim(),
        macro_scene_id: eMacroSceneId,
        process_description: eProc.trim() || null,
        scene_categories: cats,
        address_province: eProvince.trim(),
        address_city: eCity.trim(),
        address_district: eDistrict.trim(),
        address_detail: eDetail.trim() || null,
        ...(snapshotPath ? { snapshot_path: snapshotPath } : {}),
      });
      setEditingId(null);
      setEFile(null);
      await load();
    } catch (err: unknown) {
      setErr(err instanceof Error ? err.message : "保存失败");
    } finally {
      setEBusy(false);
    }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!macroSceneId) {
      setErr("请先选择或创建大场景");
      return;
    }
    if (!file) {
      setErr("请选择现场快照图片");
      return;
    }
    const cats = SCENE_CATEGORY_KEYS.filter((k) => selCats[k]);
    if (cats.length < 1) {
      setErr("请至少勾选一个场景大类");
      return;
    }
    if (!province.trim() || !city.trim() || !district.trim()) {
      setErr("请填写省、市、区（县）");
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const { path } = await uploadWorkstationSnapshot(groupId, file);
      await createScenarioPosition({
        group_id: groupId,
        macro_scene_id: macroSceneId,
        title: title.trim(),
        process_description: proc.trim() || undefined,
        snapshot_path: path,
        scene_categories: cats,
        address_province: province.trim(),
        address_city: city.trim(),
        address_district: district.trim(),
        address_detail: detail.trim() || undefined,
      });
      setTitle("");
      setProc("");
      setProvince("");
      setCity("");
      setDistrict("");
      setDetail("");
      setSelCats({ industrial: true, home: false, special: false });
      setFile(null);
      await load();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  async function onPosBatchDelete() {
    if (posBatch.count === 0) return;
    if (!confirm(`确定删除选中的 ${posBatch.count} 个小岗位？`)) return;
    setErr("");
    setPosBatchDeleting(true);
    try {
      await deleteScenarioPositions(posBatch.selectedIds);
      if (editingId && posBatch.isSelected(editingId)) setEditingId(null);
      posBatch.clear();
      await load();
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "批量删除小岗位失败");
    } finally {
      setPosBatchDeleting(false);
    }
  }

  if (loading && rows.length === 0 && macros.length === 0) return <Spinner />;

  return (
    <div className="w-full min-w-0 space-y-8">
      <RefreshStrip active={refreshing} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">列表打印（含工位现场快照图，打印前会等待图片加载）：</span>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              setErr("");
              try {
                const html = await buildScenarioPositionsPrintHtml(
                  "场景岗位列表",
                  `工作群 ${groupId}`,
                  rows,
                  macroMap
                );
                openSceneListPrint(html);
              } catch (e: unknown) {
                setErr(e instanceof Error ? e.message : "无法打开打印窗口");
              }
            })();
          }}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm bg-white hover:bg-gray-50"
        >
          打印列表
        </button>
      </div>
      <p className="text-sm text-gray-500">
        <strong>场景岗位 / 快照</strong>：先维护<strong>大场景</strong>，再在其下添加<strong>小岗位</strong>（工序、现场说明、地址、大类与快照）。
      </p>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-gray-900">大场景</h2>
        <form onSubmit={onAddMacro} className="bg-white rounded-xl border border-violet-100 p-4 space-y-2">
          <input
            required
            placeholder="大场景名称（必填）"
            value={macroTitle}
            onChange={(e) => setMacroTitle(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <textarea
            placeholder="大场景说明（可选）"
            value={macroDesc}
            onChange={(e) => setMacroDesc(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              required
              placeholder="省（必填）"
              value={macroProvince}
              onChange={(e) => setMacroProvince(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="市（必填）"
              value={macroCity}
              onChange={(e) => setMacroCity(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="区/县（必填）"
              value={macroDistrict}
              onChange={(e) => setMacroDistrict(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <input
            placeholder="详细地址（可选）"
            value={macroDetail}
            onChange={(e) => setMacroDetail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={macroBusy}
            className="px-4 py-2 bg-violet-700 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {macroBusy ? "保存中…" : "添加大场景"}
          </button>
        </form>
        <BatchSelectToolbar
          total={macros.length}
          selectedCount={macroBatch.count}
          onSelectAll={() => macroBatch.toggleAll(macroIds)}
          onClear={macroBatch.clear}
          onDelete={() => void onMacroBatchDelete()}
          deleting={macroBatchDeleting}
          deleteLabel="删除选中大场景"
        />
        {macros.length === 0 ? (
          <p className="text-sm text-amber-700 border border-dashed border-amber-200 rounded-xl p-4 text-center">
            请先添加至少一个大场景，再创建小岗位。
          </p>
        ) : (
          <CardList as="div">
            {macros.map((m) => (
              <CardListItem as="div" key={m.id}>
                <div className="relative rounded-xl border border-gray-200 overflow-hidden h-full w-full min-w-0 box-border bg-white">
                  <div className="flex items-start gap-2 p-2 pb-0">
                    <BatchSelectCheckbox
                      checked={macroBatch.isSelected(m.id)}
                      onChange={() => macroBatch.toggle(m.id)}
                    />
                    <div className="flex-1 min-w-0">
                      {editingMacroId === m.id ? (
                        <form onSubmit={(ev) => void onSaveMacroEdit(ev, m.id)} className="p-2 space-y-2">
                          <p className="text-xs font-medium text-violet-900">编辑大场景</p>
                          <input
                            required
                            value={eMacroTitle}
                            onChange={(e) => setEMacroTitle(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                          />
                          <textarea
                            value={eMacroDesc}
                            onChange={(e) => setEMacroDesc(e.target.value)}
                            rows={2}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                          />
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              required
                              placeholder="省"
                              value={eMacroProvince}
                              onChange={(e) => setEMacroProvince(e.target.value)}
                              className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                            />
                            <input
                              required
                              placeholder="市"
                              value={eMacroCity}
                              onChange={(e) => setEMacroCity(e.target.value)}
                              className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                            />
                            <input
                              required
                              placeholder="区/县"
                              value={eMacroDistrict}
                              onChange={(e) => setEMacroDistrict(e.target.value)}
                              className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                            />
                          </div>
                          <input
                            placeholder="详细地址"
                            value={eMacroDetail}
                            onChange={(e) => setEMacroDetail(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="submit"
                              disabled={eMacroBusy}
                              className="px-4 py-2 bg-violet-700 text-white rounded-lg text-sm disabled:opacity-50"
                            >
                              {eMacroBusy ? "保存中…" : "保存"}
                            </button>
                            <button
                              type="button"
                              disabled={eMacroBusy}
                              onClick={() => setEditingMacroId(null)}
                              className="px-4 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                            >
                              取消
                            </button>
                          </div>
                        </form>
                      ) : (
                        <MacroSiteRow row={m} />
                      )}
                    </div>
                  </div>
                  {editingMacroId !== m.id && (
                    <div className="absolute top-2 right-2 flex gap-1">
                      <button
                        type="button"
                        onClick={() => openMacroEdit(m)}
                        className="text-xs text-violet-700 bg-white/95 px-2 py-1 rounded border border-violet-200 shadow-sm"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm("删除该大场景？")) return;
                          if (editingMacroId === m.id) setEditingMacroId(null);
                          try {
                            await deleteSceneMacroSite(m.id);
                            await load();
                          } catch (ex: unknown) {
                            setErr(ex instanceof Error ? ex.message : "删除失败");
                          }
                        }}
                        className="text-xs text-red-600 bg-white/95 px-2 py-1 rounded border border-red-100 shadow-sm"
                      >
                        删除
                      </button>
                    </div>
                  )}
                </div>
              </CardListItem>
            ))}
          </CardList>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-gray-900">小岗位 / 快照</h2>
        <form onSubmit={onAdd} className="bg-white rounded-xl border border-indigo-100 p-4 space-y-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">所属大场景（必填）</label>
            <select
              required
              value={macroSceneId}
              onChange={(e) => setMacroSceneId(e.target.value)}
              disabled={macros.length === 0}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              <option value="">请选择大场景</option>
              {macros.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-gray-500">场景大类（可多选）</p>
          <div className="flex flex-wrap gap-3">
            {SCENE_CATEGORY_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selCats[k]} onChange={() => toggleCat(k)} />
                {SCENE_CATEGORY_LABELS[k]}
              </label>
            ))}
          </div>
          <input
            required
            placeholder="工序 / 小岗位（必填）"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <textarea
            placeholder="具体描述（可选）"
            value={proc}
            onChange={(e) => setProc(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              required
              placeholder="省（必填）"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="市（必填）"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="区/县（必填）"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <input
            placeholder="详细地址（可选）"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <div>
            <label className="block text-xs text-gray-500 mb-1">现场快照（必填）</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm w-full"
            />
          </div>
          <button
            type="submit"
            disabled={busy || macros.length === 0}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {busy ? "上传中..." : "添加小岗位"}
          </button>
        </form>
        <BatchSelectToolbar
          total={rows.length}
          selectedCount={posBatch.count}
          onSelectAll={() => posBatch.toggleAll(posIds)}
          onClear={posBatch.clear}
          onDelete={() => void onPosBatchDelete()}
          deleting={posBatchDeleting}
          deleteLabel="删除选中小岗位"
        />
        <ListViewSection
          storageKey="scene-positions"
          compact={
            <CompactList>
              {rows.map((r) => (
                <CompactListRow
                  key={r.id}
                  primary={
                    <span className="inline-flex items-center gap-2 min-w-0">
                      <BatchSelectCheckbox checked={posBatch.isSelected(r.id)} onChange={() => posBatch.toggle(r.id)} />
                      <span className="truncate">{formatScenarioPositionLabel(r, macroMap)}</span>
                    </span>
                  }
                  secondary={r.process_description ?? undefined}
                  meta={`${labelSceneCategories(r.scene_categories)} · ${[r.address_province, r.address_city, r.address_district].filter(Boolean).join(" ")}`}
                />
              ))}
            </CompactList>
          }
        >
          <CardList as="div">
            {rows.map((r) => {
              const macro = r.macro_scene_id ? macroMap.get(r.macro_scene_id) : undefined;
              return (
                <CardListItem as="div" key={r.id}>
                  <div className="relative rounded-xl border border-gray-200 overflow-hidden h-full w-full min-w-0 box-border">
                    <div className="absolute top-2 left-2 z-10">
                      <BatchSelectCheckbox
                        checked={posBatch.isSelected(r.id)}
                        onChange={() => posBatch.toggle(r.id)}
                        label={`选择 ${r.title}`}
                      />
                    </div>
                    <ScenarioRow row={r} macroTitle={macro?.title} />
                    <div className="absolute top-2 right-2 flex gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        className="text-xs text-violet-700 bg-white/95 px-2 py-1 rounded border border-violet-200 shadow-sm"
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!confirm("删除该小岗位？")) return;
                          if (editingId === r.id) setEditingId(null);
                          await deleteScenarioPosition(r.id);
                          await load();
                        }}
                        className="text-xs text-red-600 bg-white/95 px-2 py-1 rounded border border-red-100 shadow-sm"
                      >
                        删除
                      </button>
                    </div>
                    {editingId === r.id && (
                      <form
                        onSubmit={(ev) => void onSaveEdit(ev, r.id)}
                        className="border-t border-indigo-100 bg-indigo-50/40 p-4 space-y-2"
                      >
                        <p className="text-xs font-medium text-indigo-900">编辑小岗位</p>
                        <div>
                          <label className="block text-xs text-gray-500 mb-1">所属大场景</label>
                          <select
                            required
                            value={eMacroSceneId}
                            onChange={(e) => setEMacroSceneId(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                          >
                            <option value="">请选择</option>
                            {macros.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.title}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {SCENE_CATEGORY_KEYS.map((k) => (
                            <label key={k} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={eSelCats[k]} onChange={() => toggleECat(k)} />
                              {SCENE_CATEGORY_LABELS[k]}
                            </label>
                          ))}
                        </div>
                        <input
                          required
                          placeholder="工序 / 小岗位"
                          value={eTitle}
                          onChange={(e) => setETitle(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                        />
                        <textarea
                          placeholder="具体描述"
                          value={eProc}
                          onChange={(e) => setEProc(e.target.value)}
                          rows={2}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <input
                            required
                            placeholder="省"
                            value={eProvince}
                            onChange={(e) => setEProvince(e.target.value)}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                          />
                          <input
                            required
                            placeholder="市"
                            value={eCity}
                            onChange={(e) => setECity(e.target.value)}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                          />
                          <input
                            required
                            placeholder="区/县"
                            value={eDistrict}
                            onChange={(e) => setEDistrict(e.target.value)}
                            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                          />
                        </div>
                        <input
                          placeholder="详细地址（可选）"
                          value={eDetail}
                          onChange={(e) => setEDetail(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                        />
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">更换现场快照（可选，不选则保留原图）</label>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(e) => setEFile(e.target.files?.[0] ?? null)}
                            className="text-sm w-full"
                          />
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            type="submit"
                            disabled={eBusy}
                            className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm disabled:opacity-50"
                          >
                            {eBusy ? "保存中…" : "保存"}
                          </button>
                          <button
                            type="button"
                            disabled={eBusy}
                            onClick={() => {
                              setEditingId(null);
                              setEFile(null);
                              setErr("");
                            }}
                            className="px-4 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </CardListItem>
              );
            })}
          </CardList>
        </ListViewSection>
      </section>
    </div>
  );
}

'''

p.write_text(text[:start] + NEW + text[end:], encoding="utf-8")
print("patched", p, "bytes", len(NEW))
