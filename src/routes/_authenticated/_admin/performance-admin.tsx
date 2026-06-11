import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchEvaluationPeriods, fetchEvaluationsByPeriod, fetchKpiScoresByEvalId,
  fetchBehavioralScoresByEvalId, fetchAllProfiles, fetchActiveKpiTemplates,
  fetchActiveBehavioralCompetencies, insertEvaluationPeriod, updateEvaluationPeriodStatus,
  insertEvaluationsForPeriod, insertKpiScores, insertBehavioralScores,
  updateKpiHrScore, updateBehavioralGhScore, approveEvaluation,
} from "@/lib/performance-functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Plus, Users, ClipboardList, CheckCircle2, ChevronDown, ChevronUp, ShieldAlert, Heart, Target } from "lucide-react";
import { computeOverallRating, RATING_COLORS, RATING_DESCRIPTIONS } from "@/lib/performance-rating";

export const Route = createFileRoute("/_authenticated/_admin/performance-admin")({ component: PerformanceAdminPage });

type Period = {
  id: string; title: string; period_type: string;
  start_date: string; end_date: string; status: string; created_at: string;
};

type Evaluation = {
  id: string; employee_id: string; period_id: string; status: string;
  overall_score: number | null;
  kpi_score: number | null;
  behavioral_score: number | null;
  overall_rating: string | null;
  self_assessment_submitted_at: string | null;
  approved_at: string | null;
  group_head_notes: string | null;
  employee: { full_name: string; email: string | null; department: string; position: string | null } | null;
};

type KpiScore = {
  id: string; kpi_title: string; kpi_weight: number; kpi_target: number; kpi_metric_unit: string;
  self_actual_value: number | null; self_score: number | null; self_comments: string | null;
  hr_actual_value: number | null; hr_score: number | null; hr_comments: string | null;
  final_score: number | null;
};

type BehavioralScore = {
  id: string; competency_id: string; competency_name: string; competency_indicators: string;
  employee_accomplishments: string | null; employee_rating: number | null;
  gh_rating: number | null; gh_comments: string | null;
  final_rating: number | null;
};

type Employee = { id: string; full_name: string; email: string | null; department: string; position: string | null };

const STATUS_COLORS: Record<string, string> = {
  draft: "secondary", active: "default", closed: "outline",
  pending_self_assessment: "secondary", self_assessed: "default", approved: "default",
};

function PeriodBadge({ s }: { s: string }) {
  const labels: Record<string, string> = {
    draft: "Draft", active: "Active", closed: "Closed",
    pending_self_assessment: "Pending Self-Assessment",
    self_assessed: "Awaiting Group Head",
    approved: "Approved",
  };
  return <Badge variant={(STATUS_COLORS[s] ?? "secondary") as "default" | "secondary" | "outline" | "destructive"}>{labels[s] ?? s}</Badge>;
}

function ScoreStars({ score, onChange }: { score: number | null; onChange?: (v: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange}
          onClick={() => onChange?.(n)}
          className={`text-lg transition-colors ${n <= (score ?? 0) ? "text-yellow-400" : "text-muted-foreground/30"} ${onChange ? "hover:text-yellow-300 cursor-pointer" : "cursor-default"}`}>
          ★
        </button>
      ))}
      {score != null && <span className="ml-1 text-sm text-muted-foreground">{Number(score).toFixed(1)}/5</span>}
    </div>
  );
}

