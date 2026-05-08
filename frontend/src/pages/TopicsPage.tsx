import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createGroupTopic,
  deleteGroupTopic,
  fetchActiveGroupId,
  listGroupTopics,
  type GroupTopic,
} from "../api/groups";
import Spinner from "../components/Spinner";
import { useAuth } from "../auth/AuthContext";

export default function TopicsPage() {
  const { profile, session } = useAuth();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [topics, setTopics] = useState<GroupTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const gid = await fetchActiveGroupId();
      setGroupId(gid);
      if (!gid) {
        setTopics([]);
        return;
      }
      const t = await listGroupTopics(gid);
      setTopics(t);
    } catch (e: any) {
      setErr(e.message ?? "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId) return;
    setErr("");
    try {
      await createGroupTopic(groupId, title, body);
      setTitle("");
      setBody("");
      await load();
    } catch (e: any) {
      setErr(e.message ?? "发布失败");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("删除该话题？")) return;
    try {
      await deleteGroupTopic(id);
      await load();
    } catch (e: any) {
      setErr(e.message ?? "删除失败");
    }
  }

  if (loading) return <Spinner />;

  if (!groupId) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <p className="text-gray-600 mb-4">你还没有加入任何已审批的群组，暂时无法查看话题。</p>
        <Link to="/join" className="text-indigo-600 font-medium hover:underline">
          去申请入群
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">本群话题</h1>
        <p className="text-sm text-gray-500 mt-1">仅本群组已激活成员可见与发布。</p>
      </div>

      <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-indigo-100 p-6 shadow-sm space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">发布话题</h2>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="正文（可选）"
          rows={4}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">
          发布
        </button>
      </form>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-700">话题列表</h2>
        {topics.length === 0 ? (
          <p className="text-gray-400 text-sm">暂无话题</p>
        ) : (
          <ul className="space-y-3">
            {topics.map((t) => (
              <li key={t.id} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">{t.title}</p>
                    {t.body && <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{t.body}</p>}
                    <p className="text-xs text-gray-400 mt-2">
                      {new Date(t.created_at).toLocaleString()}
                    </p>
                  </div>
                  {(profile?.role === "admin" || session?.user?.id === t.created_by) && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(t.id)}
                      className="text-xs text-red-600 shrink-0 h-fit"
                    >
                      删除
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
