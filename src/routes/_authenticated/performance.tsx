import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchMyEvaluations, fetchKpiScoresByEvalId, fetchBehavioralScoresByEvalId,
  updateKpiSelfScore, updateBehavioralSelfScore, markEvaluationSelfAssessed,
} from "@/lib/performance-functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BarChart3, CheckCircle2, Clock, Send, Target, Heart } from "lucide-react";
import { RATING_COLORS, RATING_DESCRIPTIONS, computeOverallRating, type OverallRating } from "@/lib/performance-rating";

export const Route = createFileRoute("/_authenticated/performance")({ component: PerformancePage });

type Evaluation = {
  id: string; period_id: string; status: string;
  overall_score: number | null;
  kpi_score: number | null; behavioral_score: number | null; overall_rating: string | null;
  self_assessment_submitted_at: string | null;
  approved_at: string | null; group_head_notes: string | null;
  period: { title: string; period_type: string; start_date: string; end_date: string; status: string } | null;
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

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_self_assessment: { label: "Pending Self-Assessment", color: "secondary" },
  self_assessed:           { label: "Submitted · Awaiting Group Head", color: "default" },
  approved:                { label: "Approved", color: "default" },
};

function EvalBadge({ status }: { status: string }) {
  const { label, color } = STATUS_LABELS[status] ?? { label: status, color: "secondary" };
  return <Badge variant={color as "default" | "secondary" | "outline" | "destructive"}>{label}</Badge>;
}

function ScoreStars({ score, onChange }: { score: number | null; onChange?: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange}
          onClick={() => onChange?.(n)}
          className={`text-xl transition-colors ${n <= (score ?? 0) ? "text-yellow-400" : "text-muted-foreground/25"} ${onChange ? "hover:text-yellow-300 cursor-pointer" : "cursor-default"}`}>
          ★
        </button>
      ))}
      {score != null && <span className="ml-1.5 text-sm text-muted-foreground">{Number(score).toFixed(1)}/5</span>}
    </div>
  );
}

const RATING_FREQ: Record<number, string> = {
  5: "Consistently", 4: "Frequently", 3: "Sometimes", 2: "Seldom", 1: "Does Not Demonstrate",
};

function PerformancePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [assessingEval, setAssessingEval] = useState<Evaluation | null>(null);
  const [kpiPatches, setKpiPatches] = useState<Record<string, { self_score: number | null; self_actual_value: string; self_comments: string }>>({});
  const [behavioralPatches, setBehavioralPatches] = useState<Record<string, { employee_rating: number | null; employee_accomplishments: string }>>({});

  const { data: evaluations = [], isLoading } = useQuery({
    queryKey: ["my-evaluations", user?.id],
    enabled: !!user,
    queryFn: () => fetchMyEvaluations({ data: { userId: user!.id } }) as Promise<Evaluation[]>,
  });

  const { data: kpiScores = [] } = useQuery({
    queryKey: ["my-kpi-scores", assessingEval?.id],
    enabled: !!assessingEval,
    queryFn: () => fetchKpiScoresByEvalId({ data: { evaluationId: assessingEval!.id } }) as Promise<KpiScore[]>,
  });

  const { data: behavioralScores = [] } = useQuery({
    queryKey: ["my-behavioral-scores", assessingEval?.id],
    enabled: !!assessingEval,
    queryFn: () => fetchBehavioralScoresByEvalId({ data: { evaluationId: assessingEval!.id } }) as Promise<BehavioralScore[]>,
  });

  const openAssessment = (ev: Evaluation) => {
    setAssessingEval(ev);
    setKpiPatches({});
    setBehavioralPatches({});
  };

  const submitSelfAssessment = useMutation({
    mutationFn: async () => {
      if (!assessingEval) return;
      for (const score of kpiScores) {
        const patch = kpiPatches[score.id];
        if (patch) {
          await updateKpiSelfScore({ data: {
            id: score.id,
            selfScore: patch.self_score,
            selfActualValue: parseFloat(patch.self_actual_value) || null,
            selfComments: patch.self_comments || null,
          }});
        }
      }
      for (const beh of behavioralScores) {
        const patch = behavioralPatches[beh.id];
        if (patch) {
          await updateBehavioralSelfScore({ data: {
            id: beh.id,
            employeeRating: patch.employee_rating,
            employeeAccomplishments: patch.employee_accomplishments || null,
          }});
        }
      }
      await markEvaluationSelfAssessed({ data: {
        evaluationId: assessingEval.id,
        submittedAt: new Date().toISOString(),
      }});
    },
    onSuccess: () => {
      toast.success("Self-assessment submitted!");
      qc.invalidateQueries({ queryKey: ["my-evaluations"] });
      qc.invalidateQueries({ queryKey: ["my-kpi-scores"] });
      qc.invalidateQueries({ queryKey: ["my-behavioral-scores"] });
      setAssessingEval(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Live self-assessment preview — updates as the employee rates themselves
  const selfPreview = (() => {
    if (!assessingEval || assessingEval.status === "approved") return null;
    // Weighted KPI average (patch value takes precedence over stored value)
    let totalWeight = 0, weightedSum = 0;
    for (const s of kpiScores) {
      const score = kpiPatches[s.id]?.self_score ?? s.self_score;
      if (score != null) { weightedSum += score * s.kpi_weight; totalWeight += s.kpi_weight; }
    }
    const kpiAvg = totalWeight > 0 ? weightedSum / totalWeight : null;
    // Behavioral average
    const behRatings = behavioralScores
      .map((b) => behavioralPatches[b.id]?.employee_rating ?? b.employee_rating)
      .filter((v): v is number => v != null);
    const behAvg = behRatings.length > 0 ? behRatings.reduce((s, v) => s + v, 0) / behRatings.length : null;
    return { kpi: kpiAvg, behavioral: behAvg, overall: computeOverallRating(kpiAvg, behAvg) };
  })();

  const pending = evaluations.filter((e) => e.status === "pending_self_assessment");
  const inProgress = evaluations.filter((e) => e.status === "self_assessed");
  const completed = evaluations.filter((e) => e.status === "approved");

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">My Performance</p>
        <h1 className="mt-1 font-display text-4xl flex items-center gap-3">
          <BarChart3 className="h-8 w-8 text-accent" /> Performance Evaluations
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each review has two parts — Part I (your role KPIs) and Part II (universal behavioral competencies).
          Your overall rating is determined by the KPI × Behavioral matrix.
        </p>
      </div>

      {/* Action required */}
      {pending.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" /> Action Required
          </p>
          {pending.map((ev) => (
            <Card key={ev.id} className="border-accent/30 bg-accent/5">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">{ev.period?.title}</CardTitle>
                    <p className="text-xs text-muted-foreground capitalize mt-0.5">
                      {ev.period?.period_type.replace("_", " ")} ·{" "}
                      {new Date(ev.period?.start_date ?? "").toLocaleDateString()} –{" "}
                      {new Date(ev.period?.end_date ?? "").toLocaleDateString()}
                    </p>
                  </div>
                  <EvalBadge status={ev.status} />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Complete your self-assessment for both Part I (KPIs) and Part II (Behavioral Competencies).
                </p>
                <Button onClick={() => openAssessment(ev)}>
                  <Send className="mr-1.5 h-4 w-4" /> Start Self-Assessment
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* In progress */}
      {inProgress.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">In Progress</p>
          {inProgress.map((ev) => (
            <Card key={ev.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">{ev.period?.title}</CardTitle>
                    <p className="text-xs text-muted-foreground capitalize mt-0.5">
                      {ev.period?.period_type.replace("_", " ")}
                    </p>
                  </div>
                  <EvalBadge status={ev.status} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Self-assessment submitted {ev.self_assessment_submitted_at
                    ? new Date(ev.self_assessment_submitted_at).toLocaleDateString()
                    : ""}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Awaiting review and approval from <strong>Liv Olarte (IT Group Head)</strong>.
                </p>
                <Button size="sm" variant="outline" className="mt-3"
                  onClick={() => openAssessment(ev)}>
                  View Details
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Completed</p>
          {completed.map((ev) => {
            const colors = ev.overall_rating ? RATING_COLORS[ev.overall_rating as OverallRating] : null;
            return (
              <Card key={ev.id} className={`border-2 ${colors?.border ?? "border-green-500/20"}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle className="text-base">{ev.period?.title}</CardTitle>
                      <p className="text-xs text-muted-foreground capitalize mt-0.5">
                        {ev.period?.period_type.replace("_", " ")}
                      </p>
                    </div>
                    <EvalBadge status={ev.status} />
                  </div>
                </CardHeader>
                <CardContent>
                  {ev.overall_rating && colors && (
                    <div className={`mb-4 rounded-lg border p-4 ${colors.bg} ${colors.border}`}>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Overall Performance Rating</p>
                      <p className={`font-display text-3xl mt-1 ${colors.text}`}>{ev.overall_rating}</p>
                      <p className="text-xs text-muted-foreground mt-1">{RATING_DESCRIPTIONS[ev.overall_rating as OverallRating]}</p>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded bg-background/60 p-2 text-center">
                          <p className="text-xs uppercase text-muted-foreground">Part I · KPI Score</p>
                          <p className="font-display text-xl">{ev.kpi_score != null ? Number(ev.kpi_score).toFixed(2) : "—"}<span className="text-xs text-muted-foreground"> / 5</span></p>
                        </div>
                        <div className="rounded bg-background/60 p-2 text-center">
                          <p className="text-xs uppercase text-muted-foreground">Part II · Behavioral</p>
                          <p className="font-display text-xl">{ev.behavioral_score != null ? Number(ev.behavioral_score).toFixed(2) : "—"}<span className="text-xs text-muted-foreground"> / 5</span></p>
                        </div>
                      </div>
                    </div>
                  )}
                  {ev.group_head_notes && (
                    <div className="rounded-lg bg-accent/10 p-3 text-sm mb-3">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Group Head Remarks (Liv Olarte)</p>
                      <p className="italic">"{ev.group_head_notes}"</p>
                    </div>
                  )}
                  <Button size="sm" variant="outline" onClick={() => openAssessment(ev)}>
                    View Full Scores
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading evaluations…</p>}
      {!isLoading && evaluations.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No evaluations yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              The IT Group Head will create an evaluation period and assign your KPIs.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Self-Assessment / View Dialog */}
      <Dialog open={!!assessingEval} onOpenChange={(o) => !o && setAssessingEval(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {assessingEval?.status === "pending_self_assessment"
                ? "Self-Assessment"
                : "Evaluation Details"} — {assessingEval?.period?.title}
            </DialogTitle>
            <EvalBadge status={assessingEval?.status ?? ""} />
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Final result (if approved) */}
            {assessingEval?.status === "approved" && assessingEval.overall_rating && (() => {
              const colors = RATING_COLORS[assessingEval.overall_rating as OverallRating];
              return (
                <div className={`rounded-lg border-2 p-4 ${colors.bg} ${colors.border}`}>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Overall Performance Rating</p>
                  <p className={`font-display text-2xl mt-1 ${colors.text}`}>{assessingEval.overall_rating}</p>
                  <p className="text-xs text-muted-foreground mt-1">{RATING_DESCRIPTIONS[assessingEval.overall_rating as OverallRating]}</p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="rounded bg-background/60 p-2 text-center text-sm">
                      <p className="text-xs uppercase text-muted-foreground">KPI Score</p>
                      <p className="font-semibold text-lg">{assessingEval.kpi_score != null ? Number(assessingEval.kpi_score).toFixed(2) : "—"}</p>
                    </div>
                    <div className="rounded bg-background/60 p-2 text-center text-sm">
                      <p className="text-xs uppercase text-muted-foreground">Behavioral Score</p>
                      <p className="font-semibold text-lg">{assessingEval.behavioral_score != null ? Number(assessingEval.behavioral_score).toFixed(2) : "—"}</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Self-assessment rating preview (pending or submitted, not yet approved) */}
            {selfPreview?.overall && (
              <div className={`rounded-lg border-2 p-4 ${RATING_COLORS[selfPreview.overall].bg} ${RATING_COLORS[selfPreview.overall].border}`}>
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      {assessingEval?.status === "pending_self_assessment" ? "Preview — Overall Rating" : "Your Self-Assessment Rating"}
                    </p>
                    <p className={`font-display text-2xl mt-0.5 ${RATING_COLORS[selfPreview.overall].text}`}>
                      {selfPreview.overall}
                    </p>
                  </div>
                  <div className="text-right text-sm space-y-0.5">
                    <p><span className="text-muted-foreground">KPI Score </span><strong>{selfPreview.kpi?.toFixed(2) ?? "—"}</strong></p>
                    <p><span className="text-muted-foreground">Behavioral </span><strong>{selfPreview.behavioral?.toFixed(2) ?? "—"}</strong></p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{RATING_DESCRIPTIONS[selfPreview.overall]}</p>
                {assessingEval?.status === "pending_self_assessment" && (
                  <p className="text-[11px] text-muted-foreground/70 mt-2">
                    Based on your current ratings. The final rating is determined after Group Head review.
                  </p>
                )}
                {assessingEval?.status === "self_assessed" && (
                  <p className="text-[11px] text-muted-foreground/70 mt-2">
                    Based on your submitted self-assessment. Awaiting Group Head review.
                  </p>
                )}
              </div>
            )}

            {/* PART I: KPIs */}
            {kpiScores.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b pb-2">
                  <Target className="h-4 w-4 text-accent" />
                  <p className="text-sm font-semibold uppercase tracking-wide">Part I · Key Performance Indicators</p>
                </div>
                {assessingEval?.status === "pending_self_assessment" && (
                  <p className="text-xs text-muted-foreground">
                    Rate yourself on each KPI (1 = Poor, 5 = Outstanding).
                  </p>
                )}
                {kpiScores.map((score) => {
                  const patch = kpiPatches[score.id];
                  const isEditable = assessingEval?.status === "pending_self_assessment";
                  return (
                    <div key={score.id} className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{score.kpi_title}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Target: {score.kpi_target} {score.kpi_metric_unit} · Weight: {score.kpi_weight}%
                          </p>
                        </div>
                        <span className="text-xs font-medium text-accent">{score.kpi_weight}%</span>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                          {isEditable ? "Your Rating" : "Self Assessment"}
                        </p>
                        <ScoreStars score={patch?.self_score ?? score.self_score}
                          onChange={isEditable ? (v) => setKpiPatches((prev) => ({
                            ...prev,
                            [score.id]: {
                              self_score: v,
                              self_actual_value: prev[score.id]?.self_actual_value ?? "",
                              self_comments: prev[score.id]?.self_comments ?? "",
                            }
                          })) : undefined} />
                        {isEditable && (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs">Actual Value ({score.kpi_metric_unit})</Label>
                              <Input className="h-8 text-sm mt-1" type="number"
                                placeholder={`e.g. ${score.kpi_target}`}
                                value={patch?.self_actual_value ?? ""}
                                onChange={(e) => setKpiPatches((prev) => ({
                                  ...prev,
                                  [score.id]: { ...prev[score.id] ?? { self_score: null, self_comments: "" }, self_actual_value: e.target.value }
                                }))} />
                            </div>
                            <div>
                              <Label className="text-xs">Comments</Label>
                              <Input className="h-8 text-sm mt-1"
                                placeholder="Brief justification"
                                value={patch?.self_comments ?? ""}
                                onChange={(e) => setKpiPatches((prev) => ({
                                  ...prev,
                                  [score.id]: { ...prev[score.id] ?? { self_score: null, self_actual_value: "" }, self_comments: e.target.value }
                                }))} />
                            </div>
                          </div>
                        )}
                        {!isEditable && score.self_score && (
                          <div className="mt-2 text-sm text-muted-foreground">
                            {score.self_actual_value != null && <span>Actual: {score.self_actual_value} {score.kpi_metric_unit} · </span>}
                            {score.self_comments && <span className="italic">"{score.self_comments}"</span>}
                          </div>
                        )}
                      </div>
                      {score.hr_score != null && (
                        <div className="border-t pt-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Group Head Assessment (Liv Olarte)</p>
                          <ScoreStars score={score.hr_score} />
                          {score.hr_actual_value != null && (
                            <p className="text-xs text-muted-foreground mt-1">Actual: {score.hr_actual_value} {score.kpi_metric_unit}</p>
                          )}
                          {score.hr_comments && <p className="text-xs text-muted-foreground mt-1 italic">"{score.hr_comments}"</p>}
                        </div>
                      )}
                      {score.final_score != null && (
                        <div className="rounded bg-accent/10 px-3 py-2 text-sm flex items-center justify-between">
                          <span className="text-muted-foreground">Final Score</span>
                          <span className="font-semibold">{score.final_score} / 5</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* PART II: BEHAVIORAL */}
            {behavioralScores.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b pb-2">
                  <Heart className="h-4 w-4 text-pink-500" />
                  <p className="text-sm font-semibold uppercase tracking-wide">Part II · Behavioral Competencies</p>
                </div>
                {assessingEval?.status === "pending_self_assessment" && (
                  <p className="text-xs text-muted-foreground">
                    5 = Consistently · 4 = Frequently · 3 = Sometimes · 2 = Seldom · 1 = Does Not Demonstrate. Add accomplishments / critical incidents to support your rating.
                  </p>
                )}
                {behavioralScores.map((b) => {
                  const patch = behavioralPatches[b.id];
                  const isEditable = assessingEval?.status === "pending_self_assessment";
                  const currentRating = patch?.employee_rating ?? b.employee_rating;
                  return (
                    <div key={b.id} className="rounded-lg border p-4 space-y-3">
                      <div>
                        <p className="font-medium">{b.competency_name}</p>
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-sans mt-1">{b.competency_indicators}</pre>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                          {isEditable ? "Your Rating" : "Self Rating"}
                        </p>
                        <ScoreStars score={currentRating}
                          onChange={isEditable ? (v) => setBehavioralPatches((prev) => ({
                            ...prev,
                            [b.id]: {
                              employee_rating: v,
                              employee_accomplishments: prev[b.id]?.employee_accomplishments ?? b.employee_accomplishments ?? "",
                            }
                          })) : undefined} />
                        {currentRating != null && (
                          <p className="text-xs text-muted-foreground mt-1">{RATING_FREQ[Math.round(currentRating)] ?? ""}</p>
                        )}
                        {isEditable ? (
                          <div className="mt-2">
                            <Label className="text-xs">Accomplishments / Critical Incidents</Label>
                            <Textarea className="text-sm mt-1" rows={2}
                              placeholder="Cite examples that support your rating…"
                              value={patch?.employee_accomplishments ?? b.employee_accomplishments ?? ""}
                              onChange={(e) => setBehavioralPatches((prev) => ({
                                ...prev,
                                [b.id]: {
                                  employee_rating: prev[b.id]?.employee_rating ?? b.employee_rating,
                                  employee_accomplishments: e.target.value,
                                }
                              }))} />
                          </div>
                        ) : (
                          b.employee_accomplishments && (
                            <p className="text-xs text-muted-foreground mt-2 italic">"{b.employee_accomplishments}"</p>
                          )
                        )}
                      </div>
                      {b.gh_rating != null && (
                        <div className="border-t pt-3">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Group Head Rating (Liv Olarte)</p>
                          <ScoreStars score={b.gh_rating} />
                          {b.gh_comments && <p className="text-xs text-muted-foreground mt-1 italic">"{b.gh_comments}"</p>}
                        </div>
                      )}
                      {b.final_rating != null && (
                        <div className="rounded bg-accent/10 px-3 py-2 text-sm flex items-center justify-between">
                          <span className="text-muted-foreground">Final Rating (avg)</span>
                          <span className="font-semibold">{Number(b.final_rating).toFixed(2)} / 5</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {kpiScores.length === 0 && behavioralScores.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">
                No assessment items have been assigned yet. The IT Group Head will configure them.
              </p>
            )}

            {assessingEval?.status !== "pending_self_assessment" && assessingEval?.group_head_notes && (
              <div className="rounded-lg bg-accent/10 p-3 text-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Group Head Remarks (Liv Olarte)</p>
                <p className="italic">"{assessingEval.group_head_notes}"</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssessingEval(null)}>
              {assessingEval?.status === "pending_self_assessment" ? "Cancel" : "Close"}
            </Button>
            {assessingEval?.status === "pending_self_assessment" && (
              <Button onClick={() => submitSelfAssessment.mutate()}
                disabled={submitSelfAssessment.isPending || (kpiScores.length === 0 && behavioralScores.length === 0)}>
                <Send className="mr-1.5 h-4 w-4" />
                {submitSelfAssessment.isPending ? "Submitting…" : "Submit Self-Assessment"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
