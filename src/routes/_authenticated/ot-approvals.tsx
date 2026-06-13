import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  getMyOTBudgets, getMyActualOTs, getApprovedOTBudgets,
  fetchMyPendingOTApprovals, fileOTBudgetRequest, fileActualOTHours,
  approveOTStep, rejectOTStep,
} from "@/lib/ot-functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/dtr";
import { exportRowsToCSV } from "@/lib/csv-export";
import { toast } from "sonner";
import { Clock3, CheckCircle2, XCircle, Send, CalendarClock, FileDown } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ot-approvals")({
  component: OTApprovalsPage,
});

// ── Interfaces ────────────────────────────────────────────────────────────────

interface OTRequest {
  id: string;
  dtr_id: string | null;
  employee_id: string;
  requested_hours: number;
  work_date: string | null;
  request_type: "pre_approved" | "actual";
  pre_approved_id: string | null;
  target_month: string | null;
  status: "pending" | "approved" | "rejected";
  approver_chain: string[];
  current_approver_index: number;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

interface PendingOTRow {
  id: string;
  employee_id: string;
  request_type: "pre_approved" | "actual";
  requested_hours: number;
  target_month: string | null;
  work_date: string | null;
  approver_chain: string[];
  current_approver_index: number;
  review_notes: string | null;
  created_at: string;
  employee_full_name: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nextMonthValue(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatMonth(isoDate: string | null) {
  if (!isoDate) return "—";
  const d = new Date(isoDate + "T00:00:00");
  return d.toLocaleString("default", { month: "long", year: "numeric" });
}

function StatusBadge({ status }: { status: OTRequest["status"] | "logged" }) {
  if (status === "logged") {
    return (
      <span className="rounded bg-success/15 px-2 py-0.5 text-xs text-success">
        logged
      </span>
    );
  }
  const cls =
    status === "approved"
      ? "rounded bg-success/15 px-2 py-0.5 text-xs text-success"
      : status === "rejected"
      ? "rounded bg-destructive/15 px-2 py-0.5 text-xs text-destructive"
      : "rounded bg-warning/20 px-2 py-0.5 text-xs text-warning-foreground";
  return <span className={cls}>{status}</span>;
}

function StepBadge({ row }: { row: { current_approver_index: number; approver_chain: string[] } }) {
  const total = row.approver_chain.length;
  const step = Math.min(row.current_approver_index + 1, total);
  return (
    <span className="rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
      step {step} of {total}
    </span>
  );
}


// ── Main page ─────────────────────────────────────────────────────────────────

function OTApprovalsPage() {
  const { user, isHR } = useAuth();
  const qc = useQueryClient();

  // ── "Request OT Budget" dialog ───────────────────────────────────────────
  const [budgetDialogOpen, setBudgetDialogOpen] = useState(false);
  const [budgetForm, setBudgetForm] = useState({
    month: nextMonthValue(),
    requested_hours: 8,
    notes: "",
  });

  // ── "File OT Hours" dialog ───────────────────────────────────────────────
  const [fileDialogOpen, setFileDialogOpen] = useState(false);
  const [fileForm, setFileForm] = useState({
    pre_approved_id: "",
    work_date: new Date().toISOString().slice(0, 10),
    hours: 1,
  });

  // ── Decision inline-expand state ─────────────────────────────────────────
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState("");

  function toggleDecision(requestId: string, action: "approve" | "reject") {
    const key = `${requestId}-${action}`;
    if (decidingId === key) {
      setDecidingId(null);
      setDecisionNotes("");
    } else {
      setDecidingId(key);
      setDecisionNotes("");
    }
  }

  // ── Section 1: My pre-approved OT budget requests ───────────────────────
  const { data: myBudgets, isLoading: myBudgetsLoading } = useQuery({
    queryKey: ["ot-budgets-mine", user?.id],
    queryFn: () => getMyOTBudgets() as Promise<OTRequest[]>,
    enabled: !!user && !isHR,
  });

  // ── Section 2a: My filed OT (actual) ────────────────────────────────────
  const { data: myActuals, isLoading: myActualsLoading } = useQuery({
    queryKey: ["ot-actuals-mine", user?.id],
    queryFn: () => getMyActualOTs() as Promise<OTRequest[]>,
    enabled: !!user && !isHR,
  });

  // ── Section 2b: Approved budgets (for dropdown in file dialog) ───────────
  const { data: approvedBudgets } = useQuery({
    queryKey: ["ot-budgets-approved", user?.id],
    queryFn: () => getApprovedOTBudgets() as Promise<OTRequest[]>,
    enabled: !!user && !isHR,
  });

  // Hours per budget split by status. "approved" drives the displayed Used /
  // Remaining numbers (pending hours don't reduce remaining until they're
  // actually approved). "pending" surfaces alongside as an indicator, and the
  // total (approved + pending) caps how much can still be filed so multiple
  // pending requests can't collectively over-commit a budget.
  const { approvedHoursById, pendingHoursById } = useMemo(() => {
    const approved: Record<string, number> = {};
    const pending: Record<string, number> = {};
    for (const a of myActuals ?? []) {
      if (!a.pre_approved_id) continue;
      if (a.status === "approved") {
        approved[a.pre_approved_id] = (approved[a.pre_approved_id] ?? 0) + a.requested_hours;
      } else if (a.status === "pending") {
        pending[a.pre_approved_id] = (pending[a.pre_approved_id] ?? 0) + a.requested_hours;
      }
    }
    return { approvedHoursById: approved, pendingHoursById: pending };
  }, [myActuals]);

  const selectedBudget = approvedBudgets?.find(
    (b) => b.id === fileForm.pre_approved_id,
  ) ?? null;
  const approvedForSelected = selectedBudget
    ? (approvedHoursById[selectedBudget.id] ?? 0)
    : 0;
  const pendingForSelected = selectedBudget
    ? (pendingHoursById[selectedBudget.id] ?? 0)
    : 0;
  // What's shown as "remaining" — only deducts approved.
  const remainingForSelected = selectedBudget
    ? Math.max(0, selectedBudget.requested_hours - approvedForSelected)
    : 0;
  // What you can still file — also subtracts pending so you can't queue up
  // requests that collectively exceed the budget.
  const availableForSelected = selectedBudget
    ? Math.max(0, selectedBudget.requested_hours - approvedForSelected - pendingForSelected)
    : 0;

  const nextMonthIso = nextMonthValue() + "-01";
  const nextMonthBudget = useMemo(
    () => (myBudgets ?? []).find((b) => b.target_month === nextMonthIso) ?? null,
    [myBudgets, nextMonthIso],
  );

  // ── Pending my approval (chain) ─────────────────────────────────────────
  const { data: pendingForMe, isLoading: pendingLoading } = useQuery({
    queryKey: ["ot-pending-for-me", user?.id],
    queryFn: () => fetchMyPendingOTApprovals() as Promise<PendingOTRow[]>,
    enabled: !!user,
  });

  const hasPendingQueue = (pendingForMe?.length ?? 0) > 0;

  const handleExportPending = () => {
    exportRowsToCSV(
      pendingForMe ?? [],
      [
        { header: "Employee", value: (r) => r.employee_full_name ?? "" },
        { header: "Type", value: (r) => (r.request_type === "pre_approved" ? "Budget" : "Filed hours") },
        { header: "For", value: (r) => (r.request_type === "pre_approved" ? formatMonth(r.target_month) : formatDate(r.work_date)) },
        { header: "Hours", value: (r) => r.requested_hours },
        { header: "Notes", value: (r) => r.review_notes ?? "" },
        { header: "Step", value: (r) => `${Math.min(r.current_approver_index + 1, r.approver_chain.length)} of ${r.approver_chain.length}` },
        { header: "Filed", value: (r) => r.created_at },
      ],
      "ot-pending-approvals",
    );
  };

  // ── Mutation: request OT budget ──────────────────────────────────────────
  const requestBudget = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      await fileOTBudgetRequest({ data: {
        targetMonth: budgetForm.month,
        requestedHours: budgetForm.requested_hours,
        notes: budgetForm.notes || null,
      }});
    },
    onSuccess: () => {
      toast.success("OT budget request submitted");
      setBudgetDialogOpen(false);
      setBudgetForm({ month: nextMonthValue(), requested_hours: 8, notes: "" });
      qc.invalidateQueries({ queryKey: ["ot-budgets-mine"] });
      qc.invalidateQueries({ queryKey: ["ot-budgets-approved"] });
    },
    onError: (e: Error) => {
      if (e.message === "NO_ORG_NODE") {
        toast.error(
          "You haven't been placed in the org chart yet. Contact HR.",
        );
      } else {
        toast.error(e.message);
      }
    },
  });

