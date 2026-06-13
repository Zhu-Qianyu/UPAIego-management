import { useAuth } from "../auth/AuthContext";
import Spinner from "../components/Spinner";
import BountyAdminPage from "./BountyAdminPage";
import BountyExecutorPage from "./BountyExecutorPage";

/** Role-based shell for /bounties — 仅管理员可发布；数采执行员接单。 */
export default function BountyPage() {
  const { profile, loading, hasRole: userHasRole } = useAuth();

  if (loading || !profile) {
    return (
      <div className="py-16 flex justify-center">
        <Spinner />
      </div>
    );
  }

  if (userHasRole("admin")) return <BountyAdminPage />;
  if (userHasRole("collection_executor")) return <BountyExecutorPage />;

  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center text-gray-600 text-sm">
      悬赏令由平台管理员发布；数采执行员可在此接单。当前账号无相关职能。
    </div>
  );
}
