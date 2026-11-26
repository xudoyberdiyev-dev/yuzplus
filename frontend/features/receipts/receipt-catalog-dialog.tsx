"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/selection-controls";
import { ErrorState, Skeleton } from "@/components/ui/system-states";
import { TextField } from "@/components/ui/text-field";
import { zoneLabel, type Zone } from "@/features/organization/api";
import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { formatMoney, formatQuantity } from "@/lib/format";
import { type CatalogInput, type CatalogPick, collectPicks, EMPTY_INPUT, productSlots, slotKey } from "./receipt-catalog";
import { day } from "./receipts-page";

type CatalogRow = components["schemas"]["ReceiptCatalogPage"]["items"][number];

/**
 * Kirim uchun «Mahsulot qoʻshish» katalogi — BG1 B2 (egasi 26.11.2026): modal oʻrniga toʻliq sahifa (keng jadval, koʻp qator,
 * qidiruv). Kirim qoralamasi shu sahifa ortida saqlanadi — «Qoʻshish va qaytish» yoki «Kirimga qaytish» bilan hech narsa
 * yoʻqolmaydi. BG1 B3: bir mahsulotning ikkinchi (uchinchi…) partiyasi — qatordagi «+ partiya» bilan, katalogni qayta ochmasdan.
 * Boshqa qidiruvda toʻldirilgan qatorlar ham eslab qolinadi va qoʻshiladi.
 */
