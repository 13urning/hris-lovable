import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAllSubmissions, getAllCutoffs } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/StatusBadge";
import { APPROVAL_STATUSES, formatDate, toCsv, downloadCsv, type ApprovalStatus, STATUS_LABEL } from "@/lib/dtr";
import { useAuth } from "@/hooks/use-auth";
import { Check, X, AlertTriangle, Download, ChevronRight, Upload, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_admin/cutoff-approval")({ component: CutoffApproval });

function CutoffApproval() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: subs } = useQuery({ queryKey: ["all-subs"], queryFn: getAllSubmissions });
  const { data: cutoffs } = useQuery({ queryKey: ["cutoffs"], queryFn: getAllCutoffs });
  const { data: otRows } = useQuery({
    queryKey: ["all-ot-rows"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_time_reports")
        .select("id, employee_id, cutoff_id, overtime_hours, ot_status")
        .gt("overtime_hours", 0);
      if (error) throw error;
      return data ?? [];
    },
  });
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const [filters, setFilters] = useState({
    cutoff: "all", status: "all", department: "all", employee: "",
    from: "", to: "",
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState<null | "approve" | "reject" | "needs_correction">(null);
  const [bulkNote, setBulkNote] = useState("");

  const departments = useMemo(() => {
    const s = new Set<string>();
    subs?.forEach((r) => r.profile?.department && s.add(r.profile.department));
    return Array.from(s).sort();
  }, [subs]);

  const otBySubmission = useMemo(() => {
    const map = new Map<string, { total: number; pending: number; approved: number; rejected: number; count: number }>();
    otRows?.forEach((row) => {
      if (!row.employee_id || !row.cutoff_id) return;
      const key = `${row.employee_id}|${row.cutoff_id}`;
      const current = map.get(key) ?? { total: 0, pending: 0, approved: 0, rejected: 0, count: 0 };
      const hours = Number(row.overtime_hours) || 0;
      const status = (row as { ot_status?: string | null }).ot_status ?? "pending";
      current.total += hours;
      current.count += 1;
      if (status === "approved") current.approved += hours;
      else if (status === "rejected") current.rejected += hours;
      else current.pending += hours;
      map.set(key, current);
    });
    return map;
  }, [otRows]);

  const filtered = useMemo(() => {
    return (subs ?? []).filter((r) => {
      if (filters.cutoff !== "all" && r.cutoff_id !== filters.cutoff) return false;
      if (filters.status !== "all" && r.approval_status !== filters.status) return false;
      if (filters.department !== "all" && r.profile?.department !== filters.department) return false;
      if (filters.employee && !(r.profile?.full_name ?? "").toLowerCase().includes(filters.employee.toLowerCase())) return false;
      if (filters.from && r.cutoff?.end_date && r.cutoff.end_date < filters.from) return false;
      if (filters.to && r.cutoff?.start_date && r.cutoff.start_date > filters.to) return false;
      return true;
    });
  }, [subs, filters]);

  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allChecked) filtered.forEach((r) => next.delete(r.id));
    else filtered.forEach((r) => next.add(r.id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const bulkAction = useMutation({
    mutationFn: async ({ action, note }: { action: "approve" | "reject" | "needs_correction"; note: string }) => {
      if (!user) throw new Error("not signed in");
      const ids = Array.from(selected);
      if (!ids.length) throw new Error("Select at least one row");
      const now = new Date().toISOString();
      const status: ApprovalStatus = action === "approve" ? "approved"
        : action === "reject" ? "rejected" : "needs_correction";
      const update: Record<string, unknown> = { approval_status: status };
      if (action === "approve") { update.approved_by = user.id; update.approved_at = now; }
      if (action === "reject") update.rejection_reason = note;
      if (action === "needs_correction") update.correction_notes = note;

      const { error } = await supabase
        .from("dtr_cutoff_submissions")
        .update(update as never)
        .in("id", ids);
      if (error) throw error;

      const logs = ids.map((id) => ({
        dtr_cutoff_submission_id: id,
        action: (action === "approve" ? "approved" : action === "reject" ? "rejected" : "needs_correction") as "approved" | "rejected" | "needs_correction",
        action_by: user.id,
        notes: note || null,
      }));
      const { error: lerr } = await supabase.from("dtr_approval_logs").insert(logs);
      if (lerr) throw lerr;
    },
    onSuccess: (_d, vars) => {
      toast.success(`${vars.action.replace("_"," ")} applied to ${selected.size} row(s)`);
      setSelected(new Set()); setBulkOpen(null); setBulkNote("");
      qc.invalidateQueries({ queryKey: ["all-subs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportCsv = () => {
    const rows = filtered.filter((r) => selected.has(r.id)).map((r) => ({
      cutoff: r.cutoff?.cutoff_name ?? "",
      period: `${r.cutoff?.start_date ?? ""} to ${r.cutoff?.end_date ?? ""}`,
      employee: r.profile?.full_name ?? "",
      department: r.profile?.department ?? "",
      days_submitted: r.total_days_submitted,
      total_hours: r.total_hours,
      late_count: r.late_count,
      absent_count: r.absent_count,
      overtime_hours: r.overtime_hours,
      leave_days: r.leave_days,
      missing_dtrs: r.missing_dtr_count,
      status: STATUS_LABEL[r.approval_status as ApprovalStatus],
      submitted_at: r.submitted_at ?? "",
      approved_at: r.approved_at ?? "",
    }));
    if (!rows.length) { toast.error("Select rows first"); return; }
    downloadCsv(`cutoff-dtrs-${new Date().toISOString().slice(0,10)}.csv`, toCsv(rows));
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">HR · Admin</p>
        <h1 className="mt-1 font-display text-4xl">Cut Off Approval</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and finalise DTR submissions per payroll cut-off period.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Filters</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            <div>
              <Label>Cut-off</Label>
              <Select value={filters.cutoff} onValueChange={(v) => setFilters({ ...filters, cutoff: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All cut-offs</SelectItem>
                  {cutoffs?.map((c) => <SelectItem key={c.id} value={c.id}>{c.cutoff_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {APPROVAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Department</Label>
              <Select value={filters.department} onValueChange={(v) => setFilters({ ...filters, department: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Employee</Label>
              <Input value={filters.employee} placeholder="Search name"
                onChange={(e) => setFilters({ ...filters, employee: e.target.value })} />
            </div>
            <div>
              <Label>From</Label>
              <Input type="date" value={filters.from}
                onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
            </div>
            <div>
              <Label>To</Label>
              <Input type="date" value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-lg">{filtered.length} submission{filtered.length === 1 ? "" : "s"}</CardTitle>
            <p className="text-xs text-muted-foreground">{selected.size} selected</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download className="mr-1 h-4 w-4" /> Export CSV
            </Button>
            <Button size="sm" variant="outline" disabled={!selected.size}
              onClick={() => setBulkOpen("needs_correction")}>
              <AlertTriangle className="mr-1 h-4 w-4" /> Needs correction
            </Button>
            <Button size="sm" variant="destructive" disabled={!selected.size}
              onClick={() => setBulkOpen("reject")}>
              <X className="mr-1 h-4 w-4" /> Reject
            </Button>
            <Button size="sm" disabled={!selected.size}
              onClick={() => setBulkOpen("approve")}>
              <Check className="mr-1 h-4 w-4" /> Approve
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2"><Checkbox checked={allChecked} onCheckedChange={toggleAll} /></th>
                <th className="px-3 py-2 text-left">Cut-off period</th>
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">Department</th>
                <th className="px-3 py-2 text-right">Days</th>
                <th className="px-3 py-2 text-right">Hours</th>
                <th className="px-3 py-2 text-right">Late</th>
                <th className="px-3 py-2 text-right">Absent</th>
                <th className="px-3 py-2 text-right">OT</th>
                <th className="px-3 py-2 text-left">OT approval</th>
                <th className="px-3 py-2 text-right">Leave</th>
                <th className="px-3 py-2 text-right">Missing</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Payslip</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t hover:bg-secondary/30">
                  <td className="px-3 py-2"><Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} /></td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.cutoff?.cutoff_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(r.cutoff?.start_date)} – {formatDate(r.cutoff?.end_date)}
                    </div>
                  </td>
                  <td className="px-3 py-2">{r.profile?.full_name || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{r.profile?.department}</td>
                  <td className="px-3 py-2 text-right">{r.total_days_submitted}</td>
                  <td className="px-3 py-2 text-right">{Number(r.total_hours).toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{r.late_count}</td>
                  <td className="px-3 py-2 text-right">{r.absent_count}</td>
                  <td className="px-3 py-2 text-right">{Number(r.overtime_hours).toFixed(2)}</td>
                  <td className="px-3 py-2">
                    <OtApprovalSummary summary={otBySubmission.get(`${r.employee_id}|${r.cutoff_id}`)} />
                  </td>
                  <td className="px-3 py-2 text-right">{r.leave_days}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={r.missing_dtr_count > 0 ? "text-warning-foreground font-medium" : ""}>
                      {r.missing_dtr_count}
                    </span>
                  </td>
                  <td className="px-3 py-2"><StatusBadge status={r.approval_status as ApprovalStatus} /></td>
                  <td className="px-3 py-2">
                    <PayslipCell
                      row={r}
                      userId={user?.id}
                      busy={uploadingId === r.id}
                      setBusy={(b) => setUploadingId(b ? r.id : null)}
                      onChanged={() => qc.invalidateQueries({ queryKey: ["all-subs"] })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Button asChild size="sm" variant="ghost">
                      <Link to="/cutoff-approval/$id" params={{ id: r.id }}>
                        Review <ChevronRight className="ml-1 h-4 w-4" />
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={15} className="px-6 py-10 text-center text-sm text-muted-foreground">
                  No submissions match your filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={bulkOpen !== null} onOpenChange={(o) => !o && setBulkOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {bulkOpen === "approve" ? "Approve" : bulkOpen === "reject" ? "Reject" : "Mark as Needs Correction"}
              {" "}{selected.size} submission{selected.size === 1 ? "" : "s"}
            </DialogTitle>
          </DialogHeader>
          {bulkOpen !== "approve" && (
            <div>
              <Label>{bulkOpen === "reject" ? "Rejection reason" : "Correction notes"}</Label>
              <Textarea rows={4} value={bulkNote} onChange={(e) => setBulkNote(e.target.value)}
                placeholder="Visible to the employee" />
            </div>
          )}
          {bulkOpen === "approve" && (
            <p className="text-sm text-muted-foreground">
              Approved cut-offs are locked and ready for payroll processing.
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkOpen(null)}>Cancel</Button>
            <Button
              onClick={() => bulkAction.mutate({ action: bulkOpen!, note: bulkNote })}
              disabled={bulkAction.isPending || (bulkOpen !== "approve" && !bulkNote.trim())}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OtApprovalSummary({ summary }: { summary?: { total: number; pending: number; approved: number; rejected: number; count: number } }) {
  if (!summary || summary.total <= 0) return <span className="text-xs text-muted-foreground">—</span>;
  const hasPending = summary.pending > 0;
  return (
    <div className="flex min-w-32 flex-col gap-1">
      <span className={hasPending ? "rounded bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning-foreground" : "rounded bg-success/15 px-2 py-0.5 text-xs font-medium text-success"}>
        {hasPending ? `${summary.pending.toFixed(2)}h pending` : "No pending OT"}
      </span>
      <span className="text-xs text-muted-foreground">
        {summary.total.toFixed(2)}h filed · open Review
      </span>
    </div>
  );
}

type SubRow = {
  id: string;
  employee_id: string;
  cutoff_id: string;
  cutoff?: { cutoff_name: string } | null;
};

function PayslipCell({ row, userId, busy, setBusy, onChanged }: {
  row: SubRow & Record<string, unknown>;
  userId?: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onChanged: () => void;
}) {
  const payslipPath = (row as { payslip_path?: string | null }).payslip_path ?? null;

  const handleFile = async (file: File) => {
    if (!userId) { toast.error("Sign in required"); return; }
    setBusy(true);
    try {
      const ext = file.name.split(".").pop() || "pdf";
      const path = `${row.employee_id}/${row.cutoff_id}-${Date.now()}.${ext}`;
      if (payslipPath) await supabase.storage.from("payslips").remove([payslipPath]);
      const { error: upErr } = await supabase.storage.from("payslips")
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (upErr) throw upErr;
      const { error } = await supabase.from("dtr_cutoff_submissions")
        .update({
          payslip_path: path,
          payslip_uploaded_at: new Date().toISOString(),
          payslip_uploaded_by: userId,
        } as never)
        .eq("id", row.id);
      if (error) throw error;
      toast.success("Payslip uploaded");
      onChanged();
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
      const { error } = await supabase.from("dtr_cutoff_submissions")
        .update({ payslip_path: null, payslip_uploaded_at: null, payslip_uploaded_by: null } as never)
        .eq("id", row.id);
      if (error) throw error;
      toast.success("Payslip removed");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {payslipPath ? (
        <>
          <Button size="sm" variant="ghost" onClick={handleDownload} title="Download payslip">
            <FileText className="h-4 w-4 text-accent" />
          </Button>
          <label className="inline-flex">
            <input type="file" className="hidden" accept="application/pdf,image/*"
              disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
            <span className="inline-flex h-8 cursor-pointer items-center rounded-md px-2 text-xs text-muted-foreground hover:bg-secondary">
              Replace
            </span>
          </label>
          <Button size="sm" variant="ghost" onClick={handleRemove} title="Remove">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </>
      ) : (
        <label className="inline-flex">
          <input type="file" className="hidden" accept="application/pdf,image/*"
            disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
          <span className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border px-2 text-xs hover:bg-secondary">
            <Upload className="h-3.5 w-3.5" /> {busy ? "Uploading…" : "Attach"}
          </span>
        </label>
      )}
    </div>
  );
}
