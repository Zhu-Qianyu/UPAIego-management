import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getLastDirectMessage,
  listDirectConversations,
  otherUserInConversation,
  type DirectConversation,
} from "../../api/directChat";
import { listGroupChatMessages, BOT_NAME } from "../../api/groupChat";
import type { GroupMember } from "../../api/groups";
import type { UserRole } from "../../types/roles";
import BotChatPanel from "../BotChatPanel";
import GroupChatRoom from "../GroupChatRoom";
import DirectChatPanel from "./DirectChatPanel";
import DouXiaoMiAvatar from "../DouXiaoMiAvatar";

export type ImSession =
  | { kind: "group" }
  | { kind: "bot" }
  | { kind: "direct"; userId: string };

type MemberRow = GroupMember & { displayName: string; roleLabel: string };

type SessionPreview = {
  id: string;
  title: string;
  preview: string;
  time?: string;
  avatar?: "bot" | "group";
};

function sessionKey(s: ImSession): string {
  if (s.kind === "group") return "group";
  if (s.kind === "bot") return "bot";
  return `direct:${s.userId}`;
}

export default function ImShell({
  groupId,
  groupName,
  members,
  userRole,
  userRoles,
  userId,
  canSend,
  displayNameByUserId,
  setErr,
  canModerateMembers,
  onOpenMembers,
}: {
  groupId: string;
  groupName: string;
  members: MemberRow[];
  userRole: UserRole;
  userRoles?: UserRole[];
  userId: string | undefined;
  canSend: boolean;
  displayNameByUserId: Map<string, string>;
  setErr: (s: string) => void;
  canModerateMembers: boolean;
  onOpenMembers: () => void;
}) {
  const [session, setSession] = useState<ImSession>({ kind: "group" });
  const [mobilePanel, setMobilePanel] = useState<"list" | "chat">("chat");
  const [search, setSearch] = useState("");
  const [previews, setPreviews] = useState<Record<string, SessionPreview>>({});
  const [directConvs, setDirectConvs] = useState<DirectConversation[]>([]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.membership_status === "active" && m.user_id !== userId),
    [members, userId]
  );

  const refreshPreviews = useCallback(async () => {
    const next: Record<string, SessionPreview> = {};

    try {
      const groupMsgs = await listGroupChatMessages(groupId, 1);
      const lastGroup = groupMsgs[groupMsgs.length - 1];
      next.group = {
        id: "group",
        title: groupName,
        preview: lastGroup?.content?.slice(0, 40) ?? "点击进入群聊",
        time: lastGroup?.created_at,
        avatar: "group",
      };
    } catch {
      next.group = { id: "group", title: groupName, preview: "群聊", avatar: "group" };
    }

    next.bot = {
      id: "bot",
      title: BOT_NAME,
      preview: "问制度、跳转页面、代填表单",
      avatar: "bot",
    };

    try {
      const convs = await listDirectConversations(groupId);
      setDirectConvs(convs);
      for (const conv of convs) {
        if (!userId) continue;
        const otherId = otherUserInConversation(conv, userId);
        const last = await getLastDirectMessage(conv.id);
        const key = `direct:${otherId}`;
        next[key] = {
          id: key,
          title: displayNameByUserId.get(otherId) ?? "成员",
          preview: last?.content?.slice(0, 40) ?? "开始私聊",
          time: last?.created_at ?? conv.last_message_at,
        };
      }
    } catch {
      /* direct chat table may not exist */
    }

    setPreviews(next);
  }, [displayNameByUserId, groupId, groupName, userId]);

  useEffect(() => {
    void refreshPreviews();
    const t = window.setInterval(() => void refreshPreviews(), 8000);
    return () => window.clearInterval(t);
  }, [refreshPreviews]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeMembers;
    return activeMembers.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.roleLabel.toLowerCase().includes(q)
    );
  }, [activeMembers, search]);

  const currentKey = sessionKey(session);

  const openSession = useCallback((s: ImSession) => {
    setSession(s);
    setMobilePanel("chat");
  }, []);

  const showSessionList = useCallback(() => {
    setMobilePanel("list");
  }, []);

  function renderPanel() {
    if (session.kind === "group") {
      return (
        <GroupChatRoom
          embedded
          groupId={groupId}
          userRole={userRole}
          userRoles={userRoles}
          userId={userId}
          displayNameByUserId={displayNameByUserId}
          setErr={setErr}
          canSend={canSend}
          groupName={groupName}
          memberCount={members.filter((m) => m.membership_status === "active").length}
          onOpenMembers={onOpenMembers}
          onShowSessionList={showSessionList}
        />
      );
    }
    if (session.kind === "bot") {
      return (
        <BotChatPanel
          groupId={groupId}
          userRole={userRole}
          userRoles={userRoles}
          onShowSessionList={showSessionList}
        />
      );
    }
    const member = members.find((m) => m.user_id === session.userId);
    const conv = userId
      ? directConvs.find(
          (c) => otherUserInConversation(c, userId) === session.userId
        )
      : undefined;
    return (
      <DirectChatPanel
        groupId={groupId}
        conversationId={conv?.id}
        otherUserId={session.userId}
        otherDisplayName={member?.displayName ?? displayNameByUserId.get(session.userId) ?? "成员"}
        userId={userId}
        canSend={canSend}
        onShowSessionList={showSessionList}
      />
    );
  }

  function SessionItem({
    s,
    title,
    preview,
    time,
    avatar,
  }: {
    s: ImSession;
    title: string;
    preview: string;
    time?: string;
    avatar?: "bot" | "group";
  }) {
    const active = sessionKey(s) === currentKey;
    return (
      <button
        type="button"
        onClick={() => openSession(s)}
        className={`w-full flex items-center gap-2.5 sm:gap-3 px-2.5 sm:px-3 py-2.5 text-left transition-colors ${
          active ? "bg-[#c9c9c9]" : "hover:bg-[#d9d9d9]"
        }`}
      >
        {avatar === "bot" ? (
          <DouXiaoMiAvatar size="sm" className="shrink-0" />
        ) : (
          <div className="h-8 w-8 sm:h-9 sm:w-9 shrink-0 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs sm:text-sm font-semibold">
            {avatar === "group" ? "群" : title.slice(0, 1)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-gray-900 truncate">{title}</p>
            {time && (
              <span className="text-[10px] text-gray-500 shrink-0">
                {new Date(time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 truncate mt-0.5">{preview}</p>
        </div>
      </button>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] min-h-[20rem] sm:h-[calc(100vh-10rem)] sm:min-h-[32rem] rounded-lg sm:rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm">
      <aside
        className={`shrink-0 flex flex-col border-r border-gray-200 bg-[#e7e7e7] w-full md:w-[220px] lg:w-[260px] ${
          mobilePanel === "chat" ? "hidden md:flex" : "flex"
        }`}
      >
        <div className="shrink-0 p-2 sm:p-3 border-b border-gray-300/60">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索成员"
            className="w-full rounded-md border border-gray-300/80 bg-[#f5f5f5] px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SessionItem
            s={{ kind: "group" }}
            title={previews.group?.title ?? groupName}
            preview={previews.group?.preview ?? "群聊"}
            time={previews.group?.time}
            avatar="group"
          />
          <SessionItem
            s={{ kind: "bot" }}
            title={BOT_NAME}
            preview={previews.bot?.preview ?? "智能助手"}
            avatar="bot"
          />
          {filteredMembers.length > 0 && (
            <p className="px-3 pt-3 pb-1 text-[11px] font-medium text-gray-500 uppercase tracking-wide">
              私聊
            </p>
          )}
          {filteredMembers.map((m) => {
            const key = `direct:${m.user_id}`;
            const p = previews[key];
            return (
              <SessionItem
                key={m.user_id}
                s={{ kind: "direct", userId: m.user_id }}
                title={m.displayName}
                preview={p?.preview ?? "点击发消息"}
                time={p?.time}
              />
            );
          })}
        </div>
        {canModerateMembers && (
          <div className="shrink-0 border-t border-gray-300/60 p-2">
            <button
              type="button"
              onClick={onOpenMembers}
              className="w-full rounded-md py-2 text-xs font-medium text-gray-700 hover:bg-[#d9d9d9]"
            >
              群成员管理
            </button>
          </div>
        )}
      </aside>
      <main
        className={`flex-1 min-w-0 flex flex-col min-h-0 ${
          mobilePanel === "list" ? "hidden md:flex" : "flex w-full"
        }`}
      >
        {renderPanel()}
      </main>
    </div>
  );
}
