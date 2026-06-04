// Overall Performance Rating Matrix
// Rows = KPI score (rounded 1–5), Columns = Behavioral score (rounded 1–5)
// Source: PM_PPE_KPI_Sheet.pdf

export const RATINGS = [
  "Outstanding",
  "Exceeds Expectations",
  "Meets Expectations",
  "Partially Meets",
  "Below Expectations",
] as const;
export type OverallRating = typeof RATINGS[number];

// kpi-behavioral key (rounded 1–5)
const MATRIX: Record<string, OverallRating> = {
  "5-1": "Partially Meets",
  "5-2": "Partially Meets",
  "5-3": "Meets Expectations",
  "5-4": "Outstanding",
  "5-5": "Outstanding",

  "4-1": "Partially Meets",
  "4-2": "Partially Meets",
  "4-3": "Meets Expectations",
  "4-4": "Exceeds Expectations",
  "4-5": "Exceeds Expectations",

  "3-1": "Partially Meets",
  "3-2": "Partially Meets",
  "3-3": "Meets Expectations",
  "3-4": "Meets Expectations",
  "3-5": "Meets Expectations",

  "2-1": "Below Expectations",
  "2-2": "Below Expectations",
  "2-3": "Partially Meets",
  "2-4": "Partially Meets",
  "2-5": "Partially Meets",

  "1-1": "Below Expectations",
  "1-2": "Below Expectations",
  "1-3": "Below Expectations",
  "1-4": "Below Expectations",
  "1-5": "Below Expectations",
};

const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

export function computeOverallRating(
  kpiScore: number | null | undefined,
  behavioralScore: number | null | undefined,
): OverallRating | null {
  if (kpiScore == null || behavioralScore == null) return null;
  const k = clamp(kpiScore);
  const b = clamp(behavioralScore);
  return MATRIX[`${k}-${b}`] ?? null;
}

export const RATING_COLORS: Record<OverallRating, { bg: string; text: string; border: string }> = {
  "Outstanding":          { bg: "bg-emerald-100 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-400", border: "border-emerald-500/40" },
  "Exceeds Expectations": { bg: "bg-green-100 dark:bg-green-950/40",     text: "text-green-700 dark:text-green-400",     border: "border-green-500/40" },
  "Meets Expectations":   { bg: "bg-blue-100 dark:bg-blue-950/40",       text: "text-blue-700 dark:text-blue-400",       border: "border-blue-500/40" },
  "Partially Meets":      { bg: "bg-yellow-100 dark:bg-yellow-950/40",   text: "text-yellow-700 dark:text-yellow-400",   border: "border-yellow-500/40" },
  "Below Expectations":   { bg: "bg-red-100 dark:bg-red-950/40",         text: "text-red-700 dark:text-red-400",         border: "border-red-500/40" },
};

export const RATING_DESCRIPTIONS: Record<OverallRating, string> = {
  "Outstanding":          "Exceptional performance on both KPIs and behavioral competencies. Role model for others.",
  "Exceeds Expectations": "Surpassed most KPI targets and consistently demonstrated behavioral competencies.",
  "Meets Expectations":   "Achieved all KPI targets and demonstrated behavioral competencies at the expected level.",
  "Partially Meets":      "Met some KPI targets or behavioral expectations but requires improvement in key areas.",
  "Below Expectations":   "Did not meet most KPI targets and/or behavioral competencies. Requires immediate improvement plan.",
};
