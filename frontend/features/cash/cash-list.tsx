"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Banknote, CircleAlert, CreditCard, HandCoins, Landmark, LockKeyhole, LockKeyholeOpen, TriangleAlert, Truck } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Radio } from "@/components/ui/selection-controls";
import { ErrorState, Skeleton } from "@/components/ui/system-states";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { ensureCsrf } from "@/features/auth/session";
import { formatIsoDate } from "@/features/counterparties/api";
import type { DriverCash, MoneyAccount } from "@/features/payments/api";
import { describeError } from "@/features/setup/form-error";
import { api, unwrap } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { fromCents, toCents, useStatement } from "./api";
import { dayBadge, groupTrips, handoverDiff, shortSplit, sumMoney, type DriverTrip, type ShortReason } from "./list-model";

const BADGE = {
  closed: { tone: "success", icon: LockKeyhole, key: "cClosed" },
  notClosed: { tone: "warning", icon: TriangleAlert, key: "cNotClosed" },
  open: { tone: "info", icon: LockKeyholeOpen, key: "dayOpen" },
} as const;

/** Hisob kartasi (prototip Cash → cards): ikonka, nom, masʼul, holat, hisob raqami (bank), katta qoldiq, bugungi aylanma. */
export function AccountCard(props: { account: MoneyAccount; branchName: string; selected: boolean; onOpen: () => void }) {
  const t = useTranslations("cash.page.list");
  const tc = useTranslations("cash");
  const tk = useTranslations("payments.accountKind");
  const a = props.account;
  const st = useStatement(a.id, null, null);
  const isCash = a.kind === "CASH";
  const badge = isCash && st.data ? dayBadge(st.data.closedThrough, st.data.to) : null;
  const preset = badge ? BADGE[badge.kind] : null;
  const sub = [
    props.branchName,
    isCash ? (a.cashierName ? t("resp", { n: a.cashierName }) : tc("noCashier")) : null,
    a.active ? null : tc("inactive"),
  ]
    .filter(Boolean)
    .join(" · ");
  const Glyph = a.kind === "TERMINAL" ? CreditCard : a.kind === "BANK" ? Landmark : Banknote;
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onOpen}
      className={cn(
        "flex min-w-0 flex-col gap-2.5 rounded-card border bg-surface p-4 text-left transition-colors hover:border-text-secondary",
        props.selected ? "border-primary ring-1 ring-primary" : "border-border",
      )}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 flex-none items-center justify-center rounded-card bg-background text-text-secondary">
            <Glyph size={16} strokeWidth={1.5} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-semibold">{a.name}</span>
            <span className="truncate text-caption text-text-secondary">{sub}</span>
          </span>
        </span>
        {preset && badge ? (
          <Badge tone={preset.tone} icon={preset.icon} className="flex-none">
            {t(preset.key, { d: formatIsoDate(badge.date) })}
          </Badge>
        ) : !isCash ? (
          <Badge tone="neutral" className="flex-none">
            {tk(a.kind)}
          </Badge>
        ) : null}
      </span>
      {a.kind === "BANK" && a.accountNo ? (
        <span className="font-mono text-caption text-text-secondary">{a.accountNo.replace(/(\d{4})(?=\d)/g, "$1 ")}</span>
      ) : null}
      <span className="whitespace-nowrap text-page-title tracking-tight tabular-nums">{formatMoney(a.balance)}</span>
      <span className="text-table text-text-secondary">
        {st.data ? t("today", { a: formatMoney(st.data.income), b: formatMoney(st.data.expense) }) : st.error ? t("todayError") : " "}
      </span>
    </button>
  );
}

/** «Haydovchilardan kutilayotgan pul» (prototip Cash → drvTrips): reys boʻyicha, sanab qabul qilish formasi bilan. */
export function DriverCashSection(props: {
  list: DriverCash[] | undefined;
  error: boolean;
  onRetry: () => void;
  kassas: MoneyAccount[];
  canAccept: boolean;
}) {
  const t = useTranslations("cash.page.driver");
  const [editing, setEditing] = useState<number | null>(null);
  if (props.error)
    return (
      <section className="rounded-card border border-border bg-surface">
        <ErrorState onRetry={props.onRetry} />
      </section>
    );
  if (!props.list) return <Skeleton className="h-24 w-full" />;
  if (props.list.length === 0) return null;
  const trips = groupTrips(props.list);
  const total = sumMoney(trips.map((x) => x.total));
  return (
    <section className="flex min-w-0 flex-col rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-subtitle">
          <Truck size={16} strokeWidth={1.5} aria-hidden />
          {t("title")}
        </h2>
        <span className="font-semibold tabular-nums">
          {formatMoney(total)} {t("currency")}
        </span>
      </div>
      {trips.map((trip) => (
        <TripBlock
          key={trip.tripId}
          trip={trip}
          kassas={props.kassas}
          canAccept={props.canAccept}
          editing={editing === trip.tripId}
          onEdit={(on) => setEditing(on ? trip.tripId : null)}
        />
      ))}
    </section>
  );
}

