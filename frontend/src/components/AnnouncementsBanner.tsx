import { useEffect, useState } from "react";
import { listAdminMessages, type AdminMessageRow } from "../api/adminContent";

export default function AnnouncementsBanner() {
  const [items, setItems] = useState<AdminMessageRow[]>([]);

  useEffect(() => {
    listAdminMessages(5)
      .then(setItems)
      .catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="mb-6 space-y-2">
      {items.map((m) => (
        <div
          key={m.id}
          className="rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 shadow-sm"
        >
          <p className="font-semibold text-amber-900">{m.title}</p>
          <p className="text-amber-900/80 mt-1 whitespace-pre-wrap">{m.body}</p>
          <p className="text-xs text-amber-700/70 mt-2">
            {new Date(m.created_at).toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}
