import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
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
import { toast } from "sonner";
import { Clock3, CheckCircle2, XCircle, Send, CalendarClock } from "lucide-react";

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
  step: "is" | "dh";
  status: "pending" | "approved" | "rejected";
  is_approver_id: string | null;
  dh_approver_id: string | null;
  is_decided_at: string | null;
  dh_decided_at: string | null;
  is_notes: string | null;
  dh_notes: string | null;
  created_at: string;
}

interface OTRequestWithProfile extends OTRequest {
  profile: { full_name: string } | null;
}

interface OrgNode {
  id: string;
  employee_id: string;
  parent_id: string | null;
  is_dept_head: boolean;
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

function StepBadge({ step }: { step: OTRequest["step"] }) {
  const cls =
    step === "dh"
      ? "rounded bg-accent/15 px-2 py-0.5 text-xs text-accent"
      : "rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground";
  return (
    <span className={cls}>{step === "is" ? "IS review" : "DH review"}</span>
  );
}

// ── Resolve approvers by walking org_nodes ────────────────────────────────────

async function resolveApprovers(
  currentUserId: string,
): Promise<{ isApproverId: string; dhApproverId: string }> {
  const { data: myNode, error: e1 } = await supabase
    .from("org_nodes")
    .select("id, parent_id")
    .eq("employee_id", currentUserId)
    .single();
  if (e1 || !myNode) throw new Error("NO_ORG_NODE");
  if (!myNode.parent_id) throw new Error("NO_ORG_NODE");

  const { data: parentNode, error: e2 } = await supabase
    .from("org_nodes")
    .select("employee_id")
    .eq("id", myNode.parent_id)
    .single();
  if (e2 || !parentNode) throw new Error("NO_ORG_NODE");

  const isApproverId = parentNode.employee_id as string;

  let currentId = isApproverId;
  let dhApproverId: string | null = null;
  const visited = new Set<string>();

  while (true) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const { data: node } = await supabase
      .from("org_nodes")
      .select("id, employee_id, parent_id, is_dept_head")
      .eq("employee_id", currentId)
      .single<OrgNode>();

    if (!node) break;
    if (node.is_dept_head) {
      dhApproverId = node.employee_id;
      break;
    }
    if (!node.parent_id) break;

    const { data: pNode } = await supabase
      .from("org_nodes")
      .select("employee_id")
      .eq("id", node.parent_id)
      .single<{ employee_id: string }>();

    if (!pNode) break;
    currentId = pNode.employee_id;
  }

