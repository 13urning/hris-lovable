import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchAllLeaves,
  fetchMyLeaves,
  fetchMyProfile,
  fetchProfilesByIds,
  fileLeaveRequest,
  approveLeaveStep,
  rejectLeaveStep,
  fetchMyPendingLeaveApprovals,
  deleteLeaveRequest,
  cancelLeaveRequest,
  fileLeaveOnBehalf,
  fetchProfilesForLeaveFiling,
} from "@/lib/leave-functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TablePagination } from "@/components/TablePagination";
import { usePagination } from "@/hooks/use-pagination";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { RejectReasonDialog } from "@/components/RejectReasonDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { formatDate, todayIso } from "@/lib/dtr";
import { businessDaysBetween } from "@/lib/utils";
import {
  Plane,
  Check,
  X,
  Trash2,
  Ban,
  CalendarDays,
  Clock3,
  CalendarCheck2,
  Users,
  FileDown,
  UserPlus,
} from "lucide-react";
import { exportRowsToCSV } from "@/lib/csv-export";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/leaves")({ component: LeavesPage });

type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
type LeaveRow = {
  id: string;
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: LeaveStatus;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
  half_day: boolean;
  half_day_period: "AM" | "PM" | null;
};

const LEAVE_TYPES = [
  { value: "VL", label: "Vacation Leave" },
  { value: "SL", label: "Sick Leave" },
  { value: "EL", label: "Emergency Leave" },
  { value: "BDAY", label: "Birthday Leave" },
  { value: "ML", label: "Maternity Leave" },
  { value: "PL", label: "Paternity Leave" },
  { value: "BL", label: "Bereavement Leave" },
  { value: "WP", label: "Leave without Pay" },
  { value: "Other", label: "Other" },
];

