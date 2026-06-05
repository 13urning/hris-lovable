import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { getAllCutoffs, getMyDTRs, getMySubmission, getCurrentCutoff } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, type ApprovalStatus } from "@/lib/dtr";
import { Lock, Clock3, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dtr")({ component: AttendancePage });

// Inline stat card used in the summary row
function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" | "accent" }) {
  return (
    <div className="rounded-md border bg-background/60 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-display text-2xl ${
          tone === "warn"
            ? "text-warning-foreground"
            : tone === "accent"
            ? "text-accent"
            : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// OT status pill — reused in the table
function OtBadge({ status }: { status: string | null | undefined }) {
  if (!status || status === "none") return <span className="text-xs text-muted-foreground">—</span>;
  const cls =
    status === "approved"
      ? "bg-success/15 text-success"
      : status === "rejected"
      ? "bg-destructive/15 text-destructive"
      : "bg-warning/20 text-warning-foreground";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

function AttendancePage() {
  const { user, isHR } = useAuth();
  if (isHR) return <Navigate to="/cutoff-approval" />;

  const { data: cutoffs } = useQuery({ queryKey: ["cutoffs"], queryFn: getAllCutoffs });
  const { data: currentCutoff } = useQuery({ queryKey: ["cutoff", "current"], queryFn: getCurrentCutoff });
  const [selectedCutoff, setSelectedCutoff] = useState<string | null>(null);

  const activeCutoff = selectedCutoff
    ? cutoffs?.find((c) => c.id === selectedCutoff)
    : currentCutoff;

  const { data: dtrs, isLoading: dtrsLoading } = useQuery({
    queryKey: ["dtrs", user?.id, activeCutoff?.id],
    queryFn: () => getMyDTRs(user!.id, activeCutoff!.id),
    enabled: !!user && !!activeCutoff,
  });

  const { data: submission } = useQuery({
    queryKey: ["sub", user?.id, activeCutoff?.id],
    queryFn: () => getMySubmission(user!.id, activeCutoff!.id),
    enabled: !!user && !!activeCutoff,
  });

  const status = (submission?.approval_status ?? "draft") as ApprovalStatus;
  const locked = status === "approved" || status === "pending_approval";

  // Sorted ascending for chronological reading
  const sortedDtrs = [...(dtrs ?? [])].sort((a, b) =>
    a.work_date.localeCompare(b.work_date)
  );

  // Summary stats
  const totalDays = sortedDtrs.length;
  const totalHours = sortedDtrs.reduce((s, d) => s + Number(d.hours_worked ?? 0), 0);
  const undertimeDays = sortedDtrs.filter((d) => (d as { is_undertime?: boolean }).is_undertime).length;
  const totalOt = sortedDtrs.reduce((s, d) => s + Number(d.overtime_hours ?? 0), 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">My Records</p>
          <h1 className="mt-1 font-display text-4xl">Attendance History</h1>
        </div>
        <div className="flex items-center gap-3">
          <Label className="text-xs text-muted-foreground">Cut-off</Label>
          <Select
            value={activeCutoff?.id ?? ""}
            onValueChange={(v) => setSelectedCutoff(v)}
          >
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder="Select cut-off" />
            </SelectTrigger>
            <SelectContent>
              {cutoffs?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.cutoff_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {submission && <StatusBadge status={status} />}
        </div>
      </div>

      {/* Status banner */}
      {locked && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <Lock className="h-4 w-4 shrink-0" />
          {status === "approved"
            ? "This cut-off is approved and locked. Contact HR if corrections are needed."
            : "Pending HR approval — this cut-off is under review."}
        </div>
      )}

      {/* Summary stats */}
      {activeCutoff && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Days logged" value={totalDays} />
          <Stat label="Hours worked" value={totalHours.toFixed(1)} tone="accent" />
          <Stat label="Undertime days" value={undertimeDays} tone={undertimeDays > 0 ? "warn" : undefined} />
          <Stat label="OT hours" value={totalOt.toFixed(2)} />
        </div>
      )}

      {/* Attendance table */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl flex items-center gap-2">
            <Clock3 className="h-5 w-5" />
            {activeCutoff ? activeCutoff.cutoff_name : "Select a cut-off"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {dtrsLoading ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              Loading records…
            </div>
          ) : sortedDtrs.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              No attendance records for this cut-off.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Shift</th>
                    <th className="px-4 py-2 text-left">Time In</th>
                    <th className="px-4 py-2 text-left">Time Out</th>
                    <th className="px-4 py-2 text-right">Hours</th>
                    <th className="px-4 py-2 text-right">Late (min)</th>
                    <th className="px-4 py-2 text-right">Undertime</th>
                    <th className="px-4 py-2 text-right">OT hrs</th>
                    <th className="px-4 py-2 text-left">OT Status</th>
                    <th className="px-4 py-2 text-left">Flag</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDtrs.map((d) => {
                    const row = d as typeof d & {
                      shift_label?: string | null;
                      is_undertime?: boolean;
                      undertime_minutes?: number | null;
                      ot_status?: string | null;
                      ot_review_notes?: string | null;
                    };
                    const isUndertime = !!row.is_undertime;
                    const undertimeMins = Number(row.undertime_minutes ?? 0);
                    const otHours = Number(d.overtime_hours ?? 0);
                    const showFileOt =
                      otHours > 0 &&
                      row.ot_status !== "approved" &&
                      row.ot_status !== "rejected";
                    const flag = d.is_absent
                      ? "Absent"
                      : d.is_leave
                      ? `Leave (${d.leave_type ?? ""})`
                      : "Present";

                    return (
                      <tr
                        key={d.id}
                        className={`border-t ${
                          isUndertime
                            ? "bg-amber-50/40 dark:bg-amber-950/20"
                            : ""
                        }`}
                      >
                        <td className="px-4 py-2 whitespace-nowrap">
                          {formatDate(d.work_date)}
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {row.shift_label ?? "—"}
                        </td>
                        <td className="px-4 py-2 tabular-nums">
                          {d.time_in ?? "—"}
                        </td>
                        <td className="px-4 py-2 tabular-nums">
                          {d.time_out ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {Number(d.hours_worked ?? 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {Number(d.late_minutes ?? 0)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {undertimeMins > 0 ? (
                            <span className="font-medium text-amber-600 dark:text-amber-400">
                              {undertimeMins}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {otHours > 0 ? otHours.toFixed(2) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2">
                          {otHours > 0 ? (
                            <div className="space-y-0.5">
                              <OtBadge status={row.ot_status} />
                              {row.ot_status === "rejected" && row.ot_review_notes && (
                                <p className="max-w-[180px] text-[11px] italic text-destructive">
                                  "{row.ot_review_notes}"
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {d.is_absent ? (
                            <span className="inline-flex items-center gap-1 text-xs text-destructive">
                              <AlertTriangle className="h-3 w-3" />
                              Absent
                            </span>
                          ) : d.is_leave ? (
                            <span className="text-xs text-muted-foreground">{flag}</span>
                          ) : (
                            <span className="text-xs text-success">Present</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {showFileOt && (
                            <Link
                              to="/ot-approvals"
                              className="inline-flex items-center rounded border border-border px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              File OT
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
