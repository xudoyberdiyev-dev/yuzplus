import type { ChangeEvent } from "react";

/**
 * Raqam yoziladigan maydonlarda minglarni boʻsh joy bilan ajratish (egasi 24.11.2026: «1 000 000»).
 * Koʻrinish: «1 000 000» / «1 250 000,50»; ichki (saqlanadigan) qiymat boʻsh joysiz: «1000000» / «1250000,50».
 */
const SEP = " "; // uzilmaydigan boʻsh joy — qator boʻlinmaydi, koʻrinishi oddiy boʻsh joy
const SPACES = /[\s  ]/g;

export function ungroupDigits(display: string): string {
  return display.replace(SPACES, "");
}

export function groupDigits(raw: string): string {
  const v = ungroupDigits(raw);
  const m = /^(-?)(\d+)([.,]\d*)?$/.exec(v);
  if (!m) return v; // raqam boʻlmasa — oʻzgarishsiz (validatsiya xatoni koʻrsatadi)
  const [, sign, int, frac = ""] = m;
  return sign + int.replace(/\B(?=(\d{3})+(?!\d))/g, SEP) + frac;
}

/** Boʻsh joylarsiz hisoblaganda `count` ta belgidan keyingi kursor oʻrni. */
export function caretAfter(display: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < display.length; i++) {
    if (!/[\s  ]/.test(display[i])) seen++;
    if (seen === count) return i + 1;
  }
  return display.length;
}

/** `<input>` onChange uchun: ichki qiymatni beradi va kursorni guruhlangandan keyin joyida saqlaydi. */
export function onGroupedChange(e: ChangeEvent<HTMLInputElement>, emit: (raw: string) => void): void {
  const el = e.target;
  const pos = el.selectionStart ?? el.value.length;
  const count = ungroupDigits(el.value.slice(0, pos)).length;
  const raw = ungroupDigits(el.value);
  emit(raw);
  requestAnimationFrame(() => {
    if (document.activeElement !== el) return;
    const p = caretAfter(el.value, count);
    el.setSelectionRange(p, p);
  });
}
