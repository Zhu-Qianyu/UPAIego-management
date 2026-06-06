/** Calendar date YYYY-MM-DD in Asia/Shanghai. */
export function shanghaiDateString(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function parseShanghaiMidnight(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+08:00`);
}

/** ISO weekday in Shanghai: 0 = Monday … 6 = Sunday. */
function shanghaiWeekdayIndex(dateStr: string): number {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
  }).format(parseShanghaiMidnight(dateStr));
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[label] ?? 0;
}

function shiftShanghaiDate(dateStr: string, days: number): string {
  const d = parseShanghaiMidnight(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return shanghaiDateString(d);
}

export interface ShanghaiPeriodStarts {
  week: Date;
  month: Date;
  year: Date;
}

/** Inclusive lower bounds (UTC instants) for week / month / year in Asia/Shanghai. */
export function shanghaiPeriodStarts(now = new Date()): ShanghaiPeriodStarts {
  const today = shanghaiDateString(now);
  const weekday = shanghaiWeekdayIndex(today);
  const weekStr = shiftShanghaiDate(today, -weekday);
  const [y, m] = today.split("-").map(Number);
  const monthStr = `${y}-${String(m).padStart(2, "0")}-01`;
  const yearStr = `${y}-01-01`;
  return {
    week: parseShanghaiMidnight(weekStr),
    month: parseShanghaiMidnight(monthStr),
    year: parseShanghaiMidnight(yearStr),
  };
}

export function isOnOrAfter(iso: string, start: Date): boolean {
  return new Date(iso).getTime() >= start.getTime();
}