function TripBlock(props: {
  trip: DriverTrip<DriverCash>;
  kassas: MoneyAccount[];
  canAccept: boolean;
  editing: boolean;
  onEdit: (on: boolean) => void;
}) {
  const t = useTranslations("cash.page.driver");
  const ts = useTranslations("orders.shipments.tripStatus");
  const { trip } = props;
  return (
    <div className="flex flex-col gap-2.5 border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <span className="flex min-w-0 flex-col">
          <span className="font-semibold">{trip.driver}</span>
          <span className="text-caption text-text-secondary">
            <span className="font-mono">{trip.tripNumber}</span> · {ts(trip.tripStatus)}
          </span>
        </span>
        <span className="flex items-center gap-2.5">
          <span className="text-subtitle tabular-nums">
            {formatMoney(trip.total)} {t("currency")}
          </span>
          {!props.editing && props.canAccept ? (
            <Button icon={HandCoins} disabled={props.kassas.length === 0} onClick={() => props.onEdit(true)}>
              {t("accept")}
            </Button>
          ) : null}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {trip.rows.map((r) => (
          <li key={r.stopId} className="flex justify-between gap-2 text-table text-text-secondary">
            <span className="min-w-0">
              <span className="font-mono text-text-primary">{r.orderNumber}</span> · {r.customer}
            </span>
            <span className="flex-none tabular-nums text-text-primary">{formatMoney(r.amount)}</span>
          </li>
        ))}
      </ul>
      {props.editing ? <AcceptForm trip={trip} kassas={props.kassas} onDone={() => props.onEdit(false)} /> : null}
    </div>
  );
}

const REASONS = [
  { value: "customer", label: "rCustomer", hint: "rCustomerHint" },
  { value: "driver", label: "rDriver", hint: "rDriverHint" },
  { value: "mixed", label: "rMixed", hint: "rMixedHint" },
] as const;

/**
 * Reys boʻyicha qabul (KT1, SPEC 5.4): Kassir haqiqatda sanagan summani kiritadi. Kam boʻlsa — sabab: (a) mijoz toʻlamagan (bekat boʻyicha
 * summa), (b) haydovchi kamomadi yoki aralash; ortiqcha — tanlangan mijozga. Farq boʻlsa izoh majburiy va tasdiq oynasi.
 */
