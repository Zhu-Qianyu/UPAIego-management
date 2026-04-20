import { useState } from "react";
import { supabase } from "../api/supabase";

type Mode = "login" | "register";

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      if (mode === "register") {
        const { error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) throw signUpError;

        setMessage("注册成功，现在可以使用该账号登录。");
        setMode("login");
        setPassword("");
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
    } catch (err: any) {
      setError(err.message ?? "认证失败，请检查邮箱和密码。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-white to-violet-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white/95 backdrop-blur rounded-2xl shadow-xl border border-indigo-100 p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">UPAIego 设备管理</h1>
        <p className="text-sm text-gray-500 mb-6">
          {mode === "login" ? "登录后即可查看你账号下的设备。" : "注册账号后即可管理你自己的设备数据。"}
        </p>

        <div className="grid grid-cols-2 gap-2 bg-gray-100 rounded-lg p-1 mb-5">
          <button
            type="button"
            onClick={() => setMode("login")}
            className={`py-2 text-sm rounded-md ${
              mode === "login" ? "bg-white text-indigo-600 font-medium shadow-sm" : "text-gray-600"
            }`}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => setMode("register")}
            className={`py-2 text-sm rounded-md ${
              mode === "register" ? "bg-white text-indigo-600 font-medium shadow-sm" : "text-gray-600"
            }`}
          >
            注册
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">邮箱</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="请输入邮箱"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">密码</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="至少 6 位"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-green-600">{message}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "请稍候..." : mode === "login" ? "登录" : "创建账号"}
          </button>
        </form>
      </div>
    </div>
  );
}
