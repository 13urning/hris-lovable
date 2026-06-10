import { createServerFn } from "@tanstack/react-start";

type KpiTemplate = {
  id: string; title: string; description: string | null;
  metric_unit: string; target_value: number; weight: number;
  team: string; designation: string | null; is_active: boolean; created_at: string;
};

export const fetchKpiTemplates = createServerFn({ method: "POST" })
  .handler(async () => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT * FROM kpi_templates ORDER BY team, title`,
    );
    return rows as KpiTemplate[];
  });

export const upsertKpiTemplate = createServerFn({ method: "POST" })
  .inputValidator((data: {
    id?: string; title: string; description: string | null;
    metric_unit: string; target_value: number; weight: number;
    team: string; designation: string | null; is_active: boolean;
    created_by?: string;
  }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { id, created_by, ...rest } = data;
    if (id) {
      const cols = Object.keys(rest);
      const vals = Object.values(rest);
      const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(", ");
      await pool.query(
        `UPDATE kpi_templates SET ${sets} WHERE id = $${cols.length + 1}`,
        [...vals, id],
      );
    } else {
      const fields = { ...rest, created_by: created_by ?? null };
      const cols = Object.keys(fields);
      const vals = Object.values(fields);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      await pool.query(
        `INSERT INTO kpi_templates (${cols.join(", ")}) VALUES (${placeholders})`,
        vals,
      );
    }
  });

export const deleteKpiTemplate = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    await pool.query(`DELETE FROM kpi_templates WHERE id = $1`, [data.id]);
  });
