import { Fuel, Receipt, Route, Utensils, Wrench, type LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api, unwrap } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";

/** HD2 (SPEC 5.4): yoʻl xarajatlari va reys avansi — umumiy tiplar va soʻrovlar. */
export type TripMoneyView = components["schemas"]["TripMoneyView"];
export type TripExpense = components["schemas"]["TripExpense"];
export type TripAdvance = components["schemas"]["TripAdvance"];
export type ExpenseReport = components["schemas"]["ExpenseReport"];
export type ExpenseGroup = components["schemas"]["ExpenseGroup"];
export type ExpenseKind = TripExpense["kind"];
export type ExpenseSource = TripExpense["source"];
export type ExpenseStatus = TripExpense["status"];

export const TRIP_EXPENSES_VIEW = "tripExpenses.view";

export const EXPENSE_KINDS: readonly ExpenseKind[] = ["FUEL", "MEAL", "TOLL", "REPAIR", "OTHER"];

export const KIND_ICON: Record<ExpenseKind, LucideIcon> = {
  FUEL: Fuel,
  MEAL: Utensils,
  TOLL: Route,
  REPAIR: Wrench,
  OTHER: Receipt,
};

export const STATUS_TONE = { PENDING: "warning", APPROVED: "success", REJECTED: "danger" } as const;

/** Chek rasmi manzili (cookie bilan ochiladi). */
export function expensePhotoUrl(id: number): string {
  return `/api/trip-expenses/${id}/photo`;
}

/** Reysning avans va xarajatlari (kassir, rahbar, haydovchi — oʻz reysi). */
export function useTripMoney(tripId: number | null) {
  return useQuery({
    queryKey: ["trips", "money", tripId],
    queryFn: () => unwrap(api.GET("/api/trips/{id}/money", { params: { path: { id: tripId as number } } })),
    enabled: tripId != null,
  });
}
