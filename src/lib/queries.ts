import { supabase } from "@/integrations/supabase/client";

/** Fetch all DTRs for an employee in a given month (YYYY-MM). */
export async function getMyDTRsByMonth(employeeId: string, yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  const startDate = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const endDate = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  const { data, error } = await supabase
    .from("daily_time_reports")
    .select("*")
    .eq("employee_id", employeeId)
    .gte("work_date", startDate)
    .lte("work_date", endDate)
    .order("work_date", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Fetch the most recent N days of DTRs for an employee (used on the dashboard). */
export async function getRecentDTRs(employeeId: string, days = 14) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await supabase
    .from("daily_time_reports")
    .select("*")
    .eq("employee_id", employeeId)
    .gte("work_date", since.toISOString().slice(0, 10))
    .order("work_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