function PerformanceAdminPage() {
  const { user, isHR, loading, rolesLoading } = useAuth();
  const qc = useQueryClient();
  const [showPeriodForm, setShowPeriodForm] = useState(false);
  const [activePeriod, setActivePeriod] = useState<Period | null>(null);
  const [reviewingEval, setReviewingEval] = useState<Evaluation | null>(null);
  const [kpiPatches, setKpiPatches] = useState<Record<string, { hr_score: number | null; hr_actual_value: number | null; hr_comments: string }>>({});
  const [behavioralPatches, setBehavioralPatches] = useState<Record<string, { gh_rating: number | null; gh_comments: string }>>({});
  const [groupHeadNotes, setGroupHeadNotes] = useState("");
  const [expandedEvals, setExpandedEvals] = useState<Set<string>>(new Set());
  const [ratingFilter, setRatingFilter] = useState<string | null>(null);

  const [periodForm, setPeriodForm] = useState({
    title: "", period_type: "quarterly", start_date: "", end_date: "",
  });

  const { data: periods = [] } = useQuery({
    queryKey: ["eval-periods"],
    enabled: isHR,
    queryFn: () => fetchEvaluationPeriods() as Promise<Period[]>,
  });

  const { data: evaluations = [] } = useQuery({
    queryKey: ["evaluations", activePeriod?.id],
    enabled: !!activePeriod && isHR,
    queryFn: () => fetchEvaluationsByPeriod({ data: { periodId: activePeriod!.id } }) as Promise<Evaluation[]>,
  });

  const { data: evalScores } = useQuery({
    queryKey: ["eval-scores", reviewingEval?.id],
    enabled: !!reviewingEval,
    queryFn: () => fetchKpiScoresByEvalId({ data: { evaluationId: reviewingEval!.id } }) as Promise<KpiScore[]>,
  });

  const { data: behavioralScores } = useQuery({
    queryKey: ["eval-behavioral", reviewingEval?.id],
    enabled: !!reviewingEval,
    queryFn: () => fetchBehavioralScoresByEvalId({ data: { evaluationId: reviewingEval!.id } }) as Promise<BehavioralScore[]>,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["all-employees"],
    enabled: isHR,
    queryFn: () => fetchAllProfiles() as Promise<Employee[]>,
  });

  const { data: kpiTemplates = [] } = useQuery({
    queryKey: ["kpi-templates"],
    enabled: isHR,
    queryFn: () => fetchActiveKpiTemplates(),
  });

  const { data: competencies = [] } = useQuery({
    queryKey: ["behavioral-competencies"],
    enabled: isHR,
    queryFn: () => fetchActiveBehavioralCompetencies(),
  });

  const createPeriod = useMutation({
    mutationFn: async () => {
      await insertEvaluationPeriod({ data: { ...periodForm, created_by: user!.id, status: "draft" } });
    },
    onSuccess: () => {
      toast.success("Period created");
      qc.invalidateQueries({ queryKey: ["eval-periods"] });
      setShowPeriodForm(false);
      setPeriodForm({ title: "", period_type: "quarterly", start_date: "", end_date: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePeriodStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await updateEvaluationPeriodStatus({ data: { id, status } });
    },
    onSuccess: () => {
      toast.success("Period updated");
      qc.invalidateQueries({ queryKey: ["eval-periods"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateEvaluations = useMutation({
    mutationFn: async (periodId: string) => {
      const existing = new Set(evaluations.map((e) => e.employee_id));
      const toCreate = employees.filter((emp) => !existing.has(emp.id));
      if (toCreate.length === 0) { toast.info("All employees already have evaluations"); return; }

      const inserted = await insertEvaluationsForPeriod({ data: {
        evaluations: toCreate.map((emp) => ({ employee_id: emp.id, period_id: periodId, status: "pending_self_assessment" })),
      }});

      type KpiTpl = { id: string; title: string; weight: number; target_value: number; metric_unit: string; team: string; designation: string | null };
      type CompTpl = { id: string; name: string; behavioral_indicators: string };

      const kpiPayloads: Record<string, unknown>[] = [];
      for (const row of inserted) {
        const emp = toCreate.find((e) => e.id === row.employee_id);
        if (!emp) continue;
        for (const k of (kpiTemplates as KpiTpl[]).filter((k) => k.team === emp.department && (k.designation === null || k.designation === emp.position))) {
          kpiPayloads.push({ evaluation_id: row.id, kpi_template_id: k.id, kpi_title: k.title, kpi_weight: k.weight, kpi_target: k.target_value, kpi_metric_unit: k.metric_unit });
        }
      }
      if (kpiPayloads.length > 0) await insertKpiScores({ data: { scores: kpiPayloads } });

      if ((competencies as CompTpl[]).length > 0) {
        const bPayloads: Record<string, unknown>[] = [];
        for (const row of inserted) {
          for (const c of competencies as CompTpl[]) {
            bPayloads.push({ evaluation_id: row.id, competency_id: c.id, competency_name: c.name, competency_indicators: c.behavioral_indicators });
          }
        }
        await insertBehavioralScores({ data: { scores: bPayloads } });
      }
    },
    onSuccess: () => {
      toast.success("Evaluations generated");
      qc.invalidateQueries({ queryKey: ["evaluations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openReview = (ev: Evaluation) => {
    setReviewingEval(ev);
    setGroupHeadNotes(ev.group_head_notes ?? "");
    setKpiPatches({});
    setBehavioralPatches({});
  };

  // Live preview of overall rating during the review dialog
  const livePreview = (() => {
    if (!evalScores || !behavioralScores) return null;
    // KPI weighted average using GH score (or self if not yet set)
    const finalKpis = evalScores.map((s) => {
      const patch = kpiPatches[s.id];
      const sc = patch?.hr_score ?? s.hr_score ?? s.self_score;
      return { score: sc, weight: s.kpi_weight };
    }).filter((s) => s.score != null);
    const totalWeight = finalKpis.reduce((sum, s) => sum + s.weight, 0);
    const kpiAvg = totalWeight > 0
      ? finalKpis.reduce((sum, s) => sum + (s.score! * s.weight), 0) / totalWeight
      : null;

    // Behavioral average — per competency, final = (employee + gh) / 2 if both, else whichever exists
    const finalBeh = behavioralScores.map((b) => {
      const patch = behavioralPatches[b.id];
      const gh = patch?.gh_rating ?? b.gh_rating;
      const emp = b.employee_rating;
      if (gh != null && emp != null) return (gh + emp) / 2;
      return gh ?? emp;
    }).filter((v): v is number => v != null);
    const behAvg = finalBeh.length > 0
      ? finalBeh.reduce((s, v) => s + v, 0) / finalBeh.length
      : null;

    return {
      kpi: kpiAvg,
      behavioral: behAvg,
      overall: computeOverallRating(kpiAvg, behAvg),
    };
  })();

  const reviewAndApprove = useMutation({
    mutationFn: async () => {
      if (!reviewingEval || !evalScores || !behavioralScores) return;

      for (const score of evalScores) {
        const patch = kpiPatches[score.id];
        const ghScore = patch?.hr_score ?? score.hr_score;
        await updateKpiHrScore({ data: {
          id: score.id,
          hrScore: ghScore,
          hrActualValue: patch?.hr_actual_value ?? score.hr_actual_value,
          hrComments: patch?.hr_comments ?? score.hr_comments,
          finalScore: ghScore ?? score.self_score,
        }});
      }

      for (const beh of behavioralScores) {
        const patch = behavioralPatches[beh.id];
        const gh = patch?.gh_rating ?? beh.gh_rating;
        const emp = beh.employee_rating;
        const finalRating = gh != null && emp != null ? (gh + emp) / 2 : gh ?? emp;
        await updateBehavioralGhScore({ data: {
          id: beh.id,
          ghRating: gh,
          ghComments: patch?.gh_comments ?? beh.gh_comments,
          finalRating,
        }});
      }

      const kpiScore = livePreview?.kpi ?? null;
      const behavioralScore = livePreview?.behavioral ?? null;
      const overallRating = computeOverallRating(kpiScore, behavioralScore);
      await approveEvaluation({ data: {
        id: reviewingEval.id,
        approvedAt: new Date().toISOString(),
        groupHeadNotes: groupHeadNotes,
        kpiScore,
        behavioralScore,
        overallScore: kpiScore,
        overallRating,
      }});
    },
    onSuccess: () => {
      toast.success("Evaluation reviewed and approved");
      qc.invalidateQueries({ queryKey: ["evaluations"] });
      qc.invalidateQueries({ queryKey: ["eval-scores"] });
      qc.invalidateQueries({ queryKey: ["eval-behavioral"] });
      setReviewingEval(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleExpand = (id: string) => {
    setExpandedEvals((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  useEffect(() => setRatingFilter(null), [activePeriod?.id]);

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
            Only Liv Olarte (Information Technology Group Head) can access performance reviews.
          </p>
          <Navigate to="/dashboard" />
        </CardContent>
      </Card>
    );
  }

  // Count by overall_rating (non-null)
  const ratingCounts = evaluations.reduce<Record<string, number>>((acc, e) => {
    if (e.overall_rating) {
      acc[e.overall_rating] = (acc[e.overall_rating] ?? 0) + 1;
    }
    return acc;
  }, {});

  // Count by key statuses
  const statusCounts = {
    self_assessed: evaluations.filter((e) => e.status === "self_assessed").length,
    approved: evaluations.filter((e) => e.status === "approved").length,
    pending_self_assessment: evaluations.filter((e) => e.status === "pending_self_assessment").length,
  };

  // Filtered list
  const filteredEvaluations = ratingFilter
    ? evaluations.filter((e) =>
        e.overall_rating === ratingFilter ||
        e.status === ratingFilter
      )
    : evaluations;

  const evalsByStatus = {
    pending: filteredEvaluations.filter((e) => e.status === "pending_self_assessment"),
    self_assessed: filteredEvaluations.filter((e) => e.status === "self_assessed"),
    approved: filteredEvaluations.filter((e) => e.status === "approved"),
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Group Head Tools</p>
          <h1 className="mt-1 font-display text-4xl flex items-center gap-3">
            <ClipboardList className="h-8 w-8 text-accent" /> Performance Reviews
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Workflow: <strong>Employee self-assesses Part I (KPIs) + Part II (Behavioral)</strong> →{" "}
            <strong>Group Head reviews, scores, and approves</strong>. Final rating is computed from the KPI × Behavioral matrix.
          </p>
        </div>
        <Button onClick={() => setShowPeriodForm(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> New Period
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {periods.map((p) => (
          <Card key={p.id}
            className={`cursor-pointer transition-all hover:border-primary/50 ${activePeriod?.id === p.id ? "border-primary ring-1 ring-primary" : ""}`}
            onClick={() => setActivePeriod(activePeriod?.id === p.id ? null : p)}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <CardTitle className="text-base">{p.title}</CardTitle>
                <PeriodBadge s={p.status} />
              </div>
              <p className="text-xs text-muted-foreground capitalize">{p.period_type.replace("_", " ")}</p>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {new Date(p.start_date).toLocaleDateString()} – {new Date(p.end_date).toLocaleDateString()}
              </p>
              <div className="mt-3 flex gap-2">
                {p.status === "draft" && (
                  <Button size="sm" onClick={(e) => { e.stopPropagation(); updatePeriodStatus.mutate({ id: p.id, status: "active" }); }}>
                    Activate
                  </Button>
                )}
                {p.status === "active" && (
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); updatePeriodStatus.mutate({ id: p.id, status: "closed" }); }}>
                    Close
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {periods.length === 0 && (
          <p className="col-span-full text-sm text-muted-foreground">No evaluation periods yet. Create one to get started.</p>
        )}
      </div>

      {activePeriod && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="font-display text-xl">{activePeriod.title}</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">{evaluations.length} evaluations</p>
            </div>
            {activePeriod.status === "active" && (
              <Button onClick={() => generateEvaluations.mutate(activePeriod.id)}
                disabled={generateEvaluations.isPending}>
                <Users className="mr-1.5 h-4 w-4" />
                {generateEvaluations.isPending ? "Generating…" : "Generate for All"}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-3 gap-3">
              {[
                { label: "Pending Self-Assessment", count: evalsByStatus.pending.length, color: "text-muted-foreground" },
                { label: "Awaiting Group Head", count: evalsByStatus.self_assessed.length, color: "text-yellow-600" },
                { label: "Approved", count: evalsByStatus.approved.length, color: "text-green-600" },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border bg-background/60 p-3 text-center">
                  <p className={`font-display text-2xl ${s.color}`}>{s.count}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>

            {evaluations.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {/* Rating chips */}
                {Object.entries(ratingCounts).map(([rating, count]) => (
                  <button
                    key={rating}
                    onClick={() => setRatingFilter(ratingFilter === rating ? null : rating)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      ratingFilter === rating
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border hover:bg-secondary"
                    }`}
                  >
                    {rating}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      ratingFilter === rating ? "bg-primary-foreground/20 text-primary-foreground" : "bg-secondary text-muted-foreground"
                    }`}>{count}</span>
                  </button>
                ))}

                {/* Status chips — only show if count > 0 */}
                {statusCounts.pending_self_assessment > 0 && (
                  <button
                    onClick={() => setRatingFilter(ratingFilter === "pending_self_assessment" ? null : "pending_self_assessment")}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      ratingFilter === "pending_self_assessment"
                        ? "bg-warning text-warning-foreground border-warning"
                        : "bg-warning/10 border-warning/30 text-warning-foreground hover:bg-warning/20"
                    }`}
                  >
                    Pending Self-Assessment
                    <span className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold">{statusCounts.pending_self_assessment}</span>
                  </button>
                )}
                {statusCounts.self_assessed > 0 && (
                  <button
                    onClick={() => setRatingFilter(ratingFilter === "self_assessed" ? null : "self_assessed")}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      ratingFilter === "self_assessed"
                        ? "bg-accent text-accent-foreground border-accent"
                        : "bg-accent/10 border-accent/30 text-accent hover:bg-accent/20"
                    }`}
                  >
                    Awaiting Group Head
                    <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold">{statusCounts.self_assessed}</span>
                  </button>
                )}
                {statusCounts.approved > 0 && (
                  <button
                    onClick={() => setRatingFilter(ratingFilter === "approved" ? null : "approved")}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      ratingFilter === "approved"
                        ? "bg-success text-white border-success"
                        : "bg-success/10 border-success/30 text-success hover:bg-success/20"
                    }`}
                  >
                    Approved
                    <span className="rounded-full bg-success/20 px-1.5 py-0.5 text-[10px] font-bold">{statusCounts.approved}</span>
                  </button>
                )}

                {/* Clear filter button — only when a filter is active */}
                {ratingFilter && (
                  <button
                    onClick={() => setRatingFilter(null)}
                    className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-secondary"
                  >
                    Clear filter ×
                  </button>
                )}
              </div>
            )}

            <Tabs defaultValue="self_assessed">
              <TabsList>
                <TabsTrigger value="pending">Pending Self-Assess ({evalsByStatus.pending.length})</TabsTrigger>
                <TabsTrigger value="self_assessed">Awaiting Your Review ({evalsByStatus.self_assessed.length})</TabsTrigger>
                <TabsTrigger value="approved">Approved ({evalsByStatus.approved.length})</TabsTrigger>
              </TabsList>

              {(["pending", "self_assessed", "approved"] as const).map((tab) => (
                <TabsContent key={tab} value={tab} className="mt-4">
                  {evalsByStatus[tab].length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">None in this stage.</p>
                  ) : (
                    <div className="space-y-2">
                      {evalsByStatus[tab].map((ev) => {
                        const colors = ev.overall_rating ? RATING_COLORS[ev.overall_rating as keyof typeof RATING_COLORS] : null;
                        return (
                          <div key={ev.id} className="rounded-lg border bg-card">
                            <div className="flex items-center justify-between px-4 py-3">
                              <div>
                                <p className="font-medium">{ev.employee?.full_name ?? "—"}</p>
                                <p className="text-xs text-muted-foreground">
                                  {ev.employee?.department} · {ev.employee?.position ?? "—"}
                                </p>
                              </div>
                              <div className="flex items-center gap-3">
                                {ev.overall_rating && colors && (
                                  <span className={`text-xs px-2 py-1 rounded-full border font-medium ${colors.bg} ${colors.text} ${colors.border}`}>
                                    {ev.overall_rating}
                                  </span>
                                )}
                                {ev.kpi_score != null && ev.behavioral_score != null && (
                                  <div className="text-right text-xs">
                                    <p>KPI <span className="font-semibold">{Number(ev.kpi_score).toFixed(2)}</span></p>
                                    <p>Beh <span className="font-semibold">{Number(ev.behavioral_score).toFixed(2)}</span></p>
                                  </div>
                                )}
                                <PeriodBadge s={ev.status} />
                                {tab === "self_assessed" && (
                                  <Button size="sm" onClick={() => openReview(ev)}>Review & Approve</Button>
                                )}
                                {tab === "approved" && (
                                  <Button size="sm" variant="outline" onClick={() => openReview(ev)}>View</Button>
                                )}
                                <button onClick={() => toggleExpand(ev.id)} className="text-muted-foreground hover:text-foreground">
                                  {expandedEvals.has(ev.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </button>
                              </div>
                            </div>
                            {expandedEvals.has(ev.id) && <EvalScorePreview evalId={ev.id} />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Period Create Dialog */}
      <Dialog open={showPeriodForm} onOpenChange={setShowPeriodForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Evaluation Period</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={periodForm.title}
                onChange={(e) => setPeriodForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Q2 2026 Performance Review" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={periodForm.period_type}
                onValueChange={(v) => setPeriodForm((f) => ({ ...f, period_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start Date</Label>
                <Input type="date" value={periodForm.start_date}
                  onChange={(e) => setPeriodForm((f) => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>End Date</Label>
                <Input type="date" value={periodForm.end_date}
                  onChange={(e) => setPeriodForm((f) => ({ ...f, end_date: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPeriodForm(false)}>Cancel</Button>
            <Button onClick={() => createPeriod.mutate()} disabled={createPeriod.isPending || !periodForm.title || !periodForm.start_date || !periodForm.end_date}>
              Create Period
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review & Approve Dialog */}
      <Dialog open={!!reviewingEval} onOpenChange={(o) => !o && setReviewingEval(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {reviewingEval?.status === "approved" ? "Evaluation Details" : "Review & Approve"}
              {" — "}{reviewingEval?.employee?.full_name}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              {reviewingEval?.employee?.department} · {reviewingEval?.employee?.position ?? "—"}
            </p>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Live Overall Rating Preview */}
            {livePreview && livePreview.overall && (
              <div className={`rounded-lg border-2 p-4 ${RATING_COLORS[livePreview.overall].bg} ${RATING_COLORS[livePreview.overall].border}`}>
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {reviewingEval?.status === "approved" ? "Overall Performance Rating" : "Preview — Overall Rating"}
                    </p>
                    <p className={`font-display text-2xl mt-0.5 ${RATING_COLORS[livePreview.overall].text}`}>
                      {livePreview.overall}
                    </p>
                  </div>
                  <div className="text-right text-sm space-y-0.5">
                    <p><span className="text-muted-foreground">KPI Score</span>{" "}<strong>{livePreview.kpi?.toFixed(2) ?? "—"}</strong></p>
                    <p><span className="text-muted-foreground">Behavioral</span>{" "}<strong>{livePreview.behavioral?.toFixed(2) ?? "—"}</strong></p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{RATING_DESCRIPTIONS[livePreview.overall]}</p>
              </div>
            )}

            {/* PART I: KPIs */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b pb-2">
                <Target className="h-4 w-4 text-accent" />
                <p className="text-sm font-semibold uppercase tracking-wide">Part I · Key Performance Indicators</p>
              </div>
              {evalScores && evalScores.length > 0 ? evalScores.map((score) => {
                const patched = kpiPatches[score.id];
                const ghScore = patched?.hr_score ?? score.hr_score;
                const isEditable = reviewingEval?.status === "self_assessed";
                return (
                  <div key={score.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{score.kpi_title}</p>
                        <p className="text-xs text-muted-foreground">
                          Target: {score.kpi_target} {score.kpi_metric_unit} · Weight: {score.kpi_weight}%
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded bg-secondary/40 p-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Employee Self-Assessment</p>
                        <ScoreStars score={score.self_score} />
                        {score.self_actual_value != null && (
                          <p className="text-xs mt-1">Actual: {score.self_actual_value} {score.kpi_metric_unit}</p>
                        )}
                        {score.self_comments && <p className="text-xs text-muted-foreground mt-1 italic">"{score.self_comments}"</p>}
                      </div>
                      <div className="rounded bg-accent/10 p-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Group Head Score</p>
                        <ScoreStars score={ghScore}
                          onChange={isEditable ? (v) => setKpiPatches((prev) => ({
                            ...prev,
                            [score.id]: {
                              hr_score: v,
                              hr_actual_value: prev[score.id]?.hr_actual_value ?? null,
                              hr_comments: prev[score.id]?.hr_comments ?? "",
                            }
                          })) : undefined} />
                        {isEditable && (
                          <>
                            <Input className="mt-1 h-7 text-xs" type="number"
                              placeholder={`Actual (${score.kpi_metric_unit})`}
                              value={patched?.hr_actual_value ?? ""}
                              onChange={(e) => setKpiPatches((prev) => ({
                                ...prev,
                                [score.id]: {
                                  hr_score: prev[score.id]?.hr_score ?? null,
                                  hr_actual_value: parseFloat(e.target.value) || null,
                                  hr_comments: prev[score.id]?.hr_comments ?? "",
                                }
                              }))} />
                            <Input className="mt-1 h-7 text-xs"
                              placeholder="Comments"
                              value={patched?.hr_comments ?? ""}
                              onChange={(e) => setKpiPatches((prev) => ({
                                ...prev,
                                [score.id]: {
                                  hr_score: prev[score.id]?.hr_score ?? null,
                                  hr_actual_value: prev[score.id]?.hr_actual_value ?? null,
                                  hr_comments: e.target.value,
                                }
                              }))} />
                          </>
                        )}
                        {!isEditable && score.hr_actual_value != null && (
                          <p className="text-xs mt-1">Actual: {score.hr_actual_value} {score.kpi_metric_unit}</p>
                        )}
                        {!isEditable && score.hr_comments && (
                          <p className="text-xs text-muted-foreground mt-1 italic">"{score.hr_comments}"</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <p className="text-sm text-muted-foreground p-3 rounded border">No KPIs assigned. The employee will only be scored on behavioral competencies.</p>
              )}
            </div>

            {/* PART II: BEHAVIORAL */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b pb-2">
                <Heart className="h-4 w-4 text-pink-500" />
                <p className="text-sm font-semibold uppercase tracking-wide">Part II · Behavioral Competencies</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Rate each: 5 = Consistently · 4 = Frequently · 3 = Sometimes · 2 = Seldom · 1 = Does Not Demonstrate.
                Final per-competency rating = average of employee + Group Head.
              </p>
              {behavioralScores && behavioralScores.length > 0 ? behavioralScores.map((b) => {
                const patch = behavioralPatches[b.id];
                const ghRating = patch?.gh_rating ?? b.gh_rating;
                const isEditable = reviewingEval?.status === "self_assessed";
                const finalRating =
                  (ghRating != null && b.employee_rating != null)
                    ? (ghRating + b.employee_rating) / 2
                    : (ghRating ?? b.employee_rating);
                return (
                  <div key={b.id} className="rounded-lg border p-3 space-y-2">
                    <div>
                      <p className="font-medium text-sm">{b.competency_name}</p>
                      <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap font-sans mt-1">{b.competency_indicators}</pre>
                    </div>
                    {b.employee_accomplishments && (
                      <div className="rounded bg-secondary/30 p-2 text-xs">
                        <p className="uppercase tracking-wide text-muted-foreground mb-0.5">Accomplishments / Critical Incidents (from employee)</p>
                        <p>{b.employee_accomplishments}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded bg-secondary/40 p-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Employee Rating</p>
                        <ScoreStars score={b.employee_rating} />
                      </div>
                      <div className="rounded bg-accent/10 p-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Group Head Rating (IS)</p>
                        <ScoreStars score={ghRating}
                          onChange={isEditable ? (v) => setBehavioralPatches((prev) => ({
                            ...prev,
                            [b.id]: {
                              gh_rating: v,
                              gh_comments: prev[b.id]?.gh_comments ?? "",
                            }
                          })) : undefined} />
                        {isEditable ? (
                          <Textarea className="mt-1 text-xs" rows={2}
                            placeholder="Comments & areas for improvement"
                            value={patch?.gh_comments ?? ""}
                            onChange={(e) => setBehavioralPatches((prev) => ({
                              ...prev,
                              [b.id]: {
                                gh_rating: prev[b.id]?.gh_rating ?? null,
                                gh_comments: e.target.value,
                              }
                            }))} />
                        ) : (
                          b.gh_comments && <p className="text-xs text-muted-foreground mt-1 italic">"{b.gh_comments}"</p>
                        )}
                      </div>
                    </div>
                    {finalRating != null && (
                      <div className="rounded bg-green-50 dark:bg-green-950/20 px-2 py-1 text-xs flex justify-between">
                        <span className="text-muted-foreground">Final Rating (avg)</span>
                        <span className="font-semibold">{finalRating.toFixed(2)} / 5</span>
                      </div>
                    )}
                  </div>
                );
              }) : (
                <p className="text-sm text-muted-foreground p-3 rounded border">No behavioral competencies loaded.</p>
              )}
            </div>

            {/* Group Head Notes */}
            <div className="space-y-1.5">
              <Label>Group Head Notes {reviewingEval?.status === "self_assessed" && "(visible to the employee)"}</Label>
              {reviewingEval?.status === "self_assessed" ? (
                <Textarea value={groupHeadNotes} onChange={(e) => setGroupHeadNotes(e.target.value)}
                  rows={3} placeholder="Overall feedback for the employee…" />
              ) : (
                <div className="rounded-lg border bg-secondary/30 p-3 text-sm min-h-[60px]">
                  {reviewingEval?.group_head_notes || <span className="text-muted-foreground italic">No notes recorded.</span>}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewingEval(null)}>Close</Button>
            {reviewingEval?.status === "self_assessed" && (
              <Button onClick={() => reviewAndApprove.mutate()} disabled={reviewAndApprove.isPending}
                className="bg-green-600 hover:bg-green-700">
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                {reviewAndApprove.isPending ? "Approving…" : "Approve & Finalize"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EvalScorePreview({ evalId }: { evalId: string }) {
  const { data: scores = [] } = useQuery({
    queryKey: ["eval-scores-preview", evalId],
    queryFn: () => fetchKpiScoresByEvalId({ data: { evaluationId: evalId } }) as Promise<KpiScore[]>,
  });
  const { data: bScores = [] } = useQuery({
    queryKey: ["eval-behavioral-preview", evalId],
    queryFn: () => fetchBehavioralScoresByEvalId({ data: { evaluationId: evalId } }) as Promise<BehavioralScore[]>,
  });
  if (scores.length === 0 && bScores.length === 0) {
    return <div className="px-4 pb-3 text-xs text-muted-foreground">No scores yet.</div>;
  }
  return (
    <div className="border-t px-4 pb-3 pt-2 space-y-3">
      {scores.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Part I · KPIs</p>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left py-1">KPI</th>
                <th className="text-center">Weight</th>
                <th className="text-center">Self</th>
                <th className="text-center">GH</th>
                <th className="text-center">Final</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.id} className="border-t border-secondary/50">
                  <td className="py-1">{s.kpi_title}</td>
                  <td className="text-center">{s.kpi_weight}%</td>
                  <td className="text-center">{s.self_score ?? "—"}</td>
                  <td className="text-center">{s.hr_score ?? "—"}</td>
                  <td className="text-center font-medium">{s.final_score ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {bScores.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Part II · Behavioral</p>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="text-left py-1">Competency</th>
                <th className="text-center">Self</th>
                <th className="text-center">GH</th>
                <th className="text-center">Final</th>
              </tr>
            </thead>
            <tbody>
              {bScores.map((b) => (
                <tr key={b.id} className="border-t border-secondary/50">
                  <td className="py-1">{b.competency_name}</td>
                  <td className="text-center">{b.employee_rating ?? "—"}</td>
                  <td className="text-center">{b.gh_rating ?? "—"}</td>
                  <td className="text-center font-medium">{b.final_rating ? Number(b.final_rating).toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
