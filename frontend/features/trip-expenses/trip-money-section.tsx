"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { HandCoins, Wallet } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/system-states";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { can } from "@/features/auth/can";
import { ensureCsrf, useMe } from "@/features/auth/session";
import { CASH_APPROVE, toCents, usableAccount } from "@/features/cash/api";
import { ExpenseLabel } from "@/features/cash/cash-list";
import { PAYMENT_MT, useAccounts } from "@/features/payments/api";
import { describeError } from "@/features/setup/form-error";
import { api, unwrap } from "@/lib/api/client";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useTripMoney } from "./api";

/** Reys kartasi: avans va yoʻl xarajatlari (HD2). Kassir (payments.mt) — «Avans berish» (reys yakunlanmagan boʻlsa). */
export function TripMoneySection({ tripId, branchId, closed }: { tripId: number; branchId: number; closed: boolean }) {
  const t = useTranslations("cash.tripExpenses");
  const me = useMe();
  const q = useTripMoney(tripId);
  const [open, setOpen] = useState(false);
  const canAdvance = can(me.data, PAYMENT_MT) && !closed;
  const data = q.data;
  if (q.isLoading) return <Skeleton className="h-20 w-full" />;
  if (!data) return null;
  const empty = data.advances.length === 0 && data.expenses.length === 0;
  if (empty && !canAdvance) return null;
  return (
    <section className="flex min-w-0 flex-col rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="flex items-center gap-2 text-[14px] font-semibold">
          <Wallet size={16} strokeWidth={1.5} aria-hidden />
          {t("section")}
        </span>
        {canAdvance ? (
          <Button size="sm" variant="secondary" icon={HandCoins} onClick={() => setOpen(true)}>
            {t("advance")}
          </Button>
        ) : null}
      </div>
      {empty ? (
        <p className="p-3 text-table text-text-secondary">{t("noMoney")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 p-3">
          {data.advances.map((a) => (
            <li key={`a${a.id}`} className="flex flex-wrap items-baseline justify-between gap-2 text-table">
              <span className="min-w-0 text-text-secondary">
                <span className="tabular-nums">{formatDateTime(new Date(a.createdAt))}</span> ·{" "}
                <span className="font-medium text-text-primary">{t("advanceTitle")}</span> · <span className="font-mono">{a.cashOp}</span>
                {a.note ? ` · ${a.note}` : ""}{" "}
                <Badge tone={a.settled ? "success" : "info"}>{a.settled ? t("advanceSettled") : t("advanceOpen")}</Badge>
              </span>
              <span className="tabular-nums">+{formatMoney(a.amount)}</span>
            </li>
          ))}
          {data.expenses.map((x) => (
            <li key={`e${x.id}`} className="flex flex-wrap items-baseline justify-between gap-2 text-table text-text-secondary">
              <ExpenseLabel x={x} />
              <span className="tabular-nums text-text-primary">−{formatMoney(x.amount)}</span>
            </li>
          ))}
          {toCents(data.advanceOpen) > 0n || data.pending > 0 ? (
            <li className="pt-1 text-caption text-text-secondary">
              {t("openTotals", { a: formatMoney(data.advanceOpen), e: formatMoney(data.expensesOpen), n: data.pending })}
            </li>
          ) : null}
        </ul>
      )}
      {open ? <AdvanceDialog tripId={tripId} branchId={branchId} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

function AdvanceDialog(props: { tripId: number; branchId: number; onClose: () => void }) {
  const t = useTranslations("cash.tripExpenses");
  const qc = useQueryClient();
  const me = useMe();
  const accounts = useAccounts(props.branchId);
  const all = accounts.data ?? [];
  const supervisor = can(me.data, CASH_APPROVE);
  const kassas = all.filter((a) => a.kind === "CASH" && a.active && usableAccount(a, all, me.data?.id, supervisor));
  const [kassa, setKassa] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const account = kassa ?? (kassas[0] ? String(kassas[0].id) : null);
  const amountOk = /^\d+(\.\d+)?$/.test(amount.trim()) && toCents(amount) > 0n;

  async function save() {
    setTried(true);
    if (!amountOk || !account) return;
    setBusy(true);
    setError(null);
    try {
      await ensureCsrf();
      await unwrap(
        api.POST("/api/trips/{id}/advances", {
          params: { path: { id: props.tripId } },
          body: { accountId: Number(account), amount: amount.trim(), note: note.trim() || undefined },
        }),
      );
      toast({ tone: "success", title: t("advanceDone", { s: formatMoney(amount.trim()) }) });
      await qc.invalidateQueries({ queryKey: ["trips", "money"] });
      await qc.invalidateQueries({ queryKey: ["money-accounts"] });
      props.onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const server = describeError(error);
  return (
    <Modal
      open
      onClose={props.onClose}
      title={t("advanceTitle")}
      primaryAction={{ label: t("advance"), onClick: () => void save(), loading: busy, disabled: !account }}
    >
      <div className="flex flex-col gap-3">
        <p className="text-table text-text-secondary">{t("advanceHint")}</p>
        <Select
          label={t("advanceKassa")}
          value={account}
          onChange={setKassa}
          options={kassas.map((a) => ({ value: String(a.id), label: a.name, sub: a.code }))}
        />
        <TextField
          label={t("advanceAmount")}
          variant="amount"
          required
          value={amount}
          onChange={setAmount}
          error={tried && !amountOk ? t("eAmount") : undefined}
        />
        <TextField label={t("advanceNote")} value={note} onChange={setNote} maxLength={300} />
        {server.message ? <Alert tone="danger" title={server.message} /> : null}
      </div>
    </Modal>
  );
}
