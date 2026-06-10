import { createServerFn } from "@tanstack/react-start";

export const fetchMyEvaluations = createServerFn({ method: "POST" })
  .inputValidator((data: { userId: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT pe.*,
              ep.title AS period_title, ep.period_type, ep.start_date AS period_start_date,
              ep.end_date AS period_end_date, ep.status AS period_status
       FROM performance_evaluations pe
       LEFT JOIN evaluation_periods ep ON ep.id = pe.period_id
       WHERE pe.employee_id = $1
       ORDER BY pe.created_at DESC`,
      [data.userId],
    );
    return rows.map((r) => ({
      id: r.id as string, period_id: r.period_id as string, status: r.status as string,
      overall_score: r.overall_score as number | null,
      kpi_score: r.kpi_score as number | null,
      behavioral_score: r.behavioral_score as number | null,
      overall_rating: r.overall_rating as string | null,
      self_assessment_submitted_at: r.self_assessment_submitted_at as string | null,
      approved_at: r.approved_at as string | null,
      group_head_notes: r.group_head_notes as string | null,
      period: r.period_title ? {
        title: r.period_title as string,
        period_type: r.period_type as string,
        start_date: r.period_start_date as string,
        end_date: r.period_end_date as string,
        status: r.period_status as string,
      } : null,
    }));
  });

export const fetchKpiScoresByEvalId = createServerFn({ method: "POST" })
  .inputValidator((data: { evaluationId: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT * FROM evaluation_kpi_scores WHERE evaluation_id = $1 ORDER BY kpi_title`,
      [data.evaluationId],
    );
    return rows as {
      id: string; kpi_title: string; kpi_weight: number; kpi_target: number; kpi_metric_unit: string;
      self_actual_value: number | null; self_score: number | null; self_comments: string | null;
      hr_actual_value: number | null; hr_score: number | null; hr_comments: string | null;
      final_score: number | null;
    }[];
  });

export const fetchBehavioralScoresByEvalId = createServerFn({ method: "POST" })
  .inputValidator((data: { evaluationId: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT ebs.*,
              bc.display_order
       FROM evaluation_behavioral_scores ebs
       LEFT JOIN behavioral_competencies bc ON bc.id = ebs.competency_id
       WHERE ebs.evaluation_id = $1
       ORDER BY bc.display_order ASC NULLS LAST`,
      [data.evaluationId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      competency_id: r.competency_id as string,
      competency_name: r.competency_name as string,
      competency_indicators: r.competency_indicators as string,
      employee_accomplishments: r.employee_accomplishments as string | null,
      employee_rating: r.employee_rating as number | null,
      gh_rating: r.gh_rating as number | null,
      gh_comments: r.gh_comments as string | null,
      final_rating: r.final_rating as number | null,
      competency: { display_order: r.display_order as number },
    }));
  });

export const updateKpiSelfScore = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; selfScore: number | null; selfActualValue: number | null; selfComments: string | null }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    await pool.query(
      `UPDATE evaluation_kpi_scores
       SET self_score = $1, self_actual_value = $2, self_comments = $3
       WHERE id = $4`,
      [data.selfScore, data.selfActualValue, data.selfComments, data.id],
    );
  });

export const updateBehavioralSelfScore = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; employeeRating: number | null; employeeAccomplishments: string | null }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    await pool.query(
      `UPDATE evaluation_behavioral_scores
       SET employee_rating = $1, employee_accomplishments = $2
       WHERE id = $3`,
      [data.employeeRating, data.employeeAccomplishments, data.id],
    );
  });

export const markEvaluationSelfAssessed = createServerFn({ method: "POST" })
  .inputValidator((data: { evaluationId: string; submittedAt: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    await pool.query(
      `UPDATE performance_evaluations
       SET status = 'self_assessed', self_assessment_submitted_at = $1
       WHERE id = $2`,
      [data.submittedAt, data.evaluationId],
    );
  });

// â”€â”€ Performance-admin functions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const fetchEvaluationPeriods = createServerFn({ method: "POST" })
  .handler(async () => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT * FROM evaluation_periods ORDER BY created_at DESC`,
    );
    return rows;
  });

export const fetchEvaluationsByPeriod = createServerFn({ method: "POST" })
  .inputValidator((data: { periodId: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT pe.*, p.full_name, p.email, p.department, p.position
       FROM performance_evaluations pe
       LEFT JOIN profiles p ON p.id = pe.employee_id
       WHERE pe.period_id = $1
       ORDER BY pe.created_at`,
      [data.periodId],
    );
    return rows.map((r) => ({
      ...r,
      employee: { full_name: r.full_name, email: r.email, department: r.department, position: r.position },
    }));
  });

export const fetchAllProfiles = createServerFn({ method: "POST" })
  .handler(async () => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(`SELECT * FROM profiles ORDER BY full_name`);
    return rows;
  });

export const fetchActiveKpiTemplates = createServerFn({ method: "POST" })
  .handler(async () => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT * FROM kpi_templates WHERE is_active = TRUE`,
    );
    return rows;
  });

