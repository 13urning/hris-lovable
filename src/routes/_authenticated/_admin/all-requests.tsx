import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { fetchAllRequests } from "@/lib/all-requests-functions";
import {
  ALL_REQUESTS_MAX_RANGE_DAYS,
  REQUEST_KINDS,
  REQUEST_STATUSES,
  validateAllRequestsInput,
  type AllRequestRow,
  type RequestKind,
  type RequestStatus,
} from "@/lib/all-requests";
import { phTodayIso } from "@/lib/attendance-absence";
import { shiftDisplay } from "@/lib/dtr";
import { leaveTypeLabel } from "@/lib/leave-types";
import { to12Hour, formatOtRange } from "@/lib/ot-hours";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TablePagination } from "@/components/TablePagination";
import { TableSkeleton } from "@/components/TableSkeleton";
import { usePagination } from "@/hooks/use-pagination";
import { ClipboardList, AlertTriangle, Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/_admin/all-requests")({
  component: AllRequestsPage,
});

// ── Date helpers (pure string/UTC arithmetic — never local-timezone Date math,
// since these are calendar dates, not instants) ─────────────────────────────

function isoAddDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

// PH calendar date, e.g. "Sep 23, 2026". Pinned to Asia/Manila rather than the
// browser's zone (dtr.ts formatDate) so a timestamp like reviewed_at lands on
// the same day it does in PH. A bare "YYYY-MM-DD" parses as UTC midnight, which
// is the same calendar day in PH, so this is safe for date columns too.
function formatPhDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Filed timestamp (UTC ISO) → PH date + time, e.g. "Sep 23, 2026, 2:04 PM".
function formatFiledAt(iso: string): string {
  const d = new Date(iso);
  const date = formatPhDate(iso);
  const time = d.toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date}, ${time}`;
}

// "YYYY-MM" → "September 2026".
function formatTargetMonth(ym: string | null): string {
  if (!ym) return "—";
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleString("default", { month: "long", year: "numeric" });
}

function formatClockTime(t: string | null): string {
  return t ? to12Hour(t) : "—";
}

// ── Labels + tones ───────────────────────────────────────────────────────────

const KIND_LABELS: Record<RequestKind, string> = {
  leave: "Leave",
  ot_budget: "OT Budget",
  ot_actual: "OT Actual",
  dispute: "Dispute",
};

const KIND_TONE: Record<RequestKind, string> = {
  leave: "bg-accent/15 text-accent border-accent/30",
  ot_budget: "bg-primary/15 text-primary border-primary/30",
  ot_actual: "bg-primary/10 text-primary border-primary/20",
  dispute: "bg-warning/20 text-warning-foreground border-warning/40",
};

const STATUS_TONE: Record<RequestStatus, string> = {
  pending: "bg-warning/20 text-warning-foreground",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

const STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: "Only admins can view all requests.",
  UNAUTHENTICATED: "Sign in again to view all requests.",
  INVALID_INPUT: "Check the date range and try again.",
  INVALID_DATE: "Enter valid start and end dates.",
  INVALID_RANGE: "End date must be on or after the start date.",
  RANGE_TOO_LARGE: `Pick a range of ${ALL_REQUESTS_MAX_RANGE_DAYS} days or less.`,
};

function friendlyError(e: Error): string {
  return ERROR_MESSAGES[e.message] ?? e.message;
}

// Same validator the server runs, so the page can never block a range the
// server accepts (or send one it rejects).
function rangeErrorFor(startDate: string, endDate: string): string | null {
  if (!startDate) return "Pick a start date.";
  if (!endDate) return "Pick an end date.";
  try {
    validateAllRequestsInput({ startDate, endDate });
    return null;
  } catch (e) {
    return friendlyError(e as Error);
  }
}

// ── Per-kind "what was requested" summary (table Details column) ────────────

function RequestDetails({ row }: { row: AllRequestRow }) {
  switch (row.kind) {
    case "leave":
      return (
        <div>
          <div className="font-medium">{leaveTypeLabel(row.leave_type)}</div>
          <div className="text-xs text-muted-foreground">
            {row.half_day ? (
              <>
                {formatPhDate(row.start_date)}{" "}
                <span>(half day · {row.half_day_period ?? "—"})</span>
              </>
            ) : (
              <>
                {formatPhDate(row.start_date)} → {formatPhDate(row.end_date)}
              </>
            )}
          </div>
        </div>
      );
    case "ot_budget":
      return (
        <div>
          <div className="font-medium">{row.requested_hours ?? 0}h</div>
          <div className="text-xs text-muted-foreground">{formatTargetMonth(row.target_month)}</div>
        </div>
      );
    case "ot_actual": {
      const range = formatOtRange(row.time_from, row.time_to);
      return (
        <div>
          <div className="font-medium">
            {row.requested_hours ?? 0}h · {formatPhDate(row.work_date)}
          </div>
          {range && <div className="text-xs text-muted-foreground">{range}</div>}
        </div>
      );
    }
    case "dispute":
      return (
        <div>
          <div className="font-medium">{formatPhDate(row.work_date)}</div>
          <div className="text-xs text-muted-foreground">
            {formatClockTime(row.original_time_in)} – {formatClockTime(row.original_time_out)}
            {row.original_shift_label ? ` (${shiftDisplay(row.original_shift_label)})` : ""}
            {" → "}
            {formatClockTime(row.requested_time_in)} – {formatClockTime(row.requested_time_out)}
            {row.requested_shift_label ? ` (${shiftDisplay(row.requested_shift_label)})` : ""}
          </div>
        </div>
      );
    default:
      return null;
  }
}

// ── Approval column: who it's waiting on, or when/by whom it was decided ────

function ApprovalCell({ row }: { row: AllRequestRow }) {
  if (row.status === "pending") {
    return (
      <span className="text-xs text-muted-foreground">
        Waiting on{" "}
        <span className="font-medium text-foreground">{row.current_approver_name ?? "—"}</span>
        {" · step "}
        {row.current_approver_index + 1} of {row.chain_length}
      </span>
    );
  }
  if (!row.reviewed_at) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="text-xs text-muted-foreground">
      {formatPhDate(row.reviewed_at)}
      {row.reviewed_by_name && (
        <>
          {" · by "}
          <span className="text-foreground">{row.reviewed_by_name}</span>
        </>
      )}
    </span>
  );
}

// ── Read-only detail dialog ──────────────────────────────────────────────────

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm">{children}</div>
    </div>
  );
}

function RequestDetailDialog({
  row,
  onOpenChange,
}: {
  row: AllRequestRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl flex items-center gap-2">
            <Badge variant="outline" className={row ? KIND_TONE[row.kind] : ""}>
              {row ? KIND_LABELS[row.kind] : ""}
            </Badge>
            Request details
          </DialogTitle>
        </DialogHeader>
        {row && (
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <DetailField label="Employee">
                {row.employee_name ?? "Unknown"}
                <div className="text-xs text-muted-foreground">
                  {[row.department, row.employee_code].filter(Boolean).join(" · ") || "—"}
                </div>
              </DetailField>
              <DetailField label="Filed">{formatFiledAt(row.created_at)}</DetailField>
              <DetailField label="Status">
                <Badge className={STATUS_TONE[row.status]} variant="secondary">
                  {STATUS_LABELS[row.status]}
                </Badge>
              </DetailField>
              <DetailField label="Approval">
                <ApprovalCell row={row} />
              </DetailField>
            </div>

            <div className="rounded-md border p-3">
              <RequestDetails row={row} />
            </div>

            <DetailField label="Requester's notes">
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-secondary/30 p-3 text-sm">
                {row.requester_text?.trim() ? row.requester_text : "—"}
              </div>
            </DetailField>

            <DetailField label="Review notes">
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-secondary/30 p-3 text-sm">
                {row.review_notes?.trim() ? row.review_notes : "—"}
              </div>
            </DetailField>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function AllRequestsPage() {
  const { isAdmin, loading, rolesLoading, rolesInitialized, user } = useAuth();

  const today = phTodayIso();
  const [startDate, setStartDate] = useState(() => isoAddDays(today, -89));
  const [endDate, setEndDate] = useState(today);
  const [kindFilter, setKindFilter] = useState<"all" | RequestKind>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | RequestStatus>("all");
  const [search, setSearch] = useState("");
  const [selectedRow, setSelectedRow] = useState<AllRequestRow | null>(null);

  const rangeError = rangeErrorFor(startDate, endDate);

  const {
    data: result,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: ["all-requests", startDate, endDate],
    enabled: !!user && isAdmin && !rangeError,
    queryFn: () => fetchAllRequests({ data: { startDate, endDate } }),
  });

  // Rows scoped to the current type selection — the base for both the visible
  // table (after status + search are applied) and the per-status counts (so
  // the counts always describe "this type, this date range").
  const rowsForType = useMemo(() => {
    const rows = result?.rows ?? [];
    return kindFilter === "all" ? rows : rows.filter((r) => r.kind === kindFilter);
  }, [result, kindFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<RequestStatus, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0,
    };
    for (const r of rowsForType) counts[r.status]++;
    return counts;
  }, [rowsForType]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rowsForType
      .filter((r) => statusFilter === "all" || r.status === statusFilter)
      .filter((r) => {
        if (!q) return true;
        const name = r.employee_name?.toLowerCase() ?? "";
        const code = r.employee_code?.toLowerCase() ?? "";
        return name.includes(q) || code.includes(q);
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [rowsForType, statusFilter, search]);

  const pg = usePagination(filteredRows, 25);
  const { setPage } = pg;
  // Any filter change starts back at the newest rows — the shared hook only
  // clamps the page when the list shrinks, it never resets it.
  useEffect(() => {
    setPage(1);
  }, [setPage, kindFilter, statusFilter, search, startDate, endDate]);

  // ── Admin-only gate. The `_admin` layout alone admits HR, so this page adds
  // its own check and redirects everyone else to the dashboard (AC-R8). Mirrors
  // the layout gate's loading condition so a token-refresh re-fetch of roles
  // doesn't flash a redirect for an already-admitted admin. ─────────────────
  if (loading || (user && rolesLoading && !rolesInitialized)) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="font-display text-2xl text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!isAdmin) return <Navigate to="/dashboard" />;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Admin</p>
        <h1 className="mt-1 font-display text-4xl">All Requests</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Every leave, OT budget, OT actual-hours, and attendance dispute filed by any employee, by
          the date it was filed (Philippine time). Read-only — act on a request from its usual
          approval screen.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1">
            <Label htmlFor="ar-start" className="text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id="ar-start"
              type="date"
              className="w-40"
              value={startDate}
              max={endDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ar-end" className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id="ar-end"
              type="date"
              className="w-40"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as typeof kindFilter)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {REQUEST_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
            >
              <SelectTrigger className="w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses ({rowsForType.length})</SelectItem>
                {REQUEST_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]} ({statusCounts[s]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[200px] flex-1 space-y-1">
            <Label htmlFor="ar-search" className="text-xs text-muted-foreground">
              Search employee
            </Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="ar-search"
                className="pl-8"
                placeholder="Name or employee code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
        {rangeError && (
          <CardContent className="pt-0">
            <p className="flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" /> {rangeError}
            </p>
          </CardContent>
        )}
      </Card>

      {result?.truncated && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Showing the newest {result.limit.toLocaleString()} requests in this range — narrow the
          date range to see older requests.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            {isLoading || isFetching
              ? "Loading…"
              : `${filteredRows.length} request${filteredRows.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {error ? (
            <div className="px-6 py-10 text-center text-sm text-destructive">
              {friendlyError(error as Error)}
            </div>
          ) : isLoading ? (
            <TableSkeleton rows={8} cols={6} />
          ) : filteredRows.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              {rangeError
                ? "Fix the date range to load requests."
                : "No requests match your filters."}
            </div>
          ) : (
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Filed</th>
                  <th className="px-4 py-2 text-left">Employee</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Details</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-left">Approval</th>
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map((row) => (
                  <tr
                    key={`${row.kind}-${row.id}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`View details for ${row.employee_name ?? "this"} request`}
                    className="cursor-pointer border-t align-top transition-colors hover:bg-secondary/40 focus:bg-secondary/40 focus:outline-none"
                    onClick={() => setSelectedRow(row)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedRow(row);
                      }
                    }}
                  >
                    <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                      {formatFiledAt(row.created_at)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="font-medium truncate">{row.employee_name ?? "Unknown"}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[row.department, row.employee_code].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className={KIND_TONE[row.kind]}>
                        {KIND_LABELS[row.kind]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <RequestDetails row={row} />
                    </td>
                    <td className="px-4 py-2">
                      <Badge className={STATUS_TONE[row.status]} variant="secondary">
                        {STATUS_LABELS[row.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <ApprovalCell row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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

      <RequestDetailDialog row={selectedRow} onOpenChange={(o) => !o && setSelectedRow(null)} />
    </div>
  );
}
