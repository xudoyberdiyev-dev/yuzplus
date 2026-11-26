"use client";

import { useTranslations } from "next-intl";
import { CalendarCheck, Check, CircleCheck, Lock, PackageCheck, TrendingDown, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/selection-controls";
import { TextField } from "@/components/ui/text-field";
import { formatIsoDate, parseMoneyInput, parseUzDate, todayTashkent } from "@/features/counterparties/api";
import { describeError } from "@/features/setup/form-error";
import { cn } from "@/lib/cn";
import { formatMoney, formatQuantity } from "@/lib/format";
import { fetchReceiptBatches, searchPostedReceipts, useSaveDraft, useSubmit, type ReceiptBatches } from "./api";
import { applyMarkup, formatPct, fromCents, markupNetRounded, netMarkupPct, parsePercent, pctDiff, toCents, toInput } from "./price-set";

type Batch = ReceiptBatches["items"][number];

/**
 * «Narx oʻrnatish» → «Kirim boʻyicha» (egasi 26.11.2026): sahifadan chiqmasdan — oʻtkazilgan kirim tanlanadi, uning partiyalari
 * kirim narxi bilan chiqadi, ustama % kiritiladi va sotuv narxi hisoblanadi (QQSsiz, soʻmgacha — mijoz hujjatlaridagi «Baza narxi /
 * Ust.% / Sotish narxi» bilan bir xil). Saqlash — NO hujjati (kirimga bogʻlangan, partiyalar boʻyicha).
 */
export function ReceiptPriceSet({
  branchId,
  priceTypeId,
  typeName,
  vatByProduct,
  onDirtyChange,
}: {
  branchId: number | null;
  priceTypeId: number | null;
  typeName: string;
  vatByProduct: ReadonlyMap<number, string>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const t = useTranslations("prices.set");
  const tr = useTranslations("prices.set.rc");
  const [receipt, setReceipt] = useState<string | null>(null);
  const [receiptLabel, setReceiptLabel] = useState<string | null>(null);
  const labels = useRef(new Map<string, string>());
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [raw, setRaw] = useState<Record<number, string>>({});
  const [pct, setPct] = useState("15");
  const [pctErr, setPctErr] = useState<string>();
  const [roundNet, setRoundNet] = useState(true);
  const [eff, setEff] = useState(() => formatIsoDate(todayTashkent()));
  const [effErr, setEffErr] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [banner, setBanner] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const save = useSaveDraft();
  const submit = useSubmit();

  const rows = useMemo(() => batches ?? [], [batches]);
  const hasCost = rows.some((b) => b.cost != null);
  const current = (b: Batch) => (priceTypeId ? (b.batchPrices[String(priceTypeId)] ?? b.productPrices[String(priceTypeId)] ?? null) : null);
  const next = (b: Batch) => {
    const v = raw[b.batchId];
    if (v == null || v.trim() === "") return null;
    return parseMoneyInput(v);
  };
  const changed = rows.filter((b) => {
    const n = next(b);
    return n != null && Number(n) > 0 && n !== current(b);
  });
  const bad = rows.filter((b) => {
    const v = raw[b.batchId];
    if (v == null || v.trim() === "") return false;
    const n = parseMoneyInput(v);
    return !n || Number(n) <= 0;
  });
  const below = changed.filter((b) => b.cost != null && (toCents(next(b)) ?? 0n) < (toCents(b.cost) ?? 0n));
  const dirty = changed.length > 0;

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  async function load(id: string) {
    setLoading(true);
    setLoadErr(null);
    setBanner(null);
    try {
      const rb = await fetchReceiptBatches(Number(id));
      setBatches(rb.items);
      setRaw({});
    } catch (e) {
      setBatches(null);
      setLoadErr(describeError(e).message ?? tr("loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    const n = parsePercent(pct);
    if (n == null) return setPctErr(t("errors.pct"));
    setPctErr(undefined);
    const out = { ...raw };
    for (const b of rows) {
      const base = toCents(b.cost);
      if (base == null || base <= 0n) continue;
      const cents = roundNet ? markupNetRounded(base, n, vatByProduct.get(b.productId)) : applyMarkup(base, n, 0);
      out[b.batchId] = toInput(fromCents(cents));
    }
    setRaw(out);
  }

  function trySave() {
    const iso = parseUzDate(eff);
    if (!iso) return setEffErr(t("errors.eff"));
    if (iso < todayTashkent()) return setEffErr(t("errors.past"));
    setEffErr(undefined);
    if (bad.length) return setLoadErr(t("errors.price"));
    if (!changed.length) return setLoadErr(t("errors.none"));
    setLoadErr(null);
    setConfirm(true);
  }

  function doSave() {
    const iso = parseUzDate(eff);
    if (!iso || branchId == null || priceTypeId == null || !receipt) return;
    const lines = changed.map((b) => ({ productId: b.productId, priceTypeId, newPrice: next(b)!, batchId: b.batchId }));
    save.mutate(
      { body: { branchId, effectiveFrom: iso, lines, receiptId: Number(receipt) } },
      {
        onSuccess: (d) =>
          submit.mutate(d.id, {
            onSuccess: (x) => {
              setConfirm(false);
              setBanner(
                x.status === "PENDING_APPROVAL"
                  ? { tone: "warning", text: t("savedPending", { no: x.number }) }
                  : {
                      tone: "success",
                      text: t("savedPosted", { no: x.number, n: formatQuantity(x.lines.length), d: formatIsoDate(x.effectiveFrom) }),
                    },
              );
              if (receipt) void load(receipt);
            },
          }),
      },
    );
  }

  const err = describeError(save.error ?? submit.error).message;

  return (
    <div className="flex flex-col gap-4" data-screen-label="Narx oʻrnatish — kirim boʻyicha">
      {banner ? <Alert tone={banner.tone} icon={banner.tone === "success" ? CircleCheck : TriangleAlert} title={banner.text} /> : null}
      <section className="grid grid-cols-1 items-end gap-3 rounded-card border border-border bg-surface p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_180px_minmax(0,1.2fr)]">
        <Select
          label={tr("receipt")}
          value={receipt}
          loadOptions={async (q) => {
            const found = branchId == null ? [] : await searchPostedReceipts(branchId, q);
            found.forEach((o) => labels.current.set(o.value, `${o.label} · ${o.sub}`));
            return found;
          }}
          onChange={(v) => {
            if (dirty && v !== receipt && !window.confirm(t("leave"))) return;
            setReceipt(v);
            setReceiptLabel(v ? (labels.current.get(v) ?? null) : null);
            if (v) void load(v);
            else setBatches(null);
          }}
          placeholder={tr("receiptPh")}
          options={receipt && receiptLabel ? [{ value: receipt, label: receiptLabel }] : []}
        />
        <TextField
          variant="date"
          label={t("eff")}
          value={eff}
          onChange={(v) => (setEff(v), setEffErr(undefined))}
          placeholder="kk.oo.yyyy"
          inputMode="numeric"
          error={effErr}
        />
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextField
              label={tr("pct")}
              value={pct}
              onChange={(v) => (setPct(v), setPctErr(undefined))}
              suffix="%"
              inputMode="decimal"
              error={pctErr}
              disabled={!hasCost}
            />
          </div>
          <Button variant="secondary" onClick={apply} disabled={!rows.length || !hasCost} className={pctErr ? "mb-6" : undefined}>
            {t("apply")}
          </Button>
        </div>
        <Checkbox
          className="sm:col-span-2 xl:col-span-3"
          label={tr("roundNet")}
          description={tr("roundNetHint")}
          checked={roundNet}
          onChange={setRoundNet}
        />
      </section>
      {rows.length && !hasCost ? <Alert tone="info" title={tr("noCost")} /> : null}
      {loadErr ? <Alert tone="danger" title={loadErr} /> : null}
      <div className="min-w-0 overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full min-w-[980px] border-collapse text-[13px]">
          <caption className="sr-only">{tr("caption", { t: typeName })}</caption>
          <thead>
            <tr className="border-b border-border bg-table-header text-left text-caption font-medium text-text-secondary">
              <th className="w-11 px-3 py-2">№</th>
              <th className="px-3 py-2">{t("k.prod")}</th>
              <th className="w-32 px-3 py-2">{tr("batch")}</th>
              <th className="w-20 px-3 py-2 text-right">{tr("qty")}</th>
              {hasCost ? <th className="w-32 px-3 py-2 text-right">{tr("cost")}</th> : null}
              <th className="w-[140px] px-3 py-2 text-right">{t("k.cur")}</th>
              <th className="w-[150px] px-3 py-2 text-right">{t("k.new")}</th>
              {hasCost ? <th className="w-20 px-3 py-2 text-right">{t("k.mk")}</th> : null}
              <th className="w-[88px] px-3 py-2 text-right">{t("k.chg")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-text-secondary">
                  {t("loading")}
                </td>
              </tr>
            ) : !batches ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-text-secondary">
                  <PackageCheck className="mx-auto mb-2 size-6 text-text-disabled" strokeWidth={1.5} aria-hidden />
                  {tr("pick")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-text-secondary">
                  {tr("empty")}
                </td>
              </tr>
            ) : (
              rows.map((b, i) => {
                const cur = current(b);
                const n = next(b);
                const nc = toCents(n);
                const cc = toCents(b.cost);
                const isBad = bad.includes(b);
                const isBelow = below.includes(b);
                const isChanged = changed.includes(b);
                const mk = nc != null && cc != null ? netMarkupPct(nc, cc) : null;
                const chg = nc != null && cur ? pctDiff(nc, toCents(cur) ?? 0n) : null;
                return (
                  <tr key={b.batchId} className={cn("border-b border-border last:border-b-0", isBelow && "bg-danger-bg/40")}>
                    <td className="px-3 py-2 text-text-secondary">{i + 1}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{b.productName}</div>
                      <div className="font-mono text-caption text-text-secondary">
                        {b.productCode}
                        {b.bonus ? ` · ${tr("bonus")}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-mono">{b.batchNumber}</div>
                      <div className="text-caption text-text-secondary">{formatIsoDate(b.expiryDate)}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(b.qty)}</td>
                    {hasCost ? (
                      <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{b.cost ? formatMoney(b.cost) : "—"}</td>
                    ) : null}
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={cur ? "" : "text-warning"}>{cur ? formatMoney(cur) : "—"}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        value={raw[b.batchId] ?? ""}
                        onChange={(e) => setRaw((o) => ({ ...o, [b.batchId]: e.target.value }))}
                        inputMode="decimal"
                        placeholder={cur ? toInput(cur) : ""}
                        aria-label={`${t("k.new")} — ${b.productName} ${b.batchNumber}`}
                        aria-invalid={isBad || undefined}
                        className={cn(
                          "h-8 w-full rounded-md border px-2 text-right tabular-nums outline-none focus:border-primary focus:ring-3 focus:ring-primary/15",
                          isBad || isBelow ? "border-danger" : isChanged ? "border-primary bg-primary-soft" : "border-border bg-surface",
                        )}
                      />
                    </td>
                    {hasCost ? (
                      <td className={cn("px-3 py-2 text-right tabular-nums", mk != null && mk < 0 ? "text-danger" : "text-text-secondary")}>
                        {formatPct(mk)}
                      </td>
                    ) : null}
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        chg == null ? "text-text-secondary" : chg > 0 ? "text-success" : "text-danger",
                      )}
                    >
                      {formatPct(chg)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex items-center justify-end gap-4 border-t border-border bg-surface px-6 py-3">
        <span className="text-[13px] text-text-secondary">
          {tr("foot", { n: formatQuantity(changed.length), m: formatQuantity(below.length) })}
        </span>
        <Button icon={Check} onClick={trySave} disabled={!rows.length}>
          {t("save")}
        </Button>
      </div>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("dlgTitle")}
        primaryAction={{ label: t("save"), onClick: doSave, loading: save.isPending || submit.isPending }}
        secondaryAction={{ label: t("cancel"), onClick: () => setConfirm(false) }}
      >
        <div className="flex flex-col gap-3 text-[13px]">
          <div className="flex items-start gap-2.5">
            <PackageCheck className="mt-0.5 size-4 shrink-0 text-text-secondary" strokeWidth={1.5} aria-hidden />
            <span>{tr("dReceipt", { r: receiptLabel ?? "", t: typeName })}</span>
          </div>
          <div className="flex items-start gap-2.5">
            <CalendarCheck className="mt-0.5 size-4 shrink-0 text-text-secondary" strokeWidth={1.5} aria-hidden />
            <span>{t("d.eff", { n: formatQuantity(changed.length), d: eff })}</span>
          </div>
          <div className="flex items-start gap-2.5">
            <Lock className="mt-0.5 size-4 shrink-0 text-text-secondary" strokeWidth={1.5} aria-hidden />
            <span>{tr("dBatches")}</span>
          </div>
          {below.length ? (
            <div className="flex items-start gap-2.5 text-danger">
              <TrendingDown className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              <span>{t("d.below", { n: formatQuantity(below.length) })}</span>
            </div>
          ) : null}
          {err ? <Alert tone="danger" title={err} /> : null}
        </div>
      </Modal>
    </div>
  );
}
