import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { getRecentDTRs } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/dtr";
import { Clock3, AlertCircle, CalendarCheck, Plane } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: Dashboard });

function Dashboard() {
  const { user, isHR } = useAuth();
  const qc = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 7) + "-01";

  // ── OT budget for current month ────────────────────────────────────────
  const { data: otBudgets } = useQuery({
    queryKey: ["ot-budget", user?.id, firstOfMonth],
    enabled: !!user && !isHR,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ot_approval_requests")
        .select("id, requested_hours, target_month, status")
        .eq("employee_id", user!.id)
        .eq("request_type", "pre_approved")
        .eq("status", "approved")
        .eq("target_month", firstOfMonth);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: otFiled } = useQuery({
    queryKey: ["ot-filed", user?.id, firstOfMonth],
    enabled: !!user && !isHR,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ot_approval_requests")
        .select("id, requested_hours, pre_approved_id")
        .eq("employee_id", user!.id)
        .eq("request_type", "actual");
      if (error) throw error;
      return data ?? [];
    },
  });

  const totalApprovedOT = (otBudgets ?? []).reduce((s, b) => s + Number(b.requested_hours), 0);
  const budgetIds = new Set((otBudgets ?? []).map((b) => b.id));
  const totalFiledOT = (otFiled ?? [])
    .filter((f) => f.pre_approved_id && budgetIds.has(f.pre_approved_id))
    .reduce((s, f) => s + Number(f.requested_hours), 0);
  const remainingOT = Math.max(0, totalApprovedOT - totalFiledOT);

  // ── Leave credits & summary ────────────────────────────────────────────
  const { data: myProfile } = useQuery({
    queryKey: ["my-profile", user?.id],
    enabled: !!user && !isHR,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("vl_credits, sl_credits")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: myLeaves } = useQuery({
    queryKey: ["my-leaves", user?.id],
    enabled: !!user && !isHR,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("id, leave_type, start_date, end_date, status")
        .eq("employee_id", user!.id)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // ── Today's attendance ─────────────────────────────────────────────────
  const { data: todayEntry, refetch: refetchToday } = useQuery({
    queryKey: ["dtr-today", user?.id, today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_time_reports")
        .select("id, time_in, time_out, hours_worked, shift_label, is_undertime, undertime_minutes")
        .eq("employee_id", user!.id)
        .eq("work_date", today)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user && !isHR,
  });

  // ── Recent DTRs (last 14 days) ─────────────────────────────────────────
  const { data: recentDtrs } = useQuery({
    queryKey: ["recent-dtrs", user?.id],
    queryFn: () => getRecentDTRs(user!.id, 14),
    enabled: !!user && !isHR,
  });

  const [showShiftPicker, setShowShiftPicker] = useState(false);

  const clockIn = useMutation({
    mutationFn: async (shiftLabel: "7-4" | "8-5" | "9-6") => {
      const timeIn = new Date().toTimeString().slice(0, 5);
      const { error } = await supabase.from("daily_time_reports").insert({
        employee_id: user!.id,
        work_date: today,
        time_in: timeIn,
        shift_label: shiftLabel,
        cutoff_id: null,
        is_undertime: false,
        undertime_minutes: 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Clocked in!");
      refetchToday();
      qc.invalidateQueries({ queryKey: ["recent-dtrs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      const timeOut = new Date().toTimeString().slice(0, 5);
      const [ih, im] = (todayEntry!.time_in!).split(":").map(Number);
      const [oh, om] = timeOut.split(":").map(Number);
      const totalMins = oh * 60 + om - (ih * 60 + im);
      const hoursWorked = Math.max(0, Math.round((totalMins / 60) * 100) / 100);
      const STANDARD = 9;
      const isUndertime = hoursWorked < STANDARD;
      const undertimeMins = isUndertime ? Math.round(STANDARD * 60 - totalMins) : 0;
      const { error } = await supabase
        .from("daily_time_reports")
        .update({ time_out: timeOut, hours_worked: hoursWorked, is_undertime: isUndertime, undertime_minutes: undertimeMins })
        .eq("id", todayEntry!.id);
      if (error) throw error;
      return { hoursWorked, isUndertime, undertimeMins };
    },
    onSuccess: (result) => {
      toast.success("Clocked out!");
      refetchToday();
      qc.invalidateQueries({ queryKey: ["recent-dtrs"] });
      if (result.isUndertime) {
        toast.warning(`Undertime: ${result.undertimeMins} min short of 9 hrs`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Leave helpers ──────────────────────────────────────────────────────
  const leaveDays = (a: string, b: string) =>
    Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1);
  const leavesAll = myLeaves ?? [];
  const leavesApproved = leavesAll.filter((l) => l.status === "approved");
  const leavesPending = leavesAll.filter((l) => l.status === "pending");
  const totalApprovedDays = leavesApproved.reduce((s, l) => s + leaveDays(l.start_date, l.end_date), 0);
  const totalPendingDays = leavesPending.reduce((s, l) => s + leaveDays(l.start_date, l.end_date), 0);
  const upcomingLeaves = leavesAll
    .filter((l) => (l.status === "approved" || l.status === "pending") && l.end_date >= today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, 3);

  const VL_ENTITLEMENT = myProfile?.vl_credits ?? 10;
  const SL_ENTITLEMENT = myProfile?.sl_credits ?? 10;
  const currentYear = new Date().getFullYear();
  const inCurrentYear = (iso: string) => new Date(iso).getFullYear() === currentYear;
  const usedDaysByType = (type: "VL" | "SL") =>
    leavesAll
      .filter((l) => l.leave_type === type && (l.status === "approved" || l.status === "pending") && inCurrentYear(l.start_date))
      .reduce((s, l) => s + leaveDays(l.start_date, l.end_date), 0);
  const vlUsed = usedDaysByType("VL");
  const slUsed = usedDaysByType("SL");
  const vlRemaining = Math.max(0, VL_ENTITLEMENT - vlUsed);
  const slRemaining = Math.max(0, SL_ENTITLEMENT - slUsed);

  const clockedIn = !!todayEntry?.time_in;
  const clockedOut = !!todayEntry?.time_out;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {isHR ? "HR · Admin" : "Employee Dashboard"}
        </p>
        <h1 className="mt-1 font-display text-4xl">Hello.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isHR
            ? "Manage attendance, leaves, OT, and team performance."
            : "Track your daily attendance, leaves, and overtime."}
        </p>
      </div>

      {/* ── Employee-only sections ──────────────────────────────────────── */}
      {!isHR && (
        <>
          {/* Clock in / out card */}
          <Card className="border-primary/20 bg-gradient-to-br from-card to-secondary/30">
            <CardContent className="flex flex-col items-center gap-4 py-8">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Today's Attendance</p>

              {!clockedIn && (
                <Button size="lg" className="h-16 w-48 text-lg font-semibold"
                  onClick={() => setShowShiftPicker(true)}
                  disabled={clockIn.isPending}>
                  <Clock3 className="mr-2 h-5 w-5" /> Clock In
                </Button>
              )}

              {clockedIn && !clockedOut && (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm text-muted-foreground">
                    In at <span className="font-semibold text-foreground">{todayEntry!.time_in}</span>
                    {" · "}{todayEntry!.shift_label} shift
                  </p>
                  <Button size="lg" variant="destructive" className="h-16 w-48 text-lg font-semibold"
                    onClick={() => clockOut.mutate()} disabled={clockOut.isPending}>
                    <Clock3 className="mr-2 h-5 w-5" /> Clock Out
                  </Button>
                </div>
              )}

              {clockedIn && clockedOut && (
                <div className="flex flex-col items-center gap-2 text-center">
                  <p className="text-sm font-medium">
                    {todayEntry!.time_in} → {todayEntry!.time_out}
                    {" · "}<span className="font-semibold">{Number(todayEntry!.hours_worked).toFixed(2)} hrs</span>
                    {" · "}{todayEntry!.shift_label} shift
                  </p>
                  {todayEntry!.is_undertime && (
                    <div className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-sm text-warning-foreground">
                      <AlertCircle className="h-4 w-4" />
                      Undertime — {todayEntry!.undertime_minutes} min short
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* OT budget card */}
          {totalApprovedOT > 0 ? (
            <Card className="border-accent/20">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="font-display text-lg flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-accent" /> OT Budget — {new Date(firstOfMonth + "T00:00:00").toLocaleString("default", { month: "long", year: "numeric" })}
                </CardTitle>
                <Link to="/ot-approvals" className="text-xs text-accent underline underline-offset-2">View all →</Link>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-md border bg-background/60 p-3 text-center">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Approved</p>
                    <p className="mt-1 font-display text-2xl">{totalApprovedOT.toFixed(1)}<span className="text-sm text-muted-foreground"> hrs</span></p>
                  </div>
                  <div className="rounded-md border bg-background/60 p-3 text-center">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Used</p>
                    <p className="mt-1 font-display text-2xl">{totalFiledOT.toFixed(1)}<span className="text-sm text-muted-foreground"> hrs</span></p>
                  </div>
                  <div className={`rounded-md border p-3 text-center ${remainingOT <= 0 ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5"}`}>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Remaining</p>
                    <p className={`mt-1 font-display text-2xl ${remainingOT <= 0 ? "text-destructive" : "text-success"}`}>
                      {remainingOT.toFixed(1)}<span className="text-sm text-muted-foreground"> hrs</span>
                    </p>
                  </div>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${Math.min(100, totalApprovedOT > 0 ? (totalFiledOT / totalApprovedOT) * 100 : 0)}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center justify-between rounded-md border border-border/50 bg-secondary/30 px-4 py-2.5 text-sm text-muted-foreground">
              <span>No approved OT budget for this month.</span>
              <Link to="/ot-approvals" className="text-xs text-accent underline underline-offset-2">Request OT →</Link>
            </div>
          )}

          {/* Leave summary */}
          <Card className="border-accent/15">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">My leaves</p>
                <CardTitle className="mt-1 font-display text-2xl flex items-center gap-2">
                  <Plane className="h-5 w-5 text-accent" /> Leave summary
                </CardTitle>
              </div>
              <Button asChild variant="ghost" size="sm"><Link to="/leaves">View all →</Link></Button>
            </CardHeader>
            <CardContent>
              <div className="mb-5 grid gap-3 sm:grid-cols-2">
                <LeaveBalance label="Vacation Leave" code="VL" used={vlUsed} total={VL_ENTITLEMENT} remaining={vlRemaining} year={currentYear} />
                <LeaveBalance label="Sick Leave" code="SL" used={slUsed} total={SL_ENTITLEMENT} remaining={slRemaining} year={currentYear} />
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat icon={<CalendarCheck className="h-4 w-4" />} label="Approved days" value={totalApprovedDays} />
                <Stat icon={<Clock3 className="h-4 w-4" />} label="Pending days" value={totalPendingDays} tone={totalPendingDays > 0 ? "warn" : undefined} />
                <Stat icon={<Plane className="h-4 w-4" />} label="Approved requests" value={leavesApproved.length} />
                <Stat icon={<AlertCircle className="h-4 w-4" />} label="Total filed" value={leavesAll.length} />
              </div>
              {upcomingLeaves.length > 0 && (
                <div className="mt-5 space-y-1.5 border-t pt-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Upcoming / ongoing</p>
                  {upcomingLeaves.map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-sm">
                      <span className="font-medium">
                        {l.leave_type}
                        <span className="ml-2 text-xs uppercase tracking-wide text-muted-foreground">{l.status}</span>
                      </span>
                      <span className="text-muted-foreground">
                        {formatDate(l.start_date)} → {formatDate(l.end_date)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent attendance */}
          <div>
            <h2 className="font-display text-2xl">Recent attendance</h2>
            <div className="mt-4 overflow-hidden rounded-lg border bg-card">
              {recentDtrs?.length ? (
                <table className="w-full text-sm">
                  <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Date</th>
                      <th className="px-4 py-2 text-left">Time in</th>
                      <th className="px-4 py-2 text-left">Time out</th>
                      <th className="px-4 py-2 text-right">Hours</th>
                      <th className="px-4 py-2 text-right">Late (min)</th>
                      <th className="px-4 py-2 text-right">OT</th>
                      <th className="px-4 py-2 text-left">Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDtrs.map((d) => (
                      <tr key={d.id} className="border-t">
                        <td className="px-4 py-2">{formatDate(d.work_date)}</td>
                        <td className="px-4 py-2">{d.time_in ?? "—"}</td>
                        <td className="px-4 py-2">{d.time_out ?? "—"}</td>
                        <td className="px-4 py-2 text-right">{Number(d.hours_worked).toFixed(2)}</td>
                        <td className="px-4 py-2 text-right">{d.late_minutes}</td>
                        <td className="px-4 py-2 text-right">{Number(d.overtime_hours).toFixed(2)}</td>
                        <td className="px-4 py-2">
                          {d.is_absent ? <span className="text-destructive">Absent</span>
                            : d.is_leave ? <span className="text-accent">Leave</span>
                            : (d as { is_undertime?: boolean }).is_undertime ? <span className="text-warning-foreground">Undertime</span>
                            : <span className="text-muted-foreground">Present</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                  No attendance records in the last 14 days. <Link to="/dtr" className="text-accent underline">View full history →</Link>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── HR / Admin landing ──────────────────────────────────────────── */}
      {isHR && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { to: "/employees", label: "Employees", desc: "Manage profiles, roles, and leave credits" },
            { to: "/org-chart", label: "Org Chart", desc: "Visualise the reporting hierarchy" },
            { to: "/ot-approvals", label: "OT Approvals", desc: "Review pre-approved OT budget requests" },
            { to: "/leaves", label: "Leave Requests", desc: "Review and approve employee leave" },
            { to: "/kpi-builder", label: "KPI Builder", desc: "Build and manage KPI templates" },
            { to: "/performance-admin", label: "Performance", desc: "Review team performance evaluations" },
          ].map(({ to, label, desc }) => (
            <Link key={to} to={to as never}
              className="rounded-lg border bg-card p-5 transition-colors hover:bg-secondary/40">
              <p className="font-semibold">{label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
            </Link>
          ))}
        </div>
      )}

      {/* Shift picker dialog */}
      <Dialog open={showShiftPicker} onOpenChange={setShowShiftPicker}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Select your shift for today</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            {(["7-4", "8-5", "9-6"] as const).map((s) => (
              <Button key={s} variant="outline" size="lg" className="h-14 text-base"
                onClick={() => { setShowShiftPicker(false); clockIn.mutate(s); }}>
                {s === "7-4" ? "7:00 AM – 4:00 PM" : s === "8-5" ? "8:00 AM – 5:00 PM" : "9:00 AM – 6:00 PM"}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ icon, label, value, tone }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; tone?: "warn";
}) {
  return (
    <div className="rounded-md border bg-background/60 p-3">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}{label}
      </div>
      <div className={`mt-1 font-display text-2xl capitalize ${tone === "warn" ? "text-warning-foreground" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function LeaveBalance({ label, code, used, total, remaining, year }: {
  label: string; code: string; used: number; total: number; remaining: number; year: number;
}) {
  const pct = Math.min(100, Math.round((used / total) * 100));
  const depleted = remaining <= 0;
  const low = remaining > 0 && remaining <= 3;
  return (
    <div className="rounded-lg border bg-background/60 p-4">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {label} <span className="opacity-60">· {year}</span>
          </p>
          <p className="mt-0.5 font-display text-2xl">
            <span className={depleted ? "text-destructive" : low ? "text-warning-foreground" : ""}>
              {remaining}
            </span>
            <span className="text-base text-muted-foreground"> / {total} days left</span>
          </p>
        </div>
        <span className="rounded-full border bg-card px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {code}
        </span>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full transition-all ${depleted ? "bg-destructive" : low ? "bg-warning" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{used} used (approved + pending)</p>
    </div>
  );
}
