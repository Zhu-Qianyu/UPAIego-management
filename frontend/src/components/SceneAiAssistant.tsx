import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchActiveGroupId } from "../api/groups";
import {
  appendAgentChatMessage,
  clearAgentChatHistory,
  listAgentChatMessages,
  searchAgentChatMessages,
  type AgentChatMessageRow,
} from "../api/agentChat";
import {
  countAgentInboxUnread,
  listAgentInboxMessages,
  markAgentInboxRead,
  type AgentInboxMessage,
} from "../api/agentInbox";
import {
  executeAgentProposals,
  loadMacrosForAgent,
  sceneAiFeatureEnabled,
  sendSceneAgentMessage,
  type AgentProposal,
  type PendingImage,
} from "../api/sceneAgent";
import { labelSceneCategories } from "../utils/sceneCategories";
import { useAitebot } from "../aitebot/AitebotContext";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS } from "../auth/roleLabels";
import type { UserRole } from "../types/roles";
import DouXiaoMiAvatar from "./DouXiaoMiAvatar";

const BOT_NAME = "豆小秘";

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  imagePreviews?: string[];
  proposals?: AgentProposal[];
  inboxId?: string;
};

type InputMode = "text" | "voice";
type VoiceLang = "zh-CN" | "en-US";

const QUICK_TOPICS_BY_ROLE: Record<UserRole, { icon: string; label: string; prompt: string }[]> = {
  admin: [
    { icon: "📢", label: "群发通知", prompt: "帮我起草一条通知：明天全体放假，并发送给群组所有人。" },
    { icon: "📋", label: "采集流程", prompt: "请说明从场景录入、排班到悬赏结算的完整数采制度。" },
    { icon: "👥", label: "群组管理", prompt: "带我去看群组管理和待审批成员。" },
    { icon: "🏢", label: "甲方业务", prompt: "甲方业务和场景岗位怎么配合？" },
  ],
  scene_operator: [
    { icon: "📅", label: "采集排班", prompt: "帮我打开采集排班，并说明发布排班前要准备什么。" },
    { icon: "✨", label: "新场景", prompt: "我们在评估一个新场景，是否适合采集？" },
    { icon: "📋", label: "采集流程", prompt: "请说明从甲方业务、岗位到排班发布的流程。" },
    { icon: "📢", label: "通知执行员", prompt: "帮我起草一条通知发给所有数采执行员。" },
  ],
  device_operator: [
    { icon: "🔧", label: "运维工作台", prompt: "带我打开运维工作台，说明悬赏借还设备流程。" },
    { icon: "📱", label: "登记设备", prompt: "如何登记离线设备？需要关联什么？" },
    { icon: "📋", label: "设备状态", prompt: "设备故障或离线时我应该怎么处理？" },
  ],
  collection_executor: [
    { icon: "📅", label: "我的排班", prompt: "带我去看今天的采集排班，如何打卡？" },
    { icon: "💰", label: "悬赏令", prompt: "打开悬赏令，说明接单和截止注意事项。" },
    { icon: "🗺️", label: "数采地图", prompt: "带我去数采地图看设备位置。" },
    { icon: "👛", label: "钱包", prompt: "我的钱包结算规则是什么？" },
  ],
};

