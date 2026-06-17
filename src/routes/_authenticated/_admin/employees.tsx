import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchAllEmployees,
  updateEmployeeProfile,
  setEmployeeRole,
  setAttendanceTracking,
  bulkCreateEmployees,
  deleteEmployee,
} from "@/lib/employee-functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Download, Upload, Check, X, Copy, Users, Pencil, FileDown, Trash2 } from "lucide-react";
import { TablePagination } from "@/components/TablePagination";
import { usePagination } from "@/hooks/use-pagination";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_admin/employees")({
  component: EmployeesPage,
});

// ── Types ─────────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  full_name: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  email: string | null;
  department: string;
  employee_code: string | null;
  position: string | null;
  company: string | null;
  vl_credits: number | null;
  vl_remaining: number | null;
  sl_credits: number | null;
  sl_remaining: number | null;
  el_credits: number | null;
  el_remaining: number | null;
  bday_credits: number | null;
  bday_remaining: number | null;
  ml_credits: number | null;
  ml_remaining: number | null;
  pl_credits: number | null;
  pl_remaining: number | null;
  bl_credits: number | null;
  bl_remaining: number | null;
  exclude_from_attendance: boolean;
  roles: ("employee" | "hr" | "admin")[];
  vl_used: number;
  sl_used: number;
};

type ImportRow = {
  email: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  employee_code: string;
  company: string;
  department: string;
  position: string;
  vl_credits: string;
  sl_credits: string;
  el_credits: string;
  bday_credits: string;
  ml_credits: string;
  pl_credits: string;
  bl_credits: string;
};

type ImportResult = {
  email: string;
  full_name: string;
  success: boolean;
  temp_password?: string;
  error?: string;
};

type LeaveTypeMeta = {
  key: "vl" | "sl" | "el" | "bday" | "ml" | "pl" | "bl";
  label: string;
  totalCol: keyof Row;
  remainingCol: keyof Row;
};

const LEAVE_TYPES: LeaveTypeMeta[] = [
  { key: "vl", label: "Vacation", totalCol: "vl_credits", remainingCol: "vl_remaining" },
  { key: "sl", label: "Sick", totalCol: "sl_credits", remainingCol: "sl_remaining" },
  { key: "el", label: "Emergency", totalCol: "el_credits", remainingCol: "el_remaining" },
  { key: "bday", label: "Birthday", totalCol: "bday_credits", remainingCol: "bday_remaining" },
  { key: "ml", label: "Maternity", totalCol: "ml_credits", remainingCol: "ml_remaining" },
  { key: "pl", label: "Paternity", totalCol: "pl_credits", remainingCol: "pl_remaining" },
  { key: "bl", label: "Bereavement", totalCol: "bl_credits", remainingCol: "bl_remaining" },
];

