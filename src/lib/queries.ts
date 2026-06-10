import { getDTRsForMonth, getRecentDTRsQuery } from "@/lib/dtr-functions";

/** Fetch all DTRs for an employee in a given month (YYYY-MM). */
export async function getMyDTRsByMonth(employeeId: string, yearMonth: string) {
  return getDTRsForMonth({ data: { employeeId, yearMonth } });
}

/** Fetch the most recent N days of DTRs for an employee (used on the dashboard). */
export async function getRecentDTRs(employeeId: string, days = 14) {
  return getRecentDTRsQuery({ data: { employeeId, days } });
}
