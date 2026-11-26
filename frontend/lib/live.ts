"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Real vaqt signallari (SPEC 10, SSE): bitta varaqda bitta `EventSource` — `/api/notifications/stream`.
 * Hodisalar: «notifications» (oʻz bildirishnomalari), «messages» (ichki xabarlar), «orders», «trips», «receipts» (shu filialda hujjat oʻzgardi).
 * Signalda maʼlumot yoʻq — sahifa oʻz soʻrovini qayta bajaradi. Ulanish uzilsa brauzer oʻzi qayta ulanadi;
 * qayta ulanganda («ready») barcha obunachilar chaqiriladi — uzilish paytida oʻtkazib yuborilganlar ham koʻrinsin.
 */
export const STREAM_URL = "/api/notifications/stream";
export type LiveEvent = "notifications" | "orders" | "trips" | "receipts" | "transfers" | "messages";

/** SSE ulangan boʻlsa soʻrov faqat zaxira; ulanmagan boʻlsa — sahifaning odatdagi oraligʻi. */
export const LIVE_POLL_MS = 300_000;

type Handler = () => void;

const handlers = new Map<LiveEvent, Set<Handler>>();
const statusListeners = new Set<() => void>();
let source: EventSource | null = null;
let connected = false;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
/** Sahifa almashganda TopBar qayta yaratiladi — ulanish darhol yopilmaydi, yangi sahifa shu ulanishni oladi. */
export const CLOSE_DELAY_MS = 3_000;

function setConnected(v: boolean) {
  if (connected === v) return;
  connected = v;
  statusListeners.forEach((l) => l());
}

function fire(event: LiveEvent) {
  handlers.get(event)?.forEach((h) => h());
}

function open() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (source || typeof EventSource === "undefined") return;
  const es = new EventSource(STREAM_URL, { withCredentials: true });
  source = es;
  es.addEventListener("ready", () => {
    setConnected(true);
    handlers.forEach((set) => set.forEach((h) => h()));
  });
  for (const ev of ["notifications", "orders", "trips", "receipts", "transfers", "messages"] as const) {
    es.addEventListener(ev, () => fire(ev));
  }
  es.onerror = () => setConnected(false);
}

function idle(): boolean {
  for (const set of handlers.values()) if (set.size > 0) return false;
  return true;
}

function closeIfIdle() {
  if (!idle() || closeTimer) return;
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (!idle()) return;
    source?.close();
    source = null;
    setConnected(false);
  }, CLOSE_DELAY_MS);
}

/** Hodisaga obuna; qaytaradi — obunani bekor qilish. Oxirgi obunachi ketganda ulanish yopiladi. */
export function subscribeLive(event: LiveEvent, handler: Handler): () => void {
  let set = handlers.get(event);
  if (!set) handlers.set(event, (set = new Set()));
  set.add(handler);
  open();
  return () => {
    set.delete(handler);
    closeIfIdle();
  };
}

/** Testlar uchun: holatni tozalash. */
export function resetLive() {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  handlers.clear();
  source?.close();
  source = null;
  connected = false;
}

function subscribeStatus(l: () => void) {
  statusListeners.add(l);
  return () => void statusListeners.delete(l);
}

/**
 * Bir yoki bir nechta hodisaga obuna (masalan, `useLive(["orders"], () => q.refetch())`).
 * Qaytaradi: SSE ulanganmi — soʻrov oraligʻini kattalashtirish uchun (`refetchInterval: live ? LIVE_POLL_MS : 10_000`).
 */
export function useLive(events: readonly LiveEvent[], onEvent: () => void, enabled = true): boolean {
  const cb = useRef(onEvent);
  useEffect(() => {
    cb.current = onEvent;
  }, [onEvent]);
  const key = events.join(",");
  useEffect(() => {
    if (!enabled) return;
    const handler = () => cb.current();
    const offs = (key.split(",") as LiveEvent[]).map((e) => subscribeLive(e, handler));
    return () => offs.forEach((off) => off());
  }, [key, enabled]);
  const live = useSyncExternalStore(
    subscribeStatus,
    () => connected,
    () => false,
  );
  return enabled && live;
}

