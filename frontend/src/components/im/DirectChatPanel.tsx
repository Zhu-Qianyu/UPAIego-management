import { useCallback, useEffect, useRef, useState } from "react";
import {
  getOrCreateDirectConversation,
  listDirectMessages,
  markDirectMessagesRead,
  sendDirectMessage,
  subscribeDirectMessages,
  type DirectMessage,
} from "../../api/directChat";

export default function DirectChatPanel({
  groupId,
  conversationId: initialConversationId,
  otherUserId,
  otherDisplayName,
  userId,
  canSend,
  onShowSessionList,
}: {
  groupId: string;
  conversationId?: string | null;
  otherUserId: string;
  otherDisplayName: string;
  userId: string | undefined;
  canSend: boolean;
  onShowSessionList?: () => void;
}) {
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [sendErr, setSendErr] = useState("");
  const [tableMissing, setTableMissing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ensureConversation = useCallback(async () => {
    if (conversationId) return conversationId;
    const id = await getOrCreateDirectConversation(groupId, otherUserId);
    setConversationId(id);
    return id;
  }, [conversationId, groupId, otherUserId]);

  const loadMessages = useCallback(async (convId: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const rows = await listDirectMessages(convId);
      setMessages(rows);
      setTableMissing(false);
      await markDirectMessagesRead(convId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "加载私聊失败";
      if (msg.includes("does not exist") || msg.includes("Could not find")) {
        setTableMissing(true);
        setMessages([]);
      } else if (!silent) {
        setSendErr(msg);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const convId = await ensureConversation();
        await loadMessages(convId);
      } catch (e: unknown) {
        setSendErr(e instanceof Error ? e.message : "无法打开私聊");
        setLoading(false);
      }
    })();
  }, [ensureConversation, loadMessages, groupId, otherUserId]);

  useEffect(() => {
    if (!conversationId) return;
    const unsub = subscribeDirectMessages(conversationId, {
      onInsert: (msg: DirectMessage) => {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        if (msg.sender_user_id !== userId) void markDirectMessagesRead(conversationId);
      },
    });
    const pollId = window.setInterval(() => {
      void loadMessages(conversationId, true);
    }, 3000);
    return () => {
      window.clearInterval(pollId);
      unsub();
    };
  }, [conversationId, loadMessages, userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, busy]);

  async function onSend() {
    const text = input.trim();
    if (!text || busy || !canSend) return;
    if (tableMissing) {
      setSendErr("私聊尚未初始化，请联系管理员检查服务器数据库");
      return;
    }

    setSendErr("");
    setBusy(true);
    setInput("");
    try {
      const convId = await ensureConversation();
      const msg = await sendDirectMessage(convId, text);
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    } catch (e: unknown) {
      setSendErr(e instanceof Error ? e.message : "发送失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f5f5f5]">
      <header className="shrink-0 border-b border-gray-200 bg-[#ededed] px-2 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2">
        {onShowSessionList ? (
          <button
            type="button"
            onClick={onShowSessionList}
            className="md:hidden shrink-0 rounded-md px-2 py-1 text-sm text-gray-700 hover:bg-gray-200/70"
            aria-label="返回会话列表"
          >
            ←
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-900 truncate text-sm sm:text-base">{otherDisplayName}</p>
          <p className="text-[11px] sm:text-xs text-gray-500">私聊 · 仅本群成员可见</p>
        </div>
      </header>

      {tableMissing && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          私聊功能尚未就绪，请联系管理员检查服务器数据库。
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-2 sm:px-4 py-3 space-y-3">
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-8">加载中…</p>
        ) : (
          messages.map((m) => {
            const isMe = m.sender_user_id === userId;
            return (
              <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[min(92%,28rem)] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                    isMe ? "bg-[#95ec69] text-gray-900" : "bg-white text-gray-800 border border-gray-100"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {sendErr && <p className="shrink-0 px-4 text-xs text-red-600">{sendErr}</p>}

      <footer className="shrink-0 border-t border-gray-200 bg-[#f5f5f5] px-2 sm:px-4 py-2 sm:py-3">
        {!canSend ? (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            入群审批通过后可发送私聊
          </p>
        ) : (
          <div className="flex gap-1.5 sm:gap-2 items-end">
            <textarea
              value={input}
              rows={2}
              onChange={(e) => setInput(e.target.value)}
              placeholder="发消息…"
              disabled={tableMissing}
              className="flex-1 min-w-0 w-full rounded-lg border border-gray-200 bg-white px-2.5 sm:px-3 py-2 text-base sm:text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
            />
            <button
              type="button"
              disabled={busy || !input.trim() || tableMissing}
              onClick={() => void onSend()}
              className="shrink-0 rounded-lg bg-[#07c160] text-white px-4 py-2 text-sm font-medium disabled:opacity-40"
            >
              发送
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
