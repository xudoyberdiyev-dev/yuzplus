"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, FileSpreadsheet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ErrorState, Skeleton } from "@/components/ui/system-states";
import { toast } from "@/components/ui/toast";
import { ensureCsrf } from "@/features/auth/session";
import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { isoToDay } from "@/features/bank/model";

type Info = components["schemas"]["ClientDocsInfo"];
type Contract = components["schemas"]["ContractOption"];
export type ClientDocKind = "INVOICE" | "OFFER" | "SPECIFICATION";

export const CLIENT_DOC_KINDS: ClientDocKind[] = ["INVOICE", "OFFER", "SPECIFICATION"];

/** FT6 ruxsati: kirim narxi chiqadigan hujjatlar. */
export const CLIENT_DOCS_PERMISSIONS = ["orders.view", "prices.view", "invoices.costPrint"] as const;

/** Shartnoma ro'yxatdagi ko'rinishi: «№ 1478 · 05.01.2026». */
export function contractLabel(c: Pick<Contract, "number" | "signedOn">): string {
  return c.signedOn ? `№ ${c.number} · ${isoToDay(c.signedOn)}` : `№ ${c.number}`;
}

/** Tanlov: avval saqlangan, bo'lmasa tavsiya etilgan shartnoma. */
export function initialContract(info: Pick<Info, "contract" | "suggestedContractId">): string | null {
  const id = info.contract?.id ?? info.suggestedContractId;
  return id == null ? null : String(id);
}

export function clientDocUrl(orderId: number, kind: ClientDocKind | "zip"): string {
  return kind === "zip" ? `/api/orders/${orderId}/client-docs/zip` : `/api/orders/${orderId}/client-docs/${kind}/xlsx`;
}

/** Buyurtma → «Chop etish» → «Mijoz hujjatlari»: hisob varaq-faktura, tijorat taklifi, spetsifikatsiya (alohida yoki bitta arxiv). */
export function ClientDocsModal(props: { orderId: number; onClose: () => void }) {
  const t = useTranslations("orders.clientDocs");
  const qc = useQueryClient();
  const key = ["orders", props.orderId, "client-docs"] as const;
  const info = useQuery({
    queryKey: key,
    queryFn: () => unwrap(api.GET("/api/orders/{id}/client-docs", { params: { path: { id: props.orderId } } })),
  });
  const [picked, setPicked] = useState<string | null>(null);
  const contract = picked ?? (info.data ? initialContract(info.data) : null);

  const save = useMutation({
    mutationFn: async (contractId: number) => {
      await ensureCsrf();
      return unwrap(api.PUT("/api/orders/{id}/client-docs/contract", { params: { path: { id: props.orderId } }, body: { contractId } }));
    },
    onSuccess: (r) => qc.setQueryData(key, r),
    onError: () => toast({ tone: "danger", title: t("saveError") }),
  });

  async function download(kind: ClientDocKind | "zip") {
    if (!contract) return;
    if (info.data?.contract?.id !== Number(contract)) await save.mutateAsync(Number(contract));
    window.open(clientDocUrl(props.orderId, kind), "_blank", "noopener");
  }

  const d = info.data;
  const noContracts = d != null && d.contracts.length === 0;
  return (
    <Modal
      open
      onClose={props.onClose}
      title={t("title")}
      primaryAction={{
        label: t("downloadAll"),
        onClick: () => void download("zip"),
        loading: save.isPending,
        disabled: !contract || !d || d.lines === 0,
      }}
      secondaryAction={{ label: t("close"), onClick: props.onClose }}
    >
      {info.isPending ? (
        <Skeleton className="h-32" />
      ) : info.isError || !d ? (
        <ErrorState onRetry={() => info.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-text-secondary">{t("intro")}</p>
          {noContracts ? (
            <Alert tone="warning" title={t("noContracts")}>
              {t("noContractsHint")}
            </Alert>
          ) : (
            <Select
              label={t("contract")}
              required
              hint={t("contractHint")}
              options={d.contracts.map((c) => ({
                value: String(c.id),
                label: contractLabel(c),
                sub: c.validUntil ? t("validUntil", { date: isoToDay(c.validUntil) }) : undefined,
              }))}
              value={contract}
              onChange={setPicked}
            />
          )}
          {d.missing.length ? (
            <Alert tone="warning" title={t("missingTitle")}>
              <ul className="list-disc pl-5">
                {d.missing.map((m) => (
                  <li key={m}>{t(`missing.${m}` as "missing.noCost")}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {d.lines === 0 ? <Alert tone="info" title={t("noLines")} /> : null}
          <div className="flex flex-col gap-2">
            <p className="text-caption text-text-secondary">{t("separately")}</p>
            <div className="flex flex-wrap gap-2">
              {CLIENT_DOC_KINDS.map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant="secondary"
                  icon={FileSpreadsheet}
                  disabled={!contract || d.lines === 0 || save.isPending}
                  onClick={() => void download(k)}
                >
                  {t(`kind.${k}`)}
                </Button>
              ))}
            </div>
            <p className="flex items-center gap-1 text-caption text-text-secondary">
              <Archive size={14} strokeWidth={1.5} aria-hidden />
              {t("zipHint")}
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