export const fetchActiveBehavioralCompetencies = createServerFn({ method: "POST" })
  .handler(async () => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT * FROM behavioral_competencies WHERE is_active = TRUE ORDER BY display_order`,
    );
    return rows;
  });

export const insertEvaluationPeriod = createServerFn({ method: "POST" })
  .inputValidator((data: Record<string, unknown>) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const cols = Object.keys(data);
    const vals = Object.values(data);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await pool.query(
      `INSERT INTO evaluation_periods (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      vals,
    );
    return rows[0];
  });

export const updateEvaluationPeriodStatus = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; status: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    await pool.query(
      `UPDATE evaluation_periods SET status = $1 WHERE id = $2`,
      [data.status, data.id],
    );
  });

export const insertEvaluationsForPeriod = createServerFn({ method: "POST" })
  .inputValidator((data: { evaluations: { employee_id: string; period_id: string; status: string }[] }) => data)
  .handler(async ({ data }): Promise<{ id: string; employee_id: string }[]> => {
    const { pool } = await import("@/lib/db.server");
    const results: { id: string; employee_id: string }[] = [];
    for (const ev of data.evaluations) {
      const { rows } = await pool.query(
        `INSERT INTO performance_evaluations (employee_id, period_id, status) VALUES ($1, $2, $3) RETURNING id, employee_id`,
        [ev.employee_id, ev.period_id, ev.status],
      );
      if (rows[0]) results.push(rows[0] as { id: string; employee_id: string });
    }
    return results;
  });

export const insertKpiScores = createServerFn({ method: "POST" })
  .inputValidator((data: { scores: Record<string, unknown>[] }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    if (data.scores.length === 0) return;
    const cols = Object.keys(data.scores[0]);
    const placeholders = data.scores
      .map((_, i) => `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(", ")})`)
      .join(", ");
    const vals = data.scores.flatMap((s) => Object.values(s));
    await pool.query(
      `INSERT INTO evaluation_kpi_scores (${cols.join(", ")}) VALUES ${placeholders}`,
      vals,
    );
  });

export const insertBehavioralScores = createServerFn({ method: "POST" })
  .inputValidator((data: { scores: Record<string, unknown>[] }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    if (data.scores.length === 0) return;
    const cols = Object.keys(data.scores[0]);
    const placeholders = data.scores
      .map((_, i) => `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(", ")})`)
      .join(", ");
    const vals = data.scores.flatMap((s) => Object.values(s));
    await pool.query(
      `INSERT INTO evaluation_behavioral_scores (${cols.join(", ")}) VALUES ${placeholders}`,
      vals,
    );
  });

export const updateKpiHrScore = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; hrScore: number | null; hrActualValue: number | null; hrComments: string | null; finalScore: number | null }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    await pool.query(
      `UPDATE evaluation_kpi_scores
       SET hr_score = $1, hr_actual_value = $2, hr_comments = $3, final_score = $4
       WHERE id = $5`,
      [data.hrScore, data.hrActualValue, data.hrComments, data.finalScore, data.id],
    );
  });

export const updateBehavioralGhScore = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; ghRating: number | null; ghComments: string | null; finalRating: number | null }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    await pool.query(
      `UPDATE evaluation_behavioral_scores
       SET gh_rating = $1, gh_comments = $2, final_rating = $3
       WHERE id = $4`,
      [data.ghRating, data.ghComments, data.finalRating, data.id],
    );
  });

export const approveEvaluation = createServerFn({ method: "POST" })
  .inputValidator((data: {
    id: string; approvedAt: string; approvedBy: string; groupHeadNotes: string | null;
    kpiScore: number | null; behavioralScore: number | null; overallScore: number | null; overallRating: string | null;
  }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    await pool.query(
      `UPDATE performance_evaluations
       SET status = 'approved', approved_at = $1, approved_by = $2, group_head_notes = $3,
           kpi_score = $4, behavioral_score = $5, overall_score = $6, overall_rating = $7
       WHERE id = $8`,
      [data.approvedAt, data.approvedBy, data.groupHeadNotes, data.kpiScore, data.behavioralScore, data.overallScore, data.overallRating, data.id],
    );
  });
