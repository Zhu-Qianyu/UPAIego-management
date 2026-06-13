import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import ManualDevicesTab from "./ManualDevicesTab";
import Search from "./Search";
import { useAuth } from "../auth/AuthContext";

type Tab = "devices" | "search" | "fleet";

export default function DeviceManagePage() {
  const { hasRole } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");

  const tab: Tab =
    tabParam === "search"
      ? "search"
      : tabParam === "fleet" && hasRole("admin")
        ? "fleet"
        : "devices";

  useEffect(() => {
    if (tabParam === "fleet" && !hasRole("admin")) {
      setSearchParams({}, { replace: true });
    }
  }, [tabParam, hasRole, setSearchParams]);

  useEffect(() => {
    if (tabParam === "register" || tabParam === "offline") {
      setSearchParams({}, { replace: true });
    }
  }, [tabParam, setSearchParams]);

  const setTab = useCallback(
    (next: Tab) => {
      if (next === "devices") setSearchParams({}, { replace: true });
      else if (next === "search") setSearchParams({ tab: "search" }, { replace: true });
      else setSearchParams({ tab: "fleet" }, { replace: true });
    },
    [setSearchParams]
  );

  return (
    <div className="w-full min-w-0">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">设备管理</h1>
      <p className="text-sm text-gray-500 mb-6">
        登记与管理本工作群设备：按<strong>甲方业务</strong>分类，系统分配<strong>登记编号与二维码</strong>；设备类型为<strong>甲方公司名 + 设备简称</strong>。
      </p>

      <div
        className="flex gap-1 p-1 mb-6 w-fit max-w-full flex-wrap rounded-xl bg-gray-100/90 ring-1 ring-gray-200/80"
        role="tablist"
        aria-label="设备管理"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "devices"}
          id="tab-devices"
          onClick={() => setTab("devices")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === "devices"
              ? "bg-white text-indigo-800 shadow-sm ring-1 ring-indigo-100"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          设备列表
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
          搜索
        </button>
        {hasRole("admin") && (
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
        className="w-full min-w-0"
        aria-labelledby={`tab-${tab}`}
      >
        {tab === "devices" && <ManualDevicesTab />}
        {tab === "search" && <Search embedded />}
        {tab === "fleet" && hasRole("admin") && <ManualDevicesTab fleetMode />}
      </section>
    </div>
  );
}