export function ReceiptCatalogPage({
  warehouseId,
  supplierId,
  zones,
  defaultZone,
  pricesVisible,
  existing,
  header,
  onClose,
  onAdd,
}: {
  warehouseId: number;
  supplierId: number | null;
  zones: Zone[];
  defaultZone: string | null;
  pricesVisible: boolean;
  existing: Set<string>;
  header: string;
  onClose: () => void;
  onAdd: (lines: CatalogPick[]) => void;
}) {
  const t = useTranslations("receipts.catalog");
  const tr = useTranslations("receipts");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [supplierOnly, setSupplierOnly] = useState(supplierId !== null);
  const [zone, setZone] = useState<string | null>(defaultZone ?? (zones[0] ? String(zones[0].id) : null));
  const [inputs, setInputs] = useState<Record<string, CatalogInput>>({});
  const [extra, setExtra] = useState<Record<number, number[]>>({});
  const [known, setKnown] = useState<Record<number, CatalogRow>>({});
  const [tried, setTried] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.querySelector("main")?.scrollTo({ top: 0 });
  }, []);
  const catalog = useQuery({
    queryKey: ["receipts", "catalog", warehouseId, supplierId, q, supplierOnly],
    queryFn: () =>
      unwrap(
        api.GET("/api/receipts/catalog", {
          params: { query: { warehouseId, supplierId: supplierId ?? undefined, q: q || undefined, supplierOnly, size: 200 } },
        }),
      ),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => catalog.data?.items ?? [], [catalog.data]);
  // Toʻldirilgan, lekin hozirgi qidiruvda koʻrinmayotgan mahsulotlar ham qoʻshiladi
  const filledIds = new Set(
    Object.entries(inputs)
      .filter(([, v]) => Object.values(v).some((x) => x.trim()))
      .map(([k]) => Number(k.split(":")[0])),
  );
  const visibleIds = new Set(rows.map((r) => r.productId));
  const hidden = [...filledIds].filter((id) => !visibleIds.has(id) && known[id]).map((id) => known[id]!);
  const all = [...rows, ...hidden];
  const dp = tr("datePlaceholder");
  const { picks, errors } = collectPicks(all, inputs, { zoneId: zone ? Number(zone) : null, pricesVisible, existing });
  const hasErrors = Object.keys(errors).length > 0;
  const hiddenFilled = hidden.reduce((n, r) => n + productSlots(r.productId, inputs).length, 0);

  function set(r: CatalogRow, key: string, field: keyof CatalogInput, value: string) {
    setInputs((m) => ({ ...m, [key]: { ...(m[key] ?? EMPTY_INPUT), [field]: value } }));
    setKnown((k) => (k[r.productId] ? k : { ...k, [r.productId]: r }));
  }

  function addSlot(r: CatalogRow) {
    setExtra((m) => {
      const list = m[r.productId] ?? [];
      const next = (list.length ? Math.max(...list) : 0) + 1;
      return { ...m, [r.productId]: [...list, next] };
    });
  }

  function removeSlot(r: CatalogRow, slot: number) {
    setExtra((m) => ({ ...m, [r.productId]: (m[r.productId] ?? []).filter((x) => x !== slot) }));
    setInputs((m) => {
      const next = { ...m };
      delete next[slotKey(r.productId, slot)];
      return next;
    });
  }

  function add() {
    setTried(true);
    if (hasErrors || picks.length === 0) return;
    onAdd(picks);
  }

  const cell = (
    r: CatalogRow,
    key: string,
    field: keyof CatalogInput,
    label: string,
    width: string,
    opts?: { numeric?: boolean; placeholder?: string; date?: boolean },
  ) => (
    <TextField
      variant={opts?.date ? "date" : "text"}
      label={`${r.name}: ${label}`}
      size="sm"
      value={inputs[key]?.[field] ?? ""}
      onChange={(x) => set(r, key, field, x)}
      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
      inputMode={opts?.numeric || opts?.date ? "numeric" : undefined}
      placeholder={opts?.placeholder}
      className={`${width} [&>label]:sr-only`}
    />
  );

  const inputCells = (r: CatalogRow, key: string) => (
    <>
      <td className="px-1 py-1">{cell(r, key, "batch", t("cell.batch"), "w-32")}</td>
      <td className="px-1 py-1">{cell(r, key, "produced", t("cell.produced"), "w-32", { placeholder: dp, date: true })}</td>
      <td className="px-1 py-1">{cell(r, key, "expiry", t("cell.expiry"), "w-32", { placeholder: dp, date: true })}</td>
      <td className="px-1 py-1">{cell(r, key, "qty", t("cell.qty"), "w-24 [&_input]:text-right", { numeric: true })}</td>
      <td className="px-1 py-1">{cell(r, key, "bonus", t("cell.bonus"), "w-20 [&_input]:text-right", { numeric: true })}</td>
      {pricesVisible ? (
        <td className="px-1 py-1">
          {cell(r, key, "price", t("cell.price"), "w-32 [&_input]:text-right", {
            placeholder: r.lastPrice ? formatMoney(r.lastPrice) : tr("sum"),
          })}
        </td>
      ) : null}
    </>
  );

  const errorFor = (key: string) => (tried && errors[key] ? t(`errors.${errors[key]}`) : undefined);
  const colSpan = pricesVisible ? 9 : 8;
  const primaryLabel = picks.length ? t("addBackCount", { count: picks.length }) : t("addBack");

  return (
    <div className="flex flex-col gap-4" data-screen-label="Kirim katalogi">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <button
            type="button"
            onClick={onClose}
            className="flex w-fit items-center gap-1 text-[13px] font-medium text-link hover:underline"
          >
            <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden />
            {t("backToReceipt")}
          </button>
          <h1 className="text-page-title">{t("title")}</h1>
          <p className="text-caption text-text-secondary">{header}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface p-3">
        <div className="min-w-72 flex-1">
          <TextField
            label={t("search")}
            variant="search"
            value={search}
            autoFocus
            onChange={(v) => {
              setSearch(v);
              clearTimeout(debounce.current);
              debounce.current = setTimeout(() => setQ(v.trim()), 250);
            }}
            placeholder={t("searchPlaceholder")}
            className="[&>label]:sr-only"
          />
        </div>
        <Select
          label={t("zoneAll")}
          value={zone}
          onChange={setZone}
          options={zones.map((z) => ({ value: String(z.id), label: z.name, sub: zoneLabel(z.type) }))}
          className="w-64"
        />
        {supplierId !== null ? <Checkbox label={t("supplierOnly")} checked={supplierOnly} onChange={setSupplierOnly} /> : null}
      </div>
      {hiddenFilled > 0 ? <p className="text-caption text-text-secondary">{t("hiddenFilled", { n: hiddenFilled })}</p> : null}
      {catalog.error ? (
        <ErrorState onRetry={() => catalog.refetch()} />
      ) : catalog.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full text-table" data-testid="receipt-catalog">
            <thead className="sticky top-0 z-10 bg-table-header text-left text-text-secondary">
              <tr>
                <th className="px-3 py-2 font-medium">{t("col.product")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("col.stock")}</th>
                <th className="px-2 py-2 font-medium">{t("col.lastReceipt")}</th>
                <th className="px-2 py-2 font-medium">{t("col.batch")}</th>
                <th className="px-2 py-2 font-medium">{t("col.produced")}</th>
                <th className="px-2 py-2 font-medium">{t("col.expiry")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("col.qty")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("col.bonus")}</th>
                {pricesVisible ? <th className="px-2 py-2 text-right font-medium">{t("col.price")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpan} className="px-3 py-8 text-center text-text-secondary">
                    {supplierOnly ? t("emptySupplier") : t("empty")}
                  </td>
                </tr>
              ) : (
                rows.flatMap((r) => {
                  const key0 = slotKey(r.productId, 0);
                  const err0 = errorFor(key0);
                  const main = (
                    <tr key={key0} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <span className="flex flex-col gap-0.5">
                          <span>
                            <span className="font-mono text-text-secondary">{r.code}</span> {r.name}
                          </span>
                          {r.manufacturer ? <span className="text-caption text-text-secondary">{r.manufacturer}</span> : null}
                          {err0 ? <span className="text-caption text-danger">{err0}</span> : null}
                          <button
                            type="button"
                            onClick={() => addSlot(r)}
                            className="flex w-fit items-center gap-1 text-caption font-medium text-link hover:underline"
                            aria-label={t("addBatchFor", { p: r.name })}
                          >
                            <Plus className="size-3.5" strokeWidth={1.5} aria-hidden />
                            {t("addBatch")}
                          </button>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatQuantity(r.stock)}</td>
                      <td className="px-2 py-2 text-caption whitespace-nowrap text-text-secondary">
                        {r.lastDate ? day(r.lastDate) : "—"}
                        {pricesVisible && r.lastPrice ? <div className="tabular-nums">{formatMoney(r.lastPrice)}</div> : null}
                      </td>
                      {inputCells(r, key0)}
                    </tr>
                  );
                  const subs = (extra[r.productId] ?? []).map((slot, i) => {
                    const key = slotKey(r.productId, slot);
                    const err = errorFor(key);
                    return (
                      <tr key={key} className="align-top bg-background/40" data-testid="catalog-extra-batch">
                        <td className="py-1 pr-2 pl-8" colSpan={3}>
                          <span className="flex items-center gap-2 text-caption text-text-secondary">
                            {t("batchN", { n: i + 2 })}
                            <button
                              type="button"
                              onClick={() => removeSlot(r, slot)}
                              className="rounded-control p-0.5 hover:bg-surface hover:text-danger"
                              aria-label={t("removeBatch", { n: i + 2 })}
                            >
                              <X className="size-3.5" strokeWidth={1.5} aria-hidden />
                            </button>
                          </span>
                          {err ? <span className="text-caption text-danger">{err}</span> : null}
                        </td>
                        {inputCells(r, key)}
                      </tr>
                    );
                  });
                  return [main, ...subs];
                })
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-6 py-3">
        <span className="text-caption text-text-secondary">{t("footer", { price: pricesVisible ? t("footerPrice") : "" })}</span>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("back")}
          </Button>
          <Button onClick={add} disabled={picks.length === 0 && !hasErrors}>
            {primaryLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
