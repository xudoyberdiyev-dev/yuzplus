"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Egasi qarori (24.11.2026 01:00): dastur 24.11 soat 12:00 gacha «uyqu rejimida» — butun ekran
 * (login ham) animatsiyali banner bilan yopiladi, hech qanday maʼlumot qabul qilinmaydi.
 * SLEEP_UNTIL dan keyin oʻzi ochiladi. Keyingi safar: vaqtni oʻzgartiring yoki null qiling.
 */
export const SLEEP_UNTIL: string | null = null; // egasi 24.11 11:11: muddatidan oldin olib tashlandi

export function sleepLeftMs(now: number, until: string | null = SLEEP_UNTIL): number {
  if (until === null) return 0;
  return Math.max(0, Date.parse(until) - now);
}

export function formatLeft(ms: number): string {
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export function SleepGate({ children }: { children: ReactNode }) {
  const [left, setLeft] = useState(0);

  useEffect(() => {
    // Avtomatik testlar (Playwright: navigator.webdriver) yopilmaydi.
    if (navigator.webdriver) return;
    const tick = () => setLeft(sleepLeftMs(Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const asleep = left > 0;
  return (
    <>
      <div inert={asleep} aria-hidden={asleep || undefined} className="contents">
        {children}
      </div>
      {asleep ? <SleepScreen left={left} /> : null}
    </>
  );
}

const STARS = [
  [8, 14, 0],
  [22, 70, 0.6],
  [80, 20, 1.1],
  [90, 62, 0.3],
  [60, 8, 1.7],
  [35, 88, 0.9],
  [48, 30, 2.1],
  [12, 45, 1.4],
] as const;

function SleepScreen({ left }: { left: number }) {
  const t = useTranslations("shell");
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sleep-title"
      className="fixed inset-0 z-[1000] flex items-center justify-center overflow-hidden bg-brand-900 p-6 print:hidden"
    >
      <style>{`
@keyframes yp-fl{0%{transform:translate(0,0);opacity:0}20%{opacity:1}100%{transform:translate(26px,-60px);opacity:0}}
@keyframes yp-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes yp-tw{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes yp-bar{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@media (prefers-reduced-motion: reduce){.yp-anim{animation:none!important}}
`}</style>
      {STARS.map(([x, y, d]) => (
        <span
          key={`${x}-${y}`}
          aria-hidden
          className="yp-anim absolute size-[3px] rounded-full bg-sidebar-text"
          style={{ left: `${x}%`, top: `${y}%`, animation: `yp-tw 2.4s ${d}s infinite` }}
        />
      ))}
      <div className="relative flex max-w-[480px] flex-col items-center text-center">
        <div className="yp-anim relative mb-6 size-[110px]" style={{ animation: "yp-bob 4s infinite ease-in-out" }} aria-hidden>
          <svg viewBox="0 0 100 100" width="110" height="110">
            <circle cx="50" cy="50" r="46" fill="currentColor" className="text-white/10" />
            <path d="M62 22a30 30 0 1 0 18 44 24 24 0 0 1-18-44z" fill="currentColor" className="text-sidebar-active" />
          </svg>
          {[
            [84, 18, 16, 0],
            [92, 8, 20, 1],
            [100, -2, 24, 2],
          ].map(([x, y, f, d], i) => (
            <span
              key={i}
              className="yp-anim absolute font-semibold text-sidebar-active"
              style={{ left: x, top: y, fontSize: f, animation: `yp-fl 3s ${d}s infinite ease-out`, opacity: 0 }}
            >
              {i === 2 ? "Z" : "z"}
            </span>
          ))}
        </div>
        <h1 id="sleep-title" className="mb-3 text-2xl font-semibold text-white">
          {t("sleepTitle")}
        </h1>
        <p className="text-body leading-relaxed text-sidebar-text">{t("sleepText", { date: "24.11.2026", time: "12:00" })}</p>
        <div className="mt-6 inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-white">
          <span className="yp-anim size-2 rounded-full bg-sidebar-active" style={{ animation: "yp-tw 1.4s infinite" }} aria-hidden />
          <span className="text-sidebar-text">{t("sleepLeft")}</span>
          <b className="font-semibold tabular-nums" aria-live="off">
            {formatLeft(left)}
          </b>
        </div>
        <div className="mt-5 h-[3px] w-[220px] overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div className="yp-anim h-full w-2/5 bg-sidebar-active" style={{ animation: "yp-bar 2.2s infinite ease-in-out" }} />
        </div>
        <p className="mt-5 text-caption text-sidebar-text/70">{t("sleepSaved")}</p>
      </div>
    </div>
  );
}