function joinFullName(first: string, middle: string, last: string): string {
  return [first, middle, last]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

function initials(first?: string | null, last?: string | null, full?: string | null): string {
  if (first || last)
    return `${(first ?? "")[0] ?? ""}${(last ?? "")[0] ?? ""}`.toUpperCase() || "—";
  if (!full) return "—";
  return (
    full
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") || "—"
  );
}

function middleInitial(middle?: string | null): string {
  const m = (middle ?? "").trim();
  return m ? `${m[0]?.toUpperCase()}.` : "";
}

function displayName(r: Row): string {
  const first = (r.first_name ?? "").trim();
  const last = (r.last_name ?? "").trim();
  if (!first && !last) return r.full_name || "—";
  const mi = middleInitial(r.middle_name);
  return [first, mi, last].filter(Boolean).join(" ");
}

// ── CSV helpers ───────────────────────────────────────────────────────────────

const TEMPLATE_HEADERS: (keyof ImportRow)[] = [
  "email",
  "first_name",
  "middle_name",
  "last_name",
  "employee_code",
  "company",
  "department",
  "position",
  "vl_credits",
  "sl_credits",
  "el_credits",
  "bday_credits",
  "ml_credits",
  "pl_credits",
  "bl_credits",
];

const EXPORT_HEADERS = [
  "email",
  "first_name",
  "middle_name",
  "last_name",
  "employee_code",
  "company",
  "department",
  "position",
  "vl_credits",
  "vl_remaining",
  "sl_credits",
  "sl_remaining",
  "el_credits",
  "el_remaining",
  "bday_credits",
  "bday_remaining",
  "ml_credits",
  "ml_remaining",
  "pl_credits",
  "pl_remaining",
  "bl_credits",
  "bl_remaining",
  "role",
] as const;

const TEMPLATE_EXAMPLE: ImportRow = {
  email: "juan.delacruz@example.com",
  first_name: "Juan",
  middle_name: "Reyes",
  last_name: "dela Cruz",
  employee_code: "EMP-001",
  company: "Tidal Solutions",
  department: "Engineering",
  position: "Software Engineer",
  vl_credits: "10",
  sl_credits: "10",
  el_credits: "5",
  bday_credits: "1",
  ml_credits: "",
  pl_credits: "",
  bl_credits: "3",
};

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function triggerDownload(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadTemplate() {
  const rows = [
    TEMPLATE_HEADERS.map(csvEscape).join(","),
    TEMPLATE_HEADERS.map((h) => csvEscape(TEMPLATE_EXAMPLE[h])).join(","),
  ];
  triggerDownload(rows.join("\n"), "employee-import-template.csv");
}

function exportEmployees(rows: Row[]) {
  const lines = [EXPORT_HEADERS.map(csvEscape).join(",")];
  for (const r of rows) {
    const role: "employee" | "hr" | "admin" = r.roles.includes("admin")
      ? "admin"
      : r.roles.includes("hr")
        ? "hr"
        : "employee";
    const record: Record<string, unknown> = { ...r, role };
    lines.push(EXPORT_HEADERS.map((h) => csvEscape(record[h])).join(","));
  }
  const stamp = new Date().toISOString().slice(0, 10);
  triggerDownload(lines.join("\n"), `employees-${stamp}.csv`);
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(cur);
      cur = "";
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
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const cols = parseCSVLine(line);
      const get = (name: string, fallback = "") => (cols[idx(name)] ?? fallback).trim();
      return {
        email: get("email"),
        first_name: get("first_name"),
        middle_name: get("middle_name"),
        last_name: get("last_name"),
        employee_code: get("employee_code"),
        company: get("company"),
        department: get("department"),
        position: get("position"),
        vl_credits: get("vl_credits") || "10",
        sl_credits: get("sl_credits") || "10",
        el_credits: get("el_credits"),
        bday_credits: get("bday_credits"),
        ml_credits: get("ml_credits"),
        pl_credits: get("pl_credits"),
        bl_credits: get("bl_credits"),
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

// ── Edit form state ──────────────────────────────────────────────────────────

type EditForm = {
  first_name: string;
  middle_name: string;
  last_name: string;
  employee_code: string;
  company: string;
  department: string;
  position: string;
  vl_credits: string;
  vl_remaining: string;
  sl_credits: string;
  sl_remaining: string;
  el_credits: string;
  el_remaining: string;
  bday_credits: string;
  bday_remaining: string;
  ml_credits: string;
  ml_remaining: string;
  pl_credits: string;
  pl_remaining: string;
  bl_credits: string;
  bl_remaining: string;
};

function rowToForm(r: Row): EditForm {
  const v = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(x));
  return {
    first_name: r.first_name ?? "",
    middle_name: r.middle_name ?? "",
    last_name: r.last_name ?? "",
    employee_code: r.employee_code ?? "",
    company: r.company ?? "",
    department: r.department ?? "",
    position: r.position ?? "",
    vl_credits: v(r.vl_credits),
    vl_remaining: v(r.vl_remaining),
    sl_credits: v(r.sl_credits),
    sl_remaining: v(r.sl_remaining),
    el_credits: v(r.el_credits),
    el_remaining: v(r.el_remaining),
    bday_credits: v(r.bday_credits),
    bday_remaining: v(r.bday_remaining),
    ml_credits: v(r.ml_credits),
    ml_remaining: v(r.ml_remaining),
    pl_credits: v(r.pl_credits),
    pl_remaining: v(r.pl_remaining),
    bl_credits: v(r.bl_credits),
    bl_remaining: v(r.bl_remaining),
  };
}

function diffPatches(orig: Row, form: EditForm): Record<string, string | number | null> {
  const patches: Record<string, string | number | null> = {};
  const setText = (k: keyof EditForm, prev: string | null) => {
    const next = form[k].trim();
    if (next !== (prev ?? "")) patches[k] = next;
  };
  const setNum = (k: keyof EditForm, prev: number | null) => {
    const raw = form[k].trim();
    const next = raw === "" ? null : Number(raw);
    if (next !== prev) patches[k] = next as number | null as string | number;
  };

  setText("first_name", orig.first_name);
  setText("middle_name", orig.middle_name);
  setText("last_name", orig.last_name);
  setText("employee_code", orig.employee_code);
  setText("company", orig.company);
  setText("department", orig.department);
  setText("position", orig.position);

  setNum("vl_credits", orig.vl_credits);
  setNum("vl_remaining", orig.vl_remaining);
  setNum("sl_credits", orig.sl_credits);
  setNum("sl_remaining", orig.sl_remaining);
  setNum("el_credits", orig.el_credits);
  setNum("el_remaining", orig.el_remaining);
  setNum("bday_credits", orig.bday_credits);
  setNum("bday_remaining", orig.bday_remaining);
  setNum("ml_credits", orig.ml_credits);
  setNum("ml_remaining", orig.ml_remaining);
  setNum("pl_credits", orig.pl_credits);
  setNum("pl_remaining", orig.pl_remaining);
  setNum("bl_credits", orig.bl_credits);
  setNum("bl_remaining", orig.bl_remaining);

  // If any name part changed, re-derive full_name from the new values
  if ("first_name" in patches || "middle_name" in patches || "last_name" in patches) {
    patches.full_name = joinFullName(form.first_name, form.middle_name, form.last_name);
  }

  return patches;
}

// ── Page ──────────────────────────────────────────────────────────────────────

function EmployeesPage() {
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");

  // Edit modal state
  const [editingRow, setEditingRow] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete confirm dialog state
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);

  // Import dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "preview" | "results">("upload");
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [importing, setImporting] = useState(false);

  // ── Queries & mutations ────────────────────────────────────────────────────

  const { data } = useQuery({
    queryKey: ["employees"],
    queryFn: () => fetchAllEmployees() as Promise<Row[]>,
  });

  const saveEdit = useMutation({
    mutationFn: async ({
      row,
      patches,
    }: {
      row: Row;
      patches: Record<string, string | number | null>;
    }) => {
      if (Object.keys(patches).length === 0) return;
      // updateEmployeeProfile expects string | number values; null is acceptable for nullable columns
      await updateEmployeeProfile({
        data: { id: row.id, patches: patches as Record<string, string | number> },
      });
    },
    onSuccess: () => {
      toast.success("Employee saved");
      qc.invalidateQueries({ queryKey: ["employees"] });
      setEditingRow(null);
      setEditForm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeEmployee = useMutation({
    mutationFn: async (id: string) => {
      await deleteEmployee({ data: { id } });
    },
    onSuccess: () => {
      toast.success("Employee deleted");
      qc.invalidateQueries({ queryKey: ["employees"] });
      setDeleteTarget(null);
    },
    onError: (e: Error) => {
      if (e.message === "CANNOT_DELETE_SELF") toast.error("You can't delete your own account");
      else toast.error(e.message);
    },
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: "employee" | "hr" | "admin" }) => {
      const roles =
        role === "admin"
          ? [
              { user_id: userId, role: "admin" },
              { user_id: userId, role: "hr" },
              { user_id: userId, role: "employee" },
            ]
          : role === "hr"
            ? [
                { user_id: userId, role: "hr" },
                { user_id: userId, role: "employee" },
              ]
            : [{ user_id: userId, role: "employee" }];
      await setEmployeeRole({ data: { userId, roles } });
    },
    onSuccess: () => {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setTracking = useMutation({
    mutationFn: async ({ id, excluded }: { id: string; excluded: boolean }) => {
      await setAttendanceTracking({ data: { id, excluded } });
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.excluded ? "Attendance tracking off" : "Attendance tracking on");
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Keep editForm in sync if the underlying row refetches while editing
  useEffect(() => {
    if (!editingRow) return;
    const fresh = (data ?? []).find((r) => r.id === editingRow.id);
    if (fresh && !editForm) setEditForm(rowToForm(fresh));
  }, [editingRow, data, editForm]);

  function openEdit(row: Row) {
    setEditingRow(row);
    setEditForm(rowToForm(row));
  }

  function closeEdit() {
    setEditingRow(null);
    setEditForm(null);
  }

  function handleSaveEdit() {
    if (!editingRow || !editForm) return;
    const patches = diffPatches(editingRow, editForm);
    if (Object.keys(patches).length === 0) {
      toast.info("No changes");
      return;
    }
    setSavingEdit(true);
    saveEdit.mutate({ row: editingRow, patches }, { onSettled: () => setSavingEdit(false) });
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
    e.target.value = "";
  }

  async function handleImport() {
    setImporting(true);
    try {
      const results = await bulkCreateEmployees({ data: { employees: importRows } });
      setImportResults(results);
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

  // ── Filter ─────────────────────────────────────────────────────────────────

  const filtered = useMemo(
    () =>
      (data ?? []).filter((r) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          r.full_name.toLowerCase().includes(q) ||
          (r.email ?? "").toLowerCase().includes(q) ||
          (r.company ?? "").toLowerCase().includes(q) ||
          (r.department ?? "").toLowerCase().includes(q) ||
          (r.employee_code ?? "").toLowerCase().includes(q)
        );
      }),
    [data, search],
  );

  const pg = usePagination(filtered, 25);

  const successCount = importResults.filter((r) => r.success).length;
  const failCount = importResults.filter((r) => !r.success).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">People</p>
          <h1 className="mt-1 font-display text-4xl">Employees</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="mr-2 h-4 w-4" /> Download Template
          </Button>
          <Button
            variant="outline"
            onClick={() => exportEmployees(filtered)}
            disabled={filtered.length === 0}
          >
            <FileDown className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button
            onClick={() => {
              resetImport();
              setImportOpen(true);
            }}
          >
            <Users className="mr-2 h-4 w-4" /> Import Employees
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle>
            {filtered.length} {filtered.length === 1 ? "person" : "people"}
          </CardTitle>
          <Input
            className="max-w-xs"
            placeholder="Search name, email, code, department…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-left font-medium">Code</th>
                  <th className="px-4 py-3 text-left font-medium">Department</th>
                  <th className="px-4 py-3 text-left font-medium">Position</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-center font-medium">Tracked</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map((r) => {
                  const role: "employee" | "hr" | "admin" = r.roles.includes("admin")
                    ? "admin"
                    : r.roles.includes("hr")
                      ? "hr"
                      : "employee";
                  return (
                    <tr key={r.id} className="border-t hover:bg-secondary/30">
                      <td className="px-4 py-3 min-w-[220px]">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {initials(r.first_name, r.last_name, r.full_name)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate">{displayName(r)}</div>
                            {r.company && (
                              <div className="text-[11px] text-muted-foreground truncate">
                                {r.company}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <div className="truncate max-w-[260px]" title={r.email ?? ""}>
                          {r.email ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono bg-secondary/60 px-1.5 py-0.5 rounded">
                          {r.employee_code ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">{r.department}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.position ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Select
                          value={role}
                          disabled={!isAdmin}
                          onValueChange={(v) =>
                            setRole.mutate({ userId: r.id, role: v as "employee" | "hr" | "admin" })
                          }
                        >
                          <SelectTrigger className="w-28 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="employee">Employee</SelectItem>
                            <SelectItem value="hr">HR</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-3">
                        <div
                          className="flex items-center justify-center"
                          title={
                            r.exclude_from_attendance
                              ? "Attendance tracking off — excluded from absence monitoring"
                              : "Attendance tracking on"
                          }
                        >
                          <Switch
                            checked={!r.exclude_from_attendance}
                            disabled={setTracking.isPending}
                            onCheckedChange={(checked) =>
                              setTracking.mutate({ id: r.id, excluded: !checked })
                            }
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                          </Button>
                          {isAdmin && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive/10"
                              onClick={() => setDeleteTarget(r)}
                              disabled={r.id === user?.id}
                              title={
                                r.id === user?.id
                                  ? "You can't delete your own account"
                                  : "Delete employee"
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              {search
                ? "No employees match your search."
                : "No employees yet. Use Import Employees to add them."}
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

      {!isAdmin && <p className="text-xs text-muted-foreground">Only admins can change roles.</p>}

      {/* ── Edit Employee Dialog ─────────────────────────────────────────── */}
      <Dialog
        open={!!editingRow}
        onOpenChange={(o) => {
          if (!o) closeEdit();
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {editingRow ? displayName(editingRow) : "Edit Employee"}
            </DialogTitle>
          </DialogHeader>

          {editingRow && editForm && (
            <div className="space-y-5 py-2">
              <section>
                <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Identity
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">First name</Label>
                    <Input
                      value={editForm.first_name}
                      onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Middle name</Label>
                    <Input
                      placeholder="optional"
                      value={editForm.middle_name}
                      onChange={(e) => setEditForm({ ...editForm, middle_name: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Last name</Label>
                    <Input
                      value={editForm.last_name}
                      onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                    />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Email</Label>
                    <div className="mt-1 text-sm py-2">{editingRow.email ?? "—"}</div>
                  </div>
                  <div>
                    <Label className="text-xs">Employee code</Label>
                    <Input
                      className="font-mono"
                      placeholder="—"
                      value={editForm.employee_code}
                      onChange={(e) => setEditForm({ ...editForm, employee_code: e.target.value })}
                    />
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Employment
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Company</Label>
                    <Input
                      value={editForm.company}
                      onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Department</Label>
                    <Input
                      value={editForm.department}
                      onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <Label className="text-xs">Position</Label>
                  <Input
                    value={editForm.position}
                    onChange={(e) => setEditForm({ ...editForm, position: e.target.value })}
                  />
                </div>
              </section>

              <section>
                <h3 className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                  Leave credits
                </h3>
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/40 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium w-1/2">Type</th>
                        <th className="px-3 py-2 text-right font-medium">Total</th>
                        <th className="px-3 py-2 text-right font-medium">Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {LEAVE_TYPES.map((lt) => {
                        const totalKey = `${lt.key}_credits` as keyof EditForm;
                        const remainingKey = `${lt.key}_remaining` as keyof EditForm;
                        return (
                          <tr key={lt.key} className="border-t">
                            <td className="px-3 py-2 font-medium">{lt.label}</td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                min={0}
                                max={365}
                                placeholder="—"
                                className="w-20 rounded border bg-background px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                                value={editForm[totalKey]}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, [totalKey]: e.target.value })
                                }
                              />
                            </td>
                            <td className="px-3 py-2 text-right">
                              <input
                                type="number"
                                min={-100}
                                max={365}
                                placeholder="—"
                                className="w-20 rounded border bg-background px-2 py-1 text-right text-sm font-medium text-accent focus:outline-none focus:ring-1 focus:ring-ring"
                                value={editForm[remainingKey]}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, [remainingKey]: e.target.value })
                                }
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Leave blank to keep a type unset. Negative remaining values are allowed for
                  adjustments.
                </p>
              </section>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeEdit}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Dialog ───────────────────────────────────────── */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Delete employee?</DialogTitle>
          </DialogHeader>

          {deleteTarget && (
            <div className="space-y-3 py-2">
              <p className="text-sm">
                This permanently removes <strong>{displayName(deleteTarget)}</strong> and all linked
                records: profile, role assignments, leave history, attendance, performance
                evaluations. This cannot be undone.
              </p>
              <div className="rounded-md border bg-secondary/30 p-3 text-xs text-muted-foreground">
                Email: <span className="text-foreground">{deleteTarget.email ?? "—"}</span>
                <br />
                Code:{" "}
                <span className="font-mono text-foreground">
                  {deleteTarget.employee_code ?? "—"}
                </span>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={removeEmployee.isPending}
              onClick={() => deleteTarget && removeEmployee.mutate(deleteTarget.id)}
            >
              {removeEmployee.isPending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Import Dialog ───────────────────────────────────────────────── */}
      <Dialog
        open={importOpen}
        onOpenChange={(o) => {
          if (!o) resetImport();
          setImportOpen(o);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Import Employees</DialogTitle>
          </DialogHeader>

          {importStep === "upload" && (
            <div className="space-y-5 py-2">
              <p className="text-sm text-muted-foreground">
                Use the <strong>Download Template</strong> button to get the CSV, fill it in, then
                upload it below. Accounts will be created with temporary passwords you can
                distribute to each employee.
              </p>

              <div className="rounded-lg border border-dashed p-8 flex flex-col items-center gap-3 text-center">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Upload your filled CSV</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Columns: email, first_name, middle_name, last_name, employee_code, company,
                    department, position, vl_credits, sl_credits, el_credits, bday_credits,
                    ml_credits, pl_credits, bl_credits
                  </p>
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
                <span className="font-medium text-foreground">Required:</span> email, first_name,
                last_name &nbsp;·&nbsp;
                <span className="font-medium text-foreground">Optional:</span> all other columns
                (vl_credits &amp; sl_credits default to 10; others default to unset)
              </div>
            </div>
          )}

          {importStep === "preview" && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                {importRows.length} row{importRows.length !== 1 ? "s" : ""} parsed. Review before
                creating accounts.
              </p>
              <div className="max-h-80 overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-secondary/80 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">First</th>
                      <th className="px-3 py-2 text-left">Middle</th>
                      <th className="px-3 py-2 text-left">Last</th>
                      <th className="px-3 py-2 text-left">Department</th>
                      <th className="px-3 py-2 text-left">Position</th>
                      <th
                        className="px-3 py-2 text-right"
                        title="Vacation / Sick / Emergency / Birthday / Maternity / Paternity / Bereavement"
                      >
                        Credits (VL/SL/EL/BDAY/ML/PL/BL)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1.5 font-medium">
                          {row.email || <span className="text-destructive">missing</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {row.first_name || <span className="text-destructive">missing</span>}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {row.middle_name || "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {row.last_name || <span className="text-destructive">missing</span>}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {row.department || "—"}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{row.position || "—"}</td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground font-mono">
                          {[
                            row.vl_credits,
                            row.sl_credits,
                            row.el_credits,
                            row.bday_credits,
                            row.ml_credits,
                            row.pl_credits,
                            row.bl_credits,
                          ]
                            .map((c) => c || "—")
                            .join(" / ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground">
                A secure temporary password will be generated for each employee. Share it with them
                securely — they can change it after signing in.
              </p>
            </div>
          )}

          {importStep === "results" && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-4 text-sm">
                {successCount > 0 && (
                  <span className="flex items-center gap-1.5 text-success font-medium">
                    <Check className="h-4 w-4" /> {successCount} account
                    {successCount !== 1 ? "s" : ""} created
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
                            <span className="rounded bg-secondary px-1.5 py-0.5">
                              {r.temp_password}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.success ? (
                            <span className="text-success">Created</span>
                          ) : (
                            <span className="text-destructive" title={r.error}>
                              Failed: {r.error}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {successCount > 0 && (
                <div className="rounded-md bg-warning/10 border border-warning/30 px-4 py-3 text-xs text-warning-foreground">
                  <strong>Important:</strong> Copy and securely distribute the temporary passwords
                  above. They will not be shown again.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            {importStep === "upload" && (
              <Button variant="outline" onClick={() => setImportOpen(false)}>
                Cancel
              </Button>
            )}
            {importStep === "preview" && (
              <>
                <Button variant="outline" onClick={() => setImportStep("upload")}>
                  Back
                </Button>
                <Button onClick={handleImport} disabled={importing || importRows.length === 0}>
                  {importing
                    ? "Creating accounts…"
                    : `Create ${importRows.length} Account${importRows.length !== 1 ? "s" : ""}`}
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
                <Button
                  onClick={() => {
                    resetImport();
                    setImportOpen(false);
                  }}
                >
                  Done
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
