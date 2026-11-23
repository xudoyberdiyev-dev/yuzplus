"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Camera, Plus, Wallet } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { ensureCsrf } from "@/features/auth/session";
import { toCents } from "@/features/cash/api";
import { ExpenseLabel } from "@/features/cash/cash-list";
import { describeError } from "@/features/setup/form-error";
import { api, unwrap } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { EXPENSE_KINDS, useTripMoney, type ExpenseKind, type ExpenseSource } from "./api";

const SOURCES: readonly ExpenseSource[] = ["ADVANCE", "COLLECTED", "OWN"];

/** Xarajat formasi xatosi: summa > 0; yoqilgʻida chek rasmi; «Boshqa» — izoh. */
export function expenseFormError(kind: ExpenseKind, amount: string, file: File | null, note: string): "amount" | "photo" | "note" | null {
  if (!/^\d+([.,]\d{1,2})?$/.test(amount.trim()) || toCents(amount.trim().replace(",", ".")) <= 0n) return "amount";
  if (kind === "FUEL" && !file) return "photo";
  if (kind === "OTHER" && !note.trim()) return "note";
  return null;
}

/** Haydovchi paneli (veb): reys avansi va yoʻl xarajatlari, «Xarajat qoʻshish» (HD2; mobil ilovadagi bilan bir xil qoidalar). */
export function DriverExpenses({ tripId }: { tripId: number }) {
  const t = useTranslations("cash.tripExpenses");
  const q = useTripMoney(tripId);
  const [open, setOpen] = useState(false);
  const data = q.data;
  return (
    <section className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          <Wallet size={18} strokeWidth={1.5} aria-hidden />
          {t("section")}
        </span>
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => setOpen(true)}>
          {t("add")}
        </Button>
      </div>
      {data && toCents(data.advanceOpen) > 0n ? (
        <span className="text-table text-text-secondary">{t("advanceGiven", { s: formatMoney(data.advanceOpen) })}</span>
      ) : null}
      {data && data.expenses.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {data.expenses.map((x) => (
            <li key={x.id} className="flex flex-wrap justify-between gap-2 text-table text-text-secondary">
              <ExpenseLabel x={x} />
              <span className="tabular-nums text-text-primary">{formatMoney(x.amount)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {open ? <ExpenseDialog tripId={tripId} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

function ExpenseDialog(props: { tripId: number; onClose: () => void }) {
  const t = useTranslations("cash.tripExpenses");
  const qc = useQueryClient();
  const [kind, setKind] = useState<ExpenseKind>("FUEL");
  const [source, setSource] = useState<ExpenseSource>("ADVANCE");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [liters, setLiters] = useState("");
  const [odometer, setOdometer] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const problem = expenseFormError(kind, amount, file, note);

  async function save() {
    setTried(true);
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      await ensureCsrf();
      const created = await unwrap(
        api.POST("/api/trips/{id}/expenses", {
          params: { path: { id: props.tripId } },
          body: {
            kind,
            source,
            amount: amount.trim().replace(",", "."),
            note: note.trim() || undefined,
            liters: kind === "FUEL" && liters.trim() ? Number(liters.trim().replace(",", ".")) : undefined,
            odometer: odometer.trim() ? Number(odometer.trim()) : undefined,
            spentAt: new Date().toISOString(),
            clientUuid: crypto.randomUUID(),
          },
        }),
      );
      if (file) {
        await unwrap(
          api.POST("/api/trips/{id}/expenses/{expenseId}/photo", {
            params: { path: { id: props.tripId, expenseId: created.id } },
            body: { file: file as unknown as string },
            bodySerializer: () => {
              const fd = new FormData();
              fd.append("file", file, file.name);
              return fd;
            },
          }),
        );
      }
      toast({ tone: "success", title: t("saved") });
      await qc.invalidateQueries({ queryKey: ["trips", "money"] });
      props.onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const server = describeError(error);
  return (
    <Modal open onClose={props.onClose} title={t("add")} primaryAction={{ label: t("save"), onClick: () => void save(), loading: busy }}>
      <div className="flex flex-col gap-3">
        <Select
          label={t("page.cKind")}
          value={kind}
          onChange={(v) => v && setKind(v as ExpenseKind)}
          options={EXPENSE_KINDS.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
        />
        <TextField
          label={t("page.cAmount")}
          variant="amount"
          required
          value={amount}
          onChange={setAmount}
          error={tried && problem === "amount" ? t("eAmount") : undefined}
        />
        <Select
          label={t("page.cSource")}
          value={source}
          onChange={(v) => v && setSource(v as ExpenseSource)}
          options={SOURCES.map((s) => ({ value: s, label: t(`source.${s}`) }))}
        />
        {kind === "FUEL" ? (
          <>
            <label className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-control border border-border bg-surface px-3.5 font-semibold text-link">
              <Camera size={18} strokeWidth={1.5} aria-hidden />
              {file ? t("receiptTaken") : t("receiptTake")}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="sr-only"
                aria-label={t("receiptTake")}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {tried && problem === "photo" ? <span className="text-table text-danger">{t("ePhoto")}</span> : null}
            <TextField label={t("page.cLiters")} value={liters} onChange={setLiters} />
          </>
        ) : null}
        <TextField label={t("page.cOdo")} value={odometer} onChange={(v) => setOdometer(v.replace(/\D/g, ""))} />
        <TextField
          label={t("advanceNote")}
          required={kind === "OTHER"}
          value={note}
          onChange={setNote}
          maxLength={300}
          error={tried && problem === "note" ? t("eNote") : undefined}
        />
        {server.message ? <Alert tone="danger" title={server.message} /> : null}
      </div>
    </Modal>
  );
}
