"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookmarkPlus,
  ChevronDown,
  Columns3,
  Copy,
  EyeOff,
  FileSpreadsheet,
  FileText,
  GripVertical,
  History,
  ListPlus,
  MoveRight,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { RowMenu } from "@/components/ui/row-menu";
import { Checkbox } from "@/components/ui/selection-controls";
import { ErrorState, Skeleton } from "@/components/ui/system-states";
import { toast } from "@/components/ui/toast";
import { can } from "@/features/auth/can";
import { ensureCsrf, useMe } from "@/features/auth/session";
import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useFefoPref, withFefo } from "./fefo-invoice-pref";
import { FefoQuestionBody, FefoQuestionModal, useFefoChoice } from "./fefo-question";
import {
  MAX_EXTRA_COLUMNS,
  addSection,
  duplicate,
  grandTotal,
  isRemoved,
  isSection,
  moveToSection,
  nextExtraKey,
  removeExtraColumn,
  removeSection,
  setRemoved,
  toggleHidden,
  viewLines,
  type FormRow,
  type InvoiceDoc,
} from "./invoice-layout";
export type FormType = "WAREHOUSE" | "WAREHOUSE2" | "CLIENT_SEND" | "CLIENT1" | "CLIENT2";

/** O18: 5 faktura turi — nomlari va ustunlari shablondagidek (fakturaning oʻzi kirill). */
export const FORM_TYPES: { type: FormType; title: string; priced: boolean; cols: Col[] }[] = [
  {
    type: "WAREHOUSE",
    title: "Фактура для склада",
    priced: true,
    cols: ["area", "name", "manufacturer", "series", "qty", "expiry", "unit", "price", "total"],
  },
  {
    type: "WAREHOUSE2",
    title: "Фактура для склада №2",
    priced: false,
    cols: ["area", "name", "manufacturer", "series", "qty", "expiry", "unit"],
  },
  {
    type: "CLIENT_SEND",
    title: "Фактура для Клиентов отправка",
    priced: true,
    cols: ["farmId", "name", "manufacturer", "series", "qty", "expiry", "unit", "price", "total"],
  },
  {
    type: "CLIENT1",
    title: "Фактура Для клиента №1",
    priced: true,
    cols: ["name", "manufacturer", "series", "qty", "expiry", "unit", "price", "total"],
  },
  {
    type: "CLIENT2",
    title: "Фактура Для Клиента №2",
    priced: true,
    cols: ["name", "manufacturer", "qty", "expiry", "unit", "price", "total"],
  },
];

type Col = "area" | "farmId" | "name" | "manufacturer" | "series" | "qty" | "expiry" | "unit" | "price" | "total";
type EditCol = Exclude<Col, "total">;

export const COL_TITLES: Record<Col, string> = {
  area: "Худуд",
  farmId: "Фарм ИД",
  name: "Махсулот номи",
  manufacturer: "Ишлаб чикарувчиси",
  series: "Серия",
  qty: "Сони",
  expiry: "Яроклик муддати",
  unit: "Ул/Бирлиги",
  price: "ККС билан Нархи",
  total: "ККС билан Жами киймати (Сумма)",
};

