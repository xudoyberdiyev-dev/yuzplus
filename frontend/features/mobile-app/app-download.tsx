"use client";

import { useTranslations } from "next-intl";
import { Download, ShieldCheck, Smartphone } from "lucide-react";
import { LoginLayout } from "@/features/auth/login-layout";
import { APK_DEV_URL, APK_URL } from "./links";

const STEPS = ["s1", "s2", "s3", "s4"] as const;

export function AppDownload({ qrSvg }: { qrSvg: string }) {
  const t = useTranslations("mobileApp");
  return (
    <LoginLayout>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-page-title">
            <Smartphone size={22} strokeWidth={1.5} aria-hidden />
            {t("title")}
          </h1>
          <p className="text-table text-text-secondary">{t("subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <div
            role="img"
            aria-label={t("qr")}
            className="size-40 flex-none rounded-card border border-border bg-surface p-2 text-text-primary [&>svg]:size-full"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <a
              href={APK_URL}
              className="inline-flex h-10 w-fit items-center gap-2 rounded-control bg-primary-button px-4 font-semibold text-white hover:bg-primary-button-hover"
            >
              <Download size={16} strokeWidth={1.5} aria-hidden />
              {t("download")}
            </a>
            <span className="text-caption text-text-secondary">{t("qrHint")}</span>
            <a href={APK_DEV_URL} className="text-caption text-link hover:underline">
              {t("dev")}
            </a>
          </div>
        </div>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-table">
          {STEPS.map((s) => (
            <li key={s}>{t(s)}</li>
          ))}
        </ol>
        <p className="flex items-start gap-2 text-caption text-text-secondary">
          <ShieldCheck size={14} strokeWidth={1.5} className="mt-0.5 flex-none" aria-hidden />
          {t("safety")}
        </p>
      </div>
    </LoginLayout>
  );
}