  // ── Mutation: file actual OT hours ───────────────────────────────────────
  const fileActual = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!selectedBudget) throw new Error("Select a budget first");
      if (fileForm.hours > availableForSelected) {
        throw new Error(
          pendingForSelected > 0
            ? `Hours exceed budget. ${availableForSelected}h available (${pendingForSelected}h already pending approval).`
            : `Hours exceed remaining budget (${availableForSelected}h left)`,
        );
      }
      await fileActualOTHours({ data: {
        preApprovedId: selectedBudget.id,
        workDate: fileForm.work_date,
        hours: fileForm.hours,
      }});
    },
    onSuccess: () => {
      toast.success("OT hours filed");
      setFileDialogOpen(false);
      setFileForm({
        pre_approved_id: "",
        work_date: new Date().toISOString().slice(0, 10),
        hours: 1,
      });
      qc.invalidateQueries({ queryKey: ["ot-actuals-mine"] });
      qc.invalidateQueries({ queryKey: ["ot-budgets-approved"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Mutation: approve current chain step ─────────────────────────────────
  const approveStep = useMutation({
    mutationFn: async ({ requestId, notes }: { requestId: string; notes: string }) => {
      if (!user) throw new Error("Not signed in");
      await approveOTStep({ data: { id: requestId, notes } });
    },
    onSuccess: () => {
      toast.success("Approved");
      setDecidingId(null);
      setDecisionNotes("");
      qc.invalidateQueries({ queryKey: ["ot-pending-for-me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Mutation: reject current chain step ──────────────────────────────────
  const rejectStep = useMutation({
    mutationFn: async ({ requestId, notes }: { requestId: string; notes: string }) => {
      if (!user) throw new Error("Not signed in");
      await rejectOTStep({ data: { id: requestId, notes } });
    },
    onSuccess: () => {
      toast.success("Request rejected");
      setDecidingId(null);
      setDecisionNotes("");
      qc.invalidateQueries({ queryKey: ["ot-pending-for-me"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Overtime
          </p>
          <h1 className="mt-1 font-display text-4xl">OT Approvals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Request monthly OT budgets and file actual hours against approved
            budgets.
          </p>
        </div>
      </div>

      {/* ── Pre-Approved OT for Next Month ──────────────────────────────── */}
      {!isHR && (
        <Card className="border-primary/30">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="font-display text-2xl flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-primary" />
                Pre-Approved OT — {formatMonth(nextMonthIso)}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Request approval for OT hours to be used next month. Once approved,
                these become your OT allocation and deduct as you log actual hours.
              </p>
            </div>
            {!nextMonthBudget && (
              <Button
                onClick={() => {
                  setBudgetForm({ month: nextMonthValue(), requested_hours: 8, notes: "" });
                  setBudgetDialogOpen(true);
                }}
              >
                <Send className="mr-2 h-4 w-4" /> Request OT Hours
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {myBudgetsLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : nextMonthBudget ? (
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Requested</p>
                  <p className="text-2xl font-bold tabular-nums">{nextMonthBudget.requested_hours}h</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
                  <div className="mt-0.5"><StatusBadge status={nextMonthBudget.status} /></div>
                </div>
                {nextMonthBudget.status === "pending" && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Awaiting</p>
                    <div className="mt-0.5"><StepBadge row={nextMonthBudget} /></div>
                  </div>
                )}
                {nextMonthBudget.status === "approved" && (() => {
                  const used = approvedHoursById[nextMonthBudget.id] ?? 0;
                  const pending = pendingHoursById[nextMonthBudget.id] ?? 0;
                  const remaining = Math.max(0, nextMonthBudget.requested_hours - used);
                  return (
                    <>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Used</p>
                        <p className="text-lg font-semibold tabular-nums text-muted-foreground">{used}h</p>
                      </div>
                      {pending > 0 && (
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Pending</p>
                          <p className="text-lg font-semibold tabular-nums text-warning-foreground">{pending}h</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Remaining</p>
                        <p className={`text-lg font-semibold tabular-nums ${remaining === 0 ? "text-destructive" : "text-success"}`}>
                          {remaining}h
                        </p>
                      </div>
                    </>
                  );
                })()}
                {nextMonthBudget.status === "rejected" && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setBudgetForm({ month: nextMonthValue(), requested_hours: 8, notes: "" });
                      setBudgetDialogOpen(true);
                    }}
                  >
                    <Send className="mr-2 h-4 w-4" /> Request Again
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No OT budget requested for {formatMonth(nextMonthIso)} yet.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── OT Budget History ───────────────────────────────────────────── */}
      {!isHR && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="font-display text-2xl flex items-center gap-2">
              <Clock3 className="h-5 w-5" /> OT Budget History
            </CardTitle>
            <Button variant="outline" onClick={() => setBudgetDialogOpen(true)}>
              <Send className="mr-2 h-4 w-4" /> Request OT Budget
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {myBudgetsLoading ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : myBudgets?.length ? (
              <table className="w-full text-sm">
                <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Month</th>
                    <th className="px-4 py-2 text-right">Approved</th>
                    <th className="px-4 py-2 text-right">Used</th>
                    <th className="px-4 py-2 text-right">Pending</th>
                    <th className="px-4 py-2 text-right">Remaining</th>
                    <th className="px-4 py-2 text-left">Step</th>
                    <th className="px-4 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {myBudgets.map((r) => {
                    const used = r.status === "approved" ? (approvedHoursById[r.id] ?? 0) : null;
                    const pending = r.status === "approved" ? (pendingHoursById[r.id] ?? 0) : null;
                    const remaining = used !== null ? Math.max(0, r.requested_hours - used) : null;
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="px-4 py-2 font-medium">{formatMonth(r.target_month)}</td>
                        <td className="px-4 py-2 text-right">{r.requested_hours}h</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {used !== null ? `${used}h` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {pending !== null && pending > 0 ? (
                            <span className="text-warning-foreground">{pending}h</span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {remaining !== null ? (
                            <span className={remaining === 0 ? "text-destructive font-medium" : "text-success font-medium"}>
                              {remaining}h
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-2">
                          {r.status === "pending" ? <StepBadge row={r} /> : "—"}
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={r.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                No OT budget requests yet. Click "Request OT Budget" to get started.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Filed OT ────────────────────────────────────────────────────── */}
      {!isHR && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="font-display text-2xl flex items-center gap-2">
              <CalendarClock className="h-5 w-5" /> Filed OT
            </CardTitle>
            <Button
              variant="outline"
              onClick={() => {
                setFileForm({
                  pre_approved_id:
                    approvedBudgets?.[0]?.id ?? "",
                  work_date: new Date().toISOString().slice(0, 10),
                  hours: 1,
                });
                setFileDialogOpen(true);
              }}
              disabled={!approvedBudgets?.length}
              title={
                !approvedBudgets?.length
                  ? "No approved OT budgets available"
                  : undefined
              }
            >
              <Send className="mr-2 h-4 w-4" /> File OT Hours
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {myActualsLoading ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : myActuals?.length ? (
              <table className="w-full text-sm">
                <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-right">Hours Filed</th>
                    <th className="px-4 py-2 text-left">Month Budget</th>
                    <th className="px-4 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {myActuals.map((r) => {
                    const budget = myBudgets?.find(
                      (b) => b.id === r.pre_approved_id,
                    );
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="px-4 py-2 font-medium">
                          {formatDate(r.work_date)}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {r.requested_hours}h
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">
                          {budget
                            ? `${formatMonth(budget.target_month)} (${budget.requested_hours}h)`
                            : "—"}
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={r.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                No OT hours filed yet.{" "}
                {!approvedBudgets?.length
                  ? "You need an approved OT budget first."
                  : 'Click "File OT Hours" to log hours against an approved budget.'}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Pending my approval (chain queue) ───────────────────────────── */}
      {hasPendingQueue && (
        <Card className="border-warning/30 bg-warning/5">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="font-display text-2xl flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-warning-foreground" /> Pending my approval
              <span className="ml-1 rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                {pendingForMe?.length ?? 0}
              </span>
            </CardTitle>
            <Button variant="outline" onClick={handleExportPending} disabled={!pendingForMe?.length}>
              <FileDown className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {pendingLoading ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Employee</th>
                    <th className="px-4 py-2 text-left">Type</th>
                    <th className="px-4 py-2 text-left">For</th>
                    <th className="px-4 py-2 text-right">Hours</th>
                    <th className="px-4 py-2 text-left">Notes</th>
                    <th className="px-4 py-2 text-left">Step</th>
                    <th className="px-4 py-2 text-left">Filed</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingForMe?.map((r) => {
                    const approveKey = `${r.id}-approve`;
                    const rejectKey = `${r.id}-reject`;
                    const expandingApprove = decidingId === approveKey;
                    const expandingReject = decidingId === rejectKey;
                    const expanding = expandingApprove || expandingReject;
                    const isBudget = r.request_type === "pre_approved";
                    return (
                      <>
                        <tr key={r.id} className="border-t">
                          <td className="px-4 py-2 font-medium">
                            {r.employee_full_name ?? "—"}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${isBudget ? "bg-primary/10 text-primary" : "bg-accent/15 text-accent"}`}>
                              {isBudget ? "Budget" : "Filed hours"}
                            </span>
                          </td>
                          <td className="px-4 py-2">
                            {isBudget ? formatMonth(r.target_month) : formatDate(r.work_date)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {r.requested_hours}h
                          </td>
                          <td className="px-4 py-2 text-muted-foreground max-w-[260px]">
                            {r.review_notes ?? "—"}
                          </td>
                          <td className="px-4 py-2">
                            <StepBadge row={r} />
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {formatDate(r.created_at)}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant={expandingApprove ? "default" : "outline"}
                                className="text-success border-success/40 hover:bg-success/10"
                                onClick={() => toggleDecision(r.id, "approve")}
                              >
                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />{" "}
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant={expandingReject ? "default" : "outline"}
                                className="text-destructive border-destructive/40 hover:bg-destructive/10"
                                onClick={() => toggleDecision(r.id, "reject")}
                              >
                                <XCircle className="mr-1.5 h-3.5 w-3.5" />{" "}
                                Reject
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {expanding && (
                          <tr key={`${r.id}-expand`} className="border-t bg-secondary/30">
                            <td colSpan={8} className="px-4 py-3">
                              <div className="flex flex-wrap items-end gap-3">
                                <div className="flex-1 min-w-[240px]">
                                  <Label className="text-xs">
                                    {expandingApprove
                                      ? "Approval notes (optional)"
                                      : "Rejection reason (optional)"}
                                  </Label>
                                  <Textarea
                                    rows={2}
                                    className="mt-1"
                                    placeholder={
                                      expandingApprove
                                        ? "Any notes for the next approver…"
                                        : "Explain why this OT budget is being denied…"
                                    }
                                    value={decisionNotes}
                                    onChange={(e) => setDecisionNotes(e.target.value)}
                                  />
                                </div>
                                <div className="flex gap-2 pb-0.5">
                                  {expandingApprove && (
                                    <Button
                                      size="sm"
                                      disabled={approveStep.isPending}
                                      onClick={() =>
                                        approveStep.mutate({ requestId: r.id, notes: decisionNotes })
                                      }
                                    >
                                      Confirm approval
                                    </Button>
                                  )}
                                  {expandingReject && (
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      disabled={rejectStep.isPending}
                                      onClick={() =>
                                        rejectStep.mutate({ requestId: r.id, notes: decisionNotes })
                                      }
                                    >
                                      Confirm rejection
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setDecidingId(null);
                                      setDecisionNotes("");
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state when user is HR and has no queue */}
      {isHR && !hasPendingQueue && (
        <Card>
          <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
            No overtime budget requests pending your review.
          </CardContent>
        </Card>
      )}

      {/* ── Request OT Budget Dialog ─────────────────────────────────────── */}
      <Dialog open={budgetDialogOpen} onOpenChange={setBudgetDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              Request OT Budget
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="budget-month">Month</Label>
              <Input
                id="budget-month"
                type="month"
                className="mt-1"
                value={budgetForm.month}
                onChange={(e) =>
                  setBudgetForm({ ...budgetForm, month: e.target.value })
                }
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Select the month you need OT hours for.
              </p>
            </div>

            <div>
              <Label htmlFor="budget-hours">Hours Requested</Label>
              <Input
                id="budget-hours"
                type="number"
                min={0.5}
                step={0.5}
                className="mt-1"
                value={budgetForm.requested_hours}
                onChange={(e) =>
                  setBudgetForm({
                    ...budgetForm,
                    requested_hours: Number(e.target.value),
                  })
                }
              />
            </div>

            <div>
              <Label htmlFor="budget-notes">Notes (optional)</Label>
              <Textarea
                id="budget-notes"
                rows={2}
                className="mt-1"
                placeholder="Context for the approvers up the chain…"
                value={budgetForm.notes}
                onChange={(e) =>
                  setBudgetForm({ ...budgetForm, notes: e.target.value })
                }
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setBudgetDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                requestBudget.isPending ||
                !budgetForm.month ||
                budgetForm.requested_hours <= 0
              }
              onClick={() => requestBudget.mutate()}
            >
              {requestBudget.isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── File OT Hours Dialog ─────────────────────────────────────────── */}
      <Dialog open={fileDialogOpen} onOpenChange={setFileDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              File OT Hours
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="file-budget">Select budget</Label>
              <select
                id="file-budget"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                value={fileForm.pre_approved_id}
                onChange={(e) => {
                  const id = e.target.value;
                  const budget = approvedBudgets?.find((b) => b.id === id);
                  const approved = budget ? (approvedHoursById[budget.id] ?? 0) : 0;
                  const pending = budget ? (pendingHoursById[budget.id] ?? 0) : 0;
                  const available = budget
                    ? Math.max(0, budget.requested_hours - approved - pending)
                    : 0;
                  setFileForm({
                    ...fileForm,
                    pre_approved_id: id,
                    hours: Math.min(fileForm.hours, available || 1),
                  });
                }}
              >
                <option value="">— choose a budget —</option>
                {approvedBudgets?.map((b) => {
                  const used = approvedHoursById[b.id] ?? 0;
                  const pending = pendingHoursById[b.id] ?? 0;
                  const remaining = Math.max(0, b.requested_hours - used);
                  const pendingTag = pending > 0 ? `, ${pending}h pending` : "";
                  return (
                    <option key={b.id} value={b.id}>
                      {formatMonth(b.target_month)} — {b.requested_hours}h (
                      {used}h used{pendingTag}, {remaining}h remaining)
                    </option>
                  );
                })}
              </select>
            </div>

            {selectedBudget && (
              <p className="text-[11px] text-muted-foreground -mt-2">
                Remaining hours:{" "}
                <span
                  className={
                    remainingForSelected === 0
                      ? "text-destructive font-medium"
                      : "text-success font-medium"
                  }
                >
                  {remainingForSelected}h
                </span>{" "}
                of {selectedBudget.requested_hours}h
                {pendingForSelected > 0 && (
                  <>
                    {" · "}
                    <span className="text-warning-foreground font-medium">
                      {pendingForSelected}h pending approval
                    </span>
                  </>
                )}
              </p>
            )}

            <div>
              <Label htmlFor="file-date">Date of work</Label>
              <Input
                id="file-date"
                type="date"
                className="mt-1"
                value={fileForm.work_date}
                onChange={(e) =>
                  setFileForm({ ...fileForm, work_date: e.target.value })
                }
              />
            </div>

            <div>
              <Label htmlFor="file-hours">Hours to file</Label>
              <Input
                id="file-hours"
                type="number"
                min={0.5}
                step={0.5}
                max={availableForSelected || undefined}
                className="mt-1"
                value={fileForm.hours}
                onChange={(e) =>
                  setFileForm({ ...fileForm, hours: Number(e.target.value) })
                }
                disabled={!selectedBudget || availableForSelected === 0}
              />
              {selectedBudget &&
                availableForSelected === 0 && (
                  <p className="mt-1 text-[11px] text-destructive">
                    {pendingForSelected > 0
                      ? `Budget is fully committed (${pendingForSelected}h pending approval).`
                      : "This budget is fully used."}
                  </p>
                )}
              {selectedBudget &&
                availableForSelected > 0 &&
                fileForm.hours > availableForSelected && (
                  <p className="mt-1 text-[11px] text-destructive">
                    Cannot exceed {availableForSelected}h
                    {pendingForSelected > 0 && ` (${pendingForSelected}h already pending)`}.
                  </p>
                )}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setFileDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                fileActual.isPending ||
                !fileForm.pre_approved_id ||
                !fileForm.work_date ||
                fileForm.hours <= 0 ||
                fileForm.hours > availableForSelected ||
                availableForSelected === 0
              }
              onClick={() => fileActual.mutate()}
            >
              {fileActual.isPending ? "Filing…" : "File Hours"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