function welcomeMessage(enabled: boolean, role: UserRole): UiMessage {
  const roleLabel = ROLE_LABELS[role];
  const roleHints: Record<UserRole, string> = {
    admin: "你可以让我通知全员或指定角色（消息会发到每人账户收件箱），也可以带路管理台、场景业务与悬赏。",
    scene_operator: "我可以帮你梳理甲方业务与排班，并向数采执行员群发通知；有录入方案时会请你确认后再写入。",
    device_operator: "我可以带你处理设备登记、运维工作台与悬赏借还流程。",
    collection_executor: "我可以帮你看排班打卡、悬赏接单与钱包；有群通知时会在收件箱提醒你。",
  };
  return {
    id: "welcome",
    role: "assistant",
    text: enabled
      ? `你好，我是 ${BOT_NAME}，本工作群的智能体。你当前是「${roleLabel}」。${roleHints[role]}`
      : `${BOT_NAME} 尚未启用，请联系管理员配置 scene-ai-agent。`,
  };
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function inboxToUiMessage(msg: AgentInboxMessage): UiMessage {
  return {
    id: `inbox-${msg.id}`,
    role: "assistant",
    text: `📬 ${msg.title}\n\n${msg.body}`,
    inboxId: msg.id,
  };
}

function chatRowToUiMessage(row: AgentChatMessageRow): UiMessage {
  return {
    id: row.id,
    role: row.role,
    text: row.content,
    proposals: row.metadata.proposals?.length ? row.metadata.proposals : undefined,
    inboxId: row.metadata.inbox_id,
  };
}

async function saveChatMessage(
  groupId: string,
  role: "user" | "assistant",
  content: string,
  metadata?: { proposals?: AgentProposal[]; inbox_id?: string; source?: "inbox" | "chat" }
): Promise<UiMessage> {
  const row = await appendAgentChatMessage({ groupId, role, content, metadata });
  if (row) return chatRowToUiMessage(row);
  return { id: uid(), role, text: content, proposals: metadata?.proposals };
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognition) | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function IconCamera({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 8h3l2-2h6l2 2h3v11H4V8z" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

function IconWave({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 10v4M12 8v8M16 10v4" strokeLinecap="round" />
    </svg>
  );
}

function IconPlus({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 6v12M6 12h12" strokeLinecap="round" />
    </svg>
  );
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4" strokeLinecap="round" />
    </svg>
  );
}

function formatChatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function snippetAroundKeyword(text: string, keyword: string, maxLen = 72): string {
  const lower = text.toLowerCase();
  const kw = keyword.toLowerCase();
  const idx = lower.indexOf(kw);
  if (idx < 0) return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + keyword.length + 40);
  const chunk = text.slice(start, end);
  return `${start > 0 ? "…" : ""}${chunk}${end < text.length ? "…" : ""}`;
}

export default function SceneAiAssistant() {
  const enabled = sceneAiFeatureEnabled();
  const { role } = useAuth();
  const userRole: UserRole = role ?? "scene_operator";
  const { pageContext, executeActions, toast, clearToast } = useAitebot();
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [voiceLang, setVoiceLang] = useState<VoiceLang>("zh-CN");
  const [listening, setListening] = useState(false);
  const [holding, setHolding] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [imageHint, setImageHint] = useState<"unknown" | "macro" | "position">("unknown");
  const [busy, setBusy] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [err, setErr] = useState("");
  const [nextImageIndex, setNextImageIndex] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<AgentChatMessageRow[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const holdTranscriptRef = useRef("");
  const shownInboxIdsRef = useRef<Set<string>>(new Set());

  const quickTopics = QUICK_TOPICS_BY_ROLE[userRole];

  const speechSupported = useMemo(() => getSpeechRecognitionCtor() !== null, []);

  const refreshUnread = useCallback(async (gid: string | null) => {
    try {
      const n = await countAgentInboxUnread(gid);
      setUnreadCount(n);
    } catch {
      setUnreadCount(0);
    }
  }, []);

  const pullInboxIntoChat = useCallback(async (gid: string) => {
    try {
      const rows = await listAgentInboxMessages({ groupId: gid, unreadOnly: true, limit: 10 });
      const fresh = rows.filter((r) => !shownInboxIdsRef.current.has(r.id));
      if (!fresh.length) return;
      for (const r of fresh) shownInboxIdsRef.current.add(r.id);
      const uiRows = fresh.reverse().map(inboxToUiMessage);
      setMessages((prev) => [...prev, ...uiRows]);
      for (const r of fresh) {
        const text = `📬 ${r.title}\n\n${r.body}`;
        await saveChatMessage(gid, "assistant", text, {
          inbox_id: r.id,
          source: "inbox",
        });
      }
      await markAgentInboxRead(fresh.map((r) => r.id));
      await refreshUnread(gid);
    } catch {
      /* table may not exist yet */
    }
  }, [refreshUnread]);

  const loadChatHistory = useCallback(async (gid: string) => {
    setHistoryLoading(true);
    try {
      const rows = await listAgentChatMessages({ groupId: gid, limit: 200 });
      for (const r of rows) {
        if (r.metadata.inbox_id) shownInboxIdsRef.current.add(r.metadata.inbox_id);
      }
      if (rows.length > 0) {
        setMessages(rows.map(chatRowToUiMessage));
        const inboxIds = rows
          .map((r) => r.metadata.inbox_id)
          .filter((id): id is string => Boolean(id));
        if (inboxIds.length) await markAgentInboxRead(inboxIds);
      } else {
        setMessages([welcomeMessage(enabled, userRole)]);
      }
    } catch {
      setMessages([welcomeMessage(enabled, userRole)]);
    } finally {
      setHistoryLoading(false);
    }
  }, [enabled, userRole]);

  useEffect(() => {
    void fetchActiveGroupId()
      .then((gid) => {
        setGroupId(gid);
        void refreshUnread(gid);
        if (gid) void loadChatHistory(gid);
        else {
          setMessages([welcomeMessage(enabled, userRole)]);
          setHistoryLoading(false);
        }
      })
      .catch(() => {
        setGroupId(null);
        setMessages([welcomeMessage(enabled, userRole)]);
        setHistoryLoading(false);
      });
  }, [refreshUnread, loadChatHistory, enabled, userRole]);

  useEffect(() => {
    if (!groupId) return;
    const t = window.setInterval(() => {
      void refreshUnread(groupId);
      if (open) void pullInboxIntoChat(groupId);
    }, 30000);
    return () => window.clearInterval(t);
  }, [groupId, open, refreshUnread, pullInboxIntoChat]);

  useEffect(() => {
    if (!open || !groupId) return;
    void pullInboxIntoChat(groupId);
  }, [open, groupId, pullInboxIntoChat]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    if (!searchOpen || !groupId) {
      setSearchResults([]);
      return;
    }
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    setSearchBusy(true);
    const t = window.setTimeout(() => {
      void searchAgentChatMessages({ groupId, query: q, limit: 40 })
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
        .finally(() => setSearchBusy(false));
    }, 280);
    return () => window.clearTimeout(t);
  }, [searchOpen, searchQuery, groupId]);

  const scrollToMessage = useCallback((messageId: string) => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    setHighlightId(messageId);
    window.setTimeout(() => {
      messageRefs.current.get(messageId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    window.setTimeout(() => setHighlightId(null), 2800);
  }, []);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

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
        setExtraOpen(false);
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

  const stopRecognition = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setHolding(false);
  };

  const startHoldRecognition = () => {
    if (!speechSupported) {
      setErr("当前浏览器不支持语音输入");
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor || listening) return;

    holdTranscriptRef.current = "";
    const rec = new Ctor();
    recognitionRef.current = rec;
    rec.lang = voiceLang;
    rec.interimResults = true;
    rec.continuous = true;

    rec.onstart = () => {
      setListening(true);
      setHolding(true);
      setErr("");
    };
    rec.onend = () => {
      setListening(false);
      setHolding(false);
      const t = holdTranscriptRef.current.trim();
      if (t) setInput((prev) => (prev ? `${prev}${t}` : t));
      holdTranscriptRef.current = "";
    };
    rec.onerror = () => {
      stopRecognition();
      setErr("语音识别失败，请检查麦克风权限");
    };
    rec.onresult = (event: SpeechRecognitionEvent) => {
      let chunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        chunk += event.results[i][0].transcript;
      }
      holdTranscriptRef.current += chunk;
      if (event.results[event.results.length - 1]?.isFinal) {
        setInput((prev) => (prev ? `${prev}${chunk}` : chunk));
      }
    };

    try {
      rec.start();
    } catch {
      setErr("无法启动语音识别");
    }
  };

  const onNewTopic = () => {
    void (async () => {
      if (groupId) await clearAgentChatHistory(groupId);
      shownInboxIdsRef.current.clear();
      setMessages([welcomeMessage(enabled, userRole)]);
      setInput("");
      setPendingImages((prev) => {
        for (const p of prev) URL.revokeObjectURL(p.previewUrl);
        return [];
      });
      setNextImageIndex(0);
      setErr("");
      setExtraOpen(false);
    })();
  };

  const applyQuickTopic = (prompt: string) => {
    setInput(prompt);
    setInputMode("text");
  };

  async function onSend(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text && pendingImages.length === 0) return;
    if (!enabled) {
      setErr(`${BOT_NAME} 未启用`);
      return;
    }
    if (!groupId) {
      setErr(`请先加入并激活工作群后再使用${BOT_NAME}`);
      return;
    }
    setErr("");
    setBusy(true);
    setExtraOpen(false);

    const userMsg: UiMessage = {
      id: uid(),
      role: "user",
      text: text || "（见附件图片）",
      imagePreviews: pendingImages.length ? pendingImages.map((p) => p.previewUrl) : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    void saveChatMessage(groupId, "user", userMsg.text);

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
        pageContext,
      });

      let actionNote = "";
      if (res.actions.length > 0) {
        const summaries = executeActions(res.actions);
        if (summaries.length > 0) actionNote = `\n\n⚡ 已执行：${summaries.join("；")}`;
      }

      let broadcastNote = "";
      if (res.broadcast_result) {
        if (res.broadcast_result.ok) {
          broadcastNote = `\n\n📢 已发送到 ${res.broadcast_result.sent_count ?? 0} 人账户收件箱。`;
        } else if (res.broadcast_result.error) {
          broadcastNote = `\n\n⚠️ 群发失败：${res.broadcast_result.error}`;
        }
      }

      const assistantText =
        res.assistant_message +
        (res.questions.length ? `\n\n💡 待补充：${res.questions.join("；")}` : "") +
        actionNote +
        broadcastNote;

      const assistantMsg = await saveChatMessage(groupId, "assistant", assistantText, {
        proposals: res.proposals.length ? res.proposals : undefined,
        source: "chat",
      });
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "发送失败");
      const failText = "抱歉，这次没能处理你的请求。请检查网络或稍后再试。";
      const failMsg = groupId
        ? await saveChatMessage(groupId, "assistant", failText, { source: "chat" })
        : { id: uid(), role: "assistant" as const, text: failText };
      setMessages((prev) => [...prev, failMsg]);
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
      const okText = `已写入：大场景 ${result.createdMacros} 个，小岗位 ${result.createdPositions} 个。可在「场景业务 → 场景岗位」查看。`;
      const okMsg = await saveChatMessage(groupId, "assistant", okText, { source: "chat" });
      setMessages((prev) => [...prev, okMsg]);
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
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-lg ring-2 ring-rose-100 hover:scale-105 transition-transform focus:outline-none focus:ring-2 focus:ring-rose-300 overflow-visible"
          aria-label={`打开${BOT_NAME}${unreadCount ? `，${unreadCount}条未读` : ""}`}
          title={BOT_NAME}
        >
          <DouXiaoMiAvatar size="lg" className="h-14 w-14 ring-0 shadow-none" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      )}

      {open && (
        <>
          <button
            type="button"
            aria-label={`关闭${BOT_NAME}`}
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 flex h-[75vh] min-h-[420px] flex-col overflow-hidden bg-[#f5f5f5] shadow-[0_-8px_32px_rgba(0,0,0,0.12)] animate-[slideUp_0.25s_ease-out]"
            role="dialog"
            aria-label={BOT_NAME}
          >
            <header className="flex shrink-0 items-center justify-between border-b border-gray-200/80 bg-white px-4 py-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <DouXiaoMiAvatar size="md" />
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{BOT_NAME}</p>
                  <p className="text-xs text-gray-500 truncate">
                    群组智能体 · {ROLE_LABELS[userRole]} · {pageContext.pageTitle}
                    {pageContext.sceneTab
                      ? ` · ${pageContext.sceneTab === "tasks" ? "采集排班" : pageContext.sceneTab === "demands" ? "甲方业务" : "场景岗位"}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen((v) => !v);
                    if (searchOpen) {
                      setSearchQuery("");
                      setSearchResults([]);
                    }
                  }}
                  className={`p-2 rounded-lg ${searchOpen ? "bg-rose-50 text-rose-600" : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"}`}
                  aria-label="搜索聊天记录"
                  title="搜索聊天记录"
                >
                  <IconSearch className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-sm text-gray-500 hover:text-gray-800 px-2 py-1"
                >
                  收起
                </button>
              </div>
            </header>

            {searchOpen && (
              <div className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5">
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                  <IconSearch className="h-4 w-4 text-gray-400 shrink-0" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索聊天记录关键词…"
                    className="flex-1 min-w-0 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="text-xs text-gray-500 hover:text-gray-800"
                      onClick={() => {
                        setSearchQuery("");
                        setSearchResults([]);
                      }}
                    >
                      清除
                    </button>
                  )}
                </div>
                <div className="mt-2 max-h-[28vh] overflow-y-auto rounded-xl border border-gray-100 bg-white">
                  {!searchQuery.trim() && (
                    <p className="px-3 py-4 text-xs text-gray-400 text-center">输入关键词检索历史对话</p>
                  )}
                  {searchQuery.trim() && searchBusy && (
                    <p className="px-3 py-4 text-xs text-gray-400 text-center">搜索中…</p>
                  )}
                  {searchQuery.trim() && !searchBusy && searchResults.length === 0 && (
                    <p className="px-3 py-4 text-xs text-gray-400 text-center">未找到相关记录</p>
                  )}
                  {searchResults.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => scrollToMessage(row.id)}
                      className="w-full text-left px-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-rose-50/60"
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-xs font-medium text-gray-700">
                          {row.role === "user" ? "我" : BOT_NAME}
                        </span>
                        <span className="text-[10px] text-gray-400 shrink-0">{formatChatTime(row.created_at)}</span>
                      </div>
                      <p className="text-xs text-gray-600 line-clamp-2">
                        {snippetAroundKeyword(row.content, searchQuery.trim())}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
              {historyLoading && (
                <div className="flex gap-2 items-center text-sm text-gray-400 pl-9">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce">·</span>
                    <span className="animate-bounce [animation-delay:0.1s]">·</span>
                    <span className="animate-bounce [animation-delay:0.2s]">·</span>
                  </span>
                  正在加载聊天记录
                </div>
              )}
              {!historyLoading &&
                messages.map((m) => (
                <div
                  key={m.id}
                  ref={(el) => {
                    if (el) messageRefs.current.set(m.id, el);
                    else messageRefs.current.delete(m.id);
                  }}
                  className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : "flex-row"} ${
                    highlightId === m.id ? "rounded-2xl ring-2 ring-rose-300 ring-offset-2 bg-rose-50/40 p-1 -mx-1" : ""
                  }`}
                >
                  {m.role === "assistant" && <DouXiaoMiAvatar size="sm" className="mt-0.5" />}
                  <div
                    className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-[#1a1a1a] text-white rounded-br-md"
                        : "bg-white text-gray-800 shadow-sm border border-gray-100 rounded-bl-md"
                    }`}
                  >
                    {m.text}
                    {m.imagePreviews?.length ? (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {m.imagePreviews.map((src) => (
                          <img key={src} src={src} alt="" className="h-16 w-16 object-cover rounded-lg" />
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
                <div className="flex gap-2 items-center text-sm text-gray-400 pl-9">
                  <span className="inline-flex gap-1">
                    <span className="animate-bounce">·</span>
                    <span className="animate-bounce [animation-delay:0.1s]">·</span>
                    <span className="animate-bounce [animation-delay:0.2s]">·</span>
                  </span>
                  {BOT_NAME} 正在思考
                </div>
              )}
            </div>

            {toast && (
              <div className="shrink-0 mx-4 mt-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900 flex justify-between gap-2">
                <span>{toast}</span>
                <button type="button" className="text-emerald-700" onClick={clearToast}>
                  知道了
                </button>
              </div>
            )}

            {err && <p className="shrink-0 px-4 py-1 text-xs text-red-600">{err}</p>}

            {pendingImages.length > 0 && (
              <div className="shrink-0 px-4 pb-1">
                <div className="flex flex-wrap gap-2">
                  {pendingImages.map((img) => (
                    <div key={img.index} className="relative">
                      <img src={img.previewUrl} alt="" className="h-11 w-11 object-cover rounded-lg border border-gray-200" />
                      <button
                        type="button"
                        onClick={() => removeImage(img.index)}
                        className="absolute -top-1 -right-1 bg-gray-800 text-white text-[10px] rounded-full w-4 h-4"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <footer className="shrink-0 px-3 pb-3 pt-1 bg-[#f5f5f5] relative">
              <p className="text-center text-sm text-gray-400 mb-2">聊聊新话题</p>

              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {quickTopics.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => applyQuickTopic(item.prompt)}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-sm text-gray-800 hover:bg-gray-50"
                  >
                    <span>{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 rounded-[1.75rem] border border-gray-200 bg-white px-3 py-2 shadow-sm">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="shrink-0 p-1 text-gray-700 hover:text-gray-900"
                  aria-label="上传图片"
                >
                  <IconCamera className="h-6 w-6" />
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

                {inputMode === "text" ? (
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="发消息或按住说话…"
                    className="flex-1 min-w-0 bg-transparent text-[15px] text-gray-900 placeholder:text-gray-400 outline-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void onSend();
                      }
                    }}
                    onPointerDown={(e) => {
                      if (e.pointerType === "mouse" && e.button !== 0) return;
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={`flex-1 rounded-full py-2 text-[15px] font-medium select-none touch-none ${
                      holding ? "bg-gray-900 text-white" : "text-gray-500"
                    }`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      startHoldRecognition();
                    }}
                    onPointerUp={stopRecognition}
                    onPointerLeave={holding ? stopRecognition : undefined}
                    onPointerCancel={stopRecognition}
                  >
                    {holding ? "松开 结束" : "按住 说话"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setInputMode((m) => (m === "text" ? "voice" : "text"));
                    stopRecognition();
                  }}
                  className={`shrink-0 flex h-9 w-9 items-center justify-center rounded-full border ${
                    inputMode === "voice"
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-200 text-gray-700 hover:bg-gray-50"
                  }`}
                  aria-label="切换语音输入"
                >
                  <IconWave className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={() => setExtraOpen((v) => !v)}
                  className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50"
                  aria-label="更多"
                >
                  <IconPlus className="h-5 w-5" />
                </button>

                {(input.trim() || pendingImages.length > 0) && inputMode === "text" && (
                  <button
                    type="button"
                    disabled={busy || !enabled}
                    onClick={() => void onSend()}
                    className="shrink-0 rounded-full bg-[#1a1a1a] px-3 py-1.5 text-sm text-white disabled:opacity-40"
                  >
                    发送
                  </button>
                )}
              </div>

              {extraOpen && (
                <div className="absolute bottom-full right-3 mb-2 w-48 rounded-2xl border border-gray-200 bg-white py-2 shadow-lg text-sm">
                  <button
                    type="button"
                    className="w-full px-4 py-2 text-left hover:bg-gray-50"
                    onClick={onNewTopic}
                  >
                    新话题
                  </button>
                  <div className="px-4 py-2 text-gray-500 text-xs">语音识别语言</div>
                  <button
                    type="button"
                    className={`w-full px-4 py-2 text-left hover:bg-gray-50 ${voiceLang === "zh-CN" ? "text-gray-900 font-medium" : ""}`}
                    onClick={() => {
                      setVoiceLang("zh-CN");
                      setExtraOpen(false);
                    }}
                  >
                    中文
                  </button>
                  <button
                    type="button"
                    className={`w-full px-4 py-2 text-left hover:bg-gray-50 ${voiceLang === "en-US" ? "text-gray-900 font-medium" : ""}`}
                    onClick={() => {
                      setVoiceLang("en-US");
                      setExtraOpen(false);
                    }}
                  >
                    English
                  </button>
                  <div className="border-t border-gray-100 my-1" />
                  <div className="px-4 py-1 text-gray-500 text-xs">图片类型</div>
                  {(
                    [
                      ["unknown", "自动识别"],
                      ["macro", "大场景全景"],
                      ["position", "小岗位现场"],
                    ] as const
                  ).map(([val, lab]) => (
                    <button
                      key={val}
                      type="button"
                      className={`w-full px-4 py-2 text-left hover:bg-gray-50 ${imageHint === val ? "text-gray-900 font-medium" : ""}`}
                      onClick={() => {
                        setImageHint(val);
                        setExtraOpen(false);
                      }}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
              )}
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
    <div className="mt-3 pt-2 border-t border-gray-100 space-y-2">
      <p className="text-xs font-medium text-gray-600">待确认录入方案</p>
      <ul className="space-y-2 text-xs text-gray-700">
        {proposals.map((p) => (
          <li key={p.id} className="rounded-xl bg-gray-50 p-2.5">
            {p.kind === "macro" ? (
              <>
                <p className="font-medium text-gray-900">大场景 · {p.title}</p>
                <p className="text-gray-600 mt-0.5">{p.description || "—"}</p>
                <p className="text-gray-500 mt-0.5">
                  {p.contact_name} · {p.contact_phone}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium text-gray-900">小岗位 · {p.title}</p>
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
        className="w-full py-2 rounded-full bg-[#1a1a1a] text-white text-xs font-medium disabled:opacity-50"
      >
        {disabled ? "写入中…" : "确认写入系统"}
      </button>
    </div>
  );
}
