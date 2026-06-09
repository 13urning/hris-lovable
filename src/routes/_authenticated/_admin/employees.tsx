import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Download, Upload, Check, X, Copy, Users, Save } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_admin/employees")({ component: EmployeesPage });

// ── Types ─────────────────────────────────────────────────────────────────────

type Row = {
  id: string; full_name: string; email: string | null; department: string;
  employee_code: string | null; position: string | null; company: string | null;
  vl_credits: number | null; sl_credits: number | null;
  vl_remaining: number | null; sl_remaining: number | null;
  roles: ("employee" | "hr" | "admin")[];
  vl_used: number;
  sl_used: number;
};

type ImportRow = {
  email: string; full_name: string; employee_code: string;
  company: string; department: string; position: string;
  vl_credits: string; sl_credits: string;
};

type ImportResult = {
  email: string; full_name: string;
  success: boolean; temp_password?: string; error?: string;
};

// ── CSV helpers ───────────────────────────────────────────────────────────────

const TEMPLATE_HEADERS = [
  "email", "full_name", "employee_code", "company",
  "department", "position", "vl_credits", "sl_credits",
];

const TEMPLATE_EXAMPLE: ImportRow = {
  email: "juan.delacruz@example.com",
  full_name: "Juan dela Cruz",
  employee_code: "EMP-001",
  company: "Tidal Solutions",
  department: "Engineering",
  position: "Software Engineer",
  vl_credits: "10",
  sl_credits: "10",
};

function downloadTemplate() {
  const rows = [
    TEMPLATE_HEADERS.join(","),
    TEMPLATE_HEADERS.map((h) => TEMPLATE_EXAMPLE[h as keyof ImportRow]).join(","),
  ];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "employee-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function parseCSV(text: string): ImportRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/"/g, ""));
  const idx = (name: string) => headers.indexOf(name);
  return lines.slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const cols = parseCSVLine(line);
      const get = (name: string, fallback = "") => (cols[idx(name)] ?? fallback).trim();
      return {
        email: get("email"),
        full_name: get("full_name"),
        employee_code: get("employee_code"),
        company: get("company"),
        department: get("department"),
        position: get("position"),
        vl_credits: get("vl_credits") || "10",
        sl_credits: get("sl_credits") || "10",
      };
    });
}

function copyCredentials(results: ImportResult[]) {
  const lines = results
    .filter((r) => r.success)
    .map((r) => `${r.full_name}\t${r.email}\t${r.temp_password}`);
  const text = ["Name\tEmail\tTemporary Password", ...lines].join("\n");
  navigator.clipboard.writeText(text).then(() => toast.success("Credentials copied to clipboard"));
}

// ── Page ──────────────────────────────────────────────────────────────────────

