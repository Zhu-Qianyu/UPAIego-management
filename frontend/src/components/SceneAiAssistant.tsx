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

const BOT_NAME = "aitebot";

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  imagePreviews?: string[];
  proposals?: AgentProposal[];
};

type InputMode = "text" | "voice";
type VoiceLang = "zh-CN" | "en-US";

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function SceneAiAssistant() {
  const enabled = sceneAiFeatureEnabled();
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [voiceLang, setVoiceLang] = useState<VoiceLang>("zh-CN");
  const [listening, setListening] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>(() => [
    {
      id: "welcome",
      role: "assistant",
      text: enabled
        ? `你好，我是 ${BOT_NAME}，负责数据采集相关业务咨询。你可以和我探讨：新场景能不能采、要注意什么、系统怎么用；也可以发现场图让我整理录入方案。纯聊天不需要确认写入；有方案时你再点「确认写入系统」。`
        : `${BOT_NAME} 尚未启用。请联系管理员配置 scene-ai-agent（ARK_API_KEY + ARK_MODEL）。`,
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
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const speechSupported = useMemo(() => getSpeechRecognitionCtor() !== null, []);

  useEffect(() => {
    if (!open) return;
    void fetchActiveGroupId()
      .then(setGroupId)
      .catch(() => setGroupId(null));
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (inputMode === "text") {
      recognitionRef.current?.stop();
      setListening(false);
    }
  }, [inputMode]);

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

  const toggleVoiceInput = () => {
    if (!speechSupported) {
      setErr("当前浏览器不支持语音输入，请改用文字输入");
      setInputMode("text");
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = voiceLang;
    rec.interimResults = true;
    rec.continuous = false;

    rec.onstart = () => {
      setListening(true);
      setErr("");
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => {
      setListening(false);
      setErr("语音识别失败，请检查麦克风权限或改用文字输入");
    };
    rec.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      if (transcript.trim()) {
        setInput((prev) => (prev ? `${prev}${transcript}` : transcript));
      }
    };

    rec.start();
  };

  async function onSend() {
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    if (!enabled) {
      setErr(`${BOT_NAME} 未启用`);
      return;
    }
    if (!groupId) {
      setErr("请先加入并激活工作群后再使用 aitebot");
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
          text: "抱歉，这次没能处理你的请求。请检查网络、登录状态，或稍后再试。",
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
          aria-label={`打开 ${BOT_NAME}`}
          title={BOT_NAME}
        >
          <span aria-hidden>🤖</span>
        </button>
      )}

      {open && (
        <>
          <button
            type="button"
            aria-label="关闭 aitebot"
            className="fixed inset-0 z-40 bg-black/25"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 flex h-[33.333vh] min-h-[300px] max-h-[520px] flex-col overflow-hidden border-t border-indigo-200 bg-white shadow-[0_-12px_40px_rgba(15,23,42,0.18)] animate-[slideUp_0.25s_ease-out]"
            role="dialog"
            aria-label={BOT_NAME}
          >
            <header className="flex shrink-0 items-center justify-between border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-white px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-lg text-white">
                  🤖
                </span>
                <div>
                  <p className="font-semibold text-indigo-950 tracking-wide">{BOT_NAME}</p>
                  <p className="text-xs text-indigo-700/80">数据采集业务咨询 · 只增不改</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-white border border-transparent hover:border-gray-200"
              >
                收起
              </button>
            </header>

            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 bg-slate-50/60">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
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
              {busy && <p className="text-xs text-gray-500 px-1">{BOT_NAME} 正在思考…</p>}
            </div>

            {err && <p className="shrink-0 px-4 py-1 text-xs text-red-600 bg-red-50">{err}</p>}

            {pendingImages.length > 0 && (
              <div className="shrink-0 border-t border-gray-100 px-4 py-2 bg-white">
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

            <footer className="shrink-0 border-t border-gray-200 px-4 py-3 space-y-2 bg-white">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-gray-500">输入</span>
                <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setInputMode("text")}
                    className={`px-3 py-1 ${inputMode === "text" ? "bg-indigo-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                  >
                    文字
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode("voice")}
                    className={`px-3 py-1 ${inputMode === "voice" ? "bg-indigo-600 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                  >
                    语音
                  </button>
                </div>
                {inputMode === "voice" && (
                  <>
                    <select
                      value={voiceLang}
                      onChange={(e) => setVoiceLang(e.target.value as VoiceLang)}
                      className="rounded border border-gray-300 px-2 py-1"
                    >
                      <option value="zh-CN">中文</option>
                      <option value="en-US">English</option>
                    </select>
                    <button
                      type="button"
                      disabled={!speechSupported || busy}
                      onClick={toggleVoiceInput}
                      className={`rounded-lg px-3 py-1 font-medium ${
                        listening
                          ? "bg-red-600 text-white animate-pulse"
                          : "border border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                      } disabled:opacity-50`}
                    >
                      {listening ? "聆听中…" : "开始说话"}
                    </button>
                  </>
                )}
                <span className="text-gray-300">|</span>
                <select
                  value={imageHint}
                  onChange={(e) => setImageHint(e.target.value as typeof imageHint)}
                  className="rounded border border-gray-300 px-2 py-1"
                >
                  <option value="unknown">图片·自动</option>
                  <option value="macro">大场景全景</option>
                  <option value="position">小岗位现场</option>
                </select>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                >
                  上传图片
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
                  placeholder={
                    inputMode === "voice"
                      ? "点击「开始说话」录入，或在此编辑识别结果…"
                      : `向 ${BOT_NAME} 提问：新场景能否采集、流程说明、现场描述…`
                  }
                  rows={2}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
                  onKeyDown={(e) => {
                    if (inputMode === "text" && e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void onSend();
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={busy || !enabled}
                  onClick={() => void onSend()}
                  className="self-end px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
                >
                  发送
                </button>
              </div>
            </footer>
          </div>
        </>
      )}

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0.6; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
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
