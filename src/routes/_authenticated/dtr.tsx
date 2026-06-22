import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { getMyDTRsByMonth } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate, shiftDisplay } from "@/lib/dtr";
import { exportRowsToCSV } from "@/lib/csv-export";
import { TablePagination } from "@/components/TablePagination";
import { TableSkeleton } from "@/components/TableSkeleton";
import { usePagination } from "@/hooks/use-pagination";
import { DisputeAttendanceDialog } from "@/components/DisputeAttendanceDialog";
import {
  fetchMyDisputes,
  fetchMyPendingDisputeApprovals,
  approveDisputeStep,
  rejectDisputeStep,
  cancelDispute,
  type DisputeRow,
} from "@/lib/attendance-dispute-functions";
import { toast } from "sonner";
import { Clock3, AlertTriangle, FileDown, Scale, Check, X, Ban } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dtr")({ component: AttendancePage });

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "warn" | "accent";
}) {
  return (
    <div className="rounded-md border bg-background/60 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-display text-2xl ${tone === "warn" ? "text-warning-foreground" : tone === "accent" ? "text-accent" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function OtBadge({ status }: { status: string | null | undefined }) {
  if (!status || status === "none") return <span className="text-xs text-muted-foreground">—</span>;
  const cls =
    status === "approved"
      ? "bg-success/15 text-success"
      : status === "rejected"
        ? "bg-destructive/15 text-destructive"
        : "bg-warning/20 text-warning-foreground";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>{status}</span>
  );
}

