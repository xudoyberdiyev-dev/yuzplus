"use client";

import { useReportWebVitals } from "next/web-vitals";
import { useEffect } from "react";
import { ensureCsrf, useMe } from "@/features/auth/session";
import { api } from "@/lib/api/client";
import { currentPage, flush, record, setTelemetrySender, type TimingEntry, vitalEntry } from "@/lib/telemetry";

type Metric = Parameters<Parameters<typeof useReportWebVitals>[0]>[0];

const onVital = (m: Metric) => record(vitalEntry(m, currentPage()));

async function send(entries: TimingEntry[]) {
  await ensureCsrf();
  await api.POST("/api/telemetry/timings", { body: { entries } });
}

/** TZ1: sekin soʻrovlar va yomon Web Vitals → backend log (tizimga kirgandan keyin; varaq yashirilganda darhol). */
export function Telemetry() {
  const me = useMe();
  const enabled = Boolean(me.data);
  useReportWebVitals(onVital);
  useEffect(() => {
    if (!enabled) return;
    const off = setTelemetrySender(send);
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      off();
    };
  }, [enabled]);
  return null;
}
