import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, formatDateTime, type ApprovalStatus, STATUS_LABEL } from "@/lib/dtr";
import { ArrowLeft, Check, X, AlertTriangle, Unlock, FileText, Upload, Trash2, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_admin/cutoff-approval_/$id")({
  component: DetailPage,
});

function DetailPage() {
  const { id } = Route.useParams();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [openAction, setOpenAction] = useState<null | "approve" | "reject" | "needs_correction" | "unlock">(null);
  const [note, setNote] = useState("");
  const [otReject, setOtReject] = useState<{ dtrId: string; date: string } | null>(null);
  const [otNote, setOtNote] = useState("");

  const { data: sub } = useQuery({
    queryKey: ["sub-detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dtr_cutoff_submissions")
        .select(`*,
          profile:profiles!subs_employee_profile_fk(full_name, department, email),
          cutoff:payroll_cutoffs(*)`)
        .eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: dtrs } = useQuery({
    queryKey: ["sub-dtrs", id],
    queryFn: async () => {
      if (!sub) return [];
      const { data, error } = await supabase
        .from("daily_time_reports")
        .select("*")
        .eq("employee_id", sub.employee_id)
        .eq("cutoff_id", sub.cutoff_id)
        .order("work_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!sub,
  });

  const { data: logs } = useQuery({
    queryKey: ["sub-logs", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dtr_approval_logs")
        .select(`*, actor:profiles!dtr_approval_logs_action_by_fkey(full_name)`)
        .eq("dtr_cutoff_submission_id", id)
        .order("action_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const act = useMutation({
    mutationFn: async ({ action, note }: { action: NonNullable<typeof openAction>; note: string }) => {
      if (!user || !sub) throw new Error("Missing");
      const now = new Date().toISOString();
      const update: Record<string, unknown> = {};
      let logAction: string = action;
      if (action === "approve") {
        update.approval_status = "approved";
        update.approved_by = user.id; update.approved_at = now;
        logAction = "approved";
      } else if (action === "reject") {
        update.approval_status = "rejected"; update.rejection_reason = note;
      } else if (action === "needs_correction") {
        update.approval_status = "needs_correction"; update.correction_notes = note;
      } else if (action === "unlock") {
        update.approval_status = "needs_correction";
        update.approved_by = null; update.approved_at = null;
        update.correction_notes = note || "Unlocked by admin for corrections";
        logAction = "unlocked";
      }
      const { error } = await supabase
        .from("dtr_cutoff_submissions")
        .update(update as never)
        .eq("id", id);
      if (error) throw error;
      const { error: lerr } = await supabase.from("dtr_approval_logs").insert({
        dtr_cutoff_submission_id: id,
        action: logAction as "approved" | "rejected" | "needs_correction" | "unlocked",
        action_by: user.id,
        notes: note || null,
      });
      if (lerr) throw lerr;
    },
    onSuccess: () => {
      toast.success("Done");
      setOpenAction(null); setNote("");
      qc.invalidateQueries({ queryKey: ["sub-detail", id] });
      qc.invalidateQueries({ queryKey: ["sub-logs", id] });
      qc.invalidateQueries({ queryKey: ["all-subs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const otAct = useMutation({
    mutationFn: async ({ dtrId, approve, reason }: { dtrId: string; approve: boolean; reason?: string }) => {
      if (!user) throw new Error("Missing user");
      const row = dtrs?.find((d) => d.id === dtrId);
      if (!row) throw new Error("Row not found");
      const update = approve
        ? {
            ot_status: "approved",
            ot_approved_hours: Number(row.overtime_hours),
            ot_approved_by: user.id,
            ot_approved_at: new Date().toISOString(),
            ot_review_notes: null,
          }
        : {
            ot_status: "rejected",
            ot_approved_hours: 0,
            ot_approved_by: user.id,
            ot_approved_at: new Date().toISOString(),
            ot_review_notes: reason ?? null,
          };
      const { error } = await supabase
        .from("daily_time_reports")
        .update(update as never)
        .eq("id", dtrId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OT updated");
      setOtReject(null); setOtNote("");
      qc.invalidateQueries({ queryKey: ["sub-dtrs", id] });
      qc.invalidateQueries({ queryKey: ["sub-detail", id] });
      qc.invalidateQueries({ queryKey: ["all-subs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!sub) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const status = sub.approval_status as ApprovalStatus;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/cutoff-approval"><ArrowLeft className="mr-1 h-4 w-4" /> Back</Link>
      </Button>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{sub.cutoff?.cutoff_name}</p>
            <CardTitle className="font-display text-3xl mt-1">{sub.profile?.full_name}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {sub.profile?.department} · {sub.profile?.email}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {formatDate(sub.cutoff?.start_date)} – {formatDate(sub.cutoff?.end_date)} · Payout {formatDate(sub.cutoff?.payout_date)}
            </p>
          </div>
          <StatusBadge status={status} className="text-sm" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            <Metric label="Days" value={sub.total_days_submitted} />
            <Metric label="Hours" value={Number(sub.total_hours).toFixed(2)} />
            <Metric label="Late" value={sub.late_count} />
            <Metric label="Absent" value={sub.absent_count} />
            <Metric label="OT hrs" value={Number(sub.overtime_hours).toFixed(2)} />
            <Metric label="Leave" value={sub.leave_days} />
            <Metric label="Missing" value={sub.missing_dtr_count} warn={sub.missing_dtr_count > 0} />
          </div>
          {sub.rejection_reason && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <span className="font-medium text-destructive">Rejection reason: </span>{sub.rejection_reason}
            </div>
          )}
          {sub.correction_notes && (
            <div className="mt-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
              <span className="font-medium">Correction notes: </span>{sub.correction_notes}
            </div>
          )}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            {status === "approved" ? (
              isAdmin && (
                <Button variant="outline" onClick={() => setOpenAction("unlock")}>
                  <Unlock className="mr-1 h-4 w-4" /> Unlock
                </Button>
              )
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpenAction("needs_correction")}>
                  <AlertTriangle className="mr-1 h-4 w-4" /> Needs Correction
                </Button>
                <Button variant="destructive" onClick={() => setOpenAction("reject")}>
                  <X className="mr-1 h-4 w-4" /> Reject
                </Button>
                <Button onClick={() => setOpenAction("approve")}>
                  <Check className="mr-1 h-4 w-4" /> Approve cut-off
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <PayslipCard
        submissionId={sub.id}
        employeeId={sub.employee_id}
        cutoffId={sub.cutoff_id}
        payslipPath={(sub as { payslip_path?: string | null }).payslip_path ?? null}
        uploadedAt={(sub as { payslip_uploaded_at?: string | null }).payslip_uploaded_at ?? null}
        userId={user?.id}
      />

      <Card>
        <CardHeader><CardTitle className="text-lg">DTR entries ({dtrs?.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">In / Out</th>
                <th className="px-3 py-2 text-right">Hours</th>
                <th className="px-3 py-2 text-right">Late</th>
                <th className="px-3 py-2 text-right">OT</th>
                <th className="px-3 py-2 text-left">OT review</th>
                <th className="px-3 py-2 text-left">Flag</th>
                <th className="px-3 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {dtrs?.map((d) => (
                <tr key={d.id} className="border-t">
                  <td className="px-3 py-2">{formatDate(d.work_date)}</td>
                  <td className="px-3 py-2">{d.time_in ?? "—"} / {d.time_out ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{Number(d.hours_worked).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{d.late_minutes}</td>
                  <td className="px-3 py-2 text-right">{Number(d.overtime_hours).toFixed(2)}</td>
                  <td className="px-3 py-2">
                    {Number(d.overtime_hours) > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className={
                          (d as { ot_status?: string }).ot_status === "approved"
                            ? "rounded bg-success/15 px-2 py-0.5 text-xs text-success"
                            : (d as { ot_status?: string }).ot_status === "rejected"
                            ? "rounded bg-destructive/15 px-2 py-0.5 text-xs text-destructive"
                            : "rounded bg-warning/20 px-2 py-0.5 text-xs text-warning-foreground"
                        }>
                          {(d as { ot_status?: string }).ot_status ?? "pending"}
                        </span>
                        {(d as { ot_status?: string }).ot_status !== "approved" && (
                          <Button size="sm" variant="outline" className="h-6 px-2"
                            disabled={otAct.isPending}
                            onClick={() => otAct.mutate({ dtrId: d.id, approve: true })}>
                            <Check className="h-3 w-3" />
                          </Button>
                        )}
                        {(d as { ot_status?: string }).ot_status !== "rejected" && (
                          <Button size="sm" variant="outline" className="h-6 px-2"
                            disabled={otAct.isPending}
                            onClick={() => { setOtReject({ dtrId: d.id, date: d.work_date }); setOtNote(""); }}>
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                    {(d as { ot_review_notes?: string }).ot_review_notes && (d as { ot_status?: string }).ot_status === "rejected" && (
                      <div className="mt-1 text-[11px] text-destructive">{(d as { ot_review_notes?: string }).ot_review_notes}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {d.is_absent ? "Absent" : d.is_leave ? `Leave (${d.leave_type ?? ""})` : "Present"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{d.notes ?? ""}</td>
                </tr>
              ))}
              {!dtrs?.length && (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No DTR entries logged for this cut-off.
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Approval history</CardTitle></CardHeader>
        <CardContent>
          {logs?.length ? (
            <ol className="space-y-3">
              {logs.map((l) => (
                <li key={l.id} className="flex items-start gap-3 border-l-2 border-accent/40 pl-3">
                  <div className="flex-1">
                    <div className="text-sm">
                      <span className="font-medium capitalize">{String(l.action).replace("_"," ")}</span>
                      {" by "}
                      <span className="text-muted-foreground">{(l.actor as { full_name?: string } | null)?.full_name ?? "unknown"}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{formatDateTime(l.action_date)}</div>
                    {l.notes && <div className="mt-1 text-sm text-muted-foreground">{l.notes}</div>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No actions yet.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={openAction !== null} onOpenChange={(o) => !o && setOpenAction(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display text-2xl capitalize">
            {openAction ? String(openAction).replace("_"," ") : ""}
          </DialogTitle></DialogHeader>
          {openAction && openAction !== "approve" && (
            <div>
              <label className="text-sm">
                {openAction === "reject" ? "Rejection reason" :
                 openAction === "needs_correction" ? "Correction notes" : "Unlock reason"}
              </label>
              <Textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
          {openAction === "approve" && (
            <p className="text-sm text-muted-foreground">
              Approving will lock all {dtrs?.length ?? 0} DTR entries in this cut-off and mark it ready for payroll.
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenAction(null)}>Cancel</Button>
            <Button onClick={() => act.mutate({ action: openAction!, note })}
              disabled={act.isPending || (openAction !== "approve" && !note.trim() && openAction !== "unlock")}>
              {`Confirm ${STATUS_LABEL[openAction === "approve" ? "approved" : openAction === "reject" ? "rejected" : "needs_correction"] ?? openAction}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={otReject !== null} onOpenChange={(o) => { if (!o) { setOtReject(null); setOtNote(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display text-2xl">Reject overtime</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {otReject && `Rejecting OT for ${formatDate(otReject.date)}. Please provide a reason for the employee.`}
          </p>
          <div>
            <label className="text-sm">Reason</label>
            <Textarea rows={3} value={otNote} onChange={(e) => setOtNote(e.target.value)}
              placeholder="e.g. Not pre-approved, no business justification" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setOtReject(null); setOtNote(""); }}>Cancel</Button>
            <Button variant="destructive"
              disabled={otAct.isPending || !otNote.trim()}
              onClick={() => otReject && otAct.mutate({ dtrId: otReject.dtrId, approve: false, reason: otNote.trim() })}>
              Confirm reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className="rounded-md border bg-background/60 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-display text-xl ${warn ? "text-warning-foreground" : ""}`}>{value}</div>
    </div>
  );
}

function PayslipCard({
  submissionId, employeeId, cutoffId, payslipPath, uploadedAt, userId,
}: {
  submissionId: string; employeeId: string; cutoffId: string;
  payslipPath: string | null; uploadedAt: string | null; userId?: string;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const handleUpload = async (file: File) => {
    if (!userId) return;
    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const path = `${employeeId}/${cutoffId}-${Date.now()}.${ext}`;
      // Remove existing file if present
      if (payslipPath) await supabase.storage.from("payslips").remove([payslipPath]);
      const { error: upErr } = await supabase.storage
        .from("payslips")
        .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upErr) throw upErr;
      const { error } = await supabase
        .from("dtr_cutoff_submissions")
        .update({
          payslip_path: path,
          payslip_uploaded_at: new Date().toISOString(),
          payslip_uploaded_by: userId,
        } as never)
        .eq("id", submissionId);
      if (error) throw error;
      toast.success("Payslip uploaded");
      qc.invalidateQueries({ queryKey: ["sub-detail", submissionId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    if (!payslipPath) return;
    const { data, error } = await supabase.storage
      .from("payslips").createSignedUrl(payslipPath, 60);
    if (error || !data) { toast.error(error?.message ?? "Failed"); return; }
    window.open(data.signedUrl, "_blank");
  };

  const handleRemove = async () => {
    if (!payslipPath) return;
    if (!confirm("Remove this payslip?")) return;
    setBusy(true);
    try {
      await supabase.storage.from("payslips").remove([payslipPath]);
      const { error } = await supabase
        .from("dtr_cutoff_submissions")
        .update({ payslip_path: null, payslip_uploaded_at: null, payslip_uploaded_by: null } as never)
        .eq("id", submissionId);
      if (error) throw error;
      toast.success("Payslip removed");
      qc.invalidateQueries({ queryKey: ["sub-detail", submissionId] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="h-4 w-4" /> Payslip
        </CardTitle>
        {payslipPath && uploadedAt && (
          <span className="text-xs text-muted-foreground">Uploaded {formatDateTime(uploadedAt)}</span>
        )}
      </CardHeader>
      <CardContent>
        {payslipPath ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="mr-1 h-4 w-4" /> Download
            </Button>
            <label>
              <input
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.currentTarget.value = ""; }}
              />
              <Button variant="outline" size="sm" disabled={busy} asChild>
                <span><Upload className="mr-1 h-4 w-4" /> Replace</span>
              </Button>
            </label>
            <Button variant="destructive" size="sm" onClick={handleRemove} disabled={busy}>
              <Trash2 className="mr-1 h-4 w-4" /> Remove
            </Button>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-sm text-muted-foreground">
              Attach the employee's payslip (PDF or image) for this cut-off. They'll see a download button on their dashboard.
            </p>
            <label className="inline-flex">
              <input
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.currentTarget.value = ""; }}
              />
              <Button disabled={busy} asChild>
                <span><Upload className="mr-1 h-4 w-4" /> {busy ? "Uploading…" : "Upload payslip"}</span>
              </Button>
            </label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
