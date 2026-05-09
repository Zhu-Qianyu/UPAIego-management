import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import Register from "./Register";
import Search from "./Search";
import Dashboard from "./Dashboard";
import { useAuth } from "../auth/AuthContext";

type Tab = "register" | "search" | "fleet";

export default function DeviceManagePage() {
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");

  const tab: Tab =
    tabParam === "search"
      ? "search"
      : tabParam === "fleet" && profile?.role === "admin"
        ? "fleet"
        : "register";

  useEffect(() => {
    if (tabParam === "fleet" && profile?.role !== "admin") {
      setSearchParams({}, { replace: true });
    }
  }, [tabParam, profile?.role, setSearchParams]);

  useEffect(() => {
    if (tabParam === "offline") {
      setSearchParams({}, { replace: true });
    }
  }, [tabParam, setSearchParams]);

  const setTab = useCallback(
    (next: Tab) => {
      if (next === "register") setSearchParams({}, { replace: true });
      else if (next === "search") setSearchParams({ tab: "search" }, { replace: true });
      else setSearchParams({ tab: "fleet" }, { replace: true });
    },
    [setSearchParams]
  );

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">设备管理</h1>
      <p className="text-sm text-gray-500 mb-6">
        <strong>注册设备</strong>页包含在线注册与<strong>无心跳离线登记</strong>；<strong>搜索</strong>支持按设备 ID、登记编号等查找两类设备；管理员可在此查看<strong>全量在线设备</strong>。
      </p>

      <div
        className="flex gap-1 p-1 mb-6 w-fit max-w-full flex-wrap rounded-xl bg-gray-100/90 ring-1 ring-gray-200/80"
        role="tablist"
        aria-label="设备管理"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "register"}
          id="tab-register"
          onClick={() => setTab("register")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "register"
              ? "bg-white text-indigo-800 shadow-sm ring-1 ring-indigo-100"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          注册设备
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "search"}
          id="tab-search"
          onClick={() => setTab("search")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "search"
              ? "bg-white text-indigo-800 shadow-sm ring-1 ring-indigo-100"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          搜索设备
        </button>
        {profile?.role === "admin" && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "fleet"}
            id="tab-fleet"
            onClick={() => setTab("fleet")}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === "fleet"
                ? "bg-white text-indigo-800 shadow-sm ring-1 ring-indigo-100"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            全量设备
          </button>
        )}
      </div>

      <section
        role="tabpanel"
        aria-labelledby={`tab-${tab === "fleet" ? "fleet" : tab === "search" ? "search" : "register"}`}
      >
        {tab === "register" && <Register embedded />}
        {tab === "search" && <Search embedded />}
        {tab === "fleet" && profile?.role === "admin" && <Dashboard listScopeOverride="fleet" />}
      </section>
    </div>
  );
}
