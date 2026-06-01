import { useAuth } from "../auth/AuthContext";
import Spinner from "../components/Spinner";
import BountyAdminPage from "./BountyAdminPage";
import BountyExecutorPage from "./BountyExecutorPage";

/** Role-based shell for /bounties — admin vs collection_executor views. */
export default function BountyPage() {
  const { profile, loading } = useAuth();

  if (loading || !profile) {
    return (
      <div className="py-16 flex justify-center">
        <Spinner />
      </div>
    );
  }

  if (profile.role === "admin") return <BountyAdminPage />;
  if (profile.role === "collection_executor") return <BountyExecutorPage />;

  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center text-gray-600 text-sm">
      当前角色无法访问悬赏令模块。
    </div>
  );
}
