import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { getAllCutoffs, getMyDTRs, getMySubmission, getCurrentCutoff } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate, todayIso, toCsv, downloadCsv, type ApprovalStatus } from "@/lib/dtr";
import { Lock, Trash2, Plus, Info, Download, Printer, AlertTriangle, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dtr")({ component: DtrPage });

// Flexible schedule: standard 9 hours/day, latest time-in is 10:00.
const STANDARD_HOURS = 9;
const LATEST_TIME_IN = "10:00";

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function fromMinutes(mins: number): string {
  const m = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function computeHours(timeIn: string, timeOut: string): number {
  if (!timeIn || !timeOut) return 0;
  const mins = toMinutes(timeOut) - toMinutes(timeIn);
  return Math.max(0, Math.round((mins / 60) * 100) / 100);
}
function computeLate(timeIn: string): number {
  if (!timeIn) return 0;
  return Math.max(0, toMinutes(timeIn) - toMinutes(LATEST_TIME_IN));
}
function expectedTimeOut(timeIn: string): string {
  if (!timeIn) return "";
  return fromMinutes(toMinutes(timeIn) + STANDARD_HOURS * 60);
}

function DtrPage() {
  const { user, isHR } = useAuth();
  const qc = useQueryClient();
  if (isHR) return <Navigate to="/cutoff-approval" />;
  const { data: cutoffs } = useQuery({ queryKey: ["cutoffs"], queryFn: getAllCutoffs });
  const { data: currentCutoff } = useQuery({ queryKey: ["cutoff","current"], queryFn: getCurrentCutoff });
  const [selectedCutoff, setSelectedCutoff] = useState<string | null>(null);
  const activeCutoff = selectedCutoff
    ? cutoffs?.find((c) => c.id === selectedCutoff)
    : currentCutoff;

  const { data: dtrs, refetch } = useQuery({
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
  const isApproved = status === "approved";

  // OT-rejected rows can still be edited (only the cutoff approval truly locks)
  const rejectedOt = (dtrs ?? []).filter(
    (d) => (d as { ot_status?: string }).ot_status === "rejected",
  );
  const rowEditable = (d: { ot_status?: string | null }) =>
    !isApproved && (!locked || d.ot_status === "rejected");

  const exportCsv = () => {
    if (!dtrs?.length || !activeCutoff) return;
    const rows = [...dtrs]
      .sort((a, b) => a.work_date.localeCompare(b.work_date))
      .map((d) => ({
        Date: d.work_date,
        "Time In": d.time_in ?? "",
        "Time Out": d.time_out ?? "",
        Hours: Number(d.hours_worked).toFixed(2),
        "Late (min)": d.late_minutes,
        OT: Number(d.overtime_hours).toFixed(2),
        "OT Status": (d as { ot_status?: string }).ot_status ?? "",
        Status: d.is_absent ? "Absent" : d.is_leave ? `Leave (${d.leave_type ?? ""})` : "Present",
        Notes: d.notes ?? "",
      }));
    downloadCsv(`DTR_${activeCutoff.cutoff_name.replace(/\s+/g, "_")}.csv`, toCsv(rows));
  };

  const exportPdf = () => {
    if (!dtrs?.length || !activeCutoff) return;
    const sorted = [...dtrs].sort((a, b) => a.work_date.localeCompare(b.work_date));
    const totalHours = sorted.reduce((s, d) => s + Number(d.hours_worked), 0);
    const totalOt = sorted.reduce((s, d) => s + Number(d.overtime_hours), 0);
    const totalLate = sorted.reduce((s, d) => s + Number(d.late_minutes), 0);
    const rows = sorted.map((d) => `
      <tr>
        <td>${formatDate(d.work_date)}</td>
        <td>${d.time_in ?? "—"}</td>
        <td>${d.time_out ?? "—"}</td>
        <td style="text-align:right">${Number(d.hours_worked).toFixed(2)}</td>
        <td style="text-align:right">${d.late_minutes}</td>
        <td style="text-align:right">${Number(d.overtime_hours).toFixed(2)}</td>
        <td>${d.is_absent ? "Absent" : d.is_leave ? `Leave (${d.leave_type ?? ""})` : "Present"}</td>
        <td>${(d.notes ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))}</td>
      </tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>DTR – ${activeCutoff.cutoff_name}</title>
      <style>
        *{box-sizing:border-box;font-family:Montserrat,system-ui,sans-serif}
        body{margin:32px;color:#111}
        h1{font-size:20px;margin:0 0 4px}
        .muted{color:#666;font-size:12px}
        .meta{display:flex;justify-content:space-between;margin:16px 0;font-size:13px}
        table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
        th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
        th{background:#f3f3f3;text-transform:uppercase;font-size:10px;letter-spacing:.08em}
        tfoot td{font-weight:600;background:#fafafa}
        .stamp{margin-top:24px;padding:12px;border:1px dashed #999;font-size:12px;color:#444}
      </style></head><body>
      <h1>Daily Time Report</h1>
      <div class="muted">${activeCutoff.cutoff_name} · ${formatDate(activeCutoff.start_date)} – ${formatDate(activeCutoff.end_date)}</div>
      <div class="meta">
        <div><strong>Employee:</strong> ${user?.user_metadata?.full_name ?? user?.email ?? ""}</div>
        <div><strong>Status:</strong> APPROVED${submission?.approved_at ? ` · ${formatDate(submission.approved_at)}` : ""}</div>
      </div>
      <table>
        <thead><tr><th>Date</th><th>Time In</th><th>Time Out</th><th>Hours</th><th>Late (min)</th><th>OT</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="3">Totals</td>
          <td style="text-align:right">${totalHours.toFixed(2)}</td>
          <td style="text-align:right">${totalLate}</td>
          <td style="text-align:right">${totalOt.toFixed(2)}</td>
          <td colspan="2"></td></tr></tfoot>
      </table>
      <div class="stamp">This DTR was approved by HR. Use your browser's "Save as PDF" option in the print dialog to keep a copy.</div>
      <script>window.onload=()=>{window.print()}</script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) { toast.error("Pop-up blocked — allow pop-ups to export"); return; }
    w.document.write(html);
    w.document.close();
  };

  const [form, setForm] = useState({
    work_date: todayIso(),
    time_in: "09:00", time_out: "18:00",
    overtime_hours: 0,
    is_absent: false, is_leave: false, leave_type: "",
    notes: "",
  });

  const loadIntoForm = (d: {
    work_date: string;
    time_in: string | null;
    time_out: string | null;
    overtime_hours: number | string;
    is_absent: boolean;
    is_leave: boolean;
    leave_type: string | null;
    notes: string | null;
  }) => {
    setForm({
      work_date: d.work_date,
      time_in: d.time_in ?? "09:00",
      time_out: d.time_out ?? "18:00",
      overtime_hours: Number(d.overtime_hours) || 0,
      is_absent: !!d.is_absent,
      is_leave: !!d.is_leave,
      leave_type: d.leave_type ?? "",
      notes: d.notes ?? "",
    });
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    toast.info("Entry loaded — adjust OT and save to resubmit");
  };

  const autoLate = form.is_absent || form.is_leave ? 0 : computeLate(form.time_in);
  const autoHours = form.is_absent || form.is_leave ? 0 : computeHours(form.time_in, form.time_out);
  const expectedOut = expectedTimeOut(form.time_in);
  const isWeekend = (() => {
    const d = new Date(form.work_date + "T00:00:00");
    const dow = d.getDay();
    return dow === 0 || dow === 6;
  })();
  const autoOvertime = form.is_absent || form.is_leave
    ? 0
    : isWeekend
      ? Math.round(autoHours * 100) / 100
      : Math.max(0, Math.round((autoHours - STANDARD_HOURS) * 100) / 100);

  const upsert = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("not signed in");
      const hours = form.is_absent || form.is_leave ? 0 : computeHours(form.time_in, form.time_out);
      const late = form.is_absent || form.is_leave ? 0 : computeLate(form.time_in);
      const dow = new Date(form.work_date + "T00:00:00").getDay();
      const weekend = dow === 0 || dow === 6;
      const autoOt = form.is_absent || form.is_leave
        ? 0
        : weekend ? hours : Math.max(0, hours - STANDARD_HOURS);
      // Cap OT at total hours worked — OT can never exceed actual hours
      const ot = Math.min(hours, Math.max(form.overtime_hours, autoOt));
      const row = {
        employee_id: user.id,
        work_date: form.work_date,
        time_in: form.is_absent || form.is_leave ? null : form.time_in,
        time_out: form.is_absent || form.is_leave ? null : form.time_out,
        hours_worked: hours,
        late_minutes: late,
        overtime_hours: ot,
        ot_status: "pending" as const,
        ot_approved_hours: 0,
        ot_approved_by: null,
        ot_approved_at: null,
        is_absent: form.is_absent,
        is_leave: form.is_leave,
        leave_type: form.is_leave ? form.leave_type || "VL" : null,
        notes: form.notes || null,
      };
      const { error } = await supabase
        .from("daily_time_reports")
        .upsert(row, { onConflict: "employee_id,work_date" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("DTR saved");
      qc.invalidateQueries({ queryKey: ["dtrs"] });
      qc.invalidateQueries({ queryKey: ["sub"] });
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("daily_time_reports").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["dtrs"] });
      qc.invalidateQueries({ queryKey: ["sub"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">My DTR</p>
          <h1 className="mt-1 font-display text-4xl">Daily Time Report</h1>
        </div>
        <div className="flex items-center gap-3">
          <Label className="text-xs text-muted-foreground">Cut-off</Label>
          <Select
            value={activeCutoff?.id ?? ""}
            onValueChange={(v) => setSelectedCutoff(v)}
          >
            <SelectTrigger className="w-[260px]"><SelectValue placeholder="Select" /></SelectTrigger>
            <SelectContent>
              {cutoffs?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.cutoff_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {submission && <StatusBadge status={status} />}
        </div>
      </div>

      {locked && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <Lock className="h-4 w-4" />
          {status === "approved"
            ? "This cut-off is approved and locked. Ask HR to unlock for corrections."
            : "Pending HR approval — edits are paused until reviewed."}
        </div>
      )}

      {rejectedOt.length > 0 && !isApproved && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <div className="mb-2 flex items-center gap-2 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Overtime denied on {rejectedOt.length} entry{rejectedOt.length > 1 ? "ies" : ""} — please review and resubmit
          </div>
          <ul className="space-y-1 pl-6 text-xs text-destructive/90">
            {rejectedOt.map((d) => (
              <li key={d.id} className="list-disc">
                <span className="font-medium">{formatDate(d.work_date)}</span>
                {" — "}
                {(d as { ot_review_notes?: string | null }).ot_review_notes
                  ? `"${(d as { ot_review_notes?: string | null }).ot_review_notes}"`
                  : "No notes provided"}
                <button
                  type="button"
                  className="ml-2 underline underline-offset-2"
                  onClick={() => loadIntoForm(d as Parameters<typeof loadIntoForm>[0])}
                >
                  Edit entry
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isApproved && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="text-sm font-medium">Your DTR is approved</p>
              <p className="text-xs text-muted-foreground">Download a copy for your records.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={exportCsv}>
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
              <Button onClick={exportPdf}>
                <Printer className="mr-2 h-4 w-4" /> Export PDF
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl flex items-center gap-2">
            <Plus className="h-5 w-5" /> Log entry
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Date</Label>
              <Input type="date" value={form.work_date}
                onChange={(e) => setForm({ ...form, work_date: e.target.value })} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Past or future dates allowed — cut-off is auto-detected
              </p>
            </div>
            <div>
              <Label>Time in</Label>
              <Input type="time" value={form.time_in} disabled={form.is_absent || form.is_leave}
                onChange={(e) => setForm({ ...form, time_in: e.target.value })} />
              <p className="mt-1 text-[11px] text-muted-foreground">Latest allowed: {LATEST_TIME_IN}</p>
            </div>
            <div>
              <Label>Time out</Label>
              <Input type="time" value={form.time_out} disabled={form.is_absent || form.is_leave}
                onChange={(e) => setForm({ ...form, time_out: e.target.value })} />
              {expectedOut && !form.is_absent && !form.is_leave && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Expected: {expectedOut} ({STANDARD_HOURS}h standard)
                </p>
              )}
            </div>
            <div>
              <Label>Hours worked</Label>
              <Input value={autoHours.toFixed(2)} disabled />
              <p className="mt-1 text-[11px] text-muted-foreground">Auto-computed</p>
            </div>
            <div>
              <Label>Late (minutes)</Label>
              <Input value={autoLate} disabled />
              <p className="mt-1 text-[11px] text-muted-foreground">After {LATEST_TIME_IN}</p>
            </div>
            <div>
              <Label>Overtime hours</Label>
              <Input type="number" step="0.25" min={0} value={form.overtime_hours}
                onChange={(e) => setForm({ ...form, overtime_hours: Number(e.target.value) })} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Auto: {autoOvertime.toFixed(2)}h {isWeekend ? "(weekend — all hours count as OT)" : `beyond ${STANDARD_HOURS}h`} · needs HR approval
              </p>
            </div>
            <div className="flex items-end gap-6">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.is_absent}
                  onCheckedChange={(v) => setForm({ ...form, is_absent: v, is_leave: v ? false : form.is_leave })} />
                Absent
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={form.is_leave}
                  onCheckedChange={(v) => setForm({ ...form, is_leave: v, is_absent: v ? false : form.is_absent })} />
                Leave
              </label>
            </div>
            <div className="md:col-span-3 flex items-start gap-2 rounded-md border border-border/50 bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Flexible schedule — {STANDARD_HOURS} hours per day, latest time-in {LATEST_TIME_IN}.
                Late minutes and hours worked are computed automatically from your time-in/out.
              </span>
            </div>
            {form.is_leave && (
              <div>
                <Label>Leave type</Label>
                <Select value={form.leave_type} onValueChange={(v) => setForm({ ...form, leave_type: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VL">Vacation Leave</SelectItem>
                    <SelectItem value="SL">Sick Leave</SelectItem>
                    <SelectItem value="EL">Emergency Leave</SelectItem>
                    <SelectItem value="BL">Bereavement Leave</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="md:col-span-3">
              <Label>Notes</Label>
              <Textarea rows={2} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Anything HR should know about this entry" />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => upsert.mutate()}
              disabled={
                upsert.isPending ||
                isApproved ||
                (locked &&
                  !rejectedOt.some((d) => d.work_date === form.work_date))
              }
            >
              Save entry
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl">Entries this cut-off</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {dtrs?.length ? (
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Date</th>
                  <th className="px-4 py-2 text-left">In / Out</th>
                  <th className="px-4 py-2 text-right">Hours</th>
                  <th className="px-4 py-2 text-right">Late</th>
                  <th className="px-4 py-2 text-right">OT</th>
                  <th className="px-4 py-2 text-left">OT status</th>
                  <th className="px-4 py-2 text-left">Flag</th>
                  <th className="px-4 py-2 text-left">Notes</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {dtrs.map((d) => (
                  <tr key={d.id} className="border-t">
                    <td className="px-4 py-2">{formatDate(d.work_date)}</td>
                    <td className="px-4 py-2">{d.time_in ?? "—"} / {d.time_out ?? "—"}</td>
                    <td className="px-4 py-2 text-right">{Number(d.hours_worked).toFixed(2)}</td>
                    <td className="px-4 py-2 text-right">{d.late_minutes}</td>
                    <td className="px-4 py-2 text-right">{Number(d.overtime_hours).toFixed(2)}</td>
                    <td className="px-4 py-2">
                      {Number(d.overtime_hours) > 0 ? (
                        <div className="space-y-1">
                          <span className={
                            (d as { ot_status?: string }).ot_status === "approved"
                              ? "rounded bg-success/15 px-2 py-0.5 text-xs text-success"
                              : (d as { ot_status?: string }).ot_status === "rejected"
                              ? "rounded bg-destructive/15 px-2 py-0.5 text-xs text-destructive"
                              : "rounded bg-warning/20 px-2 py-0.5 text-xs text-warning-foreground"
                          }>
                            {(d as { ot_status?: string }).ot_status ?? "pending"}
                          </span>
                          {(d as { ot_status?: string }).ot_status === "rejected" &&
                            (d as { ot_review_notes?: string | null }).ot_review_notes && (
                              <p className="max-w-[200px] text-[11px] italic text-destructive">
                                "{(d as { ot_review_notes?: string | null }).ot_review_notes}"
                              </p>
                            )}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-2">
                      {d.is_absent ? "Absent" : d.is_leave ? `Leave (${d.leave_type ?? ""})` : "Present"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{d.notes ?? ""}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {rowEditable(d as { ot_status?: string | null }) && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Edit"
                            onClick={() => loadIntoForm(d as Parameters<typeof loadIntoForm>[0])}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Delete"
                          disabled={!rowEditable(d as { ot_status?: string | null })}
                          onClick={() => del.mutate(d.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">No entries yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
