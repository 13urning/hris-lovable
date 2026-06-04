import { supabase } from "@/integrations/supabase/client";

export async function getCurrentCutoff() {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("payroll_cutoffs")
    .select("*")
    .lte("start_date", today)
    .gte("end_date", today)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getAllCutoffs() {
  const { data, error } = await supabase
    .from("payroll_cutoffs")
    .select("*")
    .order("start_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getMyDTRs(employeeId: string, cutoffId: string | null) {
  let q = supabase
    .from("daily_time_reports")
    .select("*")
    .eq("employee_id", employeeId)
    .order("work_date", { ascending: false });
  if (cutoffId) q = q.eq("cutoff_id", cutoffId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getMySubmission(employeeId: string, cutoffId: string) {
  const { data, error } = await supabase
    .from("dtr_cutoff_submissions")
    .select("*")
    .eq("employee_id", employeeId)
    .eq("cutoff_id", cutoffId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type SubmissionWithRelations = {
  id: string;
  employee_id: string;
  cutoff_id: string;
  approval_status: string;
  submitted_at: string | null;
  total_days_submitted: number;
  total_hours: number;
  late_count: number;
  absent_count: number;
  overtime_hours: number;
  leave_days: number;
  missing_dtr_count: number;
  approved_at: string | null;
  rejection_reason: string | null;
  correction_notes: string | null;
  profile: { full_name: string; department: string; email: string | null } | null;
  cutoff: { cutoff_name: string; start_date: string; end_date: string; payout_date: string | null } | null;
};

export async function getAllSubmissions(): Promise<SubmissionWithRelations[]> {
  const { data, error } = await supabase
    .from("dtr_cutoff_submissions")
    .select(`*,
      profile:profiles!subs_employee_profile_fk(full_name, department, email),
      cutoff:payroll_cutoffs(cutoff_name, start_date, end_date, payout_date)`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as SubmissionWithRelations[];
}
