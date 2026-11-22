import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coalesceLive } from "./live";

describe("coalesceLive", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("bir oraliqdagi hodisalarni bitta yangilanishga birlashtiradi", () => {
    const run = vi.fn();
    const c = coalesceLive(run, { delayMs: 1000, jitterMs: 1000, random: () => 0.5, hidden: () => false });
    c.trigger();
    c.trigger();
    vi.advanceTimersByTime(1000);
    c.trigger();
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(1);
    c.trigger();
    vi.advanceTimersByTime(1500);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("yashirin varaqda kutadi va koʻrinadigan boʻlganda bir marta yangilaydi", () => {
    const run = vi.fn();
    let hidden = true;
    const c = coalesceLive(run, { delayMs: 100, jitterMs: 0, hidden: () => hidden });
    c.trigger();
    c.trigger();
    vi.advanceTimersByTime(10_000);
    expect(run).not.toHaveBeenCalled();
    c.visible(); // hali yashirin
    vi.advanceTimersByTime(1000);
    expect(run).not.toHaveBeenCalled();
    hidden = false;
    c.visible();
    c.visible();
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
    c.visible(); // kutayotgan hodisa yoʻq
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("oraliq davomida varaq yashirilsa — yangilanish koʻrinishgacha qoldiriladi; cancel tozalaydi", () => {
    const run = vi.fn();
    let hidden = false;
    const c = coalesceLive(run, { delayMs: 100, jitterMs: 0, hidden: () => hidden });
    c.trigger();
    hidden = true;
    vi.advanceTimersByTime(100);
    expect(run).not.toHaveBeenCalled();
    hidden = false;
    c.visible();
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
    c.trigger();
    c.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
