# -*- coding: utf-8 -*-
import pathlib

p = pathlib.Path(__file__).resolve().parents[1] / "frontend/src/pages/SceneTasksPage.tsx"
text = p.read_text(encoding="utf-8")

start = text.index("  if (loading && rows.length === 0 && macros.length === 0) return <Spinner />;")
end = text.index("\ntype SceneShellCacheV1")

NEW_RETURN = r'''  if (loading && rows.length === 0 && macros.length === 0) return <Spinner />;

  function renderPosAddForm(macroId: string) {
    return (
      <form onSubmit={(e) => void onAdd(e, macroId)} className="mb-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4 space-y-2">
        <p className="text-xs font-medium text-indigo-900">添加小岗位</p>
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
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
        />
        <textarea
          placeholder="具体描述（可选）"
          value={proc}
          onChange={(e) => setProc(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            required
            placeholder="省（必填）"
            value={province}
            onChange={(e) => setProvince(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          />
          <input
            required
            placeholder="市（必填）"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          />
          <input
            required
            placeholder="区/县（必填）"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          />
        </div>
        <input
          placeholder="详细地址（可选）"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
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
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {busy ? "上传中…" : "确认添加"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setAddPosMacroId(null);
              resetPosDraft();
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            取消
          </button>
        </div>
      </form>
    );
  }

  function renderPosEditForm(r: ScenarioPosition) {
    return (
      <form onSubmit={(ev) => void onSaveEdit(ev, r.id)} className="border border-indigo-100 bg-indigo-50/40 rounded-lg p-4 space-y-2 mt-2">
        <p className="text-xs font-medium text-indigo-900">编辑小岗位</p>
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
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-50"
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
    );
  }

  return (
    <div className="w-full min-w-0 space-y-6">
      <RefreshStrip active={refreshing} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">小岗位列表打印（含现场快照，打印前会等待图片加载）：</span>
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
          打印小岗位列表
        </button>
      </div>
      <p className="text-sm text-gray-500">
        先<strong>添加大场景</strong>（含全景图），再在各<strong>大场景卡片内</strong>维护下属小岗位与现场快照。
      </p>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">添加大场景</h2>
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
          <div>
            <label className="block text-xs text-gray-500 mb-1">全景图（必填）</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setMacroPanoramaFile(e.target.files?.[0] ?? null)}
              className="text-sm w-full"
            />
          </div>
          <button
            type="submit"
            disabled={macroBusy}
            className="px-4 py-2 bg-violet-700 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {macroBusy ? "保存中…" : "添加大场景"}
          </button>
        </form>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold text-gray-900">大场景列表</h2>
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
          <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-xl p-6 text-center">
            暂无大场景，请先在上方添加。
          </p>
        ) : (
          <div className="space-y-4">
            {macros.map((m) => {
              const macroPositions = positionsByMacro.get(m.id) ?? [];
              const macroPosIds = macroPositions.map((p) => p.id);
              const macroPosSelected = macroPosIds.filter((id) => posBatch.isSelected(id)).length;
              return (
                <article
                  key={m.id}
                  className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm"
                >
                  <div className="relative">
                    <div className="flex items-start gap-2 p-3 pb-0">
                      <BatchSelectCheckbox
                        checked={macroBatch.isSelected(m.id)}
                        onChange={() => macroBatch.toggle(m.id)}
                        label={`选择大场景 ${m.title}`}
                      />
                      <div className="flex-1 min-w-0 pr-20">
                        {editingMacroId === m.id ? (
                          <form onSubmit={(ev) => void onSaveMacroEdit(ev, m.id)} className="p-1 space-y-2">
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
                            <div>
                              <p className="text-xs text-gray-500 mb-1">当前全景图</p>
                              <MacroPanoramaSnapshot snapshotPath={m.panorama_path} />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">更换全景图（可选）</label>
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                onChange={(e) => setEMacroPanoramaFile(e.target.files?.[0] ?? null)}
                                className="text-sm w-full"
                              />
                            </div>
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
                                onClick={() => {
                                  setEditingMacroId(null);
                                  setEMacroPanoramaFile(null);
                                }}
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
                      <div className="absolute top-3 right-3 flex gap-1">
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
                            if (addPosMacroId === m.id) setAddPosMacroId(null);
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

                  <div className="border-t border-gray-100 bg-slate-50/60 px-4 py-4 mt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <h3 className="text-sm font-medium text-gray-800">
                        小岗位
                        <span className="ml-1.5 text-xs font-normal text-gray-500">共 {macroPositions.length} 个</span>
                      </h3>
                      <button
                        type="button"
                        onClick={() => toggleAddPos(m)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                          addPosMacroId === m.id
                            ? "border border-gray-300 bg-white text-gray-700"
                            : "bg-indigo-600 text-white hover:bg-indigo-700"
                        }`}
                      >
                        {addPosMacroId === m.id ? "收起表单" : "添加小岗位"}
                      </button>
                    </div>

                    {addPosMacroId === m.id && renderPosAddForm(m.id)}

                    {macroPositions.length > 0 && (
                      <BatchSelectToolbar
                        total={macroPosIds.length}
                        selectedCount={macroPosSelected}
                        onSelectAll={() => posBatch.toggleAll(macroPosIds)}
                        onClear={() => {
                          for (const id of macroPosIds) {
                            if (posBatch.isSelected(id)) posBatch.toggle(id);
                          }
                        }}
                        onDelete={() => {
                          void (async () => {
                            if (macroPosSelected === 0) return;
                            if (!confirm(`确定删除该大场景下选中的 ${macroPosSelected} 个小岗位？`)) return;
                            setErr("");
                            setPosBatchDeleting(true);
                            try {
                              await deleteScenarioPositions(
                                macroPosIds.filter((id) => posBatch.isSelected(id))
                              );
                              if (editingId && posBatch.isSelected(editingId)) setEditingId(null);
                              for (const id of macroPosIds) {
                                if (posBatch.isSelected(id)) posBatch.toggle(id);
                              }
                              await load();
                            } catch (ex: unknown) {
                              setErr(ex instanceof Error ? ex.message : "批量删除失败");
                            } finally {
                              setPosBatchDeleting(false);
                            }
                          })();
                        }}
                        deleting={posBatchDeleting}
                        deleteLabel="删除选中小岗位"
                      />
                    )}

                    {macroPositions.length === 0 ? (
                      <p className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg px-3 py-4 text-center">
                        该大场景下暂无小岗位，点击「添加小岗位」创建。
                      </p>
                    ) : (
                      <ul className="space-y-3 mt-3">
                        {macroPositions.map((r) => (
                          <li
                            key={r.id}
                            className="rounded-lg border border-gray-200 bg-white overflow-hidden"
                          >
                            <div className="relative">
                              <div className="absolute top-2 left-2 z-10">
                                <BatchSelectCheckbox
                                  checked={posBatch.isSelected(r.id)}
                                  onChange={() => posBatch.toggle(r.id)}
                                  label={`选择 ${r.title}`}
                                />
                              </div>
                              <ScenarioRow row={r} />
                              {editingId !== r.id && (
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
                              )}
                            </div>
                            {editingId === r.id && (
                              <div className="px-3 pb-3">{renderPosEditForm(r)}</div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

'''

p.write_text(text[:start] + NEW_RETURN + text[end:], encoding="utf-8")
print("patched ok")