/** SSE ulanganmi (obuna boʻlmasdan) — sahifa soʻrov oraligʻini kattalashtirishi uchun. */
export function useLiveConnected(): boolean {
  return useSyncExternalStore(
    subscribeStatus,
    () => connected,
    () => false,
  );
}

/**
 * TZ3: soʻrov oraligʻi — SSE ulangan boʻlsa zaxira (`LIVE_POLL_MS`), aks holda sahifaning odatdagi oraligʻi.
 * Faqat kaliti `LIVE_INVALIDATES` da bor soʻrovlar uchun (ulanganda ular hodisa bilan yangilanadi).
 */
export function livePollMs(live: boolean, fallbackMs: number): number {
  return live ? Math.max(LIVE_POLL_MS, fallbackMs) : fallbackMs;
}

export function useLivePoll(fallbackMs: number): number {
  return livePollMs(useLiveConnected(), fallbackMs);
}

/**
 * Hodisa → yangilanadigan roʻyxatlar (faqat roʻyxat/panel soʻrovlari; ochiq kartochka va tahrir oynalari tegilmaydi —
 * kiritilayotgan maʼlumot yoʻqolmasin). TanStack Query faqat ekrandagi soʻrovlarni qayta oladi.
 */
export const LIVE_INVALIDATES: Record<Exclude<LiveEvent, "notifications">, readonly (readonly string[])[]> = {
  messages: [["messages"]],
  orders: [
    ["orders", "list"],
    ["orders", "monitor"],
    ["orders", "pick-queue"],
    ["orders", "returns"],
    ["marking", "queue"],
    ["trips", "ready"],
    ["nav-badges"],
  ],
  trips: [
    ["trips", "list"],
    ["trips", "ready"],
    ["trips", "mine"],
    ["trips", "cash"],
    ["orders", "monitor"],
  ],
  receipts: [["receipts", "list"]],
  transfers: [
    ["warehouse-transfers", "list"],
    ["zone-transfers", "list"],
  ],
};

/** S1: bir xil hodisalar shu oraliqda bitta yangilanishga birlashadi (kuniga minglab holat oʻzgarishi — har biriga soʻrov emas). */
export const LIVE_COALESCE_MS = 1_000;
/** S1: tasodifiy kechikish — barcha ochiq oynalar bir soniyada birdan soʻrov yubormasin («podaning yugurishi»). */
export const LIVE_JITTER_MS = 1_500;

export interface LiveCoalescer {
  /** Hodisa keldi: yashirin varaqda — kutadi; aks holda oraliq tugagach bir marta `run`. */
  trigger(): void;
  /** Varaq koʻrinadigan boʻldi — yashirin paytda kelgan hodisa boʻlsa, yangilanadi. */
  visible(): void;
  cancel(): void;
}

/**
 * Hodisalarni birlashtirish: birinchi hodisadan `delay + random × jitter` ms keyin bitta `run` (oraliqdagi qolganlari shunga
 * qoʻshiladi — eng koʻp kechikish chegaralangan). Yashirin varaqda soʻrov yuborilmaydi — koʻrinadigan boʻlganda bir marta.
 */
export function coalesceLive(
  run: () => void,
  opts: { delayMs?: number; jitterMs?: number; random?: () => number; hidden?: () => boolean } = {},
): LiveCoalescer {
  const delayMs = opts.delayMs ?? LIVE_COALESCE_MS;
  const jitterMs = opts.jitterMs ?? LIVE_JITTER_MS;
  const random = opts.random ?? Math.random;
  const hidden = opts.hidden ?? (() => typeof document !== "undefined" && document.visibilityState === "hidden");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(
      () => {
        timer = null;
        if (hidden()) {
          pending = true;
          return;
        }
        run();
      },
      delayMs + Math.round(random() * jitterMs),
    );
  };
  return {
    trigger() {
      if (hidden()) {
        pending = true;
        return;
      }
      schedule();
    },
    visible() {
      if (!pending || hidden()) return;
      pending = false;
      schedule();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = false;
    },
  };
}
