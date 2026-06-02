import { useEffect, useState } from "react";

const TICK_MS = 1000;
let nowMs = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<(next: number) => void>();

function startClock() {
  if (timer !== null) return;
  timer = setInterval(() => {
    nowMs = Date.now();
    for (const listener of listeners) listener(nowMs);
  }, TICK_MS);
}

function stopClock() {
  if (listeners.size > 0 || timer === null) return;
  clearInterval(timer);
  timer = null;
}

/** 全站共享 1s 时钟，避免多页面各自 setInterval。 */
export function useNowMs(): number {
  const [value, setValue] = useState(nowMs);

  useEffect(() => {
    setValue(nowMs);
    listeners.add(setValue);
    startClock();
    return () => {
      listeners.delete(setValue);
      stopClock();
    };
  }, []);

  return value;
}

/** 立即刷新共享时钟（例如手动刷新设备在线状态后）。 */
export function bumpNowMs(): void {
  nowMs = Date.now();
  for (const listener of listeners) listener(nowMs);
}
