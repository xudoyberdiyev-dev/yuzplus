"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { CircleCheck, HandCoins, Scale, TriangleAlert, Undo2 } from "lucide-react";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { EmptyState, ErrorState, ForbiddenState } from "@/components/ui/system-states";
import { Table, type TableColumn } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { TextField } from "@/components/ui/text-field";
import { toast } from "@/components/ui/toast";
import { can } from "@/features/auth/can";
import { ensureCsrf, useMe } from "@/features/auth/session";
import { useAccounts } from "@/features/payments/api";
import { describeError } from "@/features/setup/form-error";
import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { formatDateTime, formatMoney } from "@/lib/format";
import { useBranchStore } from "@/lib/stores/branch";
import { CASH_IO, toCents, usableAccount } from "./api";

type Balance = components["schemas"]["ShortageBalance"];
type Entry = components["schemas"]["ShortageEntry"];

export const SHORTAGE_VIEW = "shortage.view";
export const SHORTAGE_WRITE_OFF = "shortage.writeOff";

const KIND = {
  SHORTAGE: { tone: "danger", icon: TriangleAlert },
  REPAID: { tone: "success", icon: CircleCheck },
  WRITTEN_OFF: { tone: "neutral", icon: Scale },
} as const;

/** Xodim kamomadi miqdori to'g'riligi (tiyinlarda): 0 < summa ≤ qoldiq. */
export function shortageAmountOk(amount: string, balance: string): boolean {
  const t = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return false;
  const c = toCents(t);
  return c > 0n && c <= toCents(balance);
}

