import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, assertUser, assertHR } from "@/lib/auth-middleware";

type KpiTemplate = {
  id: string; title: string; description: string | null;
  metric_unit: string; target_value: number; weight: number;
  team: string; designation: string | null; is_active: boolean; created_at: string;
};

// Explicit allowlist of KPI template columns the admin UI may patch — prevents
// SQL identifier injection via crafted keys.
const KPI_PATCHABLE = new Set([
  "title", "description", "metric_unit", "target_value", "weight",
  "team", "designation", "is_active",
]);

export const fetchKpiTemplates = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT * FROM kpi_templates ORDER BY team, title`,
    );
    return rows as KpiTemplate[];
  });

export const upsertKpiTemplate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: {
    id?: string; title: string; description: string | null;
    metric_unit: string; target_value: number; weight: number;
    team: string; designation: string | null; is_active: boolean;
  }) => data)
  .handler(async ({ data, context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");
    const { id, ...rest } = data;
    // Filter to allowlisted columns only.
    const safe = Object.entries(rest).filter(([col]) => KPI_PATCHABLE.has(col));
    if (safe.length === 0) return;

    if (id) {
      const sets = safe.map(([col], i) => `"${col}" = $${i + 1}`).join(", ");
      const vals = [...safe.map(([, v]) => v), id];
      await pool.query(
        `UPDATE kpi_templates SET ${sets} WHERE id = $${vals.length}`,
        vals,
      );
    } else {
      // created_by derived from server-verified user, not body.
      const cols = [...safe.map(([c]) => c), "created_by"];
      const vals = [...safe.map(([, v]) => v), context.user.dbUserId];
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const quotedCols = cols.map((c) => `"${c}"`).join(", ");
      await pool.query(
        `INSERT INTO kpi_templates (${quotedCols}) VALUES (${placeholders})`,
        vals,
      );
    }
  });

export const deleteKpiTemplate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");
    await pool.query(`DELETE FROM kpi_templates WHERE id = $1`, [data.id]);
  });
