import type { Middleware } from "openapi-fetch";
import type { components } from "./api/schema";

/**
 * TZ1 (tezlik oʻlchovi): brauzer koʻrgan sekin API soʻrovlari (tarmoq + rewrite + server) va yomon Web Vitals backend logiga
 * («slow-client») yuboriladi — server vaqti («slow-request») bilan solishtirib, sekinlik qayerdaligi koʻriladi.
 * Faqat yoʻl (soʻrov satrisiz) va ms; navbat ≤ {@link MAX_QUEUE}, har {@link FLUSH_MS} da yoki varaq yashirilganda bir yuborish.
 */
export type TimingEntry = components["schemas"]["TimingEntry"];

export const SLOW_API_MS = 1_000;
export const FLUSH_MS = 15_000;
export const MAX_QUEUE = 20;
const SKIP = ["/api/telemetry/", "/api/notifications/stream"];

type Sender = (entries: TimingEntry[]) => Promise<unknown>;

let queue: TimingEntry[] = [];
let sender: Sender | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const started = new Map<string, number>();

function page(): string | null {
  return typeof location === "undefined" ? null : location.pathname;
}

/** Sekin API qaydi (yoki null): yoʻl soʻrov satrisiz, telemetriya va SSE oʻtkaziladi. */
export function apiEntry(method: string, url: string, ms: number, status: number | null, currentPage: string | null): TimingEntry | null {
  if (ms < SLOW_API_MS) return null;
  let path: string;
  try {
    path = new URL(url, "http://x").pathname;
  } catch {
    return null;
  }
  if (!path.startsWith("/api/") || SKIP.some((s) => path.startsWith(s))) return null;
  return {
    kind: "api",
    name: `${method.toUpperCase()} ${path}`,
    ms: Math.round(ms),
    status: status ?? undefined,
    page: currentPage ?? undefined,
  };
}

/** Web Vitals: faqat «yaxshi» boʻlmaganlari; CLS birliksiz — ×1000. */
export function vitalEntry(
  metric: { name: string; value: number; rating?: "good" | "needs-improvement" | "poor" },
  currentPage: string | null,
): TimingEntry | null {
  if (!metric.rating || metric.rating === "good") return null;
  const ms = metric.name === "CLS" ? metric.value * 1000 : metric.value;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return { kind: "vital", name: metric.name, ms: Math.round(ms), page: currentPage ?? undefined };
}

export function record(entry: TimingEntry | null) {
  if (!entry || queue.length >= MAX_QUEUE) return;
  queue.push(entry);
  if (sender && !timer) timer = setTimeout(flush, FLUSH_MS);
}

export function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!sender || queue.length === 0) return;
  const batch = queue;
  queue = [];
  void sender(batch).catch(() => undefined);
}

/** Yuboruvchi oʻrnatiladi (tizimga kirgandan keyin); qaytaradi — bekor qilish. */
export function setTelemetrySender(send: Sender | null): () => void {
  sender = send;
  if (send && queue.length && !timer) timer = setTimeout(flush, FLUSH_MS);
  return () => {
    if (sender === send) {
      flush();
      sender = null;
    }
  };
}

/** openapi-fetch: har soʻrov vaqti oʻlchanadi, sekinlari navbatga. */
export const timingMiddleware: Middleware = {
  onRequest({ id }) {
    started.set(id, performance.now());
    return undefined;
  },
  onResponse({ id, request, response }) {
    const t0 = started.get(id);
    started.delete(id);
    if (t0 !== undefined) record(apiEntry(request.method, request.url, performance.now() - t0, response.status, page()));
    return undefined;
  },
  onError({ id }) {
    started.delete(id);
    return undefined;
  },
};

export function currentPage(): string | null {
  return page();
}

/** Testlar uchun. */
export function resetTelemetry() {
  if (timer) clearTimeout(timer);
  timer = null;
  queue = [];
  sender = null;
  started.clear();
}

export function pendingTelemetry(): readonly TimingEntry[] {
  return queue;
}