function AcceptForm(props: { trip: DriverTrip<DriverCash>; kassas: MoneyAccount[]; onDone: () => void }) {
  const t = useTranslations("cash.page.driver");
  const qc = useQueryClient();
  const { trip } = props;
  const last = trip.rows[trip.rows.length - 1];
  const [got, setGot] = useState(trip.total);
  const [kassa, setKassa] = useState<string | null>(props.kassas[0] ? String(props.kassas[0].id) : null);
  const [reason, setReason] = useState<ShortReason>("customer");
  const [unpaid, setUnpaid] = useState<Record<number, string>>({});
  const [overTo, setOverTo] = useState<string | null>(last ? String(last.stopId) : null);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const diff = handoverDiff(got, trip.total);
  const cents = diff === null ? 0n : toCents(diff);
  const short = cents < 0n;
  const over = cents > 0n;
  const deficit = short && diff ? diff.slice(1) : "0.00";
  const split = short ? shortSplit(deficit, reason, trip.rows, unpaid) : null;
  const noteError = diff !== null && cents !== 0n && !note.trim();
  const splitError =
    split?.error === "row"
      ? t("eRow")
      : split?.error === "sum"
        ? t("eSumSplit", { s: formatMoney(deficit) })
        : split?.error === "mixed"
          ? t("eMixed", { s: formatMoney(deficit) })
          : null;
  const overRow = trip.rows.find((r) => String(r.stopId) === overTo);

  function check() {
    setTried(true);
    setError(null);
    if (diff === null || !kassa || noteError || splitError) return;
    if (cents !== 0n) setConfirming(true);
    else void save();
  }

  async function save() {
    if (diff === null || !kassa) return;
    setBusy(true);
    let ok = false;
    try {
      await ensureCsrf();
      const res = await unwrap(
        api.POST("/api/trips/{id}/cash/accept", {
          params: { path: { id: trip.tripId } },
          body: {
            accountId: Number(kassa),
            received: fromCents(toCents(got)),
            note: note.trim() || undefined,
            unpaid: split && split.unpaid.length > 0 ? split.unpaid : undefined,
            shortage: split && toCents(split.shortage) > 0n ? split.shortage : undefined,
            overageStopId: over && overTo ? Number(overTo) : undefined,
          },
        }),
      );
      ok = true;
      toast({ tone: "success", title: t("accepted"), description: t("done", { n: res.payments.length, s: formatMoney(res.received) }) });
      setConfirming(false);
      props.onDone();
    } catch (e) {
      setError(e);
      setConfirming(false);
    } finally {
      setBusy(false);
      if (ok) {
        await qc.invalidateQueries({ queryKey: ["trips", "cash"] });
        await qc.invalidateQueries({ queryKey: ["money-accounts"] });
        await qc.invalidateQueries({ queryKey: ["payments"] });
        await qc.invalidateQueries({ queryKey: ["shortages"] });
      }
    }
  }

  const server = describeError(error);
  return (
    <div className="flex flex-col gap-3 rounded-card bg-table-header p-3">
      <div className="flex flex-wrap gap-3">
        <div className="w-64 max-w-full">
          <TextField
            label={t("got")}
            variant="amount"
            required
            value={got}
            onChange={setGot}
            error={tried && diff === null ? t("eSum") : undefined}
          />
        </div>
        <div className="w-64 max-w-full">
          <Select
            label={t("target")}
            value={kassa}
            onChange={setKassa}
            options={props.kassas.map((a) => ({ value: String(a.id), label: a.name, sub: a.code }))}
          />
        </div>
      </div>
      {diff !== null && cents !== 0n ? (
        <span className={cn("flex items-center gap-1 text-table font-semibold", short ? "text-danger" : "text-warning")}>
          <CircleAlert size={14} strokeWidth={1.5} aria-hidden />
          {t(short ? "short" : "over", { s: formatMoney(diff.replace("-", "")) })}
        </span>
      ) : null}
      {short && split ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-table font-semibold">{t("reasonTitle")}</legend>
          {REASONS.map((r) => (
            <Radio
              key={r.value}
              name={`reason-${trip.tripId}`}
              value={r.value}
              label={t(r.label)}
              description={t(r.hint)}
              checked={reason === r.value}
              onChange={(v) => setReason(v as ShortReason)}
            />
          ))}
          {reason !== "driver" ? (
            <div className="flex flex-wrap gap-3">
              {trip.rows.map((r) => (
                <div key={r.stopId} className="w-64 max-w-full">
                  <TextField
                    label={t("unpaidLabel", { c: r.customer })}
                    variant="amount"
                    value={unpaid[r.stopId] ?? ""}
                    onChange={(v) => setUnpaid((m) => ({ ...m, [r.stopId]: v }))}
                  />
                </div>
              ))}
            </div>
          ) : null}
          {toCents(split.shortage) > 0n ? (
            <span className="text-table font-semibold text-danger">{t("driverPart", { s: formatMoney(split.shortage) })}</span>
          ) : null}
          {tried && splitError ? (
            <span role="alert" className="flex items-center gap-1 text-table text-danger">
              <CircleAlert size={14} strokeWidth={1.5} aria-hidden />
              {splitError}
            </span>
          ) : null}
        </fieldset>
      ) : null}
      {over ? (
        <div className="w-80 max-w-full">
          <Select
            label={t("overTo")}
            value={overTo}
            onChange={setOverTo}
            options={trip.rows.map((r) => ({ value: String(r.stopId), label: r.customer, sub: r.orderNumber }))}
          />
        </div>
      ) : null}
      {diff !== null && cents !== 0n ? (
        <div className="w-full max-w-xl">
          <TextField label={t("note")} required value={note} onChange={setNote} error={tried && noteError ? t("eNote") : undefined} />
        </div>
      ) : null}
      {server.message ? <Alert tone="danger" title={server.message} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button loading={busy && !confirming} onClick={check}>
          {t("confirm")}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={props.onDone}>
          {t("cancel")}
        </Button>
      </div>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("confirmTitle")}
        primaryAction={{ label: t("confirm"), onClick: () => void save(), loading: busy }}
      >
        <ul className="flex flex-col gap-1 text-table">
          <li>{t("cExpected", { s: formatMoney(trip.total) })}</li>
          <li className="font-semibold">{t("cReceived", { s: formatMoney(fromCents(toCents(got))) })}</li>
          {split && split.unpaid.length > 0 ? (
            <li>{t("cUnpaid", { s: formatMoney(sumMoney(split.unpaid.map((u) => u.amount))) })}</li>
          ) : null}
          {split && toCents(split.shortage) > 0n ? (
            <li className="text-danger">{t("cShortage", { s: formatMoney(split.shortage) })}</li>
          ) : null}
          {over && diff ? <li className="text-warning">{t("cOver", { s: formatMoney(diff), c: overRow?.customer ?? "" })}</li> : null}
        </ul>
      </Modal>
    </div>
  );
}