  if (!dhApproverId) throw new Error("NO_DH");
  return { isApproverId, dhApproverId };
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ot_approval_requests")
        .select("*")
        .eq("employee_id", user!.id)
        .eq("request_type", "pre_approved")
        .order("target_month", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OTRequest[];
    },
    enabled: !!user && !isHR,
  });

  // ── Section 2a: My filed OT (actual) ────────────────────────────────────
  const { data: myActuals, isLoading: myActualsLoading } = useQuery({
    queryKey: ["ot-actuals-mine", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ot_approval_requests")
        .select("*")
        .eq("employee_id", user!.id)
        .eq("request_type", "actual")
        .order("work_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OTRequest[];
    },
    enabled: !!user && !isHR,
  });

  // ── Section 2b: Approved budgets (for dropdown in file dialog) ───────────
  const { data: approvedBudgets } = useQuery({
    queryKey: ["ot-budgets-approved", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ot_approval_requests")
        .select("*")
        .eq("employee_id", user!.id)
        .eq("request_type", "pre_approved")
        .eq("status", "approved")
        .order("target_month", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OTRequest[];
    },
    enabled: !!user && !isHR,
  });

  // Compute used hours per budget from actuals
  const usedHoursById = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of myActuals ?? []) {
      if (a.pre_approved_id) {
        map[a.pre_approved_id] = (map[a.pre_approved_id] ?? 0) + a.requested_hours;
      }
    }
    return map;
  }, [myActuals]);

  const selectedBudget = approvedBudgets?.find(
    (b) => b.id === fileForm.pre_approved_id,
  ) ?? null;
  const usedForSelected = selectedBudget
    ? (usedHoursById[selectedBudget.id] ?? 0)
    : 0;
  const remainingForSelected = selectedBudget
    ? Math.max(0, selectedBudget.requested_hours - usedForSelected)
    : 0;

  const nextMonthIso = nextMonthValue() + "-01";
  const nextMonthBudget = useMemo(
    () => (myBudgets ?? []).find((b) => b.target_month === nextMonthIso) ?? null,
    [myBudgets, nextMonthIso],
  );

  // ── Section 3: Pending IS approvals ─────────────────────────────────────
  const { data: isRequests, isLoading: isLoading_ } = useQuery({
    queryKey: ["ot-requests-is", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ot_approval_requests")
        .select(
          "*, profile:profiles!ot_approval_requests_employee_id_fkey(full_name)",
        )
        .eq("is_approver_id", user!.id)
        .eq("step", "is")
        .eq("status", "pending")
        .eq("request_type", "pre_approved");
      if (error) throw error;
      return (data ?? []) as OTRequestWithProfile[];
    },
    enabled: !!user,
  });

  // ── Section 4: Pending DH approvals ─────────────────────────────────────
  const { data: dhRequests, isLoading: dhLoading } = useQuery({
    queryKey: ["ot-requests-dh", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ot_approval_requests")
        .select(
          "*, profile:profiles!ot_approval_requests_employee_id_fkey(full_name)",
        )
        .eq("dh_approver_id", user!.id)
        .eq("step", "dh")
        .eq("status", "pending")
        .eq("request_type", "pre_approved");
      if (error) throw error;
      return (data ?? []) as OTRequestWithProfile[];
    },
    enabled: !!user,
  });

  const hasIsQueue = (isRequests?.length ?? 0) > 0;
  const hasDhQueue = (dhRequests?.length ?? 0) > 0;

  // ── Mutation: request OT budget ──────────────────────────────────────────
  const requestBudget = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      let isApproverId: string;
      let dhApproverId: string;
      try {
        ({ isApproverId, dhApproverId } = await resolveApprovers(user.id));
      } catch (err) {
        if (err instanceof Error && err.message === "NO_ORG_NODE") {
          throw new Error("NO_ORG_NODE");
        }
        throw err;
      }
      const { error } = await supabase.from("ot_approval_requests").insert({
        employee_id: user.id,
        request_type: "pre_approved",
        target_month: budgetForm.month + "-01",
        requested_hours: budgetForm.requested_hours,
        dtr_id: null,
        work_date: null,
        step: "is",
        status: "pending",
        is_approver_id: isApproverId,
        dh_approver_id: dhApproverId,
        is_notes: budgetForm.notes || null,
      });
      if (error) throw error;
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
          "Your manager hasn't been set up in the org chart yet. Contact HR.",
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
      if (fileForm.hours > remainingForSelected) {
        throw new Error(
          `Hours exceed remaining budget (${remainingForSelected}h left)`,
        );
      }
      const { error } = await supabase.from("ot_approval_requests").insert({
        employee_id: user.id,
        request_type: "actual",
        pre_approved_id: selectedBudget.id,
        work_date: fileForm.work_date,
        requested_hours: fileForm.hours,
        target_month: null,
        dtr_id: null,
        step: "is",
        status: "approved",
        is_approver_id: null,
        dh_approver_id: null,
      });
      if (error) throw error;
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

  // ── Mutation: IS approve ─────────────────────────────────────────────────
  const isApprove = useMutation({
    mutationFn: async ({
      requestId,
      notes,
    }: {
      requestId: string;
      notes: string;
    }) => {
      const { error } = await supabase
        .from("ot_approval_requests")
        .update({
          step: "dh",
          is_decided_at: new Date().toISOString(),
          is_notes: notes || null,
        })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Approved — forwarded to department head");
      setDecidingId(null);
      setDecisionNotes("");
      qc.invalidateQueries({ queryKey: ["ot-requests-is"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Mutation: IS reject ──────────────────────────────────────────────────
  const isReject = useMutation({
    mutationFn: async ({
      requestId,
      notes,
    }: {
      requestId: string;
      notes: string;
    }) => {
      const { error } = await supabase
        .from("ot_approval_requests")
        .update({
          status: "rejected",
          is_decided_at: new Date().toISOString(),
          is_notes: notes || null,
        })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request rejected");
      setDecidingId(null);
      setDecisionNotes("");
      qc.invalidateQueries({ queryKey: ["ot-requests-is"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Mutation: DH approve (final) ─────────────────────────────────────────
  const dhApprove = useMutation({
    mutationFn: async ({
      requestId,
      notes,
    }: {
      requestId: string;
      notes: string;
    }) => {
      const { error } = await supabase
        .from("ot_approval_requests")
        .update({
          status: "approved",
          dh_decided_at: new Date().toISOString(),
          dh_notes: notes || null,
        })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OT budget approved");
      setDecidingId(null);
      setDecisionNotes("");
      qc.invalidateQueries({ queryKey: ["ot-requests-dh"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Mutation: DH reject ──────────────────────────────────────────────────
  const dhReject = useMutation({
    mutationFn: async ({
      requestId,
      notes,
    }: {
      requestId: string;
      notes: string;
    }) => {
      const { error } = await supabase
        .from("ot_approval_requests")
        .update({
          status: "rejected",
          dh_decided_at: new Date().toISOString(),
          dh_notes: notes || null,
        })
        .eq("id", requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OT budget request rejected");
      setDecidingId(null);
      setDecisionNotes("");
      qc.invalidateQueries({ queryKey: ["ot-requests-dh"] });
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

      {/* ── New Section: Pre-Approved OT for Next Month ─────────────────── */}
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
                    <div className="mt-0.5"><StepBadge step={nextMonthBudget.step} /></div>
                  </div>
                )}
                {nextMonthBudget.status === "approved" && (() => {
                  const used = usedHoursById[nextMonthBudget.id] ?? 0;
                  const remaining = Math.max(0, nextMonthBudget.requested_hours - used);
                  return (
                    <>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Used</p>
                        <p className="text-lg font-semibold tabular-nums text-muted-foreground">{used}h</p>
                      </div>
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

      {/* ── Section 1: Pre-Approved OT Budget History ───────────────────── */}
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
                    <th className="px-4 py-2 text-right">Remaining</th>
                    <th className="px-4 py-2 text-left">Step</th>
                    <th className="px-4 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {myBudgets.map((r) => {
                    const used = r.status === "approved" ? (usedHoursById[r.id] ?? 0) : null;
                    const remaining = used !== null ? Math.max(0, r.requested_hours - used) : null;
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="px-4 py-2 font-medium">{formatMonth(r.target_month)}</td>
                        <td className="px-4 py-2 text-right">{r.requested_hours}h</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {used !== null ? `${used}h` : "—"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {remaining !== null ? (
                            <span className={remaining === 0 ? "text-destructive font-medium" : "text-success font-medium"}>
                              {remaining}h
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-2">
                          {r.status === "pending" ? <StepBadge step={r.step} /> : "—"}
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

      {/* ── Section 2: Filed OT ──────────────────────────────────────────── */}
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
                          <StatusBadge status="logged" />
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

      {/* ── Section 3: Pending IS Approvals ─────────────────────────────── */}
      {hasIsQueue && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-2xl flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-accent" /> Pending IS
              Approvals
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading_ ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Employee</th>
                    <th className="px-4 py-2 text-left">Month</th>
                    <th className="px-4 py-2 text-right">Hours Requested</th>
                    <th className="px-4 py-2 text-left">Filed</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {isRequests?.map((r) => {
                    const approveKey = `${r.id}-approve`;
                    const rejectKey = `${r.id}-reject`;
                    const expandingApprove = decidingId === approveKey;
                    const expandingReject = decidingId === rejectKey;
                    const expanding = expandingApprove || expandingReject;
                    return (
                      <>
                        <tr key={r.id} className="border-t">
                          <td className="px-4 py-2 font-medium">
                            {r.profile?.full_name ?? "—"}
                          </td>
                          <td className="px-4 py-2">
                            {formatMonth(r.target_month)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {r.requested_hours}h
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {formatDate(r.created_at)}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant={
                                  expandingApprove ? "default" : "outline"
                                }
                                className="text-success border-success/40 hover:bg-success/10"
                                onClick={() =>
                                  toggleDecision(r.id, "approve")
                                }
                              >
                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />{" "}
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant={
                                  expandingReject ? "default" : "outline"
                                }
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
                          <tr
                            key={`${r.id}-expand`}
                            className="border-t bg-secondary/30"
                          >
                            <td colSpan={5} className="px-4 py-3">
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
                                        ? "Any notes for the department head…"
                                        : "Explain why this OT budget is being denied…"
                                    }
                                    value={decisionNotes}
                                    onChange={(e) =>
                                      setDecisionNotes(e.target.value)
                                    }
                                  />
                                </div>
                                <div className="flex gap-2 pb-0.5">
                                  {expandingApprove && (
                                    <Button
                                      size="sm"
                                      disabled={isApprove.isPending}
                                      onClick={() =>
                                        isApprove.mutate({
                                          requestId: r.id,
                                          notes: decisionNotes,
                                        })
                                      }
                                    >
                                      Confirm approval
                                    </Button>
                                  )}
                                  {expandingReject && (
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      disabled={isReject.isPending}
                                      onClick={() =>
                                        isReject.mutate({
                                          requestId: r.id,
                                          notes: decisionNotes,
                                        })
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

      {/* ── Section 4: Pending DH Approvals ─────────────────────────────── */}
      {hasDhQueue && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-2xl flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" /> Pending DH
              Approvals
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {dhLoading ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                Loading…
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Employee</th>
                    <th className="px-4 py-2 text-left">Month</th>
                    <th className="px-4 py-2 text-right">Hours Requested</th>
                    <th className="px-4 py-2 text-left">IS Notes</th>
                    <th className="px-4 py-2 text-left">Filed</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {dhRequests?.map((r) => {
                    const approveKey = `${r.id}-approve`;
                    const rejectKey = `${r.id}-reject`;
                    const expandingApprove = decidingId === approveKey;
                    const expandingReject = decidingId === rejectKey;
                    const expanding = expandingApprove || expandingReject;
                    return (
                      <>
                        <tr key={r.id} className="border-t">
                          <td className="px-4 py-2 font-medium">
                            {r.profile?.full_name ?? "—"}
                          </td>
                          <td className="px-4 py-2">
                            {formatMonth(r.target_month)}
                          </td>
                          <td className="px-4 py-2 text-right">
                            {r.requested_hours}h
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {r.is_notes ?? "—"}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {formatDate(r.created_at)}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant={
                                  expandingApprove ? "default" : "outline"
                                }
                                className="text-success border-success/40 hover:bg-success/10"
                                onClick={() =>
                                  toggleDecision(r.id, "approve")
                                }
                              >
                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />{" "}
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant={
                                  expandingReject ? "default" : "outline"
                                }
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
                          <tr
                            key={`${r.id}-expand`}
                            className="border-t bg-secondary/30"
                          >
                            <td colSpan={6} className="px-4 py-3">
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
                                        ? "Final notes before approval…"
                                        : "Explain why this OT budget is being denied…"
                                    }
                                    value={decisionNotes}
                                    onChange={(e) =>
                                      setDecisionNotes(e.target.value)
                                    }
                                  />
                                </div>
                                <div className="flex gap-2 pb-0.5">
                                  {expandingApprove && (
                                    <Button
                                      size="sm"
                                      disabled={dhApprove.isPending}
                                      onClick={() =>
                                        dhApprove.mutate({
                                          requestId: r.id,
                                          notes: decisionNotes,
                                        })
                                      }
                                    >
                                      Confirm approval
                                    </Button>
                                  )}
                                  {expandingReject && (
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      disabled={dhReject.isPending}
                                      onClick={() =>
                                        dhReject.mutate({
                                          requestId: r.id,
                                          notes: decisionNotes,
                                        })
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

      {/* Empty state when user is HR and has no queues */}
      {isHR && !hasIsQueue && !hasDhQueue && (
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
                placeholder="Context for your IS and department head…"
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
                  const used = budget
                    ? (usedHoursById[budget.id] ?? 0)
                    : 0;
                  const remaining = budget
                    ? Math.max(0, budget.requested_hours - used)
                    : 0;
                  setFileForm({
                    ...fileForm,
                    pre_approved_id: id,
                    hours: Math.min(fileForm.hours, remaining || 1),
                  });
                }}
              >
                <option value="">— choose a budget —</option>
                {approvedBudgets?.map((b) => {
                  const used = usedHoursById[b.id] ?? 0;
                  const remaining = Math.max(0, b.requested_hours - used);
                  return (
                    <option key={b.id} value={b.id}>
                      {formatMonth(b.target_month)} — {b.requested_hours}h (
                      {used}h used, {remaining}h remaining)
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
                max={remainingForSelected || undefined}
                className="mt-1"
                value={fileForm.hours}
                onChange={(e) =>
                  setFileForm({ ...fileForm, hours: Number(e.target.value) })
                }
                disabled={!selectedBudget || remainingForSelected === 0}
              />
              {selectedBudget &&
                remainingForSelected === 0 && (
                  <p className="mt-1 text-[11px] text-destructive">
                    This budget is fully used.
                  </p>
                )}
              {selectedBudget &&
                remainingForSelected > 0 &&
                fileForm.hours > remainingForSelected && (
                  <p className="mt-1 text-[11px] text-destructive">
                    Cannot exceed remaining budget of {remainingForSelected}h.
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
                fileForm.hours > remainingForSelected ||
                remainingForSelected === 0
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
