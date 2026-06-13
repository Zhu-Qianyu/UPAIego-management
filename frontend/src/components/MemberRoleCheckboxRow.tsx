import { ROLE_LABELS } from "../auth/roleLabels";
import { sortRolesByPriority } from "../auth/roleUtils";
import type { UserRole } from "../types/roles";
import { NON_ADMIN_ROLES } from "../types/roles";

export const EDITABLE_MEMBER_ROLES: UserRole[] = [...NON_ADMIN_ROLES];

export default function MemberRoleCheckboxRow({
  roles,
  onChange,
  disabled,
}: {
  roles: UserRole[];
  onChange: (next: UserRole[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {EDITABLE_MEMBER_ROLES.map((r) => {
        const checked = roles.includes(r);
        return (
          <label
            key={r}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${
              disabled
                ? "cursor-not-allowed border-gray-100 bg-gray-50 text-gray-400"
                : checked
                  ? "cursor-pointer border-indigo-400 bg-indigo-50 text-indigo-900"
                  : "cursor-pointer border-gray-200 text-gray-600"
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              className="sr-only"
              onChange={() => {
                if (disabled) return;
                if (checked) {
                  const next = roles.filter((x) => x !== r);
                  if (next.length) onChange(sortRolesByPriority(next));
                } else {
                  onChange(sortRolesByPriority([...roles, r]));
                }
              }}
            />
            {ROLE_LABELS[r]}
          </label>
        );
      })}
    </div>
  );
}