/** Pul → Kassa → «Xodim kamomadlari» (KT1, SPEC 5.4): qoldiqlar, jurnal, «Qaytardi» va «Hisobdan chiqarish». */
export function ShortagesPage() {
  const t = useTranslations("cash.shortages");
  const me = useMe();
  const selectedBranch = useBranchStore((s) => s.branchId);
  const allowed = can(me.data, SHORTAGE_VIEW);
  const canRepay = can(me.data, CASH_IO);
  const canWriteOff = can(me.data, SHORTAGE_WRITE_OFF);
  const branchId = me.data?.allBranches ? (selectedBranch ?? null) : (me.data?.branchId ?? null);
  const [tab, setTab] = useState<"open" | "all">("open");
  const [repay, setRepay] = useState<Balance | null>(null);
  const [writeOff, setWriteOff] = useState<Balance | null>(null);
  const q = useQuery({
    queryKey: ["shortages", branchId, tab],
    queryFn: () => unwrap(api.GET("/api/shortages", { params: { query: { branchId: branchId ?? undefined, openOnly: tab === "open" } } })),
    enabled: allowed,
  });

  if (me.data && !allowed) return <ForbiddenState />;

  const balanceCols: TableColumn<Balance>[] = [
    { key: "employee", title: t("cEmployee"), wrap: true },
    { key: "branch", title: t("cBranch"), hideBelow: "xl" },
    { key: "total", title: t("cTotal"), align: "right", render: (r) => formatMoney(r.total) },
    { key: "closed", title: t("cClosed"), align: "right", render: (r) => formatMoney(r.closed) },
    {
      key: "balance",
      title: t("cBalance"),
      align: "right",
      render: (r) => <span className={toCents(r.balance) > 0n ? "font-semibold text-danger" : undefined}>{formatMoney(r.balance)}</span>,
    },
  ];
  const entryCols: TableColumn<Entry>[] = [
    { key: "createdAt", title: t("cDate"), render: (r) => formatDateTime(new Date(r.createdAt)) },
    { key: "employee", title: t("cEmployee"), wrap: true },
    {
      key: "kind",
      title: t("cKind"),
      render: (r) => (
        <Badge tone={KIND[r.kind].tone} icon={KIND[r.kind].icon}>
          {t(`kind.${r.kind}`)}
        </Badge>
      ),
    },
    { key: "amount", title: t("cAmount"), align: "right", render: (r) => formatMoney(r.amount) },
    { key: "trip", title: t("cTrip"), mono: true, render: (r) => r.trip ?? "—" },
    { key: "cashOp", title: t("cCashOp"), mono: true, hideBelow: "xl", render: (r) => r.cashOp ?? "—" },
    { key: "note", title: t("cNote"), wrap: true, render: (r) => r.note ?? "" },
    { key: "createdBy", title: t("cBy"), hideBelow: "2xl" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-page-title">{t("title")}</h1>
        <p className="text-table text-text-secondary">{t("subtitle")}</p>
      </div>
      <Tabs
        aria-label={t("title")}
        value={tab}
        onChange={(v) => setTab(v as "open" | "all")}
        items={[
          { key: "open", label: t("tabOpen") },
          { key: "all", label: t("tabAll") },
        ]}
      />
      {q.isError ? (
        <Card>
          <ErrorState onRetry={() => void q.refetch()} />
        </Card>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-subtitle">{t("balances")}</h2>
            <Table
              caption={t("balances")}
              columns={balanceCols}
              rows={q.data?.balances ?? []}
              rowKey={(r) => `${r.branchId}-${r.employeeId}`}
              loading={q.isLoading}
              rowActions={(r) =>
                toCents(r.balance) > 0n ? (
                  <span className="flex gap-2">
                    {canRepay ? (
                      <Button size="sm" variant="secondary" icon={HandCoins} onClick={() => setRepay(r)}>
                        {t("repay")}
                      </Button>
                    ) : null}
                    {canWriteOff ? (
                      <Button size="sm" variant="secondary" icon={Undo2} onClick={() => setWriteOff(r)}>
                        {t("writeOff")}
                      </Button>
                    ) : null}
                  </span>
                ) : null
              }
              emptyState={<EmptyState icon={CircleCheck} title={t("emptyTitle")} description={t("emptyDescription")} />}
            />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-subtitle">{t("journal")}</h2>
            <Table
              caption={t("journal")}
              columns={entryCols}
              rows={q.data?.entries ?? []}
              rowKey={(r) => String(r.id)}
              loading={q.isLoading}
              density="compact"
              emptyState={<EmptyState icon={Scale} title={t("journalEmpty")} description={t("subtitle")} />}
            />
          </section>
        </>
      )}
      {repay ? <RepayDialog balance={repay} onClose={() => setRepay(null)} /> : null}
      {writeOff ? <WriteOffDialog balance={writeOff} onClose={() => setWriteOff(null)} /> : null}
    </div>
  );
}

function RepayDialog(props: { balance: Balance; onClose: () => void }) {
  const t = useTranslations("cash.shortages");
  const qc = useQueryClient();
  const me = useMe();
  const b = props.balance;
  const accounts = useAccounts(b.branchId);
  const all = accounts.data ?? [];
  const supervisor = can(me.data, "cash.approve");
  const kassas = all.filter((a) => a.kind === "CASH" && a.active && usableAccount(a, all, me.data?.id, supervisor));
  const [amount, setAmount] = useState(b.balance);
  const [kassa, setKassa] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const target = kassa ?? (kassas[0] ? String(kassas[0].id) : null);
  const amountOk = shortageAmountOk(amount, b.balance);

  async function save() {
    setTried(true);
    setError(null);
    if (!amountOk || !target) return;
    setBusy(true);
    try {
      await ensureCsrf();
      const res = await unwrap(
        api.POST("/api/shortages/repay", {
          body: {
            branchId: b.branchId,
            employeeId: b.employeeId,
            accountId: Number(target),
            amount: amount.trim(),
            note: note.trim() || undefined,
          },
        }),
      );
      toast({ tone: "success", title: t("repaid"), description: t("repaidDesc", { n: res.cashOp, s: formatMoney(amount.trim()) }) });
      await qc.invalidateQueries({ queryKey: ["shortages"] });
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
      title={t("repayTitle", { n: b.employee })}
      primaryAction={{ label: t("repay"), onClick: () => void save(), loading: busy }}
    >
      <div className="flex flex-col gap-3">
        <TextField
          label={t("amount")}
          variant="amount"
          required
          value={amount}
          onChange={setAmount}
          error={tried && !amountOk ? t("eAmount", { s: formatMoney(b.balance) }) : undefined}
        />
        {accounts.data && kassas.length === 0 ? <Alert tone="warning" title={t("noKassa")} /> : null}
        <Select
          label={t("kassa")}
          value={target}
          onChange={setKassa}
          options={kassas.map((a) => ({ value: String(a.id), label: a.name, sub: a.code }))}
          error={tried && !target ? t("eKassa") : undefined}
        />
        <TextField label={t("note")} value={note} onChange={setNote} />
        {server.message ? <Alert tone="danger" title={server.message} /> : null}
      </div>
    </Modal>
  );
}

function WriteOffDialog(props: { balance: Balance; onClose: () => void }) {
  const t = useTranslations("cash.shortages");
  const qc = useQueryClient();
  const b = props.balance;
  const [amount, setAmount] = useState(b.balance);
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const amountOk = shortageAmountOk(amount, b.balance);

  async function save() {
    setTried(true);
    setError(null);
    if (!amountOk || !reason.trim()) return;
    setBusy(true);
    try {
      await ensureCsrf();
      await unwrap(
        api.POST("/api/shortages/write-off", {
          body: { branchId: b.branchId, employeeId: b.employeeId, amount: amount.trim(), reason: reason.trim() },
        }),
      );
      toast({ tone: "success", title: t("writtenOff") });
      await qc.invalidateQueries({ queryKey: ["shortages"] });
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
      tone="danger"
      onClose={props.onClose}
      title={t("writeOffTitle", { n: b.employee })}
      primaryAction={{ label: t("writeOff"), onClick: () => void save(), loading: busy }}
    >
      <div className="flex flex-col gap-3">
        <p className="text-table text-text-secondary">{t("woWarn")}</p>
        <TextField
          label={t("amount")}
          variant="amount"
          required
          value={amount}
          onChange={setAmount}
          error={tried && !amountOk ? t("eAmount", { s: formatMoney(b.balance) }) : undefined}
        />
        <TextField
          label={t("reason")}
          required
          value={reason}
          onChange={setReason}
          error={tried && !reason.trim() ? t("eReason") : undefined}
        />
        {server.message ? <Alert tone="danger" title={server.message} /> : null}
      </div>
    </Modal>
  );
}
