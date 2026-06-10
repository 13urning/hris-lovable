import { getDTRsForMonth, getRecentDTRsQuery } from "@/lib/dtr-functions";

/** Fetch all DTRs for the signed-in user in a given month (YYYY-MM). */
export async function getMyDTRsByMonth(yearMonth: string) {
  return getDTRsForMonth({ data: { yearMonth } });
}

/** Fetch the current month's DTRs for the signed-in user (used on the dashboard). */
export async function getRecentDTRs() {
  return getRecentDTRsQuery();
}
