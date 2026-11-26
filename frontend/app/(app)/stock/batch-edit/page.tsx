import { TopBar } from "@/components/shell/topbar";
import { BatchEditPage } from "@/features/stock/batch-edit-page";

export default function Page() {
  return (
    <>
      <TopBar titleKey="batchEdit" />
      <main className="flex-1 overflow-y-auto p-6">
        <BatchEditPage />
      </main>
    </>
  );
}
