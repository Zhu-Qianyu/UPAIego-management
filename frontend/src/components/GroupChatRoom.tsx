import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BOT_MENTION,
  BOT_NAME,
  isBotInvocation,
  listGroupChatMessages,
  probeGroupChatTable,
  sendBotGroupChatMessage,
  sendUserGroupChatMessage,
  subscribeGroupChat,
  updateGroupChatMessage,
  type GroupChatMessage,
} from "../api/groupChat";
import { executeAgentFormFills } from "../api/agentForms";
import {
  executeAgentBroadcast,
  executeAgentGroupRules,
  sceneAiFeatureEnabled,
  sendSceneAgentMessage,
} from "../api/sceneAgent";
import { buildAssistantChatMetadata } from "../aitebot/agentChatMetadata";
import {
  allRequiredFormImagesSelected,
  getFormImageUploadLabel,
  pendingFormFillsNeedImages,
} from "../aitebot/agentFormImages";
import type { AgentPendingFormFill } from "../aitebot/agentFormTypes";
import { AGENT_TASK_CHOICE_PROMPT, resolveSelfServiceActions } from "../aitebot/selfServiceNavigation";
import type { AgentAction, AgentPendingBroadcast, AgentPendingGroupRules } from "../aitebot/types";
import { useAitebot } from "../aitebot/AitebotContext";
import { ROLE_LABELS } from "../auth/roleLabels";
import type { UserRole } from "../types/roles";
import DouXiaoMiAvatar from "./DouXiaoMiAvatar";
import { FormFillImageUpload, PendingConfirmBar, pickFormFillImage } from "./agent/AgentConfirmUI";

type FormFillImageEntry = { file: File; previewUrl: string };

const QUICK_TOPICS_BY_ROLE: Record<UserRole, { icon: string; label: string; prompt: string }[]> = {
  admin: [
    { icon: "📢", label: "群发通知", prompt: `${BOT_MENTION} 帮我起草一条通知：明天全体放假，并发送给群组所有人。` },
    { icon: "📋", label: "采集流程", prompt: `${BOT_MENTION} 请说明从场景录入、排班到悬赏结算的完整数采制度。` },
    { icon: "👥", label: "群组管理", prompt: `${BOT_MENTION} 带我去看群组管理和待审批成员。` },
  ],
  scene_operator: [
    { icon: "📅", label: "采集排班", prompt: `${BOT_MENTION} 帮我打开采集排班，并说明发布排班前要准备什么。` },
    { icon: "✨", label: "场景岗位", prompt: `${BOT_MENTION} 帮我创建一个大场景的填写说明。` },
    { icon: "📋", label: "业务流程", prompt: `${BOT_MENTION} 请说明从甲方业务、岗位到排班发布的流程。` },
  ],
  device_operator: [
    { icon: "🔧", label: "运维工作台", prompt: `${BOT_MENTION} 带我打开运维工作台，说明悬赏借还设备流程。` },
    { icon: "📱", label: "登记设备", prompt: `${BOT_MENTION} 如何登记设备？需要关联什么甲方业务？` },
  ],
  collection_executor: [
    { icon: "📅", label: "我的排班", prompt: `${BOT_MENTION} 带我去看今天的采集排班，如何打卡？` },
    { icon: "💰", label: "悬赏令", prompt: `${BOT_MENTION} 打开悬赏令，说明接单和截止注意事项。` },
    { icon: "👛", label: "钱包", prompt: `${BOT_MENTION} 我的钱包结算规则是什么？` },
  ],
};

function describeAction(action: AgentAction): string {
  if (action.type === "toast") return action.message;
  if (action.type === "refresh") return action.target === "scene" ? "刷新场景" : "刷新页面";
  return action.label ?? (action.type === "navigate" ? action.path : action.tab);
}

