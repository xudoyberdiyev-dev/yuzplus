import { api } from "./api";
import type { components } from "./api-schema";
import type { TripDetail, TripSummary } from "./trip-view";

// Haydovchi reysi (backend: /api/trips/mine…, ruxsat trip.driver). Faol reys yoʻq — 204 → null.
export async function myTrip(): Promise<TripDetail | null> {
  return (await api<TripDetail | undefined>("/api/trips/mine")) ?? null;
}

export function myHistory(): Promise<TripSummary[]> {
  return api<TripSummary[]>("/api/trips/mine/history");
}

export function acceptLoad(tripId: number, stopId: number, places: number): Promise<TripDetail> {
  return api<TripDetail>(`/api/trips/${tripId}/stops/${stopId}/load`, { method: "POST", body: { places } });
}

export function startTrip(tripId: number): Promise<{ sales: string[] }> {
  return api<{ sales: string[] }>(`/api/trips/${tripId}/start`, { method: "POST" });
}

export type SaleLine = components["schemas"]["SaleLine"];

/** Yetkazish rasmi (kamida 1 ta majburiy) yoki mijoz imzosi (signature=true). JPEG, ≤ 5 MB. */
export function uploadPhoto(tripId: number, stopId: number, uri: string, signature = false): Promise<{ id: number }> {
  const form = new FormData();
  // React Native FormData fayl: { uri, name, type }
  form.append("file", { uri, name: signature ? "imzo.png" : "rasm.jpg", type: signature ? "image/png" : "image/jpeg" } as unknown as Blob);
  return api<{ id: number }>(`/api/trips/${tripId}/stops/${stopId}/photos${signature ? "?signature=true" : ""}`, { method: "POST", body: form });
}

export function deliver(tripId: number, stopId: number, cash: string | null): Promise<TripDetail> {
  return api<TripDetail>(`/api/trips/${tripId}/stops/${stopId}/deliver`, { method: "POST", body: { cash } });
}

export function undeliver(tripId: number, stopId: number, reason: string): Promise<TripDetail> {
  return api<TripDetail>(`/api/trips/${tripId}/stops/${stopId}/undeliver`, { method: "POST", body: { reason } });
}

export function stopLines(tripId: number, stopId: number): Promise<SaleLine[]> {
  return api<SaleLine[]>(`/api/trips/${tripId}/stops/${stopId}/lines`);
}

export function partial(tripId: number, stopId: number, reason: string, lines: { saleLineId: number; qty: number }[], cash: string | null): Promise<TripDetail> {
  return api<TripDetail>(`/api/trips/${tripId}/stops/${stopId}/partial`, { method: "POST", body: { reason, lines, cash } });
}

/** «Reysni yakunlash»: qaytgan tovar yoki naqd boʻlsa — RETURN_WAIT, aks holda DONE. */
export function finishTrip(tripId: number): Promise<{ status: TripDetail["status"] }> {
  return api<{ status: TripDetail["status"] }>(`/api/trips/${tripId}/finish`, { method: "POST" });
}

/** HD1: bir martalik GPS nuqta (fon kuzatuvi yoʻq). */
export function postPoint(
  tripId: number,
  body: { stopId: number | null; kind: string; lat: number; lng: number; accuracy: number | null; recordedAt: string },
): Promise<void> {
  return api<void>(`/api/trips/${tripId}/points`, { method: "POST", body });
}

// ===== HD2: yoʻl xarajatlari =====

export type TripMoney = components["schemas"]["TripMoneyView"];
export type TripExpense = components["schemas"]["TripExpense"];

/** Reys avansi va xarajatlari (oʻz reysi). */
export function tripMoney(tripId: number): Promise<TripMoney> {
  return api<TripMoney>(`/api/trips/${tripId}/money`);
}

export type NewExpense = {
  kind: string;
  amount: string;
  source: string;
  note: string | null;
  liters: string | null;
  price: string | null;
  odometer: number | null;
  lat: number | null;
  lng: number | null;
  spentAt: string;
  clientUuid: string;
};

/** Xarajat yozish; takroriy clientUuid — oʻsha yozuv (oflayn navbat xavfsiz). */
export function addExpense(tripId: number, body: NewExpense): Promise<{ id: number }> {
  return api<{ id: number }>(`/api/trips/${tripId}/expenses`, { method: "POST", body: { ...body, liters: body.liters ? Number(body.liters) : null } });
}

/** Chek rasmi (JPEG, ≤ 5 MB). */
export function uploadReceipt(tripId: number, expenseId: number, uri: string): Promise<{ id: number }> {
  const form = new FormData();
  form.append("file", { uri, name: "chek.jpg", type: "image/jpeg" } as unknown as Blob);
  return api<{ id: number }>(`/api/trips/${tripId}/expenses/${expenseId}/photo`, { method: "POST", body: form });
}
