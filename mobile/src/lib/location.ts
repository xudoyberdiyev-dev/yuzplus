// HD1: bir martalik joylashuv — «Yetib keldim» va bekat natijasida. Fon kuzatuvi YOʻQ; ruxsat berilmasa jim oʻtadi.
import * as Location from "expo-location";
import type { PointKind } from "./queue-core";
import { enqueue, flush } from "./queue";

const TIMEOUT_MS = 8000;

/** Ruxsat soʻraladi (faqat birinchi marta tizim oynasi chiqadi); rad etilsa — null. */
async function current(): Promise<Location.LocationObject | null> {
  const perm = await Location.getForegroundPermissionsAsync();
  const granted = perm.granted || (perm.canAskAgain && (await Location.requestForegroundPermissionsAsync()).granted);
  if (!granted) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
  const fix = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
  return (await Promise.race([fix, timeout])) ?? (await Location.getLastKnownPositionAsync().catch(() => null));
}

/** Nuqtani navbatga qoʻyadi (internet boʻlmasa ham yoʻqolmaydi). Hech qachon xato tashlamaydi — asosiy amalni toʻxtatmaydi. */
export async function recordPoint(tripId: number, stopId: number | null, kind: PointKind): Promise<void> {
  try {
    const p = await current();
    if (!p) return;
    await enqueue({
      kind: "point",
      tripId,
      stopId,
      point: kind,
      lat: Math.round(p.coords.latitude * 1e6) / 1e6,
      lng: Math.round(p.coords.longitude * 1e6) / 1e6,
      accuracy: p.coords.accuracy == null ? null : Math.round(p.coords.accuracy),
      recordedAt: new Date(p.timestamp).toISOString(),
    });
    await flush();
  } catch {
    // GPS ixtiyoriy: joylashuv olinmasa ham yetkazish davom etadi
  }
}
