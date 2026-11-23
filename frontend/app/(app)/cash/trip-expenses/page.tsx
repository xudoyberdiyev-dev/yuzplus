import { Suspense } from "react";
import { TopBar } from "@/components/shell/topbar";
import { TripExpensesPage } from "@/features/trip-expenses/trip-expenses-page";

/** Pul → Kassa → «Yoʻl xarajatlari» (HD2). */
export default function Page() {
  return (
    <>
      <TopBar titleKey="tripExpenses" />
      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        <Suspense>
          <TripExpensesPage />
        </Suspense>
      </main>
    </>
  );
}
