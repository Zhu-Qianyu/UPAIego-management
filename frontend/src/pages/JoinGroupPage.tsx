import { useState } from "react";
import { Link } from "react-router-dom";
import { submitJoinRequest } from "../api/groups";

export default function JoinGroupPage() {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setMsg("");
    setBusy(true);
    try {
      await submitJoinRequest(code);
      setMsg("申请已提交，请等待该群管理员审批。");
      setCode("");
    } catch (e: any) {
      setErr(e.message ?? "提交失败，请检查入群代码。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">申请加入工作群组</h1>
      <p className="text-sm text-gray-500 mb-6">
        向管理员索取<strong>入群代码</strong>（创建群组后显示在「群组管理」里）。提交后状态为「待审批」。
      </p>
      <form onSubmit={onSubmit} className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-6 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">入群代码</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="例如：A1B2C3D4"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono tracking-wide uppercase"
            required
          />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {msg && <p className="text-sm text-green-600">{msg}</p>}
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {busy ? "提交中..." : "提交申请"}
        </button>
        <p className="text-xs text-gray-400 text-center">
          <Link to="/" className="text-indigo-600 hover:underline">
            返回首页
          </Link>
        </p>
      </form>
    </div>
  );
}
