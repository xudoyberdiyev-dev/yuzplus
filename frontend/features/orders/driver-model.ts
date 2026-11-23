import { fromCents, toCents } from "@/features/cash/api";
import { api } from "@/lib/api/client";

/** Haydovchi paneli (HD3, H1/H5): keyingi manzil, navigator havolasi, «Yetib keldim», raqamli topshirish. Pul — tiyinda. */

type StopLike = {
  id: number;
  seq: number;
  customer: string;
  outcome?: string | null;
  paymentType: string;
  total: string;
  returnTotal?: string | null;
  returnNumber?: string | null;
  cashCollected?: string | null;
};

/** Keyingi manzil — tartib boʻyicha birinchi natijasiz bekat. */
export function nextStopId(stops: readonly StopLike[]): number | null {
  return [...stops].sort((a, b) => a.seq - b.seq).find((s) => !s.outcome)?.id ?? null;
}

/** Navigator havolasi (manzil boʻyicha); manzil yoʻq — null. */
export function roadUrl(address: string | null | undefined): string | null {
  const a = address?.trim();
  return a ? `https://yandex.uz/maps/?text=${encodeURIComponent(a)}` : null;
}

export interface Handover {
  due: string;
  got: string;
  cashDone: boolean;
  goodsDone: boolean;
  returns: string[];
}

/**
 * Reys yakuni (kodsiz topshirish, egasi 20.11): olinishi kerak naqd (yetkazilgan/qisman naqd bekatlar, qaytgan qism ayirilgan), olingan,
 * omborga qaytadigan tovar (qisman / yetkazilmadi). «Yakunlangan» — kassir va ombor qabul qilgan.
 */
export function tripHandover(stops: readonly StopLike[], status: string): Handover {
  let due = 0n;
  let got = 0n;
  const returns: string[] = [];
  for (const s of stops) {
    if (s.paymentType === "CASH" && (s.outcome === "DELIVERED" || s.outcome === "PARTIAL"))
      due += toCents(s.total) - (s.outcome === "PARTIAL" ? toCents(s.returnTotal ?? "0") : 0n);
    got += toCents(s.cashCollected ?? "0");
    if (s.outcome === "PARTIAL" || s.outcome === "UNDELIVERED") returns.push([s.customer, s.returnNumber].filter(Boolean).join(" · "));
  }
  const done = status === "DONE";
  return { due: fromCents(due), got: fromCents(got), cashDone: done || got === 0n, goodsDone: done, returns };
}

/** «Yetib keldim»: bir martalik joylashuv (ruxsat boʻlsa) serverga; vaqt «HH:MM» qaytadi. Joylashuv olinmasa ham ishlaydi. */
export async function arrivedPoint(tripId: number, stopId: number): Promise<string> {
  const time = new Intl.DateTimeFormat("uz-UZ", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent" }).format(new Date());
  if (typeof navigator === "undefined" || !navigator.geolocation) return time;
  const pos = await new Promise<GeolocationPosition | null>((resolve) =>
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 8000, maximumAge: 60_000 }),
  );
  if (pos) {
    await api
      .POST("/api/trips/{id}/points", {
        params: { path: { id: tripId } },
        body: {
          stopId,
          kind: "ARRIVED",
          lat: Math.round(pos.coords.latitude * 1e6) / 1e6,
          lng: Math.round(pos.coords.longitude * 1e6) / 1e6,
          accuracy: Math.round(pos.coords.accuracy),
          recordedAt: new Date(pos.timestamp).toISOString(),
        },
      })
      .catch(() => undefined);
  }
  return time;
}
