import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOSE_DELAY_MS,
  LIVE_INVALIDATES,
  LIVE_POLL_MS,
  livePollMs,
  retryDelayMs,
  resetLive,
  STREAM_URL,
  subscribeLive,
  useLive,
} from "./live";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  readyState = 0;
  onerror: ((e: Event) => void) | null = null;
  private listeners = new Map<string, Set<() => void>>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }
  emit(type: string) {
    this.listeners.get(type)?.forEach((fn) => fn());
  }
  close() {
    this.closed = true;
  }
}

const last = () => FakeEventSource.instances.at(-1);

describe("live (SSE)", () => {
  beforeEach(() => {
    resetLive();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("oʻchiq boʻlsa ulanmaydi", () => {
    renderHook(() => useLive(["orders"], () => {}, false));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("bir nechta obunachi — bitta ulanish; oxirgisi ketganda kechikib yopiladi", () => {
    vi.useFakeTimers();
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeLive("orders", a);
    const offB = subscribeLive("notifications", b);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(last()?.url).toBe(STREAM_URL);

    last()?.emit("orders");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();

    offA();
    expect(last()?.closed).toBe(false);
    offB();
    expect(last()?.closed).toBe(false);
    vi.advanceTimersByTime(CLOSE_DELAY_MS);
    expect(last()?.closed).toBe(true);
  });

  it("sahifa almashganda (darhol qayta obuna) ulanish saqlanadi", () => {
    vi.useFakeTimers();
    const off = subscribeLive("orders", () => {});
    off();
    const again = subscribeLive("orders", () => {});
    vi.advanceTimersByTime(CLOSE_DELAY_MS * 2);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(last()?.closed).toBe(false);
    again();
  });

  it("proksi xatosi (CLOSED) — backoff bilan qayta ochiladi; CONNECTING — brauzerga qoldiriladi", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const off = subscribeLive("orders", () => {});
    const first = last();
    act(() => first?.onerror?.(new Event("error")));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(first?.closed).toBe(false);
    if (first) first.readyState = 2;
    act(() => first?.onerror?.(new Event("error")));
    expect(first?.closed).toBe(true);
    act(() => void vi.advanceTimersByTime(4_999));
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(FakeEventSource.instances).toHaveLength(2);
    const second = last();
    if (second) second.readyState = 2;
    act(() => second?.onerror?.(new Event("error")));
    act(() => void vi.advanceTimersByTime(9_999));
    expect(FakeEventSource.instances).toHaveLength(2);
    act(() => void vi.advanceTimersByTime(1));
    expect(FakeEventSource.instances).toHaveLength(3);
    off();
    vi.restoreAllMocks();
  });

  it("obunachi ketsa qayta ulanish bekor qilinadi", () => {
    vi.useFakeTimers();
    const off = subscribeLive("orders", () => {});
    const es = last();
    if (es) es.readyState = 2;
    act(() => es?.onerror?.(new Event("error")));
    off();
    act(() => void vi.advanceTimersByTime(120_000));
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("ready — ulandi va hammasi yangilanadi; xato — ulanmagan; hodisa — oxirgi callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender, unmount } = renderHook(({ cb }) => useLive(["orders", "trips"], cb), {
      initialProps: { cb: first },
    });
    expect(result.current).toBe(false);

    act(() => last()?.emit("ready"));
    expect(result.current).toBe(true);
    expect(first).toHaveBeenCalled();

    rerender({ cb: second });
    act(() => last()?.emit("trips"));
    expect(second).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => last()?.onerror?.(new Event("error")));
    expect(result.current).toBe(false);

    unmount();
  });
});

describe("livePollMs (TZ3)", () => {
  it("SSE ulangan — zaxira oraligʻi, ulanmagan — sahifa oraligʻi", () => {
    expect(livePollMs(true, 15_000)).toBe(LIVE_POLL_MS);
    expect(livePollMs(false, 15_000)).toBe(15_000);
    expect(livePollMs(true, 600_000)).toBe(600_000);
  });

  it("useLivePoll ishlatadigan soʻrov kalitlari hodisa bilan yangilanadi", () => {
    const all = Object.values(LIVE_INVALIDATES)
      .flat()
      .map((k) => k.join("/"));
    for (const k of ["marking/queue", "orders/returns", "nav-badges", "trips/cash"]) expect(all).toContain(k);
  });
});

describe("retryDelayMs (TZ3)", () => {
  it("5 → 10 → 20 → 40 → 60 s chegarasi, ±20 %", () => {
    const mid = () => 0.5;
    expect([0, 1, 2, 3, 4, 9].map((a) => retryDelayMs(a, mid))).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    expect(retryDelayMs(0, () => 0)).toBe(4_000);
    expect(retryDelayMs(0, () => 1)).toBe(6_000);
  });
});