function groupChatToAiHistory(messages: GroupChatMessage[]): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter((m) => m.message_kind === "chat" || m.message_kind === "bot_action")
    .map((m) => ({
      role: m.sender_type === "user" ? ("user" as const) : ("assistant" as const),
      content: m.sender_type === "user" ? m.content : m.content,
    }));
}

export default function GroupChatRoom({
  groupId,
  userRole,
  userId,
  displayNameByUserId,
  setErr,
  embedded = false,
  canSend = true,
  groupName,
  memberCount,
  onOpenMembers,
}: {
  groupId: string;
  userRole: UserRole;
  userId: string | undefined;
  displayNameByUserId: Map<string, string>;
  setErr: (s: string) => void;
  embedded?: boolean;
  canSend?: boolean;
  groupName?: string;
  memberCount?: number;
  onOpenMembers?: () => void;
}) {
  const enabled = sceneAiFeatureEnabled();
  const { pageContext, executeActions, toast, clearToast } = useAitebot();
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [tableMissing, setTableMissing] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [formFillImages, setFormFillImages] = useState<Record<string, Record<number, FormFillImageEntry>>>({});
  const formImageInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const quickTopics = QUICK_TOPICS_BY_ROLE[userRole] ?? [];

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const mergeMessage = useCallback((msg: GroupChatMessage) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) {
        return prev.map((m) => (m.id === msg.id ? msg : m));
      }
      return [...prev, msg];
    });
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const probe = await probeGroupChatTable(groupId);
      if (probe === "missing") {
        setTableMissing(true);
        setMessages([]);
        return;
      }
      const rows = await listGroupChatMessages(groupId);
      setTableMissing(false);
      seenIdsRef.current = new Set(rows.map((r) => r.id));
      setMessages(rows);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "加载聊天失败";
      if (msg.includes("does not exist") || msg.includes("Could not find")) {
        setTableMissing(true);
        setMessages([]);
      } else {
        setErr(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [groupId, setErr]);

  const refreshMessages = useCallback(async () => {
    try {
      const rows = await listGroupChatMessages(groupId);
      seenIdsRef.current = new Set(rows.map((r) => r.id));
      setMessages(rows);
    } catch {
      /* 后台轮询失败不打断输入 */
    }
  }, [groupId]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    const unsub = subscribeGroupChat(groupId, {
      onInsert: (msg) => {
        if (seenIdsRef.current.has(msg.id)) return;
        seenIdsRef.current.add(msg.id);
        mergeMessage(msg);
      },
      onUpdate: (msg) => mergeMessage(msg),
      onPoll: () => void refreshMessages(),
    });
    return unsub;
  }, [groupId, mergeMessage, refreshMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, busy, scrollToBottom]);

  const patchBotMessage = useCallback(
    async (id: string, content: string, metadata: GroupChatMessage["metadata"]) => {
      const updated = await updateGroupChatMessage(id, { content, metadata });
      mergeMessage(updated);
    },
    [mergeMessage]
  );

  const onConfirmBroadcast = useCallback(
    async (msg: GroupChatMessage, spec: AgentPendingBroadcast) => {
      const result = await executeAgentBroadcast(groupId, spec);
      let text = msg.content;
      if (result.ok) {
        text += `\n\n📢 已发送到 ${result.sent_count ?? 0} 人收件箱，并同步到本群聊天室。`;
      }
      await patchBotMessage(
        msg.id,
        text,
        buildAssistantChatMetadata({ confirmDone: true })
      );
      if (!result.ok) {
        const fail = await sendBotGroupChatMessage(
          groupId,
          `通知没能发出去：${result.error ?? "未知错误"}`,
          {}
        );
        mergeMessage(fail);
      }
    },
    [groupId, mergeMessage, patchBotMessage]
  );

  const onConfirmGroupRules = useCallback(
    async (msg: GroupChatMessage, spec: AgentPendingGroupRules) => {
      const result = await executeAgentGroupRules(groupId, spec);
      let text = msg.content;
      if (result.ok) {
        text += `\n\n📜 本群规定已更新（全员生效，共 ${result.rules_length ?? 0} 字）。`;
      }
      await patchBotMessage(msg.id, text, buildAssistantChatMetadata({ confirmDone: true }));
      if (!result.ok) {
        const fail = await sendBotGroupChatMessage(groupId, `群规定没能保存：${result.error ?? "未知错误"}`, {});
        mergeMessage(fail);
      }
    },
    [groupId, mergeMessage, patchBotMessage]
  );

  const onConfirmFormFills = useCallback(
    async (msg: GroupChatMessage, specs: AgentPendingFormFill[]) => {
      const imageMap: Record<number, File> = {};
      for (const [idx, entry] of Object.entries(formFillImages[msg.id] ?? {})) {
        imageMap[Number(idx)] = entry.file;
      }
      if (!allRequiredFormImagesSelected(specs, imageMap)) {
        setErr("请先上传所需图片后再点「直接帮我干」");
        return;
      }
      const result = await executeAgentFormFills(groupId, userRole, specs, imageMap);
      let text = msg.content;
      if (result.summaries.length) text += `\n\n✅ ${result.summaries.join("；")}`;
      if (result.errors.length) text += `\n\n⚠️ ${result.errors.join("；")}`;
      await patchBotMessage(msg.id, text, buildAssistantChatMetadata({ confirmDone: true }));
      setFormFillImages((prev) => {
        const next = { ...prev };
        delete next[msg.id];
        return next;
      });
      const sceneForms = new Set([
        "party_demand_create",
        "party_demand_update",
        "scene_macro_create",
        "scenario_position_create",
        "collection_shift_create",
      ]);
      if (specs.some((s) => sceneForms.has(s.form)) && result.summaries.length) {
        executeActions([{ type: "refresh", target: "scene" }]);
      }
    },
    [executeActions, formFillImages, groupId, patchBotMessage, setErr, userRole]
  );

  const onConfirmActions = useCallback(
    async (msg: GroupChatMessage, actions: AgentAction[]) => {
      const summaries = executeActions(actions);
      let text = msg.content;
      if (summaries.length) text += `\n\n⚡ 已执行：${summaries.join("；")}`;
      await patchBotMessage(msg.id, text, buildAssistantChatMetadata({ confirmDone: true }));
    },
    [executeActions, patchBotMessage]
  );

  const onSelfServicePending = useCallback(
    async (
      msg: GroupChatMessage,
      kind: "broadcast" | "rules" | "actions" | "forms",
      ctx: {
        formFills?: AgentPendingFormFill[];
        actions?: AgentAction[];
        broadcast?: AgentPendingBroadcast;
        groupRules?: AgentPendingGroupRules;
      }
    ) => {
      const navActions = resolveSelfServiceActions({
        formFills: ctx.formFills,
        actions: ctx.actions,
        broadcast: ctx.broadcast ?? null,
        groupRules: ctx.groupRules ?? null,
      });
      await patchBotMessage(msg.id, msg.content, buildAssistantChatMetadata({ confirmDone: true }));
      if (kind === "forms") {
        setFormFillImages((prev) => {
          const next = { ...prev };
          delete next[msg.id];
          return next;
        });
      }
      if (navActions.length) {
        const summaries = executeActions(navActions);
        const reply = await sendBotGroupChatMessage(
          groupId,
          summaries.length
            ? `好的，已帮您打开：${summaries.join("；")}。您在那儿自己操作就行～`
            : "好的，已帮您打开相关页面，您在那儿自己操作就行～",
          {}
        );
        mergeMessage(reply);
      }
    },
    [executeActions, groupId, mergeMessage, patchBotMessage]
  );

  async function onSend() {
    const text = input.trim();
    if (!text || busy) return;
    if (!canSend) {
      setSendErr("入群审批通过后可发言");
      return;
    }
    if (tableMissing) {
      setSendErr("群聊天室尚未初始化，请在服务器执行 docs/GROUP_CHAT_MIGRATION.sql");
      return;
    }

    setErr("");
    setSendErr("");
    setBusy(true);
    setInput("");

    try {
      const userMsg = await sendUserGroupChatMessage(groupId, text);
      mergeMessage(userMsg);

      if (!isBotInvocation(text)) return;

      if (!enabled) {
        const fail = await sendBotGroupChatMessage(
          groupId,
          `${BOT_NAME} 尚未启用，请联系管理员配置 scene-ai-agent。`,
          {}
        );
        mergeMessage(fail);
        return;
      }

      const history = groupChatToAiHistory([...messages, userMsg]);
      const res = await sendSceneAgentMessage({
        messages: history,
        groupId,
        pageContext,
        role: userRole,
      });

      const assistantText =
        res.assistant_message + (res.questions.length ? `\n\n💡 待补充：${res.questions.join("；")}` : "");

      const formFills = res.pending_form_fills;
      const pendingActions = formFills.length ? [] : res.actions;

      const botMsg = await sendBotGroupChatMessage(
        groupId,
        assistantText,
        buildAssistantChatMetadata({
          pendingBroadcast: res.pending_broadcast ?? undefined,
          pendingGroupRules: res.pending_group_rules ?? undefined,
          pendingFormFills: formFills.length ? formFills : undefined,
          pendingActions: pendingActions.length ? pendingActions : undefined,
        })
      );
      mergeMessage(botMsg);
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : "发送失败";
      setSendErr(reason);
      setErr(reason);
      try {
        const fail = await sendBotGroupChatMessage(groupId, `抱歉，这次没能处理：${reason}`, {});
        mergeMessage(fail);
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  }

  const senderLabel = useCallback(
    (m: GroupChatMessage) => {
      if (m.sender_type === "bot") return BOT_NAME;
      if (m.sender_type === "system") return "系统公告";
      if (m.sender_user_id === userId) return "我";
      return displayNameByUserId.get(m.sender_user_id ?? "") ?? "成员";
    },
    [displayNameByUserId, userId]
  );

  const welcomeText = useMemo(
    () =>
      `欢迎进入群聊天室。直接发言可与同事交流；需要问制度、跳转页面或（管理员）群发时，输入 ${BOT_MENTION} + 您的问题。您当前是「${ROLE_LABELS[userRole]}」。`,
    [userRole]
  );

  if (loading && messages.length === 0) {
    return (
      <p className={`text-sm text-gray-500 py-8 text-center ${embedded ? "h-full flex items-center justify-center" : ""}`}>
        加载聊天室…
      </p>
    );
  }

  const shellClass = embedded
    ? "flex flex-col h-full min-h-0 overflow-hidden bg-[#f5f5f5]"
    : "bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col min-h-[28rem] max-h-[70vh]";

  return (
    <section className={shellClass}>
      {embedded ? (
        <div className="shrink-0 border-b border-gray-200 bg-[#ededed] px-4 py-3 flex items-center justify-between">
          <div>
            <p className="font-semibold text-gray-900">{groupName ?? "本工作群"}</p>
            <p className="text-xs text-gray-500">
              {memberCount != null ? `${memberCount} 人 · ` : ""}输入 {BOT_MENTION} 可问豆小秘
            </p>
          </div>
          {onOpenMembers && (
            <button
              type="button"
              onClick={onOpenMembers}
              className="text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded-md hover:bg-gray-200/60"
            >
              成员
            </button>
          )}
        </div>
      ) : (
        <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-rose-50/80 to-indigo-50/50">
          <h2 className="text-sm font-semibold text-gray-900">群聊天室</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            同事交流 + {BOT_NAME}（输入 {BOT_MENTION} 提问、跳转或群发）
          </p>
        </div>
      )}

      {tableMissing && (
        <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          数据库尚未创建群聊天表。请在 Supabase SQL Editor 执行{" "}
          <code className="font-mono">docs/GROUP_CHAT_MIGRATION.sql</code> 后刷新本页。
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 bg-[#f7f7f8] min-h-0">
        <div className="flex gap-2 items-start">
          <DouXiaoMiAvatar size="sm" className="mt-0.5 shrink-0" />
          <div className="rounded-2xl rounded-tl-md bg-white border border-gray-200 px-3 py-2 text-sm text-gray-700 max-w-[85%] shadow-sm">
            {welcomeText}
          </div>
        </div>

        {messages.map((m) => {
          const isUser = m.sender_type === "user";
          const isBot = m.sender_type === "bot";
          const isBroadcast = m.message_kind === "broadcast";
          const meta = m.metadata ?? {};
          const confirmDone = meta.confirm_done === true;

          if (isBroadcast) {
            const title = (meta as { broadcast_title?: string }).broadcast_title;
            return (
              <div key={m.id} className="flex justify-center">
                <div className="max-w-[92%] rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm">
                  <p className="text-xs font-semibold text-violet-800 mb-1">📢 群公告</p>
                  {title ? <p className="font-medium text-gray-900">{title}</p> : null}
                  <p className="text-gray-700 whitespace-pre-wrap mt-1">{m.content}</p>
                  <p className="text-[10px] text-gray-400 mt-2">{new Date(m.created_at).toLocaleString()}</p>
                </div>
              </div>
            );
          }

          return (
            <div key={m.id} className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
              {isBot ? <DouXiaoMiAvatar size="sm" className="mt-0.5 shrink-0" /> : null}
              <div className={`max-w-[85%] min-w-0 ${isUser ? "items-end" : "items-start"} flex flex-col`}>
                <p className={`text-[10px] text-gray-400 mb-0.5 px-1 ${isUser ? "text-right" : ""}`}>
                  {senderLabel(m)}
                </p>
                <div
                  className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm ${
                    isUser
                      ? embedded
                        ? "bg-[#95ec69] text-gray-900 rounded-tr-md"
                        : "bg-indigo-600 text-white rounded-tr-md"
                      : "bg-white border border-gray-200 text-gray-800 rounded-tl-md"
                  }`}
                >
                  {m.content}
                </div>

                {isBot && !confirmDone && meta.pending_broadcast ? (
                  <PendingConfirmBar
                    prompt={AGENT_TASK_CHOICE_PROMPT}
                    detail={
                      <div className="space-y-1">
                        <p className="font-medium">{meta.pending_broadcast.title}</p>
                        <p className="line-clamp-4 whitespace-pre-wrap">{meta.pending_broadcast.body}</p>
                      </div>
                    }
                    onOk={() => void onConfirmBroadcast(m, meta.pending_broadcast!)}
                    onSelfService={() =>
                      void onSelfServicePending(m, "broadcast", { broadcast: meta.pending_broadcast })
                    }
                  />
                ) : null}

                {isBot && !confirmDone && meta.pending_group_rules ? (
                  <PendingConfirmBar
                    prompt={AGENT_TASK_CHOICE_PROMPT}
                    detail={
                      <p className="line-clamp-4 whitespace-pre-wrap">
                        {meta.pending_group_rules.mode === "clear"
                          ? "（清空全部群规定）"
                          : meta.pending_group_rules.content}
                      </p>
                    }
                    onOk={() => void onConfirmGroupRules(m, meta.pending_group_rules!)}
                    onSelfService={() =>
                      void onSelfServicePending(m, "rules", { groupRules: meta.pending_group_rules })
                    }
                  />
                ) : null}

                {isBot && !confirmDone && meta.pending_form_fills?.length ? (
                  <PendingConfirmBar
                    prompt={
                      pendingFormFillsNeedImages(meta.pending_form_fills).length
                        ? `请上传图片。${AGENT_TASK_CHOICE_PROMPT}`
                        : AGENT_TASK_CHOICE_PROMPT
                    }
                    detail={
                      <div className="space-y-2">
                        <ul className="list-disc pl-4 space-y-1">
                          {meta.pending_form_fills.map((f, i) => (
                            <li key={`${f.form}-${i}`}>{f.label}</li>
                          ))}
                        </ul>
                        {pendingFormFillsNeedImages(meta.pending_form_fills).map(({ index, form }) => {
                          const entry = formFillImages[m.id]?.[index];
                          const inputKey = `${m.id}-${index}`;
                          return (
                            <FormFillImageUpload
                              key={inputKey}
                              label={getFormImageUploadLabel(form)}
                              previewUrl={entry?.previewUrl}
                              fileName={entry?.file.name}
                              inputRef={(el) => {
                                if (el) formImageInputRefs.current.set(inputKey, el);
                                else formImageInputRefs.current.delete(inputKey);
                              }}
                              onPick={(file) =>
                                void pickFormFillImage(
                                  file,
                                  (f, previewUrl) => {
                                    setFormFillImages((prev) => ({
                                      ...prev,
                                      [m.id]: { ...prev[m.id], [index]: { file: f, previewUrl } },
                                    }));
                                  },
                                  setErr
                                )
                              }
                            />
                          );
                        })}
                      </div>
                    }
                    okDisabled={
                      !allRequiredFormImagesSelected(
                        meta.pending_form_fills,
                        Object.fromEntries(
                          Object.entries(formFillImages[m.id] ?? {}).map(([k, v]) => [Number(k), v.file])
                        )
                      )
                    }
                    onOk={() => void onConfirmFormFills(m, meta.pending_form_fills!)}
                    onSelfService={() =>
                      void onSelfServicePending(m, "forms", { formFills: meta.pending_form_fills })
                    }
                  />
                ) : null}

                {isBot && !confirmDone && meta.pending_actions?.length ? (
                  <PendingConfirmBar
                    prompt={AGENT_TASK_CHOICE_PROMPT}
                    detail={<p>{meta.pending_actions.map((a) => describeAction(a)).join("；")}</p>}
                    onOk={() => void onConfirmActions(m, meta.pending_actions!)}
                    onSelfService={() =>
                      void onSelfServicePending(m, "actions", { actions: meta.pending_actions })
                    }
                  />
                ) : null}

                <p className="text-[10px] text-gray-400 mt-0.5 px-1">{new Date(m.created_at).toLocaleString()}</p>
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="flex gap-2 items-center text-sm text-gray-400 pl-10">
            <span className="inline-flex gap-1">
              <span className="animate-bounce">·</span>
              <span className="animate-bounce [animation-delay:0.1s]">·</span>
              <span className="animate-bounce [animation-delay:0.2s]">·</span>
            </span>
            {BOT_NAME} 正在思考
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {toast && (
        <div className="shrink-0 mx-3 mb-1 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900 flex justify-between">
          <span>{toast}</span>
          <button type="button" onClick={clearToast} className="text-emerald-700">
            知道了
          </button>
        </div>
      )}

      <div className={`shrink-0 border-t border-gray-100 bg-white px-3 py-2 space-y-2 ${embedded ? "bg-[#f5f5f5]" : ""}`}>
        {sendErr && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-2 py-1">{sendErr}</p>
        )}
        {!canSend && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            入群审批通过后可发言
          </p>
        )}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {quickTopics.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setInput(item.prompt)}
              className="shrink-0 inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-100"
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`发消息… 问${BOT_NAME}请以 ${BOT_MENTION} 开头`}
            className="flex-1 min-w-0 max-h-24 rounded-xl border border-gray-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
          />
          <button
            type="button"
            disabled={busy || !input.trim() || tableMissing || !canSend}
            onClick={() => void onSend()}
            className={`shrink-0 rounded-xl text-white px-4 py-2 text-sm font-medium disabled:opacity-40 ${
              embedded ? "bg-[#07c160] rounded-lg" : "bg-indigo-600"
            }`}
          >
            发送
          </button>
        </div>
      </div>
    </section>
  );
}
