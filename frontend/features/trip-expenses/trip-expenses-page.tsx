"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Fuel } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DayField } from "@/components/ui/day-field";
import { Select } from "@/components/ui/select";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/ui/system-states";
import { Table, type TableColumn } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { can } from "@/features/auth/can";
import { useMe } from "@/features/auth/session";
import { api, unwrap } from "@/lib/api/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useBranchStore } from "@/lib/stores/branch";
import {
  KIND_ICON,
  STATUS_TONE,
  TRIP_EXPENSES_VIEW,
  expensePhotoUrl,
  type ExpenseGroup,
  type ExpenseStatus,
  type TripExpense,
} from "./api";

type Tab = "rows" | "driver" | "vehicle" | "month" | "kind";

/** Toshkent boʻyicha bugun va oy boshi (ISO). */
function monthStart(): { from: string; to: string } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/** Pul → Kassa → «Yoʻl xarajatlari» (HD2, SPEC 5.4): roʻyxat (chek, holat) va hisobot — haydovchi / mashina / oy / tur, 1 km ga soʻm. */
export function TripExpensesPage() {
  const t = useTranslations("cash.tripExpenses.page");
  const tx = useTranslations("cash.tripExpenses");
  const me = useMe();
  const selectedBranch = useBranchStore((s) => s.branchId);
  const allowed = can(me.data, TRIP_EXPENSES_VIEW);
  const branchId = me.data?.allBranches ? (selectedBranch ?? null) : (me.data?.branchId ?? null);
  const [period, setPeriod] = useState(monthStart);
  const [status, setStatus] = useState<ExpenseStatus | null>(null);
  const [tab, setTab] = useState<Tab>("rows");
  const q = useQuery({
    queryKey: ["trip-expenses", branchId, period.from, period.to, status],
    queryFn: () =>
      unwrap(
        api.GET("/api/trip-expenses", {
          params: { query: { branchId: branchId ?? undefined, from: period.from, to: period.to, status: status ?? undefined } },
        }),
      ),
    enabled: allowed,
  });

  if (me.data && !allowed) return <ForbiddenState />;

  const rowCols: TableColumn<TripExpense>[] = [
    { key: "spentAt", title: t("cDate"), render: (r) => formatDateTime(new Date(r.spentAt)) },
    { key: "tripNumber", title: t("cTrip"), mono: true },
    { key: "driver", title: t("cDriver"), wrap: true },
    { key: "vehicle", title: t("cVehicle"), mono: true, hideBelow: "xl" },
    {
      key: "kind",
      title: t("cKind"),
      render: (r) => {
        const Icon = KIND_ICON[r.kind];
        return (
          <span className="flex items-center gap-1.5">
            <Icon size={14} strokeWidth={1.5} aria-hidden />
            {tx(`kind.${r.kind}`)}
            {r.note ? <span className="text-text-secondary">· {r.note}</span> : null}
          </span>
        );
      },
      wrap: true,
    },
    { key: "source", title: t("cSource"), hideBelow: "xl", render: (r) => tx(`source.${r.source}`) },
    {
      key: "liters",
      title: t("cFuel"),
      align: "right",
      hideBelow: "2xl",
      render: (r) => (r.liters ? `${r.liters} × ${r.price ? formatMoney(r.price) : "—"}` : "—"),
    },
    { key: "odometer", title: t("cOdo"), align: "right", hideBelow: "2xl", render: (r) => (r.odometer != null ? String(r.odometer) : "—") },
    { key: "amount", title: t("cAmount"), align: "right", render: (r) => formatMoney(r.amount) },
    {
      key: "status",
      title: t("cStatus"),
      render: (r) => (
        <span className="flex flex-col">
          <Badge tone={STATUS_TONE[r.status]}>{tx(`status.${r.status}`)}</Badge>
          {r.rejectReason ? <span className="text-caption text-text-secondary">{r.rejectReason}</span> : null}
        </span>
      ),
    },
    {
      key: "photos",
      title: t("cReceipt"),
      render: (r) =>
        r.photos > 0 ? (
          <a href={expensePhotoUrl(r.id)} target="_blank" rel="noreferrer" className="text-primary underline">
            {t("open")}
          </a>
        ) : (
          "—"
        ),
    },
  ];
  const groupCols = (km: boolean, label: (g: ExpenseGroup) => string): TableColumn<ExpenseGroup>[] => [
    { key: "label", title: t("cName"), wrap: true, render: label },
    { key: "count", title: t("cCount"), align: "right", render: (g) => String(g.count) },
    { key: "total", title: t("total"), align: "right", render: (g) => formatMoney(g.total) },
    { key: "approved", title: t("approved"), align: "right", render: (g) => formatMoney(g.approved) },
    { key: "liters", title: t("cLiters"), align: "right", render: (g) => g.liters ?? "—" },
    ...(km
      ? [
          { key: "km", title: t("cKm"), align: "right" as const, render: (g: ExpenseGroup) => (g.km != null ? String(g.km) : "—") },
          {
            key: "perKm",
            title: t("cPerKm"),
            align: "right" as const,
            render: (g: ExpenseGroup) => (g.perKm ? formatMoney(g.perKm) : "—"),
          },
        ]
      : []),
  ];
  const data = q.data;
  const groups: Record<Exclude<Tab, "rows">, { rows: ExpenseGroup[]; km: boolean; label: (g: ExpenseGroup) => string }> = {
    driver: { rows: data?.byDriver ?? [], km: false, label: (g) => g.label },
    vehicle: { rows: data?.byVehicle ?? [], km: true, label: (g) => g.label },
    month: { rows: data?.byMonth ?? [], km: true, label: (g) => g.label },
    kind: { rows: data?.byKind ?? [], km: false, label: (g) => tx(`kind.${g.key as TripExpense["kind"]}`) },
  };
  const empty = <EmptyState icon={Fuel} title={t("empty")} description={t("emptyHint")} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title">{t("title")}</h1>
        <p className="text-table text-text-secondary">{t("sub")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <DayField label={t("from")} value={period.from} invalid={t("from")} onApply={(v) => v && setPeriod((p) => ({ ...p, from: v }))} />
        </div>
        <div className="w-44">
          <DayField label={t("to")} value={period.to} invalid={t("to")} onApply={(v) => v && setPeriod((p) => ({ ...p, to: v }))} />
        </div>
        <div className="w-48">
          <Select
            label={t("status")}
            value={status ?? "ALL"}
            onChange={(v) => setStatus(v === "ALL" || v == null ? null : (v as ExpenseStatus))}
            options={[
              { value: "ALL", label: t("all") },
              ...(["PENDING", "APPROVED", "REJECTED"] as const).map((s) => ({ value: s, label: tx(`status.${s}`) })),
            ]}
          />
        </div>
      </div>
      {data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <div className="flex flex-col">
              <span className="text-caption text-text-secondary">{t("total")}</span>
              <span className="text-subtitle tabular-nums">{formatMoney(data.total)}</span>
            </div>
          </Card>
          <Card>
            <div className="flex flex-col">
              <span className="text-caption text-text-secondary">{t("approved")}</span>
              <span className="text-subtitle tabular-nums">{formatMoney(data.approved)}</span>
            </div>
          </Card>
          <Card>
            <div className="flex flex-col">
              <span className="text-caption text-text-secondary">{t("pending")}</span>
              <span className="text-subtitle tabular-nums">{data.pending}</span>
            </div>
          </Card>
        </div>
      ) : null}
      <Tabs
        aria-label={t("title")}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        items={[
          { key: "rows", label: t("tabRows") },
          { key: "driver", label: t("tabDriver") },
          { key: "vehicle", label: t("tabVehicle") },
          { key: "month", label: t("tabMonth") },
          { key: "kind", label: t("tabKind") },
        ]}
      />
      {q.isError ? (
        <Card>
          <ErrorState onRetry={() => void q.refetch()} />
        </Card>
      ) : tab === "rows" ? (
        <Table
          caption={t("title")}
          columns={rowCols}
          rows={data?.rows ?? []}
          rowKey={(r) => String(r.id)}
          loading={q.isLoading}
          density="compact"
          emptyState={empty}
        />
      ) : (
        <Table
          caption={t("title")}
          columns={groupCols(groups[tab].km, groups[tab].label)}
          rows={groups[tab].rows}
          rowKey={(g) => g.key}
          loading={q.isLoading}
          emptyState={empty}
        />
      )}
    </div>
  );
}
