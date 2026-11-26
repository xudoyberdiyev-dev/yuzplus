import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiEntry,
  FLUSH_MS,
  flush,
  MAX_QUEUE,
  pendingTelemetry,
  record,
  resetTelemetry,
  setTelemetrySender,
  vitalEntry,
} from "./telemetry";
import type { TimingEntry } from "./telemetry";

describe("telemetry (TZ1)", () => {
  beforeEach(() => resetTelemetry());
  afterEach(() => vi.useRealTimers());

  it("faqat sekin API soʻrovlari; soʻrov satrisiz; telemetriya va SSE oʻtkaziladi", () => {
    expect(apiEntry("get", "http://h/api/orders/5?q=aspirin", 1_234.6, 200, "/orders/5")).toEqual({
      kind: "api",
      name: "GET /api/orders/5",
      ms: 1235,
      status: 200,
      page: "/orders/5",
    });
    expect(apiEntry("GET", "/api/orders", 999, 200, null)).toBeNull();
    expect(apiEntry("POST", "/api/telemetry/timings", 5_000, 204, null)).toBeNull();
    expect(apiEntry("GET", "/api/notifications/stream", 5_000, 200, null)).toBeNull();
    expect(apiEntry("GET", "/_next/static/x.js", 5_000, 200, null)).toBeNull();
  });

  it("Web Vitals: «good» yuborilmaydi, CLS ×1000", () => {
    expect(vitalEntry({ name: "LCP", value: 1_800, rating: "good" }, "/")).toBeNull();
    expect(vitalEntry({ name: "LCP", value: 4_100.4, rating: "poor" }, "/")).toMatchObject({ kind: "vital", name: "LCP", ms: 4100 });
    expect(vitalEntry({ name: "CLS", value: 0.27, rating: "needs-improvement" }, "/")).toMatchObject({ ms: 270 });
  });

  it("navbat chegaralangan; yuboruvchi boʻlmasa kutadi, boʻlsa FLUSH_MS dan keyin bitta yuborish", async () => {
    vi.useFakeTimers();
    for (let i = 0; i < MAX_QUEUE + 5; i++) record(apiEntry("GET", `/api/x/${i}`, 2_000, 200, null));
    expect(pendingTelemetry()).toHaveLength(MAX_QUEUE);
    const send = vi.fn<(entries: TimingEntry[]) => Promise<void>>(() => Promise.resolve());
    const off = setTelemetrySender(send);
    vi.advanceTimersByTime(FLUSH_MS - 1);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toHaveLength(MAX_QUEUE);
    expect(pendingTelemetry()).toHaveLength(0);
    record(vitalEntry({ name: "INP", value: 600, rating: "poor" }, null));
    off();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("yuborish xatosi jim yutiladi", async () => {
    const send = vi.fn<(entries: TimingEntry[]) => Promise<void>>(() => Promise.reject(new Error("401")));
    setTelemetrySender(send);
    record(apiEntry("GET", "/api/x", 2_000, 500, null));
    expect(() => flush()).not.toThrow();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
