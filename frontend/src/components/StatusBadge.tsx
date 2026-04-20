const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  inactive: "bg-gray-100 text-gray-800",
  maintenance: "bg-yellow-100 text-yellow-800",
  retired: "bg-red-100 text-red-800",
  pending: "bg-orange-100 text-orange-800",
  calibrated: "bg-blue-100 text-blue-800",
  needs_recalibration: "bg-rose-100 text-rose-800",
};

export default function StatusBadge({ value }: { value: string }) {
  const color = statusColors[value] ?? "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${color}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}