/** Qatorni sudrab koʻchirish: `from` dagi qator `to` oʻrniga (qolganlari suriladi). */
export function moveRow<T>(rows: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return rows;
  const next = [...rows];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** Qator summasi: soni × narx (tiyin aniqligida, float xatosisiz). */
export function rowTotal(qty: number, price: string | null | undefined): string {
  if (!price || !/^\d+(\.\d{1,2})?$/.test(price)) return "0.00";
  const [i, f = ""] = price.split(".");
  const cents = BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
  const total = cents * BigInt(Math.max(0, Math.trunc(qty)));
  const s = total.toString().padStart(3, "0");
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

/**
 * Tuzatilgan kataklar soni: mahsulot qatorlarini asl qatorlar bilan tartib boʻyicha solishtiradi (qoʻshilgan qator — barcha toʻldirilgan
 * kataklari); FT: olib tashlangan qator, boʻlim va qoʻshilgan ustundagi toʻldirilgan katak — bittadan.
 */
export function changedCells(rows: FormRow[], original: FormRow[]): number {
  const cols: EditCol[] = ["area", "farmId", "name", "manufacturer", "series", "qty", "expiry", "unit", "price"];
  const items = rows.filter((r) => !isSection(r));
  let n = rows.length - items.length;
  items.forEach((r, i) => {
    const o = original[i];
    for (const c of cols) if (cellValue(r, c) !== (o ? cellValue(o, c) : "")) n++;
    if (isRemoved(r)) n++;
    n += Object.values(r.extra ?? {}).filter((v) => v.trim() !== "").length;
  });
  return n + Math.max(0, original.length - items.length);
}

function cellValue(r: FormRow, c: EditCol): string {
  const v = r[c];
  if (v === null || v === undefined) return "";
  if (c === "price") return Number(v).toFixed(2);
  return String(v);
}

function withTotal(r: FormRow): FormRow {
  return { ...r, total: r.price == null ? undefined : rowTotal(r.qty, r.price) };
}

/** O25: ombor fakturalari (yigʻilmagan buyurtmada FEFO soʻrovi faqat shularda). */
export function isWarehouseForm(type: FormType): boolean {
  return type === "WAREHOUSE" || type === "WAREHOUSE2";
}

/** O25: «Серия» katagidagi koʻrinish — zahira/taklif belgisi yoki «Yetishmaydi: N». */
export function seriesLabel(r: FormRow, labels: { reserved: string; proposed: string; shortage: (n: number) => string }): string {
  if (r.shortage != null) return labels.shortage(r.shortage);
  if (!r.series || !r.batchHint) return r.series ?? "";
  return `${r.series} (${r.batchHint === "RESERVED" ? labels.reserved : labels.proposed})`;
}

export function InvoiceFormsModal(props: { orderId: number; initial: FormType; onClose: () => void }) {
  const t = useTranslations("orders.invoiceForms");
  const qc = useQueryClient();
  const me = useMe();
  const pref = useFefoPref(me.data?.id);
  const [type, setType] = useState<FormType>(props.initial);
  const [fefoChoice, setFefoChoice] = useState<boolean | null>(null);
  const choice = fefoChoice ?? (pref === "yes" ? true : pref === "no" ? false : null);
  const fefoOn = isWarehouseForm(type) && choice === true;
  const base = ["orders", props.orderId, "invoice-forms"] as const;
  const key = [...base, { fefo: fefoOn, type }];
  const data = useQuery({
    queryKey: key,
    queryFn: () =>
      unwrap(api.GET("/api/orders/{id}/invoice-forms", { params: { path: { id: props.orderId }, query: { fefo: fefoOn, type } } })),
    placeholderData: (prev) => prev,
  });
  const [doc, setDoc] = useState<InvoiceDoc | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const history = useRef<InvoiceDoc[]>([]);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undoCount, setUndoCount] = useState(0);

  function reset() {
    history.current = [];
    setUndoCount(0);
    dirty.current = false;
    setDoc(null);
    setSelected(new Set());
  }

  function setFefo(v: boolean) {
    if (!dirty.current) reset();
    setFefoChoice(v);
  }
  const ask = useFefoChoice(setFefo);

  const done = (r: components["schemas"]["InvoiceForms"]) => {
    void qc.invalidateQueries({ queryKey: base, refetchType: "none" });
    qc.setQueryData(key, r);
  };
  const save = useMutation({
    mutationFn: async (next: InvoiceDoc) => {
      await ensureCsrf();
      return unwrap(
        api.PUT("/api/orders/{id}/invoice-forms", {
          params: { path: { id: props.orderId }, query: { type } },
          body: { rows: next.rows.map((r) => ({ ...r, total: undefined })), extraColumns: next.extraColumns, hidden: next.hidden },
        }),
      );
    },
    onSuccess: (r) => {
      dirty.current = false;
      done(r);
    },
  });
  const revert = useMutation({
    mutationFn: async () => {
      await ensureCsrf();
      return unwrap(api.DELETE("/api/orders/{id}/invoice-forms", { params: { path: { id: props.orderId }, query: { type } } }));
    },
    onSuccess: (r) => {
      reset();
      done(r);
    },
  });
  const template = useMutation({
    mutationFn: async (action: "save" | "apply" | "delete") => {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current && doc) await save.mutateAsync(doc);
      await ensureCsrf();
      const params = { path: { id: props.orderId, type } };
      if (action === "save") return unwrap(api.PUT("/api/orders/{id}/invoice-forms/template/{type}", { params }));
      if (action === "apply") return unwrap(api.POST("/api/orders/{id}/invoice-forms/template/{type}/apply", { params }));
      return unwrap(api.DELETE("/api/orders/{id}/invoice-forms/template/{type}", { params }));
    },
    onSuccess: (r, action) => {
      if (action === "apply") {
        if (doc) history.current.push(doc);
        setUndoCount(history.current.length);
        dirty.current = false;
        setDoc(null);
        setSelected(new Set());
      }
      done(r);
      toast({
        tone: "success",
        title: t(action === "save" ? "templateSaved" : action === "apply" ? "templateApplied" : "templateDeleted"),
      });
    },
    onError: () => toast({ tone: "danger", title: t("saveError") }),
  });

  const f = data.data;
  const canEdit = !!f?.canEdit && !!f?.canSeePrices;
  /** Yigʻilmagan, tuzatilmagan buyurtmaning ombor fakturasi — FEFO soʻraladi. */
  const fefoApplies = !!f && !f.picked && !f.edited && isWarehouseForm(type);
  const asking = fefoApplies && choice === null;
  const labels = {
    reserved: t("hintReserved"),
    proposed: t("hintProposed"),
    shortage: (n: number) => t("shortage", { n }),
  };
  const types = FORM_TYPES.filter((x) => !x.priced || f?.canSeePrices);
  const form = FORM_TYPES.find((x) => x.type === type) ?? FORM_TYPES[1];
  const current: InvoiceDoc = useMemo(
    () => doc ?? { rows: f?.rows ?? [], extraColumns: f?.extraColumns ?? [], hidden: f?.hidden ?? {} },
    [doc, f],
  );
  const rows = current.rows;
  const hidden = new Set(current.hidden[type] ?? []);
  const total = (r: FormRow) => (r.price == null ? "0.00" : rowTotal(r.qty, r.price));
  const lines = viewLines(rows, total);
  const grand = grandTotal(rows, total);
  const removed = rows.map((r, i) => ({ r, i })).filter((x) => isRemoved(x.r));
  const sections = rows.map((r, i) => ({ r, i })).filter((x) => isSection(x.r));
  const changed = f ? changedCells(rows, f.original) : 0;
  const allCols: { key: string; title: string; extra?: boolean }[] = [
    { key: "no", title: "№" },
    ...form.cols.map((c) => ({ key: c, title: COL_TITLES[c] })),
    ...current.extraColumns.map((c) => ({ key: c.key, title: c.title, extra: true })),
  ];
  const hiddenTitles = allCols.filter((c) => hidden.has(c.key)).map((c) => c.title);
  const visibleRowIndexes = lines.flatMap((l) => (l.kind === "row" ? [l.index] : []));
  const hasTemplate = !!f?.templates.includes(type);

  function update(next: InvoiceDoc) {
    history.current.push(current);
    if (history.current.length > 100) history.current.shift();
    setUndoCount(history.current.length);
    setDoc(next);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save.mutate(next), 800);
  }
  const updateRows = (next: FormRow[]) => update({ ...current, rows: next });

  function setCell(i: number, c: EditCol, v: string) {
    updateRows(
      rows.map((r, j) => {
        if (j !== i) return r;
        if (c === "qty") return withTotal({ ...r, qty: Math.max(0, Number(v.replace(/\D/g, "").slice(0, 7)) || 0) });
        if (c === "price") return withTotal({ ...r, price: v.replace(",", ".").replace(/[^\d.]/g, "") || "0" });
        return { ...r, [c]: v };
      }),
    );
  }

  function setExtra(i: number, k: string, v: string) {
    updateRows(rows.map((r, j) => (j === i ? { ...r, extra: { ...r.extra, [k]: v } } : r)));
  }

  function undo() {
    const prev = history.current.pop();
    setUndoCount(history.current.length);
    if (!prev) return;
    setDoc(prev);
    setSelected(new Set());
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save.mutate(prev), 800);
  }

  function withSelection(next: FormRow[]) {
    updateRows(next);
    setSelected(new Set());
    setMoveOpen(false);
  }

  function addColumn() {
    if (current.extraColumns.length >= MAX_EXTRA_COLUMNS) return;
    update({ ...current, extraColumns: [...current.extraColumns, { key: nextExtraKey(current.extraColumns), title: t("newColumn") }] });
  }

  const dragFrom = useRef<number | null>(null);

  async function download(format: "xlsx" | "pdf" = "xlsx") {
    if (timer.current) clearTimeout(timer.current);
    if (dirty.current && canEdit) await save.mutateAsync(current);
    window.open(withFefo(`/api/orders/${props.orderId}/invoice-forms/${type}/${format}`, fefoOn), "_blank", "noopener");
  }

  /** Excel kabi: Enter — pastdagi katak, ↑/↓ — qatorlar boʻylab; Ctrl+Z — bekor qilish. */
  function onKey(e: KeyboardEvent<HTMLInputElement>, i: number, c: string) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
      return;
    }
    const down = e.key === "Enter" || e.key === "ArrowDown";
    const up = e.key === "ArrowUp";
    if (!down && !up) return;
    e.preventDefault();
    const at = visibleRowIndexes.indexOf(i) + (down ? 1 : -1);
    const target = document.querySelector<HTMLInputElement>(`[data-cell="${visibleRowIndexes[at]}:${c}"]`);
    target?.focus();
  }

  const numeric = (c: string) => c === "qty" || c === "price" || c === "total";
  const off = (c: string) => (hidden.has(c) ? "text-text-disabled line-through" : "");
  const colSpan = allCols.length + (canEdit ? 1 : 0);
  const qtyAt = allCols.findIndex((c) => c.key === "qty");
  const totalAt = allCols.findIndex((c) => c.key === "total");

  /** «Boʻlim jami» / «Жами» qatori: soni va summa oʻz ustunida. */
  function totalsRow(label: string, qty: number, sum: string, strong: boolean) {
    return (
      <>
        {canEdit ? <td /> : null}
        {allCols.map((c, k) => (
          <td
            key={c.key}
            className={`px-2 py-1 ${numeric(c.key) ? "text-right tabular-nums" : ""} ${strong ? "font-semibold" : "text-text-secondary"}`}
          >
            {k === 1 ? label : k === qtyAt ? qty : k === totalAt && form.priced ? formatMoney(sum) : ""}
          </td>
        ))}
      </>
    );
  }

  return (
    <Modal
      open
      onClose={props.onClose}
      size="lg"
      title={t("title")}
      primaryAction={
        asking
          ? { label: t("fefoYes"), onClick: () => ask.choose(true) }
          : { label: t("download"), onClick: () => void download(), loading: save.isPending, disabled: !f || data.isPlaceholderData }
      }
      secondaryAction={asking ? { label: t("fefoNo"), onClick: () => ask.choose(false) } : { label: t("close"), onClick: props.onClose }}
    >
      <div className="flex flex-col gap-3">
        <div role="tablist" aria-label={t("types")} className="flex flex-wrap gap-2">
          {types.map((x) => (
            <button
              key={x.type}
              type="button"
              role="tab"
              aria-selected={x.type === type}
              onClick={() => {
                setType(x.type);
                setColumnsOpen(false);
              }}
              className={`rounded-full border px-3 py-1 text-caption ${x.type === type ? "border-primary bg-primary-soft text-primary" : "border-border"}`}
            >
              {x.title}
            </button>
          ))}
        </div>
        {asking ? null : <Alert tone="info" title={t("note")} />}
        {data.error ? (
          <ErrorState onRetry={() => data.refetch()} />
        ) : !f ? (
          <Skeleton className="h-40" />
        ) : asking ? (
          <FefoQuestionBody remember={ask.remember} setRemember={ask.setRemember} />
        ) : (
          <>
            {fefoApplies ? (
              <div className="flex flex-wrap items-center gap-2 text-caption" role="radiogroup" aria-label={t("fefoSwitch")}>
                <span className="text-text-secondary">{t("fefoSwitch")}:</span>
                {([true, false] as const).map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    role="radio"
                    aria-checked={choice === v}
                    onClick={() => setFefo(v)}
                    className={`rounded-full border px-3 py-1 ${choice === v ? "border-primary bg-primary-soft text-primary" : "border-border"}`}
                  >
                    {v ? t("fefoOn") : t("fefoOff")}
                  </button>
                ))}
              </div>
            ) : null}
            {f.fefo ? <Alert tone="warning" title={t("fefoNote")} /> : null}
            {f.templateApplied && !doc ? <p className="text-caption text-text-secondary">{t("templateInUse")}</p> : null}
            <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-caption text-text-secondary">
              <span aria-live="polite" className="mr-2">
                {t("changed", { n: changed })}
                {save.isPending ? ` · ${t("saving")}` : ""}
              </span>
              {canEdit ? (
                <Button size="sm" variant="tertiary" icon={Undo2} disabled={undoCount === 0} onClick={undo}>
                  {t("undo")}
                </Button>
              ) : null}
              <div className="relative">
                <Button size="sm" variant="secondary" icon={Columns3} aria-expanded={columnsOpen} onClick={() => setColumnsOpen((o) => !o)}>
                  {hidden.size ? t("columnsHidden", { n: hidden.size }) : t("columns")}
                </Button>
                {columnsOpen ? (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setColumnsOpen(false)} aria-hidden />
                    <div
                      role="group"
                      aria-label={t("columnsHint")}
                      className="absolute top-9 left-0 z-50 max-h-[420px] w-[300px] overflow-y-auto rounded-card border border-border bg-surface p-2 shadow-overlay"
                    >
                      <div className="px-1 pb-1.5 text-caption font-semibold tracking-wide text-text-secondary uppercase">
                        {t("columnsHint")}
                      </div>
                      {allCols.map((c) => (
                        <div key={c.key} className="flex items-center gap-1">
                          <Checkbox
                            className="flex-1 py-1"
                            label={c.extra ? `${c.title} (${t("added")})` : c.title}
                            checked={!hidden.has(c.key)}
                            disabled={!canEdit || c.key === "name"}
                            onChange={() => update({ ...current, hidden: toggleHidden(current.hidden, type, c.key) })}
                          />
                          {c.extra && canEdit ? (
                            <Button
                              size="sm"
                              variant="icon"
                              icon={X}
                              aria-label={t("removeColumn", { name: c.title })}
                              onClick={() => update(removeExtraColumn(current, c.key))}
                            />
                          ) : null}
                        </div>
                      ))}
                      {canEdit ? (
                        <div className="mt-1 border-t border-border pt-1">
                          <Button
                            size="sm"
                            variant="tertiary"
                            icon={Plus}
                            disabled={current.extraColumns.length >= MAX_EXTRA_COLUMNS}
                            onClick={addColumn}
                          >
                            {t("addColumn")}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
              {canEdit ? (
                <>
                  <Button
                    size="sm"
                    variant="tertiary"
                    icon={Plus}
                    onClick={() => updateRows([...rows, { name: t("newRow"), qty: 1, price: "0", total: "0.00" }])}
                  >
                    {t("addRow")}
                  </Button>
                  <Button
                    size="sm"
                    variant="tertiary"
                    icon={ListPlus}
                    onClick={() => withSelection(addSection(rows, t("newSection"), selected))}
                  >
                    {t("addSection")}
                  </Button>
                  <Button
                    size="sm"
                    variant="tertiary"
                    icon={Columns3}
                    disabled={current.extraColumns.length >= MAX_EXTRA_COLUMNS}
                    onClick={addColumn}
                  >
                    {t("addColumn")}
                  </Button>
                </>
              ) : null}
              <span className="ml-auto flex flex-wrap items-center gap-1">
                {canEdit ? (
                  <>
                    <Button
                      size="sm"
                      variant="tertiary"
                      icon={BookmarkPlus}
                      loading={template.isPending}
                      onClick={() => template.mutate("save")}
                    >
                      {t("templateSave")}
                    </Button>
                    {hasTemplate ? (
                      <RowMenu
                        label={t("templateMenu")}
                        items={[
                          {
                            key: "apply",
                            label: t("templateApply"),
                            icon: <History size={16} strokeWidth={1.5} aria-hidden />,
                            onSelect: () => template.mutate("apply"),
                          },
                          {
                            key: "delete",
                            label: t("templateDelete"),
                            icon: <Trash2 size={16} strokeWidth={1.5} aria-hidden />,
                            onSelect: () => template.mutate("delete"),
                          },
                        ]}
                      />
                    ) : null}
                    <Button
                      size="sm"
                      variant="tertiary"
                      icon={RotateCcw}
                      disabled={!f.edited}
                      loading={revert.isPending}
                      onClick={() => revert.mutate()}
                    >
                      {t("revert")}
                    </Button>
                  </>
                ) : null}
                <Button size="sm" variant="tertiary" icon={FileText} disabled={save.isPending} onClick={() => void download("pdf")}>
                  {t("pdf")}
                </Button>
              </span>
            </div>
            {canEdit && selected.size > 0 ? (
              <div
                className="flex flex-wrap items-center gap-2 rounded-card bg-brand-900 px-3 py-2 text-caption text-on-solid"
                role="toolbar"
                aria-label={t("selection", { n: selected.size })}
              >
                <span className="mr-2 font-semibold">{t("selection", { n: selected.size })}</span>
                <Button size="sm" variant="danger" icon={Trash2} onClick={() => withSelection(setRemoved(rows, selected, true))}>
                  {t("removeRows")}
                </Button>
                <div className="relative">
                  <Button size="sm" variant="secondary" icon={MoveRight} aria-expanded={moveOpen} onClick={() => setMoveOpen((o) => !o)}>
                    {t("moveToSection")}
                  </Button>
                  {moveOpen ? (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMoveOpen(false)} aria-hidden />
                      <div
                        role="menu"
                        className="absolute top-9 left-0 z-50 w-[260px] rounded-card border border-border bg-surface p-1 text-text-primary shadow-overlay"
                      >
                        {sections.map((s) => (
                          <button
                            key={s.i}
                            type="button"
                            role="menuitem"
                            onClick={() => withSelection(moveToSection(rows, selected, s.i))}
                            className="flex h-8 w-full items-center rounded-[6px] px-2 text-left text-[13px] hover:bg-table-header"
                          >
                            {s.r.name}
                          </button>
                        ))}
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => withSelection(addSection(rows, t("newSection"), selected))}
                          className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[13px] font-medium text-link hover:bg-table-header"
                        >
                          <Plus size={16} strokeWidth={1.5} aria-hidden />
                          {t("newSectionFromSelection")}
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
                <Button size="sm" variant="secondary" icon={Copy} onClick={() => withSelection(duplicate(rows, selected))}>
                  {t("duplicate")}
                </Button>
                <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setSelected(new Set())}>
                  {t("clearSelection")}
                </Button>
              </div>
            ) : null}
            <div className="max-h-[50vh] overflow-auto rounded-card border border-border">
              <table className="w-full min-w-[880px] text-caption">
                <thead className="sticky top-0 z-10 bg-table-header">
                  <tr>
                    {canEdit ? (
                      <th className="w-8 px-2 py-1">
                        <Checkbox
                          aria-label={t("selectAll")}
                          checked={visibleRowIndexes.length > 0 && selected.size === visibleRowIndexes.length}
                          indeterminate={selected.size > 0 && selected.size < visibleRowIndexes.length}
                          onChange={(v) => setSelected(new Set(v ? visibleRowIndexes : []))}
                        />
                      </th>
                    ) : null}
                    {allCols.map((c) => (
                      <th
                        key={c.key}
                        className={`px-2 py-1 ${numeric(c.key) ? "text-right" : "text-left"} ${off(c.key)}`}
                        title={hidden.has(c.key) ? t("hiddenColumn") : undefined}
                      >
                        {c.extra && canEdit ? (
                          <input
                            aria-label={t("columnName")}
                            value={c.title}
                            maxLength={60}
                            onChange={(e) =>
                              update({
                                ...current,
                                extraColumns: current.extraColumns.map((x) => (x.key === c.key ? { ...x, title: e.target.value } : x)),
                              })
                            }
                            className="w-full min-w-24 rounded-control border border-transparent bg-transparent px-1 font-semibold focus:border-primary focus:outline-none"
                          />
                        ) : (
                          c.title
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    if (l.kind === "section")
                      return (
                        <tr key={`s${l.index}`} className="border-t border-border bg-success-bg">
                          <td colSpan={colSpan} className="px-2 py-1">
                            <span className="flex items-center gap-2">
                              <ChevronDown size={14} strokeWidth={1.5} aria-hidden className="text-primary" />
                              {canEdit ? (
                                <input
                                  aria-label={t("sectionName")}
                                  value={l.title}
                                  maxLength={300}
                                  onChange={(e) => updateRows(rows.map((r, j) => (j === l.index ? { ...r, name: e.target.value } : r)))}
                                  className="field-sizing-content min-w-24 rounded-control border border-transparent bg-transparent px-1 font-semibold text-primary focus:border-primary focus:outline-none"
                                />
                              ) : (
                                <span className="font-semibold text-primary">{l.title}</span>
                              )}
                              <span className="text-text-secondary">· {t("sectionRows", { n: l.count })}</span>
                              {canEdit ? (
                                <Button
                                  size="sm"
                                  variant="icon"
                                  icon={Trash2}
                                  className="ml-auto"
                                  aria-label={t("removeSection", { name: l.title })}
                                  onClick={() => withSelection(removeSection(rows, l.index))}
                                />
                              ) : null}
                            </span>
                          </td>
                        </tr>
                      );
                    if (l.kind === "subtotal")
                      return (
                        <tr key={`t${l.section}`} className="border-t border-border">
                          {totalsRow(t("sectionTotal"), l.qty, l.sum, false)}
                        </tr>
                      );
                    const i = l.index;
                    const r = rows[i];
                    const o = f.original[l.item];
                    const isSel = selected.has(i);
                    return (
                      <tr
                        key={i}
                        className={`border-t border-border ${isSel ? "bg-danger-bg" : ""}`}
                        onDragOver={canEdit ? (e) => e.preventDefault() : undefined}
                        onDrop={
                          canEdit
                            ? (e) => {
                                e.preventDefault();
                                const from = dragFrom.current;
                                dragFrom.current = null;
                                if (from != null && from !== i) updateRows(moveRow(rows, from, i));
                              }
                            : undefined
                        }
                      >
                        {canEdit ? (
                          <td className="px-2 py-1">
                            <Checkbox
                              aria-label={t("selectRow", { n: l.no })}
                              checked={isSel}
                              onChange={(v) => {
                                const next = new Set(selected);
                                if (v) next.add(i);
                                else next.delete(i);
                                setSelected(next);
                              }}
                            />
                          </td>
                        ) : null}
                        {allCols.map((col) => {
                          const c = col.key;
                          if (c === "no")
                            return (
                              <td key={c} className={`px-2 py-1 tabular-nums ${off(c)}`}>
                                {canEdit ? (
                                  <span
                                    draggable
                                    onDragStart={(e) => {
                                      dragFrom.current = i;
                                      e.dataTransfer.effectAllowed = "move";
                                    }}
                                    title={t("drag")}
                                    className="inline-flex cursor-grab items-center gap-1 text-text-secondary"
                                  >
                                    <GripVertical size={14} strokeWidth={1.5} aria-hidden />
                                    <span className={hidden.has(c) ? "" : "text-text-primary"}>{l.no}</span>
                                  </span>
                                ) : (
                                  l.no
                                )}
                              </td>
                            );
                          if (c === "total")
                            return (
                              <td key={c} className={`px-2 py-1 text-right tabular-nums ${off(c)}`}>
                                {r.price == null ? "" : formatMoney(rowTotal(r.qty, r.price))}
                              </td>
                            );
                          if (col.extra) {
                            const v = r.extra?.[c] ?? "";
                            return (
                              <td key={c} className={`px-1 py-0.5 ${v ? "bg-warning-bg" : ""} ${off(c)}`}>
                                {canEdit ? (
                                  <input
                                    data-cell={`${i}:${c}`}
                                    aria-label={`${col.title} — ${l.no}`}
                                    value={v}
                                    maxLength={200}
                                    onChange={(e) => setExtra(i, c, e.target.value)}
                                    onKeyDown={(e) => onKey(e, i, c)}
                                    className="w-full rounded-control border border-transparent bg-transparent px-1 py-0.5 focus:border-primary focus:outline-none"
                                  />
                                ) : (
                                  v
                                )}
                              </td>
                            );
                          }
                          const ec = c as EditCol;
                          const value = cellValue(r, ec);
                          const was = o ? cellValue(o, ec) : "";
                          const edited = value !== was;
                          const hinted = !!r.batchHint && (c === "series" || c === "expiry");
                          const short = c === "series" && r.shortage != null;
                          return (
                            <td
                              key={c}
                              className={`px-1 py-0.5 ${c === "series" ? "min-w-32" : ""} ${(edited || hinted) && !hidden.has(c) ? "bg-warning-bg" : ""} ${off(c)}`}
                              title={
                                edited
                                  ? t("original", { v: was || "—" })
                                  : hinted
                                    ? r.batchHint === "RESERVED"
                                      ? labels.reserved
                                      : labels.proposed
                                    : undefined
                              }
                            >
                              {canEdit ? (
                                <input
                                  data-cell={`${i}:${c}`}
                                  aria-label={`${COL_TITLES[ec]} — ${l.no}`}
                                  value={c === "price" ? (r.price ?? "") : c === "qty" ? String(r.qty) : (r[ec] ?? "")}
                                  onChange={(e) => setCell(i, ec, e.target.value)}
                                  onKeyDown={(e) => onKey(e, i, c)}
                                  inputMode={c === "qty" || c === "price" ? "decimal" : undefined}
                                  placeholder={short ? seriesLabel(r, labels) : undefined}
                                  className={`w-full rounded-control border border-transparent bg-transparent px-1 py-0.5 focus:border-primary focus:outline-none ${
                                    c === "qty" || c === "price" ? "text-right tabular-nums" : ""
                                  } ${hidden.has(c) ? "line-through" : ""} ${short ? "placeholder:font-semibold placeholder:text-danger" : ""}`}
                                />
                              ) : null}
                              {canEdit && hinted && c === "series" ? (
                                <span className="block px-1 text-caption text-text-secondary">
                                  {r.batchHint === "RESERVED" ? labels.reserved : labels.proposed}
                                </span>
                              ) : null}
                              {canEdit ? null : (
                                <span
                                  className={
                                    c === "qty" || c === "price"
                                      ? "block text-right tabular-nums"
                                      : short
                                        ? "font-semibold text-danger"
                                        : ""
                                  }
                                >
                                  {c === "price"
                                    ? r.price == null
                                      ? ""
                                      : formatMoney(r.price)
                                    : c === "series"
                                      ? seriesLabel(r, labels)
                                      : value}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border">{totalsRow("Жами", grand.qty, grand.sum, true)}</tr>
                </tfoot>
              </table>
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-secondary">
              <span className="inline-flex items-center gap-1">
                <Trash2 size={14} strokeWidth={1.5} aria-hidden />
                {t("removedCount", { n: removed.length })}
              </span>
              {hiddenTitles.length ? (
                <span className="inline-flex items-center gap-1">
                  <EyeOff size={14} strokeWidth={1.5} aria-hidden />
                  {t("hiddenNote", { cols: hiddenTitles.join(", ") })}
                </span>
              ) : null}
              {f.edited && f.editedBy && f.editedAt ? (
                <span>{t("savedBy", { who: f.editedBy, at: formatDateTime(new Date(f.editedAt)) })}</span>
              ) : null}
            </p>
            {removed.length ? (
              <section aria-label={t("removedTitle")} className="rounded-card border border-border">
                <h3 className="border-b border-border bg-table-header px-3 py-1.5 text-caption font-semibold">{t("removedTitle")}</h3>
                <ul>
                  {removed.map(({ r, i }) => (
                    <li key={i} className="flex items-center gap-3 border-t border-border px-3 py-1 text-caption first:border-t-0">
                      <span className="flex-1 text-text-secondary line-through">{r.name}</span>
                      <span className="tabular-nums text-text-secondary">{r.qty}</span>
                      {canEdit ? (
                        <>
                          <Button size="sm" variant="tertiary" icon={Undo2} onClick={() => updateRows(setRemoved(rows, [i], false))}>
                            {t("restore")}
                          </Button>
                          <Button
                            size="sm"
                            variant="icon"
                            icon={Trash2}
                            aria-label={t("deleteRow")}
                            onClick={() => updateRows(rows.filter((_, j) => j !== i))}
                          />
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {save.error ? <p className="text-caption text-danger">{t("saveError")}</p> : null}
          </>
        )}
      </div>
    </Modal>
  );
}

/** Ommaviy fakturalar (reys, joʻnatishga tanlanganlar): 5 tur × Excel/PDF — bitta fayl, har buyurtma alohida varaq/sahifa. */
export function InvoiceFormsMenu({ orderIds }: { orderIds: number[] }) {
  const t = useTranslations("orders.tripPage");
  const me = useMe();
  const pref = useFefoPref(me.data?.id);
  const [pending, setPending] = useState<string | null>(null);
  if (orderIds.length === 0) return null;
  const open = (url: string, fefo: boolean) => window.open(withFefo(url, fefo), "_blank", "noopener");
  return (
    <>
      {pending ? (
        <FefoQuestionModal
          onClose={() => setPending(null)}
          onChoose={(fefo) => {
            open(pending, fefo);
            setPending(null);
          }}
        />
      ) : null}
      <RowMenu
        label={t("invoiceFormsXlsx")}
        trigger={{ icon: FileSpreadsheet, text: t("invoiceFormsXlsx") }}
        items={FORM_TYPES.filter((f) => !f.priced || can(me.data, "prices.view")).flatMap((f) =>
          (["xlsx", "pdf"] as const).map((fmt) => ({
            key: `${f.type}-${fmt}`,
            label: `${f.title} · ${fmt === "xlsx" ? "Excel" : "PDF"}`,
            icon:
              fmt === "xlsx" ? (
                <FileSpreadsheet size={16} strokeWidth={1.5} aria-hidden />
              ) : (
                <FileText size={16} strokeWidth={1.5} aria-hidden />
              ),
            onSelect: () => {
              const url = `/api/orders/invoice-forms/${f.type}/${fmt}?ids=${orderIds.join(",")}`;
              // O25: ombor fakturasida soʻrov bir marta (yigʻilgan buyurtmalarda server FEFO ni eʼtiborsiz qoldiradi)
              if (!isWarehouseForm(f.type)) open(url, false);
              else if (pref === "ask") setPending(url);
              else open(url, pref === "yes");
            },
          })),
        )}
      />
    </>
  );
}