const STATUS_TONE: Record<LeaveStatus, string> = {
  pending: "bg-warning/20 text-warning-foreground",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function daysBetween(a: string, b: string) {
  return businessDaysBetween(a, b);
}

// Day count for a stored leave row, accounting for half-day leaves (0.5 day).
function leaveDays(l: { start_date: string; end_date: string; half_day?: boolean }) {
  return l.half_day ? 0.5 : businessDaysBetween(l.start_date, l.end_date);
}

function isWeekend(iso: string) {
  const d = new Date(iso).getDay();
  return d === 0 || d === 6;
}

function nextWeekday(iso: string) {
  const d = new Date(iso);
  if (d.getDay() === 6) d.setDate(d.getDate() + 2);
  else if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function fromIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function initials(name?: string) {
  if (!name) return "—";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");
}

function isBetween(date: string, start: string, end: string) {
  return date >= start && date <= end;
}

function addDaysIso(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const LEAVE_TONE: Record<string, string> = {
  VL: "bg-accent/15 text-accent border-accent/30",
  SL: "bg-destructive/10 text-destructive border-destructive/30",
  EL: "bg-warning/20 text-warning-foreground border-warning/40",
  BDAY: "bg-primary/15 text-primary border-primary/30",
  BL: "bg-muted text-muted-foreground border-border",
  ML: "bg-success/15 text-success border-success/30",
  PL: "bg-success/15 text-success border-success/30",
  WP: "bg-muted text-muted-foreground border-border",
  Other: "bg-secondary text-secondary-foreground border-border",
};

// Weekend-blocking single date picker. `minIso` disables dates before it.
function DatePickerField({
  value,
  onSelect,
  minIso,
}: {
  value: string;
  onSelect: (iso: string) => void;
  minIso?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start text-left font-normal">
          <CalendarDays className="mr-2 h-4 w-4" />
          {formatDate(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={fromIso(value)}
          onSelect={(date) => {
            if (!date) return;
            onSelect(toIso(date));
            setOpen(false);
          }}
          disabled={(date) => {
            const dow = date.getDay();
            return dow === 0 || dow === 6 || (minIso ? toIso(date) < minIso : false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function LeavesPage() {
  const { user, isHR } = useAuth();
  const qc = useQueryClient();
  const today = todayIso();
  const weekEnd = addDaysIso(today, 6);

  const [form, setForm] = useState(() => {
    const d = nextWeekday(todayIso());
    return {
      leave_type: "VL",
      start_date: d,
      end_date: d,
      reason: "",
      half_day: false,
      half_day_period: "AM" as "AM" | "PM",
    };
  });
  const [filter, setFilter] = useState<"all" | "mine" | LeaveStatus>(isHR ? "all" : "mine");
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  // Id of the leave request awaiting a rejection reason (drives the reject dialog).
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  // ── Admin: file a leave on an employee's behalf ──────────────────────────
  const [behalf, setBehalf] = useState(() => {
    const d = nextWeekday(todayIso());
    return {
      employee_id: "",
      leave_type: "VL",
      start_date: d,
      end_date: d,
      reason: "",
      auto_approve: true,
      half_day: false,
      half_day_period: "AM" as "AM" | "PM",
    };
  });

  // HR sees everyone's leaves; a regular employee sees only their own (the
  // all-leaves query is HR-gated server-side).
  const { data: leaves } = useQuery({
    queryKey: ["leaves", isHR ? "all" : user?.id],
    enabled: !!user,
    queryFn: () => (isHR ? fetchAllLeaves() : fetchMyLeaves()) as Promise<LeaveRow[]>,
  });

  // Leave balances for the filing gate (employees only).
  const { data: myBalance } = useQuery({
    queryKey: ["my-leave-balance", user?.id],
    enabled: !!user && !isHR,
    queryFn: () => fetchMyProfile(),
  });
  const vlRemaining = Number(myBalance?.vl_remaining ?? 0);
  const slRemaining = Number(myBalance?.sl_remaining ?? 0);

  const employeeIds = useMemo(
    () => Array.from(new Set((leaves ?? []).map((l) => l.employee_id))),
    [leaves],
  );

  const { data: profilesMap } = useQuery({
    queryKey: ["leave-profiles", employeeIds.join(",")],
    enabled: employeeIds.length > 0,
    queryFn: async () => {
      const profiles = await fetchProfilesByIds({ data: { ids: employeeIds } });
      return Object.fromEntries(profiles.map((p) => [p.id, p]));
    },
  });

  const filtered = (leaves ?? []).filter((l) => {
    if (filter === "all") return true;
    if (filter === "mine") return l.employee_id === user?.id;
    return l.status === filter;
  });

  const active = (leaves ?? []).filter((l) => l.status === "approved" || l.status === "pending");
  const onLeaveToday = active
    .filter((l) => isBetween(today, l.start_date, l.end_date))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "approved" ? -1 : 1));
  const upcoming = active
    .filter((l) => l.start_date > today && l.start_date <= weekEnd)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const pendingCount = (leaves ?? []).filter((l) => l.status === "pending").length;

  // Filing balance gate: every type except Leave without Pay needs enough
  // balance for the requested days. VL→vacation, SL→sick, other paid types draw
  // from the combined pool. HR/admins aren't gated.
  const formDays = form.half_day ? 0.5 : daysBetween(form.start_date, form.end_date);
  const availableForType =
    form.leave_type === "WP"
      ? Infinity
      : form.leave_type === "VL"
        ? vlRemaining
        : form.leave_type === "SL"
          ? slRemaining
          : vlRemaining + slRemaining;
  // Don't gate until the balance query has resolved (undefined = still loading)
  // to avoid a false "insufficient" flash on first render.
  const insufficientBalance = !isHR && myBalance !== undefined && availableForType < formDays;
  const formTypeLabel =
    LEAVE_TYPES.find((t) => t.value === form.leave_type)?.label ?? form.leave_type;

  const fileLeave = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("not signed in");
      if (isWeekend(form.start_date)) throw new Error("Start date cannot be a weekend");
      // Half-day leave is a single day, so the end date is ignored entirely.
      if (!form.half_day) {
        if (isWeekend(form.end_date)) throw new Error("End date cannot be a weekend");
        if (new Date(form.end_date) < new Date(form.start_date))
          throw new Error("End date must be on or after start date");
      }
      if (insufficientBalance)
        throw new Error(
          `Not enough ${formTypeLabel} balance for ${formDays} day(s). File Leave without Pay instead.`,
        );
      await fileLeaveRequest({
        data: {
          leaveType: form.leave_type,
          startDate: form.start_date,
          endDate: form.half_day ? form.start_date : form.end_date,
          reason: form.reason || null,
          halfDay: form.half_day,
          halfDayPeriod: form.half_day ? form.half_day_period : null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Leave filed");
      setForm({ ...form, reason: "" });
      qc.invalidateQueries({ queryKey: ["leaves"] });
    },
    onError: (e: Error) =>
      toast.error(
        e.message === "INSUFFICIENT_BALANCE"
          ? `Not enough ${formTypeLabel} balance for ${formDays} day(s). File Leave without Pay instead.`
          : e.message,
      ),
  });

  const { data: pendingForMe } = useQuery({
    queryKey: ["leaves-pending-for-me", user?.id],
    enabled: !!user?.id,
    queryFn: () => fetchMyPendingLeaveApprovals(),
  });

  const pendingPg = usePagination(pendingForMe ?? [], 25);
  const historyPg = usePagination(filtered, 25);

  // Employee picker for on-behalf filing (HR/admin only).
  const { data: filingProfiles } = useQuery({
    queryKey: ["leave-filing-profiles"],
    enabled: isHR,
    queryFn: () => fetchProfilesForLeaveFiling(),
  });

  const fileBehalf = useMutation({
    mutationFn: async () => {
      if (!behalf.employee_id) throw new Error("Pick an employee");
      if (isWeekend(behalf.start_date)) throw new Error("Start date cannot be a weekend");
      // Half-day leave is a single day, so the end date is ignored entirely.
      if (!behalf.half_day) {
        if (isWeekend(behalf.end_date)) throw new Error("End date cannot be a weekend");
        if (new Date(behalf.end_date) < new Date(behalf.start_date))
          throw new Error("End date must be on or after start date");
      }
      await fileLeaveOnBehalf({
        data: {
          employeeId: behalf.employee_id,
          leaveType: behalf.leave_type,
          startDate: behalf.start_date,
          endDate: behalf.half_day ? behalf.start_date : behalf.end_date,
          reason: behalf.reason || null,
          autoApprove: behalf.auto_approve,
          halfDay: behalf.half_day,
          halfDayPeriod: behalf.half_day ? behalf.half_day_period : null,
        },
      });
    },
    onSuccess: () => {
      toast.success(behalf.auto_approve ? "Leave filed and approved" : "Leave filed for approval");
      setBehalf({ ...behalf, reason: "" });
      qc.invalidateQueries({ queryKey: ["leaves"] });
      qc.invalidateQueries({ queryKey: ["leaves-pending-for-me"] });
    },
    onError: (e: Error) =>
      toast.error(
        e.message === "NO_ORG_NODE"
          ? "This employee isn't in the org chart, so it can't be routed for approval. Turn on \"Approve immediately\" to file it anyway."
          : e.message,
      ),
  });

  const approveStep = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      if (!user) throw new Error("not signed in");
      await approveLeaveStep({ data: { id, notes } });
    },
    onSuccess: () => {
      toast.success("Approved");
      qc.invalidateQueries({ queryKey: ["leaves"] });
      qc.invalidateQueries({ queryKey: ["leaves-pending-for-me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectStep = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      if (!user) throw new Error("not signed in");
      await rejectLeaveStep({ data: { id, notes } });
    },
    onSuccess: () => {
      toast.success("Rejected");
      setRejectingId(null);
      qc.invalidateQueries({ queryKey: ["leaves"] });
      qc.invalidateQueries({ queryKey: ["leaves-pending-for-me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Soft-cancel a pending request (keeps it as 'cancelled' for history).
  const cancelLeave = useMutation({
    mutationFn: async (id: string) => {
      await cancelLeaveRequest({ data: { id } });
    },
    onSuccess: () => {
      toast.success("Request cancelled");
      qc.invalidateQueries({ queryKey: ["leaves"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // HR-only hard delete (e.g. to clear out old/cancelled rows).
  const deleteLeave = useMutation({
    mutationFn: async (id: string) => {
      await deleteLeaveRequest({ data: { id } });
    },
    onSuccess: () => {
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["leaves"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleExport = () => {
    exportRowsToCSV(
      filtered,
      [
        { header: "Employee", value: (l) => profilesMap?.[l.employee_id]?.full_name ?? "" },
        { header: "Department", value: (l) => profilesMap?.[l.employee_id]?.department ?? "" },
        { header: "Type", value: (l) => l.leave_type },
        {
          header: "Type Label",
          value: (l) => LEAVE_TYPES.find((t) => t.value === l.leave_type)?.label ?? l.leave_type,
        },
        { header: "Start Date", value: (l) => l.start_date },
        { header: "End Date", value: (l) => l.end_date },
        { header: "Days", value: (l) => leaveDays(l) },
        {
          header: "Half Day",
          value: (l) => (l.half_day ? `Yes (${l.half_day_period ?? ""})` : "No"),
        },
        { header: "Reason", value: (l) => l.reason ?? "" },
        { header: "Status", value: (l) => l.status },
        { header: "Filed", value: (l) => l.created_at },
        { header: "Reviewed", value: (l) => l.reviewed_at ?? "" },
        { header: "Review Notes", value: (l) => l.review_notes ?? "" },
      ],
      "leaves",
    );
  };

  return (
    <div className="space-y-8">
      <RejectReasonDialog
        open={rejectingId !== null}
        onOpenChange={(o) => !o && setRejectingId(null)}
        onConfirm={(reason) => rejectingId && rejectStep.mutate({ id: rejectingId, notes: reason })}
        pending={rejectStep.isPending}
        title="Reject leave request"
      />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Team</p>
          <h1 className="mt-1 font-display text-4xl">Leave Requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            File a leave and see who's out across the team.
          </p>
        </div>
      </div>

      {/* Today snapshot */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2 overflow-hidden border-accent/20 bg-gradient-to-br from-accent/5 via-card to-card">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="font-display text-2xl flex items-center gap-2">
                <CalendarCheck2 className="h-5 w-5 text-accent" /> Out today
              </CardTitle>
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {formatDate(today)}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {onLeaveToday.length ? (
              <div className="flex flex-wrap gap-3">
                {onLeaveToday.map((l) => {
                  const p = profilesMap?.[l.employee_id];
                  const typeLabel =
                    LEAVE_TYPES.find((t) => t.value === l.leave_type)?.label ?? l.leave_type;
                  const tone = LEAVE_TONE[l.leave_type] ?? LEAVE_TONE.Other;
                  const isPending = l.status === "pending";
                  return (
                    <div
                      key={l.id}
                      className={`group flex items-center gap-3 rounded-xl border bg-card/80 px-3 py-2 shadow-sm transition hover:shadow-md ${isPending ? "border-dashed opacity-80" : ""}`}
                      title={typeLabel}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {initials(p?.full_name)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium flex items-center gap-1.5">
                          {p?.full_name ?? "Unknown"}
                          {isPending && (
                            <span className="text-[9px] font-medium uppercase tracking-wide text-warning-foreground bg-warning/30 rounded px-1 py-0.5">
                              pending
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}
                          >
                            {l.leave_type}
                          </span>
                          <span className="text-[11px] text-muted-foreground truncate">
                            until {formatDate(l.end_date)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-dashed bg-background/40 px-4 py-6 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                Everyone's in today.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-xl flex items-center gap-2">
              <Clock3 className="h-4 w-4" /> This week
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Upcoming
              </span>
              <span className="font-display text-3xl">{upcoming.length}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Pending</span>
              <span className="font-display text-3xl">{pendingCount}</span>
            </div>
            {upcoming.length > 0 && (
              <div className="space-y-1.5 border-t pt-3">
                {upcoming.slice(0, 3).map((l) => {
                  const p = profilesMap?.[l.employee_id];
                  return (
                    <div key={l.id} className="flex items-center justify-between text-xs">
                      <span className="truncate font-medium">{p?.full_name ?? "—"}</span>
                      <span className="text-muted-foreground">{formatDate(l.start_date)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {pendingForMe && pendingForMe.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardHeader>
            <CardTitle className="font-display text-2xl flex items-center gap-2">
              <Check className="h-5 w-5 text-warning-foreground" /> Pending my approval
              <Badge variant="secondary" className="ml-1">
                {pendingForMe.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Employee</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Dates</th>
                  <th className="px-4 py-2 text-right">Days</th>
                  <th className="px-4 py-2 text-left">Reason</th>
                  <th className="px-4 py-2 text-left">Step</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {pendingPg.pageItems.map((l) => {
                  const typeLabel =
                    LEAVE_TYPES.find((t) => t.value === l.leave_type)?.label ?? l.leave_type;
                  const tone = LEAVE_TONE[l.leave_type] ?? LEAVE_TONE.Other;
                  const step = l.current_approver_index + 1;
                  const total = l.approver_chain.length;
                  return (
                    <tr key={l.id} className="border-t align-top">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                            {initials(l.employee_full_name ?? undefined)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate">
                              {l.employee_full_name ?? "—"}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {l.employee_department ?? ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}
                        >
                          {l.leave_type}
                        </span>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{typeLabel}</div>
                      </td>
                      <td className="px-4 py-2">
                        {l.half_day ? (
                          <span>
                            {formatDate(l.start_date)}{" "}
                            <span className="text-muted-foreground">
                              (half day · {l.half_day_period})
                            </span>
                          </span>
                        ) : (
                          <>
                            {formatDate(l.start_date)} → {formatDate(l.end_date)}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">{leaveDays(l)}</td>
                      <td className="px-4 py-2 text-muted-foreground max-w-[260px]">
                        {l.reason ?? ""}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {step} of {total}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Approve"
                            onClick={() => approveStep.mutate({ id: l.id })}
                            disabled={approveStep.isPending || rejectStep.isPending}
                          >
                            <Check className="h-4 w-4 text-success" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Reject"
                            onClick={() => setRejectingId(l.id)}
                            disabled={approveStep.isPending || rejectStep.isPending}
                          >
                            <X className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <TablePagination
              page={pendingPg.page}
              pageCount={pendingPg.pageCount}
              pageSize={pendingPg.pageSize}
              total={pendingPg.total}
              start={pendingPg.start}
              pageItemsCount={pendingPg.pageItems.length}
              onPageChange={pendingPg.setPage}
              onPageSizeChange={pendingPg.setPageSize}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl flex items-center gap-2">
            <Plane className="h-5 w-5" /> File a leave
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <Label>Leave type</Label>
              <Select
                value={form.leave_type}
                onValueChange={(v) => setForm({ ...form, leave_type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Start date</Label>
              <Popover open={startOpen} onOpenChange={setStartOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {formatDate(form.start_date)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={fromIso(form.start_date)}
                    onSelect={(date) => {
                      if (!date) return;
                      const iso = toIso(date);
                      const end = iso > form.end_date ? iso : form.end_date;
                      setForm({ ...form, start_date: iso, end_date: end });
                      setStartOpen(false);
                    }}
                    disabled={(date) => date.getDay() === 0 || date.getDay() === 6}
                  />
                </PopoverContent>
              </Popover>
              <p className="mt-1 text-[11px] text-muted-foreground">Past or future dates allowed</p>
            </div>
            {form.half_day ? (
              <div>
                <Label>Half-day period</Label>
                <Select
                  value={form.half_day_period}
                  onValueChange={(v) =>
                    setForm({ ...form, half_day_period: v as "AM" | "PM" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AM">Morning (AM)</SelectItem>
                    <SelectItem value="PM">Afternoon (PM)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[11px] text-muted-foreground">0.5 day</p>
              </div>
            ) : (
              <div>
                <Label>End date</Label>
                <Popover open={endOpen} onOpenChange={setEndOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-left font-normal"
                    >
                      <CalendarDays className="mr-2 h-4 w-4" />
                      {formatDate(form.end_date)}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={fromIso(form.end_date)}
                      onSelect={(date) => {
                        if (!date) return;
                        setForm({ ...form, end_date: toIso(date) });
                        setEndOpen(false);
                      }}
                      disabled={(date) => {
                        const dow = date.getDay();
                        return dow === 0 || dow === 6 || toIso(date) < form.start_date;
                      }}
                    />
                  </PopoverContent>
                </Popover>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {daysBetween(form.start_date, form.end_date)} day(s)
                </p>
              </div>
            )}
            <div className="md:col-span-4">
              <label className="flex items-center gap-3 text-sm">
                <Switch
                  checked={form.half_day}
                  onCheckedChange={(v) => setForm({ ...form, half_day: v })}
                />
                <span>
                  <span className="font-medium">Half day</span>
                  <span className="block text-xs text-muted-foreground">
                    Take a single day as a half-day leave, counted as 0.5 day.
                  </span>
                </span>
              </label>
            </div>
            <div className="md:col-span-4">
              <Label>Reason</Label>
              <Textarea
                rows={2}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Optional — give HR context for this leave"
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              {!isHR && (
                <>
                  Balance — <span className="font-medium text-foreground">VL {vlRemaining}</span> ·{" "}
                  <span className="font-medium text-foreground">SL {slRemaining}</span> day(s).
                  {insufficientBalance && (
                    <span className="ml-2 font-medium text-destructive">
                      Not enough {formTypeLabel} for {formDays} day(s) — only Leave without Pay is
                      available.
                    </span>
                  )}
                </>
              )}
            </div>
            <Button
              onClick={() => fileLeave.mutate()}
              disabled={fileLeave.isPending || insufficientBalance}
            >
              File leave
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Admin: file a leave on an employee's behalf */}
      {isHR && (
        <Card className="border-accent/30">
          <CardHeader>
            <CardTitle className="font-display text-2xl flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-accent" /> File on behalf of an employee
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Record a leave for someone who didn't file it themselves.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <Label>Employee</Label>
                <Select
                  value={behalf.employee_id}
                  onValueChange={(v) => setBehalf({ ...behalf, employee_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee" />
                  </SelectTrigger>
                  <SelectContent>
                    {(filingProfiles ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.full_name}
                        {p.department ? ` · ${p.department}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Leave type</Label>
                <Select
                  value={behalf.leave_type}
                  onValueChange={(v) => setBehalf({ ...behalf, leave_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAVE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Start date</Label>
                <DatePickerField
                  value={behalf.start_date}
                  onSelect={(iso) =>
                    setBehalf({
                      ...behalf,
                      start_date: iso,
                      end_date: iso > behalf.end_date ? iso : behalf.end_date,
                    })
                  }
                />
              </div>
              {behalf.half_day ? (
                <div>
                  <Label>Half-day period</Label>
                  <Select
                    value={behalf.half_day_period}
                    onValueChange={(v) =>
                      setBehalf({ ...behalf, half_day_period: v as "AM" | "PM" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AM">Morning (AM)</SelectItem>
                      <SelectItem value="PM">Afternoon (PM)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">0.5 day</p>
                </div>
              ) : (
                <div>
                  <Label>End date</Label>
                  <DatePickerField
                    value={behalf.end_date}
                    minIso={behalf.start_date}
                    onSelect={(iso) => setBehalf({ ...behalf, end_date: iso })}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {daysBetween(behalf.start_date, behalf.end_date)} day(s)
                  </p>
                </div>
              )}
              <div className="md:col-span-4">
                <label className="flex items-center gap-3 text-sm">
                  <Switch
                    checked={behalf.half_day}
                    onCheckedChange={(v) => setBehalf({ ...behalf, half_day: v })}
                  />
                  <span>
                    <span className="font-medium">Half day</span>
                    <span className="block text-xs text-muted-foreground">
                      File a single day as a half-day leave, counted as 0.5 day.
                    </span>
                  </span>
                </label>
              </div>
              <div className="md:col-span-4">
                <Label>Reason</Label>
                <Textarea
                  rows={2}
                  value={behalf.reason}
                  onChange={(e) => setBehalf({ ...behalf, reason: e.target.value })}
                  placeholder="Optional — context for this leave"
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
              <label className="flex items-center gap-3 text-sm">
                <Switch
                  checked={behalf.auto_approve}
                  onCheckedChange={(v) => setBehalf({ ...behalf, auto_approve: v })}
                />
                <span>
                  <span className="font-medium">Approve immediately</span>
                  <span className="block text-xs text-muted-foreground">
                    {behalf.auto_approve
                      ? "Filed as approved right away."
                      : "Routed through the employee's supervisor chain for approval."}
                  </span>
                </span>
              </label>
              <Button onClick={() => fileBehalf.mutate()} disabled={fileBehalf.isPending}>
                File for employee
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="font-display text-2xl flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />{" "}
            {isHR ? "All leaves" : filter === "mine" ? "My leaves" : "Leaves"}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Filter</Label>
            <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="mine">Mine</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            {isHR && (
              <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
                <FileDown className="mr-2 h-4 w-4" /> Export CSV
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {filtered.length ? (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Employee</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Dates</th>
                  <th className="px-4 py-2 text-right">Days</th>
                  <th className="px-4 py-2 text-left">Reason</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {historyPg.pageItems.map((l) => {
                  const p = profilesMap?.[l.employee_id];
                  const isMine = l.employee_id === user?.id;
                  const typeLabel =
                    LEAVE_TYPES.find((t) => t.value === l.leave_type)?.label ?? l.leave_type;
                  const isToday =
                    (l.status === "approved" || l.status === "pending") &&
                    isBetween(today, l.start_date, l.end_date);
                  const tone = LEAVE_TONE[l.leave_type] ?? LEAVE_TONE.Other;
                  return (
                    <tr key={l.id} className={`border-t align-top ${isToday ? "bg-accent/5" : ""}`}>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                            {initials(p?.full_name)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate flex items-center gap-2">
                              {p?.full_name ?? "—"}
                              {isMine && (
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                  you
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {p?.department ?? ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}
                        >
                          {l.leave_type}
                        </span>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{typeLabel}</div>
                      </td>
                      <td className="px-4 py-2">
                        <div>
                          {l.half_day ? (
                            <span>
                              {formatDate(l.start_date)}{" "}
                              <span className="text-muted-foreground">
                                (half day · {l.half_day_period})
                              </span>
                            </span>
                          ) : (
                            <>
                              {formatDate(l.start_date)} → {formatDate(l.end_date)}
                            </>
                          )}
                        </div>
                        {isToday && (
                          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-accent">
                            On leave today
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">{leaveDays(l)}</td>
                      <td className="px-4 py-2 text-muted-foreground max-w-[260px]">
                        {l.reason ?? ""}
                      </td>
                      <td className="px-4 py-2">
                        <Badge className={STATUS_TONE[l.status]} variant="secondary">
                          {l.status}
                        </Badge>
                        {l.review_notes && (
                          <span className="mt-0.5 block max-w-[200px] text-[11px] italic text-muted-foreground">
                            "{l.review_notes}"
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {l.status === "pending" && (isMine || isHR) && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Cancel request"
                              onClick={() => cancelLeave.mutate(l.id)}
                              disabled={cancelLeave.isPending}
                            >
                              <Ban className="h-4 w-4 text-warning-foreground" />
                            </Button>
                          )}
                          {isHR && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Delete permanently"
                              onClick={() => deleteLeave.mutate(l.id)}
                              disabled={deleteLeave.isPending}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              No leaves to show.
            </div>
          )}
          <TablePagination
            page={historyPg.page}
            pageCount={historyPg.pageCount}
            pageSize={historyPg.pageSize}
            total={historyPg.total}
            start={historyPg.start}
            pageItemsCount={historyPg.pageItems.length}
            onPageChange={historyPg.setPage}
            onPageSizeChange={historyPg.setPageSize}
          />
        </CardContent>
      </Card>
    </div>
  );
}
