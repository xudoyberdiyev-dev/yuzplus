"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useMe } from "@/features/auth/session";
import { coalesceLive, LIVE_INVALIDATES, useLive } from "@/lib/live";

type Topic = keyof typeof LIVE_INVALIDATES;
const TOPICS = ["orders", "trips", "receipts", "transfers"] as const satisfies readonly Topic[];

/**
 * Real vaqt: shu filialda buyurtma, reys yoki kirim oʻzgarsa — ekrandagi roʻyxatlar yangilanadi (SSE).
 * S1: hodisalar 1–2,5 s ichida birlashtiriladi, yashirin varaqda — koʻrinadigan boʻlganda bir marta (`coalesceLive`).
 */
export function LiveSync() {
  const me = useMe();
  const qc = useQueryClient();
  const enabled = Boolean(me.data);
  const co = useMemo(
    () =>
      Object.fromEntries(
        TOPICS.map((t) => [t, coalesceLive(() => LIVE_INVALIDATES[t].forEach((queryKey) => void qc.invalidateQueries({ queryKey })))]),
      ) as Record<(typeof TOPICS)[number], ReturnType<typeof coalesceLive>>,
    [qc],
  );
  useEffect(() => {
    const onVisible = () => TOPICS.forEach((t) => co[t].visible());
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      TOPICS.forEach((t) => co[t].cancel());
    };
  }, [co]);
  useLive(["orders"], () => co.orders.trigger(), enabled);
  useLive(["trips"], () => co.trips.trigger(), enabled);
  useLive(["receipts"], () => co.receipts.trigger(), enabled);
  useLive(["transfers"], () => co.transfers.trigger(), enabled);
  return null;
}