const DISPUTE_TONE: Record<DisputeRow["status"], string> = {
  pending: "bg-warning/20 text-warning-foreground",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

// Compact "in → out (shift)" summary of a dispute's requested values.
function disputeTimes(d: {
  requested_time_in: string | null;
  requested_time_out: string | null;
  requested_shift_label: string | null;
}) {
  const inOut = `${d.requested_time_in ?? "—"} → ${d.requested_time_out ?? "—"}`;
  return d.requested_shift_label ? `${inOut} · ${shiftDisplay(d.requested_shift_label)}` : inOut;
}

function AttendancePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [disputeOpen, setDisputeOpen] = useState(false);

  const { data: myDisputes } = useQuery({
    queryKey: ["my-disputes", user?.id],
    enabled: !!user,
    queryFn: () => fetchMyDisputes(),
  });

  const { data: pendingDisputes } = useQuery({
    queryKey: ["disputes-pending-for-me", user?.id],
    enabled: !!user,
    queryFn: () => fetchMyPendingDisputeApprovals(),
  });

  const invalidateDisputes = () => {
    qc.invalidateQueries({ queryKey: ["my-disputes"] });
    qc.invalidateQueries({ queryKey: ["disputes-pending-for-me"] });
    qc.invalidateQueries({ queryKey: ["dtrs-month"] });
  };

  const approveDispute = useMutation({
    mutationFn: (id: string) => approveDisputeStep({ data: { id } }),
    onSuccess: () => {
      toast.success("Dispute approved");
      invalidateDisputes();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectDispute = useMutation({
    mutationFn: (id: string) => rejectDisputeStep({ data: { id } }),
    onSuccess: () => {
      toast.success("Dispute rejected");
      invalidateDisputes();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMyDispute = useMutation({
    mutationFn: (id: string) => cancelDispute({ data: { id } }),
    onSuccess: () => {
      toast.success("Dispute cancelled");
      invalidateDisputes();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const todayYearMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const [selectedMonth, setSelectedMonth] = useState(todayYearMonth);

  const { data: dtrs, isLoading } = useQuery({
    queryKey: ["dtrs-month", user?.id, selectedMonth],
    queryFn: () => getMyDTRsByMonth(selectedMonth),
    enabled: !!user,
  });

  const sortedDtrs = dtrs ?? [];
  // The list now includes live-computed "absent" rows (no clock-in, no leave on a
  // past workday), so count present days by actual clock-ins, not row count.
  const presentDays = sortedDtrs.filter((d) => d.time_in).length;
  const absentDays = sortedDtrs.filter((d) => d.is_absent).length;
  const totalHours = sortedDtrs.reduce((s, d) => s + Number(d.hours_worked ?? 0), 0);
  const undertimeDays = sortedDtrs.filter(
    (d) => (d as { is_undertime?: boolean }).is_undertime,
  ).length;
  const totalOt = sortedDtrs.reduce((s, d) => s + Number(d.overtime_hours ?? 0), 0);

  const pg = usePagination(sortedDtrs, 25);

  const displayMonth = new Date(selectedMonth + "-01T00:00:00").toLocaleString("default", {
    month: "long",
    year: "numeric",
  });

  const handleExport = () => {
    type DtrRow = (typeof sortedDtrs)[number] & {
      shift_label?: string | null;
      is_undertime?: boolean;
      undertime_minutes?: number | null;
      ot_status?: string | null;
    };
    exportRowsToCSV(
      sortedDtrs as DtrRow[],
      [
        { header: "Date", value: (d) => d.work_date },
        { header: "Shift", value: (d) => d.shift_label ?? "" },
        { header: "Time In", value: (d) => d.time_in ?? "" },
        { header: "Time Out", value: (d) => d.time_out ?? "" },
        { header: "Hours", value: (d) => Number(d.hours_worked ?? 0).toFixed(2) },
        { header: "Late (min)", value: (d) => Number(d.late_minutes ?? 0) },
        { header: "Undertime (min)", value: (d) => Number(d.undertime_minutes ?? 0) },
        { header: "OT Hours", value: (d) => Number(d.overtime_hours ?? 0).toFixed(2) },
        { header: "OT Status", value: (d) => d.ot_status ?? "" },
        {
          header: "Flag",
          value: (d) => {
            if (d.is_absent) return "Absent";
            if (d.is_leave) return `Leave (${d.leave_type ?? ""})`;
            const tags: string[] = [];
            if (Number(d.late_minutes ?? 0) > 0) tags.push("Late");
            if (d.is_undertime) tags.push("Undertime");
            return tags.length ? tags.join(", ") : "Present";
          },
        },
      ],
      `attendance-${selectedMonth}`,
    );
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">My Records</p>
          <h1 className="mt-1 font-display text-4xl">Attendance History</h1>
        </div>
        <div className="flex items-center gap-3">
          <Label className="text-xs text-muted-foreground">Month</Label>
          <Input
            type="month"
            className="w-44"
            value={selectedMonth}
            max={todayYearMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          />
          <Button variant="outline" onClick={handleExport} disabled={sortedDtrs.length === 0}>
            <FileDown className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button onClick={() => setDisputeOpen(true)}>
            <Scale className="mr-2 h-4 w-4" /> Dispute attendance
          </Button>
        </div>
      </div>

      <DisputeAttendanceDialog open={disputeOpen} onOpenChange={setDisputeOpen} />

      {/* Disputes awaiting this user's approval (they're a supervisor in someone's chain) */}
      {pendingDisputes && pendingDisputes.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardHeader>
            <CardTitle className="font-display text-2xl flex items-center gap-2">
              <Scale className="h-5 w-5 text-warning-foreground" /> Disputes pending my approval
              <Badge variant="secondary" className="ml-1">
                {pendingDisputes.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Employee</th>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Current</th>
                  <th className="px-4 py-2 text-left">Requested</th>
                  <th className="px-4 py-2 text-left">Reason</th>
                  <th className="px-4 py-2 text-left">Step</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {pendingDisputes.map((d) => (
                  <tr key={d.id} className="border-t align-top">
                    <td className="px-4 py-2">
                      <div className="font-medium">{d.employee_full_name ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.employee_department ?? ""}
                      </div>
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(d.work_date)}</td>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">
                      {d.original_time_in ?? "—"} → {d.original_time_out ?? "—"}
                    </td>
                    <td className="px-4 py-2 tabular-nums font-medium">{disputeTimes(d)}</td>
                    <td className="px-4 py-2 text-muted-foreground max-w-[220px]">
                      {d.reason ?? ""}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {d.current_approver_index + 1} of {d.approver_chain.length}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Approve"
                          onClick={() => approveDispute.mutate(d.id)}
                          disabled={approveDispute.isPending || rejectDispute.isPending}
                        >
                          <Check className="h-4 w-4 text-success" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Reject"
                          onClick={() => rejectDispute.mutate(d.id)}
                          disabled={approveDispute.isPending || rejectDispute.isPending}
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Days logged" value={presentDays} />
        <Stat label="Hours worked" value={totalHours.toFixed(1)} tone="accent" />
        <Stat label="Absent days" value={absentDays} tone={absentDays > 0 ? "warn" : undefined} />
        <Stat
          label="Undertime days"
          value={undertimeDays}
          tone={undertimeDays > 0 ? "warn" : undefined}
        />
        <Stat label="OT hours" value={totalOt.toFixed(2)} />
      </div>

      {/* Attendance table */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl flex items-center gap-2">
            <Clock3 className="h-5 w-5" /> {displayMonth}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <TableSkeleton rows={8} cols={10} />
          ) : sortedDtrs.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              No attendance records for {displayMonth}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
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
                  </tr>
                </thead>
                <tbody>
                  {pg.pageItems.map((d) => {
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
                    return (
                      <tr
                        key={d.id}
                        className={`border-t ${isUndertime ? "bg-amber-50/40 dark:bg-amber-950/20" : ""}`}
                      >
                        <td className="px-4 py-2 whitespace-nowrap">{formatDate(d.work_date)}</td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {row.shift_label ?? "—"}
                        </td>
                        <td className="px-4 py-2 tabular-nums">{d.time_in ?? "—"}</td>
                        <td className="px-4 py-2 tabular-nums">{d.time_out ?? "—"}</td>
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
                          {otHours > 0 ? (
                            otHours.toFixed(2)
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
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
                            <span className="flex items-center gap-1 text-destructive">
                              <AlertTriangle className="h-3 w-3" />
                              Absent
                            </span>
                          ) : d.is_leave ? (
                            <span className="text-accent">Leave ({d.leave_type ?? ""})</span>
                          ) : (
                            <span className="flex flex-wrap items-center gap-1">
                              {Number(d.late_minutes ?? 0) > 0 && (
                                <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                                  Late
                                </span>
                              )}
                              {isUndertime && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                                  Undertime
                                </span>
                              )}
                              {Number(d.late_minutes ?? 0) === 0 && !isUndertime && (
                                <span className="text-muted-foreground">Present</span>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <TablePagination
            page={pg.page}
            pageCount={pg.pageCount}
            pageSize={pg.pageSize}
            total={pg.total}
            start={pg.start}
            pageItemsCount={pg.pageItems.length}
            onPageChange={pg.setPage}
            onPageSizeChange={pg.setPageSize}
          />
        </CardContent>
      </Card>

      {/* My attendance disputes */}
      {myDisputes && myDisputes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-2xl flex items-center gap-2">
              <Scale className="h-5 w-5" /> My disputes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">Was</th>
                  <th className="px-4 py-2 text-left">Requested</th>
                  <th className="px-4 py-2 text-left">Reason</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {myDisputes.map((d) => (
                  <tr key={d.id} className="border-t align-top">
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(d.work_date)}</td>
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">
                      {d.original_time_in ?? "—"} → {d.original_time_out ?? "—"}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{disputeTimes(d)}</td>
                    <td className="px-4 py-2 text-muted-foreground max-w-[220px]">
                      {d.reason ?? ""}
                      {d.review_notes && (
                        <span className="block text-[11px] italic">"{d.review_notes}"</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <Badge className={DISPUTE_TONE[d.status]} variant="secondary">
                        {d.status}
                      </Badge>
                      {d.status === "pending" && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          step {d.current_approver_index + 1} of {d.approver_chain.length}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {d.status === "pending" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Cancel dispute"
                          onClick={() => cancelMyDispute.mutate(d.id)}
                          disabled={cancelMyDispute.isPending}
                        >
                          <Ban className="h-4 w-4 text-warning-foreground" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
