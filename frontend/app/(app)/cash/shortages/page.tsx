import { Suspense } from "react";
import { TopBar } from "@/components/shell/topbar";
import { ShortagesPage } from "@/features/cash/shortages-page";

/** Pul → Kassa → «Xodim kamomadlari» (KT1). */
export default function Page() {
  return (
    <>
      <TopBar titleKey="shortages" />
      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <Suspense>
          <ShortagesPage />
        </Suspense>
      </main>
    </>
  );
}
