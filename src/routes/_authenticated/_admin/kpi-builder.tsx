import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { fetchKpiTemplates, upsertKpiTemplate, deleteKpiTemplate } from "@/lib/kpi-functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Target, ShieldAlert, FileDown } from "lucide-react";
import { exportRowsToCSV } from "@/lib/csv-export";

export const Route = createFileRoute("/_authenticated/_admin/kpi-builder")({ component: KpiBuilderPage });

const TEAMS = [
  "Enterprise Applications",
  "Infrastructure & Cloud Operations",
  "Data Analytics & AI",
  "IT Service Management (ITSM)",
  "PMO & Continuous Improvement",
];

type KpiTemplate = {
  id: string;
  title: string;
  description: string | null;
  metric_unit: string;
  target_value: number;
  weight: number;
  team: string;
  designation: string | null;
  is_active: boolean;
  created_at: string;
};

const EMPTY: Omit<KpiTemplate, "id" | "created_at"> = {
  title: "", description: "", metric_unit: "%", target_value: 100,
  weight: 0, team: TEAMS[0], designation: null, is_active: true,
};

function KpiBuilderPage() {
  const { user, isHR, loading, rolesLoading } = useAuth();
  const qc = useQueryClient();
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<KpiTemplate | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);

  const { data: kpis = [], isLoading } = useQuery({
    queryKey: ["kpi-templates"],
    enabled: isHR,
    queryFn: () => fetchKpiTemplates() as Promise<KpiTemplate[]>,
  });

  const upsert = useMutation({
    mutationFn: async (payload: typeof EMPTY & { id?: string }) => {
      await upsertKpiTemplate({ data: payload });
    },
    onSuccess: () => {
      toast.success(editing ? "KPI updated" : "KPI created");
      qc.invalidateQueries({ queryKey: ["kpi-templates"] });
      closeForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await deleteKpiTemplate({ data: { id } });
    },
    onSuccess: () => {
      toast.success("KPI deleted");
      qc.invalidateQueries({ queryKey: ["kpi-templates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openCreate = () => { setEditing(null); setForm(EMPTY); setShowForm(true); };
  const openEdit = (k: KpiTemplate) => {
    setEditing(k);
    setForm({ title: k.title, description: k.description ?? "", metric_unit: k.metric_unit,
      target_value: k.target_value, weight: k.weight, team: k.team,
      designation: k.designation, is_active: k.is_active });
    setShowForm(true);
  };
  const closeForm = () => { setShowForm(false); setEditing(null); };

  const handleSubmit = () => {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    if (form.weight < 0 || form.weight > 100) { toast.error("Weight must be 0–100"); return; }
    upsert.mutate({ ...form, ...(editing ? { id: editing.id } : {}) });
  };

  const filtered = teamFilter === "all" ? kpis : kpis.filter((k) => k.team === teamFilter);

  const handleExport = () => {
    exportRowsToCSV(
      filtered,
      [
        { header: "Team", value: (k) => k.team },
        { header: "KPI", value: (k) => k.title },
        { header: "Description", value: (k) => k.description ?? "" },
        { header: "Metric", value: (k) => k.metric_unit },
        { header: "Target", value: (k) => k.target_value },
        { header: "Weight (%)", value: (k) => k.weight },
        { header: "Designation", value: (k) => k.designation ?? "All" },
        { header: "Status", value: (k) => (k.is_active ? "Active" : "Inactive") },
      ],
      "kpi-templates",
    );
  };

  // Group by team
  const grouped = TEAMS.reduce<Record<string, KpiTemplate[]>>((acc, t) => {
    acc[t] = filtered.filter((k) => k.team === t);
    return acc;
  }, {});

  const totalWeight = (team: string) =>
    kpis.filter((k) => k.team === team && k.is_active && !k.designation)
      .reduce((s, k) => s + k.weight, 0);

  if (loading || rolesLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="font-display text-2xl text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!isHR) {
    return (
      <Card className="border-destructive/20">
        <CardContent className="py-12 text-center space-y-2">
          <ShieldAlert className="h-10 w-10 text-destructive mx-auto" />
          <p className="font-medium">Restricted to the IT Group Head</p>
          <p className="text-sm text-muted-foreground">
            Only Liv Olarte (IT Group Head) can manage KPI templates.
          </p>
          <Navigate to="/dashboard" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Group Head Tools</p>
          <h1 className="mt-1 font-display text-4xl flex items-center gap-3">
            <Target className="h-8 w-8 text-accent" /> KPI Builder
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define KPIs per team and designation. Weights should sum to 100% per team.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
            <FileDown className="mr-1.5 h-4 w-4" /> Export CSV
          </Button>
          <Button onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" /> New KPI</Button>
        </div>
      </div>

      {/* Team filter */}
      <div className="flex flex-wrap gap-2">
        {["all", ...TEAMS].map((t) => (
          <button key={t}
            onClick={() => setTeamFilter(t)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              teamFilter === t ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {t === "all" ? "All teams" : t}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        TEAMS.filter((t) => teamFilter === "all" || t === teamFilter).map((team) => {
          const teamKpis = grouped[team] ?? [];
          const w = totalWeight(team);
          return (
            <Card key={team}>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="font-display text-lg">{team}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {teamKpis.length} KPI{teamKpis.length !== 1 ? "s" : ""}
                    {" · "}
                    <span className={w === 100 ? "text-green-600" : w > 100 ? "text-destructive" : "text-warning-foreground"}>
                      {w}% total weight
                    </span>
                    {w !== 100 && " (should be 100%)"}
                  </p>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {teamKpis.length === 0 ? (
                  <p className="px-6 py-4 text-sm text-muted-foreground">No KPIs yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/50 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left">KPI</th>
                        <th className="px-4 py-2 text-left">Metric</th>
                        <th className="px-4 py-2 text-right">Target</th>
                        <th className="px-4 py-2 text-right">Weight</th>
                        <th className="px-4 py-2 text-left">Designation</th>
                        <th className="px-4 py-2 text-left">Status</th>
                        <th className="px-4 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teamKpis.map((k) => (
                        <tr key={k.id} className="border-t">
                          <td className="px-4 py-2">
                            <p className="font-medium">{k.title}</p>
                            {k.description && <p className="text-xs text-muted-foreground">{k.description}</p>}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{k.metric_unit}</td>
                          <td className="px-4 py-2 text-right">{k.target_value} {k.metric_unit}</td>
                          <td className="px-4 py-2 text-right font-medium">{k.weight}%</td>
                          <td className="px-4 py-2">
                            {k.designation
                              ? <Badge variant="outline" className="text-xs">{k.designation}</Badge>
                              : <span className="text-xs text-muted-foreground">All</span>}
                          </td>
                          <td className="px-4 py-2">
                            <Badge variant={k.is_active ? "default" : "secondary"}>
                              {k.is_active ? "Active" : "Inactive"}
                            </Badge>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => openEdit(k)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost"
                                onClick={() => { if (confirm("Delete this KPI?")) remove.mutate(k.id); }}
                                className="text-destructive hover:text-destructive">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={(o) => !o && closeForm()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit KPI" : "New KPI"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Feature Delivery Rate" />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea value={form.description ?? ""} rows={2}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What does this KPI measure?" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Metric Unit</Label>
                <Input value={form.metric_unit}
                  onChange={(e) => setForm((f) => ({ ...f, metric_unit: e.target.value }))}
                  placeholder="%, hrs, count, /5" />
              </div>
              <div className="space-y-1.5">
                <Label>Target Value</Label>
                <Input type="number" value={form.target_value}
                  onChange={(e) => setForm((f) => ({ ...f, target_value: parseFloat(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Weight (0–100%)</Label>
              <Input type="number" min={0} max={100} value={form.weight}
                onChange={(e) => setForm((f) => ({ ...f, weight: parseFloat(e.target.value) || 0 }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Team</Label>
              <Select value={form.team} onValueChange={(v) => setForm((f) => ({ ...f, team: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TEAMS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Designation (leave blank = all in team)</Label>
              <Input value={form.designation ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value || null }))}
                placeholder="e.g. Team Lead, Senior Engineer" />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.is_active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
              <Label>Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={upsert.isPending}>
              {editing ? "Save changes" : "Create KPI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
