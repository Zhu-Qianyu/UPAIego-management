import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchActiveGroupId } from "../api/groups";
import {
  executeAgentProposals,
  loadMacrosForAgent,
  sceneAiFeatureEnabled,
  sendSceneAgentMessage,
  type AgentProposal,
  type PendingImage,
} from "../api/sceneAgent";
import { labelSceneCategories } from "../utils/sceneCategories";

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  imagePreviews?: string[];
  proposals?: AgentProposal[];
};

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function SceneAiAssistant() {
  const enabled = sceneAiFeatureEnabled();
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>(() => [
    {
      id: "welcome",
      role: "assistant",
      text: enabled
        ? "你好，我是场景业务智能助手（豆包视觉模型）。你可以发大场景全景图、各岗位现场图，并用口语描述；我会整理录入方案，确认后帮你写入系统。我不会删除任何数据。"
        : "智能助手尚未启用。请设置 VITE_SCENE_AI_ENABLED=true，并在 Supabase 部署 scene-ai-agent（配置 ARK_API_KEY + ARK_MODEL，见 docs/SCENE_AI_AGENT_SETUP.md）。",
    },
  ]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [imageHint, setImageHint] = useState<"unknown" | "macro" | "position">("unknown");
  const [busy, setBusy] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [err, setErr] = useState("");
  const [nextImageIndex, setNextImageIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    void fetchActiveGroupId()
      .then(setGroupId)
      .catch(() => setGroupId(null));
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const imageByIndex = useMemo(() => {
    const m = new Map<number, File>();
    for (const img of pendingImages) m.set(img.index, img.file);
    return m;
  }, [pendingImages]);

  const onPickFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      const added: PendingImage[] = [];
      let idx = nextImageIndex;
      for (const f of Array.from(files)) {
        if (!f.type.startsWith("image/")) continue;
        added.push({
          index: idx,
          file: f,
          hint: imageHint,
          previewUrl: URL.createObjectURL(f),
        });
        idx += 1;
      }
      if (added.length) {
        setPendingImages((prev) => [...prev, ...added]);
        setNextImageIndex(idx);
      }
    },
    [imageHint, nextImageIndex]
  );

  const removeImage = (index: number) => {
    setPendingImages((prev) => {
      const target = prev.find((p) => p.index === index);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.index !== index);
    });
  };

  async function onSend() {
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    if (!enabled) {
      setErr("智能助手未启用");
      return;
    }
    if (!groupId) {
      setErr("请先加入并激活工作群后再使用智能助手");
      return;
    }
    setErr("");
    setBusy(true);

    const userMsg: UiMessage = {
      id: uid(),
      role: "user",
      text: text || "（见附件图片）",
      imagePreviews: pendingImages.map((p) => p.previewUrl),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    const history = [...messages, userMsg]
      .filter((m) => m.id !== "welcome")
      .map((m) => ({ role: m.role, content: m.text }));

    try {
      const macros = await loadMacrosForAgent(groupId);
      const res = await sendSceneAgentMessage({
        messages: history,
        images: pendingImages,
        groupId,
        existingMacros: macros.map((m) => ({ id: m.id, title: m.title })),
      });

      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: res.assistant_message + (res.questions.length ? `\n\n待补充：${res.questions.join("；")}` : ""),
          proposals: res.proposals.length ? res.proposals : undefined,
        },
      ]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "发送失败");
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: "抱歉，这次没能处理你的请求。请检查网络、登录状态，或确认 Edge Function 已部署。",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmProposals(proposals: AgentProposal[]) {
    if (!groupId || proposals.length === 0) return;
    if (!confirm(`确认将 ${proposals.length} 条方案写入系统？（不会删除任何已有数据）`)) return;
    setErr("");
    setExecuting(true);
    try {
      const result = await executeAgentProposals(groupId, proposals, imageByIndex);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: `已写入：大场景 ${result.createdMacros} 个，小岗位 ${result.createdPositions} 个。可在「场景业务 → 场景岗位」查看。`,
        },
      ]);
      setPendingImages((prev) => {
        for (const p of prev) URL.revokeObjectURL(p.previewUrl);
        return [];
      });
      setNextImageIndex(0);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "写入失败");
    } finally {
      setExecuting(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-2xl text-white shadow-lg ring-4 ring-indigo-100 hover:bg-indigo-700 hover:scale-105 transition-transform focus:outline-none focus:ring-2 focus:ring-indigo-400"
          aria-label="打开场景智能助手"
          title="场景智能助手"
        >
          <span aria-hidden>🤖</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-50 flex h-[min(640px,calc(100vh-2rem))] w-[min(420px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-indigo-100 bg-indigo-50/80 px-4 py-3">
            <div>
              <p className="font-semibold text-indigo-950">场景智能助手</p>
              <p className="text-xs text-indigo-700/80">只增不改 · 不删除数据</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-white"
            >
              收起
            </button>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-slate-50/50">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[92%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "bg-white border border-gray-200 text-gray-800"
                  }`}
                >
                  {m.text}
                  {m.imagePreviews?.length ? (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {m.imagePreviews.map((src) => (
                        <img key={src} src={src} alt="" className="h-14 w-14 object-cover rounded border border-white/30" />
                      ))}
                    </div>
                  ) : null}
                  {m.proposals?.length ? (
                    <ProposalCards
                      proposals={m.proposals}
                      disabled={executing}
                      onConfirm={() => void onConfirmProposals(m.proposals!)}
                    />
                  ) : null}
                </div>
              </div>
            ))}
            {busy && (
              <p className="text-xs text-gray-500 px-1">正在分析图片与描述…</p>
            )}
          </div>

          {err && <p className="px-3 py-1 text-xs text-red-600 bg-red-50">{err}</p>}

          {pendingImages.length > 0 && (
            <div className="border-t border-gray-100 px-3 py-2 bg-white">
              <p className="text-xs text-gray-500 mb-1">待发送图片 ({pendingImages.length})</p>
              <div className="flex flex-wrap gap-2">
                {pendingImages.map((img) => (
                  <div key={img.index} className="relative">
                    <img src={img.previewUrl} alt="" className="h-12 w-12 object-cover rounded border" />
                    <span className="absolute -top-1 -left-1 text-[10px] bg-gray-800 text-white px-1 rounded">
                      {img.hint === "macro" ? "景" : img.hint === "position" ? "岗" : img.index}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeImage(img.index)}
                      className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] rounded-full w-4 h-4"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <footer className="border-t border-gray-200 p-3 space-y-2 bg-white">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-gray-500">附件类型</span>
              <select
                value={imageHint}
                onChange={(e) => setImageHint(e.target.value as typeof imageHint)}
                className="rounded border border-gray-300 px-2 py-1"
              >
                <option value="unknown">自动</option>
                <option value="macro">大场景全景</option>
                <option value="position">小岗位现场</option>
              </select>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
              >
                添加图片
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  onPickFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="描述现场情况，或问如何使用系统…"
                rows={2}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void onSend();
                  }
                }}
              />
              <button
                type="button"
                disabled={busy || !enabled}
                onClick={() => void onSend()}
                className="self-end px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
              >
                发送
              </button>
            </div>
          </footer>
        </div>
      )}
    </>
  );
}

function ProposalCards({
  proposals,
  onConfirm,
  disabled,
}: {
  proposals: AgentProposal[];
  onConfirm: () => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-3 pt-2 border-t border-gray-200 space-y-2">
      <p className="text-xs font-semibold text-gray-700">待确认录入方案</p>
      <ul className="space-y-2 text-xs text-gray-700">
        {proposals.map((p) => (
          <li key={p.id} className="rounded-lg bg-slate-50 border border-slate-200 p-2">
            {p.kind === "macro" ? (
              <>
                <p className="font-medium text-violet-800">大场景 · {p.title}</p>
                <p className="text-gray-600 mt-0.5">{p.description || "—"}</p>
                <p className="text-gray-500 mt-0.5">
                  联系人 {p.contact_name} · {p.contact_phone}
                </p>
                <p className="text-gray-500">
                  {[p.address_province, p.address_city, p.address_district].join(" ")}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-indigo-800">小岗位 · {p.title}</p>
                <p className="text-gray-600 mt-0.5">{p.process_description || "—"}</p>
                <p className="text-gray-500">{labelSceneCategories(p.scene_categories)}</p>
              </>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={disabled}
        onClick={onConfirm}
        className="w-full py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
      >
        {disabled ? "写入中…" : "确认写入系统"}
      </button>
    </div>
  );
}