function EmployeesPage() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  // Existing employee list state
  const [search, setSearch] = useState("");
  const [savingAll, setSavingAll] = useState(false);

  // Pending edits — keyed by row id, then field name
  const [pendingEdits, setPendingEdits] = useState<Record<string, Record<string, string | number>>>({});

  const setEdit = (id: string, field: string, value: string | number) => {
    setPendingEdits((prev) => ({ ...prev, [id]: { ...(prev[id] ?? {}), [field]: value } }));
  };

  const clearEdit = (id: string) => {
    setPendingEdits((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const isDirty = (id: string) => !!(pendingEdits[id] && Object.keys(pendingEdits[id]).length > 0);
  const dirtyCount = Object.keys(pendingEdits).length;

  // Import dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "preview" | "results">("upload");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [importing, setImporting] = useState(false);

  // ── Queries & mutations ────────────────────────────────────────────────────

  const { data } = useQuery({
    queryKey: ["employees"],
    queryFn: async (): Promise<Row[]> => {
      const { data: profiles, error } = await supabase.from("profiles").select("*").order("full_name");
      if (error) throw error;
      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      const { data: leaves } = await supabase.from("leave_requests").select("employee_id, leave_type, start_date, end_date, status");

      const currentYear = new Date().getFullYear();
      const inCurrentYear = (iso: string) => {
        try {
          return new Date(iso).getFullYear() === currentYear;
        } catch {
          return false;
        }
      };

      const leaveDays = (a: string, b: string) => {
        try {
          return Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1);
        } catch {
          return 0;
        }
      };

      return (profiles ?? []).map((p) => {
        const userRoles = (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as Row["roles"][number]);
        const userLeaves = (leaves ?? []).filter((l) => l.employee_id === p.id);

        const vl_used = userLeaves
          .filter((l) => l.leave_type === "VL" && (l.status === "approved" || l.status === "pending") && inCurrentYear(l.start_date))
          .reduce((s, l) => s + leaveDays(l.start_date, l.end_date), 0);

        const sl_used = userLeaves
          .filter((l) => l.leave_type === "SL" && (l.status === "approved" || l.status === "pending") && inCurrentYear(l.start_date))
          .reduce((s, l) => s + leaveDays(l.start_date, l.end_date), 0);

        return {
          ...p,
          roles: userRoles,
          vl_used,
          sl_used,
        };
      });
    },
  });

  const saveRow = useMutation({
    mutationFn: async ({ row, edits }: { row: Row; edits: Record<string, string | number> }) => {
      const patches: Record<string, string | number> = {};
      for (const [field, value] of Object.entries(edits)) {
        if (field === "vl_total") {
          patches.vl_credits = Number(value);
        } else if (field === "sl_total") {
          patches.sl_credits = Number(value);
        } else if (field === "vl_remaining") {
          patches.vl_remaining = Number(value);
        } else if (field === "sl_remaining") {
          patches.sl_remaining = Number(value);
        } else {
          patches[field] = value;
        }
      }
      const { error } = await supabase.from("profiles").update(patches as never).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: (_data, { row }) => {
      clearEdit(row.id);
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: "employee" | "hr" | "admin" }) => {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const inserts =
        role === "admin"
          ? [{ user_id: userId, role: "admin" as const }, { user_id: userId, role: "hr" as const }, { user_id: userId, role: "employee" as const }]
          : role === "hr"
          ? [{ user_id: userId, role: "hr" as const }, { user_id: userId, role: "employee" as const }]
          : [{ user_id: userId, role: "employee" as const }];
      const { error } = await supabase.from("user_roles").insert(inserts);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Role updated"); qc.invalidateQueries({ queryKey: ["employees"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleSaveAll() {
    const dirtyRows = (data ?? []).filter((r) => isDirty(r.id));
    if (!dirtyRows.length) return;
    setSavingAll(true);
    try {
      for (const r of dirtyRows) {
        await saveRow.mutateAsync({ row: r, edits: pendingEdits[r.id] });
      }
      toast.success(`Saved ${dirtyRows.length} employee${dirtyRows.length !== 1 ? "s" : ""}`);
    } catch {
      // individual errors already shown via onError
    } finally {
      setSavingAll(false);
    }
  }

  // ── Import handlers ────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length === 0) {
        toast.error("No valid rows found. Make sure the file uses the template headers.");
        return;
      }
      setImportRows(rows);
      setImportStep("preview");
    };
    reader.readAsText(file);
    // reset so the same file can be re-selected after fixing issues
    e.target.value = "";
  }

  async function handleImport() {
    setImporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("bulk-create-employees", {
        body: { employees: importRows },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error) throw error;
      setImportResults((data as { results: ImportResult[] }).results);
      setImportStep("results");
      qc.invalidateQueries({ queryKey: ["employees"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function resetImport() {
    setImportStep("upload");
    setImportRows([]);
    setImportResults([]);
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  const filtered = (data ?? []).filter(
    (r) =>
      !search ||
      r.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (r.email ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (r.company ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const successCount = importResults.filter((r) => r.success).length;
  const failCount = importResults.filter((r) => !r.success).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">People</p>
          <h1 className="mt-1 font-display text-4xl">Employees</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" /> Download Template
          </Button>
          <Button onClick={() => { resetImport(); setImportOpen(true); }}>
            <Users className="mr-2 h-4 w-4" /> Import Employees
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle>{filtered.length} {filtered.length === 1 ? "person" : "people"}</CardTitle>
          <div className="flex items-center gap-2">
            {dirtyCount > 0 && (
              <Button size="sm" onClick={handleSaveAll} disabled={savingAll}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {savingAll ? "Saving…" : `Save ${dirtyCount} change${dirtyCount !== 1 ? "s" : ""}`}
              </Button>
            )}
            <Input
              className="max-w-xs"
              placeholder="Search name, email, company…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Company</th>
                <th className="px-3 py-2 text-left">Department</th>
                <th className="px-3 py-2 text-left">Position</th>
                <th className="px-3 py-2 text-right">VL Total</th>
                <th className="px-3 py-2 text-right">VL Remaining</th>
                <th className="px-3 py-2 text-right">SL Total</th>
                <th className="px-3 py-2 text-right">SL Remaining</th>
                <th className="px-3 py-2 text-left">Role</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const role: "employee" | "hr" | "admin" =
                  r.roles.includes("admin") ? "admin" : r.roles.includes("hr") ? "hr" : "employee";
                // Effective totals — use pending edit if the admin has changed the total field
                const effectiveVLTotal = pendingEdits[r.id]?.vl_total !== undefined
                  ? Number(pendingEdits[r.id].vl_total)
                  : (r.vl_credits ?? 10);
                const effectiveSLTotal = pendingEdits[r.id]?.sl_total !== undefined
                  ? Number(pendingEdits[r.id].sl_total)
                  : (r.sl_credits ?? 10);
                return (
                  <tr key={r.id} className={`border-t ${isDirty(r.id) ? "bg-primary/5" : ""}`}>
                    {/* Name */}
                    <td className="px-3 py-2">
                      <Input
                        className="h-8"
                        value={String(pendingEdits[r.id]?.full_name ?? r.full_name)}
                        onChange={(e) => setEdit(r.id, "full_name", e.target.value)}
                      />
                    </td>
                    {/* Email — read-only */}
                    <td className="px-3 py-2 text-muted-foreground text-xs">{r.email}</td>
                    {/* Code — read-only, auto-generated */}
                    <td className="px-3 py-2">
                      <span className="text-xs font-mono bg-secondary/60 px-1.5 py-0.5 rounded">
                        {r.employee_code ?? "—"}
                      </span>
                    </td>
                    {/* Company */}
                    <td className="px-3 py-2">
                      <Input
                        className="h-8"
                        placeholder="—"
                        value={String(pendingEdits[r.id]?.company ?? (r.company ?? ""))}
                        onChange={(e) => setEdit(r.id, "company", e.target.value)}
                      />
                    </td>
                    {/* Department */}
                    <td className="px-3 py-2">
                      <Input
                        className="h-8"
                        value={String(pendingEdits[r.id]?.department ?? r.department)}
                        onChange={(e) => setEdit(r.id, "department", e.target.value)}
                      />
                    </td>
                    {/* Position */}
                    <td className="px-3 py-2">
                      <Input
                        className="h-8"
                        value={String(pendingEdits[r.id]?.position ?? (r.position ?? ""))}
                        onChange={(e) => setEdit(r.id, "position", e.target.value)}
                      />
                    </td>
                    {/* VL Total — editable */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        max={365}
                        className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border focus:border-border focus:outline-none text-right font-medium"
                        value={effectiveVLTotal}
                        onChange={(e) => setEdit(r.id, "vl_total", e.target.value)}
                      />
                    </td>
                    {/* VL Remaining — stored independently, editable */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={-100}
                        max={365}
                        className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border focus:border-border focus:outline-none text-right font-medium text-accent"
                        value={
                          pendingEdits[r.id]?.vl_remaining !== undefined
                            ? Number(pendingEdits[r.id].vl_remaining)
                            : (r.vl_remaining ?? effectiveVLTotal)
                        }
                        onChange={(e) => setEdit(r.id, "vl_remaining", e.target.value)}
                      />
                    </td>
                    {/* SL Total — editable */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={0}
                        max={365}
                        className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border focus:border-border focus:outline-none text-right font-medium"
                        value={effectiveSLTotal}
                        onChange={(e) => setEdit(r.id, "sl_total", e.target.value)}
                      />
                    </td>
                    {/* SL Remaining — stored independently, editable */}
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={-100}
                        max={365}
                        className="w-16 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border focus:border-border focus:outline-none text-right font-medium text-accent"
                        value={
                          pendingEdits[r.id]?.sl_remaining !== undefined
                            ? Number(pendingEdits[r.id].sl_remaining)
                            : (r.sl_remaining ?? effectiveSLTotal)
                        }
                        onChange={(e) => setEdit(r.id, "sl_remaining", e.target.value)}
                      />
                    </td>
                    {/* Role — saves immediately */}
                    <td className="px-3 py-2">
                      <Select
                        value={role}
                        disabled={!isAdmin}
                        onValueChange={(v) => setRole.mutate({ userId: r.id, role: v as "employee" | "hr" | "admin" })}
                      >
                        <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="employee">Employee</SelectItem>
                          <SelectItem value="hr">HR</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              {search ? "No employees match your search." : "No employees yet. Use Import Employees to add them."}
            </div>
          )}
        </CardContent>
      </Card>

      {!isAdmin && <p className="text-xs text-muted-foreground">Only admins can change roles.</p>}

      {/* ── Import Dialog ───────────────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={(o) => { if (!o) resetImport(); setImportOpen(o); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Import Employees</DialogTitle>
          </DialogHeader>

          {/* Step 1: Upload */}
          {importStep === "upload" && (
            <div className="space-y-5 py-2">
              <p className="text-sm text-muted-foreground">
                Use the <strong>Download Template</strong> button on the Employees page to get the CSV,
                fill it in, then upload it below. Accounts will be created automatically with
                temporary passwords you can distribute to each employee.
              </p>

              <div className="rounded-lg border border-dashed p-8 flex flex-col items-center gap-3 text-center">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Upload your filled CSV</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Columns: email, full_name, employee_code, company, department, position, vl_credits, sl_credits</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <Button onClick={() => fileRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" /> Choose CSV File
                </Button>
              </div>

              <div className="rounded-md bg-secondary/40 p-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Required:</span> email, full_name &nbsp;·&nbsp;
                <span className="font-medium text-foreground">Optional:</span> all other columns (vl_credits &amp; sl_credits default to 10)
              </div>
            </div>
          )}

          {/* Step 2: Preview */}
          {importStep === "preview" && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                {importRows.length} row{importRows.length !== 1 ? "s" : ""} parsed. Review before creating accounts.
              </p>
              <div className="max-h-80 overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-secondary/80 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">Full Name</th>
                      <th className="px-3 py-2 text-left">Code</th>
                      <th className="px-3 py-2 text-left">Company</th>
                      <th className="px-3 py-2 text-left">Department</th>
                      <th className="px-3 py-2 text-left">Position</th>
                      <th className="px-3 py-2 text-right">VL</th>
                      <th className="px-3 py-2 text-right">SL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1.5 font-medium">{row.email || <span className="text-destructive">missing</span>}</td>
                        <td className="px-3 py-1.5">{row.full_name || <span className="text-destructive">missing</span>}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{row.employee_code || "—"}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{row.company || "—"}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{row.department || "—"}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{row.position || "—"}</td>
                        <td className="px-3 py-1.5 text-right">{row.vl_credits}</td>
                        <td className="px-3 py-1.5 text-right">{row.sl_credits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                A secure temporary password will be generated for each employee. Share it with them securely — they can change it after signing in.
              </p>
            </div>
          )}

          {/* Step 3: Results */}
          {importStep === "results" && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-4 text-sm">
                {successCount > 0 && (
                  <span className="flex items-center gap-1.5 text-success font-medium">
                    <Check className="h-4 w-4" /> {successCount} account{successCount !== 1 ? "s" : ""} created
                  </span>
                )}
                {failCount > 0 && (
                  <span className="flex items-center gap-1.5 text-destructive font-medium">
                    <X className="h-4 w-4" /> {failCount} failed
                  </span>
                )}
              </div>
              <div className="max-h-72 overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-secondary/80 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">Temporary Password</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResults.map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1.5 font-medium">{r.full_name}</td>
                        <td className="px-3 py-1.5">{r.email}</td>
                        <td className="px-3 py-1.5 font-mono">
                          {r.success ? (
                            <span className="rounded bg-secondary px-1.5 py-0.5">{r.temp_password}</span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.success
                            ? <span className="text-success">Created</span>
                            : <span className="text-destructive" title={r.error}>Failed: {r.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {successCount > 0 && (
                <div className="rounded-md bg-warning/10 border border-warning/30 px-4 py-3 text-xs text-warning-foreground">
                  <strong>Important:</strong> Copy and securely distribute the temporary passwords above. They will not be shown again.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            {importStep === "upload" && (
              <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            )}
            {importStep === "preview" && (
              <>
                <Button variant="outline" onClick={() => setImportStep("upload")}>Back</Button>
                <Button onClick={handleImport} disabled={importing || importRows.length === 0}>
                  {importing ? "Creating accounts…" : `Create ${importRows.length} Account${importRows.length !== 1 ? "s" : ""}`}
                </Button>
              </>
            )}
            {importStep === "results" && (
              <>
                {successCount > 0 && (
                  <Button variant="outline" onClick={() => copyCredentials(importResults)}>
                    <Copy className="mr-2 h-4 w-4" /> Copy All Credentials
                  </Button>
                )}
                <Button onClick={() => { resetImport(); setImportOpen(false); }}>Done</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
