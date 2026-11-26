"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, PackageOpen, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { EmptyState, ErrorState, ForbiddenState, NoResultsState } from "@/components/ui/system-states";
import { Table, type TableColumn } from "@/components/ui/table";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { can } from "@/features/auth/can";
import { ensureCsrf, useMe, useScopeBranchId } from "@/features/auth/session";
import { formatIsoDate, parseUzDate } from "@/features/counterparties/api";
import { useBranchList } from "@/features/organization/api";
import { describeError } from "@/features/setup/form-error";
import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { formatQuantity } from "@/lib/format";
import { validateBatchEdit, type BatchEditForm } from "./batch-edit";

type Row = components["schemas"]["EditableBatch"];
export const BATCH_EDIT = "stock.batchEdit";

/**
 * BG1 B1 (egasi 26.11.2026): «Qoldiqdagi partiyalarni tahrirlash» — alohida sahifa. Filial omborlarida qoldigʻi bor
 * partiyalar; har birining raqami, ishlab chiqarilgan sanasi va yaroqlilik muddati tahrirlanadi (sabab majburiy, tarix va
 * audit). Oʻtkazilgan hujjatlar oʻzgarmaydi.
 */
export function BatchEditPage() {
  const t = useTranslations("stock.batchEdit");
  const me = useMe();
  const scope = useScopeBranchId();
  const branches = useBranchList();
  const active = (branches.data ?? []).filter((b) => b.active);
  const [pick, setPick] = useState<number | null>(null);
  const own = me.data && !me.data.allBranches ? (me.data.branchId ?? null) : null;
  const branchId = own ?? pick ?? scope ?? active[0]?.id ?? null;
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);
  const [edit, setEdit] = useState<Row | null>(null);
  const list = useQuery({
    queryKey: ["stock", "batch-edit", branchId, debounced],
    queryFn: () => unwrap(api.GET("/api/stock/batch-edit", { params: { query: { branchId: branchId ?? 0, q: debounced || undefined } } })),
    enabled: branchId !== null && !!me.data && can(me.data, BATCH_EDIT),
  });

  if (me.data && !can(me.data, BATCH_EDIT)) return <ForbiddenState description={t("forbidden")} />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  const rows = list.data?.items ?? [];
  const columns: TableColumn<Row>[] = [
    { key: "code", title: t("cCode"), width: 100, mono: true, render: (r) => r.productCode },
    { key: "name", title: t("cProduct"), wrap: true, render: (r) => r.productName },
    { key: "number", title: t("cNumber"), width: 160, mono: true, render: (r) => r.number },
    { key: "produced", title: t("cProduced"), width: 130, render: (r) => formatIsoDate(r.producedOn) || "—" },
    { key: "expiry", title: t("cExpiry"), width: 130, render: (r) => formatIsoDate(r.expiryDate) },
    { key: "qty", title: t("cQty"), width: 90, align: "right", render: (r) => formatQuantity(r.qty) },
    {
      key: "edits",
      title: t("cEdits"),
      width: 110,
      align: "right",
      render: (r) => (r.edits ? t("editsN", { n: r.edits }) : "—"),
    },
  ];

  return (
    <div className="flex flex-col gap-4" data-screen-label="Partiyalarni tahrirlash">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-page-title">{t("title")}</h1>
          <p className="text-caption text-text-secondary">{t("subtitle")}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Select
            label={t("branch")}
            value={branchId ? String(branchId) : null}
            disabled={own !== null}
            onChange={(v) => setPick(v ? Number(v) : null)}
            options={active.map((b) => ({ value: String(b.id), label: b.name, sub: b.code }))}
          />
        </div>
        <div className="w-[380px] max-w-full">
          <TextField label={t("search")} variant="search" value={q} onChange={setQ} placeholder={t("searchPh")} />
        </div>
      </div>
      {list.data?.truncated ? <Alert tone="info" title={t("truncated")} /> : null}
      <Table
        caption={t("title")}
        columns={columns}
        rows={rows}
        rowKey={(r) => String(r.batchId)}
        loading={list.isPending && branchId !== null}
        onRowClick={(r) => setEdit(r)}
        rowActions={(r) => (
          <Button variant="tertiary" size="sm" icon={Pencil} onClick={() => setEdit(r)}>
            {t("edit")}
          </Button>
        )}
        emptyState={
          debounced ? (
            <NoResultsState onClearFilters={() => setQ("")} />
          ) : (
            <EmptyState icon={PackageOpen} title={t("emptyT")} description={t("emptyD")} />
          )
        }
      />
      {edit && branchId !== null ? <EditDialog row={edit} branchId={branchId} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function EditDialog({ row, branchId, onClose }: { row: Row; branchId: number; onClose: () => void }) {
  const t = useTranslations("stock.batchEdit");
  const qc = useQueryClient();
  const [f, setF] = useState<BatchEditForm>({
    number: row.number,
    produced: formatIsoDate(row.producedOn),
    expiry: formatIsoDate(row.expiryDate),
    reason: "",
  });
  const [tried, setTried] = useState(false);
  const errors = validateBatchEdit(f, row, parseUzDate);
  const history = useQuery({
    queryKey: ["stock", "batch-edit", "history", row.batchId, branchId],
    queryFn: () =>
      unwrap(api.GET("/api/stock/batch-edit/{batchId}/history", { params: { path: { batchId: row.batchId }, query: { branchId } } })),
  });
  const save = useMutation({
    mutationFn: async () => {
      await ensureCsrf();
      return unwrap(
        api.PUT("/api/stock/batch-edit/{batchId}", {
          params: { path: { batchId: row.batchId } },
          body: {
            branchId,
            number: f.number.trim(),
            producedOn: parseUzDate(f.produced) ?? undefined,
            expiryDate: parseUzDate(f.expiry) ?? "",
            reason: f.reason.trim(),
          },
        }),
      );
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["stock"] });
      toast({ tone: "success", title: t("saved"), description: `${r.productName} · ${r.number}` });
      onClose();
    },
  });
  const set = (k: keyof BatchEditForm) => (v: string) => setF((o) => ({ ...o, [k]: v }));
  const err = (k: keyof BatchEditForm) => (tried && errors[k] ? t(`e.${errors[k]}`) : undefined);
  const serverErr = save.error ? describeError(save.error).message : undefined;
  return (
    <Modal
      open
      size="md"
      onClose={() => !save.isPending && onClose()}
      title={t("dlgTitle", { p: row.productName })}
      primaryAction={{
        label: t("save"),
        loading: save.isPending,
        onClick: () => {
          setTried(true);
          if (Object.keys(errors).length === 0) save.mutate();
        },
      }}
    >
      <div className="flex flex-col gap-4">
        <p className="text-caption text-text-secondary">{t("dlgHint", { q: formatQuantity(row.qty) })}</p>
        <TextField label={t("cNumber")} required value={f.number} onChange={set("number")} error={err("number")} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField
            variant="date"
            label={t("cProduced")}
            value={f.produced}
            onChange={set("produced")}
            placeholder="kk.oo.yyyy"
            inputMode="numeric"
            error={err("produced")}
          />
          <TextField
            variant="date"
            label={t("cExpiry")}
            required
            value={f.expiry}
            onChange={set("expiry")}
            placeholder="kk.oo.yyyy"
            inputMode="numeric"
            error={err("expiry")}
          />
        </div>
        <TextField label={t("reason")} required value={f.reason} onChange={set("reason")} error={err("reason")} hint={t("reasonHint")} />
        {serverErr ? <Alert tone="danger" title={serverErr} /> : null}
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold">
            <History className="size-4" strokeWidth={1.5} aria-hidden />
            {t("history")}
          </span>
          {history.isPending ? (
            <span className="text-caption text-text-secondary">{t("loading")}</span>
          ) : !history.data?.length ? (
            <span className="text-caption text-text-secondary">{t("noHistory")}</span>
          ) : (
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {history.data.map((h, i) => (
                <li key={i} className="rounded-control bg-background px-2.5 py-1.5">
                  <div className="text-caption text-text-secondary">
                    {new Date(h.at).toLocaleString("ru-RU", { timeZone: "Asia/Tashkent" })} · {h.employee ?? "—"}
                  </div>
                  <div>
                    {h.oldNumber} → {h.newNumber}; {formatIsoDate(h.oldExpiry)} → {formatIsoDate(h.newExpiry)}
                    {h.oldProduced !== h.newProduced
                      ? `; ${formatIsoDate(h.oldProduced) || "—"} → ${formatIsoDate(h.newProduced) || "—"}`
                      : ""}
                  </div>
                  <div className="text-text-secondary">{h.reason}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
