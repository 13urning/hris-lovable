import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatDate } from "@/lib/dtr";
import { toast } from "sonner";
import { Clock3, CheckCircle2, XCircle, Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ot-approvals")({ component: OTApprovalsPage });

// ── Inline interfaces (tables not yet in generated types) ─────────────────────

interface OTRequest {
  id: string;
  dtr_id: string;
  employee_id: string;
  requested_hours: number;
  work_date: string;
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function StatusBadge({ status }: { status: OTRequest["status"] }) {
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
  return <span className={cls}>{step === "is" ? "IS review" : "DH review"}</span>;
}

// ── Resolve approvers by walking org_nodes ───────────────────────────────────

async function resolveApprovers(
  currentUserId: string,
): Promise<{ isApproverId: string; dhApproverId: string }> {
  // Step 1: get current user's org node
  const { data: myNode, error: e1 } = await supabase
    .from("org_nodes")
    .select("id, parent_id")
    .eq("employee_id", currentUserId)
    .single();
  if (e1 || !myNode) throw new Error("NO_ORG_NODE");

  if (!myNode.parent_id) throw new Error("NO_ORG_NODE");

  // Step 2: get IS (direct manager)
  const { data: parentNode, error: e2 } = await supabase
    .from("org_nodes")
    .select("employee_id")
    .eq("id", myNode.parent_id)
    .single();
  if (e2 || !parentNode) throw new Error("NO_ORG_NODE");

  const isApproverId = parentNode.employee_id as string;

  // Step 3: walk up from IS until we hit a dept head
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

    // Move to parent
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

  // ── "File New OT" dialog state ───────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [otForm, setOtForm] = useState({
    work_date: todayIso(),
    requested_hours: 1,
    notes: "",
  });

  // Fetch hours_worked for the selected date from DTR
  const { data: dtrForDate, isFetching: dtrFetching } = useQuery({
    queryKey: ["ot-dtr-date", user?.id, otForm.work_date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_time_reports")
        .select("id, hours_worked")
        .eq("employee_id", user!.id)
        .eq("work_date", otForm.work_date)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; hours_worked: number } | null;
    },
    enabled: !!user && dialogOpen,
  });

  const maxOtHours = dtrForDate ? Math.max(0, Number(dtrForDate.hours_worked) - 9) : 0;

  // ── Section 1: my own OT requests ───────────────────────────────────────
  const { data: myRequests, isLoading: myLoading } = useQuery({
    queryKey: ["ot-requests-mine", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ot_approval_requests")
        .select("*")
        .eq("employee_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OTRequest[];
    },
    enabled: !!user && !isHR,
  });

  // ── Section 2: pending IS approvals ─────────────────────────────────────
  const { data: isRequests, isLoading: isLoading_ } = useQuery({
    queryKey: ["ot-requests-is", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ot_approval_requests")
        .select("*, profile:profiles!ot_approval_requests_employee_id_fkey(full_name)")
        .eq("is_approver_id", user!.id)
        .eq("step", "is")
        .eq("status", "pending");
      if (error) throw error;
      return (data ?? []) as OTRequestWithProfile[];
    },
    enabled: !!user,
  });

  // ── Section 3: pending DH approvals ─────────────────────────────────────
  const { data: dhRequests, isLoading: dhLoading } = useQuery({
    queryKey: ["ot-requests-dh", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ot_approval_requests")
        .select("*, profile:profiles!ot_approval_requests_employee_id_fkey(full_name)")
        .eq("dh_approver_id", user!.id)
        .eq("step", "dh")
        .eq("status", "pending");
      if (error) throw error;
      return (data ?? []) as OTRequestWithProfile[];
    },
    enabled: !!user,
  });

  const hasIsQueue = (isRequests?.length ?? 0) > 0;
  const hasDhQueue = (dhRequests?.length ?? 0) > 0;

  // ── Decision local state (inline expand) ────────────────────────────────
  // decidingId: `${requestId}-approve` | `${requestId}-reject`
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

  // ── File new OT request ──────────────────────────────────────────────────
  const fileOt = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Not signed in");
      if (!dtrForDate) throw new Error("NO_DTR");

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
        dtr_id: dtrForDate.id,
        employee_id: user.id,
        requested_hours: otForm.requested_hours,
        work_date: otForm.work_date,
        step: "is",
        status: "pending",
        is_approver_id: isApproverId,
        dh_approver_id: dhApproverId,
        is_notes: otForm.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OT request filed successfully");
      setDialogOpen(false);
      setOtForm({ work_date: todayIso(), requested_hours: 1, notes: "" });
      qc.invalidateQueries({ queryKey: ["ot-requests-mine"] });
    },
    onError: (e: Error) => {
      if (e.message === "NO_ORG_NODE") {
        toast.error("Your manager hasn't been set up in the org chart yet. Contact HR.");
      } else if (e.message === "NO_DTR") {
        toast.error("No attendance record found for that date. Clock in first.");
      } else {
        toast.error(e.message);
      }
    },
  });

  // ── IS: approve (advance to DH step) ────────────────────────────────────
  const isApprove = useMutation({
    mutationFn: async ({ requestId, notes }: { requestId: string; notes: string }) => {
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

  // ── IS: reject ───────────────────────────────────────────────────────────
  const isReject = useMutation({
    mutationFn: async ({ requestId, dtrId, notes }: { requestId: string; dtrId: string; notes: string }) => {
      const { error: e1 } = await supabase
        .from("ot_approval_requests")
        .update({
          status: "rejected",
          is_decided_at: new Date().toISOString(),
          is_notes: notes || null,
        })
        .eq("id", requestId);
      if (e1) throw e1;

      const { error: e2 } = await supabase
        .from("daily_time_reports")
        .update({ ot_status: "rejected", ot_review_notes: notes || null })
        .eq("id", dtrId);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Request rejected");
      setDecidingId(null);
      setDecisionNotes("");
      qc.invalidateQueries({ queryKey: ["ot-requests-is"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── DH: approve (final) ──────────────────────────────────────────────────
  const dhApprove = useMutation({
    mutationFn: async ({
      requestId,
      dtrId,
      requestedHours,
      notes,
    }: {
      requestId: string;
      dtrId: string;
      requestedHours: number;
      notes: string;
    }) => {
      const { error: e1 } = await supabase
        .from("ot_approval_requests")
        .update({
          status: "approved",
          dh_decided_at: new Date().toISOString(),
          dh_notes: notes || null,
        })
        .eq("id", requestId);
      if (e1) throw e1;

      const { error: e2 } = await supabase
        .from("daily_time_reports")
        .update({
          ot_status: "approved",
          ot_approved_hours: requestedHours,
          ot_approved_by: user!.id,
          ot_approved_at: new Date().toISOString(),
        })
        .eq("id", dtrId);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("OT approved");
      setDecidingId(null);
      setDecisionNotes("");
      qc.invalidateQueries({ queryKey: ["ot-requests-dh"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── DH: reject ───────────────────────────────────────────────────────────
  const dhReject = useMutation({
    mutationFn: async ({ requestId, dtrId, notes }: { requestId: string; dtrId: string; notes: string }) => {
      const { error: e1 } = await supabase
        .from("ot_approval_requests")
        .update({
          status: "rejected",
          dh_decided_at: new Date().toISOString(),
          dh_notes: notes || null,
        })
        .eq("id", requestId);
      if (e1) throw e1;

      const { error: e2 } = await supabase
        .from("daily_time_reports")
        .update({ ot_status: "rejected", ot_review_notes: notes || null })
        .eq("id", dtrId);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("OT request rejected");
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
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Overtime</p>
          <h1 className="mt-1 font-display text-4xl">OT Approvals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            File and track overtime requests through the IS → DH approval chain.
          </p>
        </div>
      </div>

      {/* ── Section 1: My OT Requests ───────────────────────────────────── */}
      {!isHR && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="font-display text-2xl flex items-center gap-2">
              <Clock3 className="h-5 w-5" /> My OT Requests
            </CardTitle>
            <Button onClick={() => setDialogOpen(true)}>
              <Send className="mr-2 h-4 w-4" /> File New OT Request
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {myLoading ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : myRequests?.length ? (
              <table className="w-full text-sm">
                <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-right">Requested OT</th>
                    <th className="px-4 py-2 text-left">Step</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Notes</th>
                    <th className="px-4 py-2 text-left">Filed</th>
                  </tr>
                </thead>
                <tbody>
                  {myRequests.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-4 py-2 font-medium">{formatDate(r.work_date)}</td>
                      <td className="px-4 py-2 text-right">{r.requested_hours}h</td>
                      <td className="px-4 py-2">
                        <StepBadge step={r.step} />
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 py-2 text-muted-foreground max-w-[220px]">
                        {r.status === "rejected"
                          ? r.is_notes || r.dh_notes || "—"
                          : r.is_notes || "—"}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {formatDate(r.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                No OT requests yet. Click "File New OT Request" to get started.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Section 2: Pending IS Approvals ─────────────────────────────── */}
      {hasIsQueue && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-2xl flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-accent" /> Pending IS Approvals
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading_ ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Employee</th>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-right">Requested OT</th>
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
                          <td className="px-4 py-2">{formatDate(r.work_date)}</td>
                          <td className="px-4 py-2 text-right">{r.requested_hours}h</td>
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
                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant={expandingReject ? "default" : "outline"}
                                className="text-destructive border-destructive/40 hover:bg-destructive/10"
                                onClick={() => toggleDecision(r.id, "reject")}
                              >
                                <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {expanding && (
                          <tr key={`${r.id}-expand`} className="border-t bg-secondary/30">
                            <td colSpan={5} className="px-4 py-3">
                              <div className="flex flex-wrap items-end gap-3">
                                <div className="flex-1 min-w-[240px]">
                                  <Label className="text-xs">
                                    {expandingApprove ? "Approval notes (optional)" : "Rejection reason (optional)"}
                                  </Label>
                                  <Textarea
                                    rows={2}
                                    className="mt-1"
                                    placeholder={
                                      expandingApprove
                                        ? "Any notes for the department head…"
                                        : "Explain why this OT is being denied…"
                                    }
                                    value={decisionNotes}
                                    onChange={(e) => setDecisionNotes(e.target.value)}
                                  />
                                </div>
                                <div className="flex gap-2 pb-0.5">
                                  {expandingApprove && (
                                    <Button
                                      size="sm"
                                      disabled={isApprove.isPending}
                                      onClick={() =>
                                        isApprove.mutate({ requestId: r.id, notes: decisionNotes })
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
                                          dtrId: r.dtr_id,
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

      {/* ── Section 3: Pending DH Approvals ─────────────────────────────── */}
      {hasDhQueue && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-2xl flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" /> Pending DH Approvals
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {dhLoading ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Employee</th>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-right">Requested OT</th>
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
                          <td className="px-4 py-2">{formatDate(r.work_date)}</td>
                          <td className="px-4 py-2 text-right">{r.requested_hours}h</td>
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
                                variant={expandingApprove ? "default" : "outline"}
                                className="text-success border-success/40 hover:bg-success/10"
                                onClick={() => toggleDecision(r.id, "approve")}
                              >
                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant={expandingReject ? "default" : "outline"}
                                className="text-destructive border-destructive/40 hover:bg-destructive/10"
                                onClick={() => toggleDecision(r.id, "reject")}
                              >
                                <XCircle className="mr-1.5 h-3.5 w-3.5" /> Reject
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {expanding && (
                          <tr key={`${r.id}-expand`} className="border-t bg-secondary/30">
                            <td colSpan={6} className="px-4 py-3">
                              <div className="flex flex-wrap items-end gap-3">
                                <div className="flex-1 min-w-[240px]">
                                  <Label className="text-xs">
                                    {expandingApprove ? "Approval notes (optional)" : "Rejection reason (optional)"}
                                  </Label>
                                  <Textarea
                                    rows={2}
                                    className="mt-1"
                                    placeholder={
                                      expandingApprove
                                        ? "Final notes before approval…"
                                        : "Explain why this OT is being denied…"
                                    }
                                    value={decisionNotes}
                                    onChange={(e) => setDecisionNotes(e.target.value)}
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
                                          dtrId: r.dtr_id,
                                          requestedHours: r.requested_hours,
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
                                          dtrId: r.dtr_id,
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

      {/* Empty state when user has no queues and is HR */}
      {isHR && !hasIsQueue && !hasDhQueue && (
        <Card>
          <CardContent className="px-6 py-10 text-center text-sm text-muted-foreground">
            No overtime requests pending your review.
          </CardContent>
        </Card>
      )}

      {/* ── File New OT Dialog ───────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">File OT Request</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="ot-date">Work date</Label>
              <Input
                id="ot-date"
                type="date"
                className="mt-1"
                value={otForm.work_date}
                onChange={(e) =>
                  setOtForm({ ...otForm, work_date: e.target.value, requested_hours: 1 })
                }
              />
            </div>

            <div>
              <Label htmlFor="ot-hours-worked">Hours worked that day</Label>
              <Input
                id="ot-hours-worked"
                className="mt-1"
                value={
                  dtrFetching
                    ? "Loading…"
                    : dtrForDate
                    ? `${Number(dtrForDate.hours_worked).toFixed(2)}h`
                    : "No DTR found for this date"
                }
                disabled
                aria-describedby="ot-hours-hint"
              />
              <p id="ot-hours-hint" className="mt-1 text-[11px] text-muted-foreground">
                {dtrForDate
                  ? `Max OT: ${maxOtHours.toFixed(2)}h (hours worked minus 9h standard)`
                  : "Clock in on the DTR page first, then come back to file OT."}
              </p>
            </div>

            <div>
              <Label htmlFor="ot-requested">Requested OT hours</Label>
              <Input
                id="ot-requested"
                type="number"
                step="0.25"
                min={0.25}
                max={maxOtHours || undefined}
                className="mt-1"
                value={otForm.requested_hours}
                onChange={(e) =>
                  setOtForm({ ...otForm, requested_hours: Number(e.target.value) })
                }
                disabled={!dtrForDate || maxOtHours <= 0}
              />
              {dtrForDate && maxOtHours <= 0 && (
                <p className="mt-1 text-[11px] text-destructive">
                  No OT eligible — you need to have worked more than 9 hours on this date.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="ot-notes">Notes (optional)</Label>
              <Textarea
                id="ot-notes"
                rows={2}
                className="mt-1"
                placeholder="Context for your IS and department head…"
                value={otForm.notes}
                onChange={(e) => setOtForm({ ...otForm, notes: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                fileOt.isPending ||
                !dtrForDate ||
                maxOtHours <= 0 ||
                otForm.requested_hours <= 0 ||
                otForm.requested_hours > maxOtHours
              }
              onClick={() => fileOt.mutate()}
            >
              {fileOt.isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
