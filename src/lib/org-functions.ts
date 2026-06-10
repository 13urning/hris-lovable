import { createServerFn } from "@tanstack/react-start";

export const fetchProfilesForOrg = createServerFn({ method: "POST" })
  .handler(async () => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, full_name, position, department FROM profiles ORDER BY full_name`,
    );
    return rows as { id: string; full_name: string; position: string | null; department: string | null }[];
  });

export const fetchAllOrgNodes = createServerFn({ method: "POST" })
  .handler(async () => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(`SELECT * FROM org_nodes`);
    return rows as {
      id: string; employee_id: string; parent_id: string | null;
      team_label: string | null; is_dept_head: boolean;
      position_x: number; position_y: number;
    }[];
  });

type OrgNodeInsert = {
  employee_id: string; team_label: string | null;
  is_dept_head: boolean; position_x: number; position_y: number;
};

export const saveOrgChartData = createServerFn({ method: "POST" })
  .inputValidator((data: { nodes: OrgNodeInsert[]; edgePairs: { childEmpId: string; parentEmpId: string }[] }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Delete all existing rows
      await client.query(`DELETE FROM org_nodes WHERE created_at >= '1970-01-01'`);

      if (data.nodes.length === 0) {
        await client.query("COMMIT");
        return;
      }

      // 2. Insert all nodes without parent_id
      const insertedIds: { id: string; employee_id: string }[] = [];
      for (const node of data.nodes) {
        const { rows } = await client.query<{ id: string; employee_id: string }>(
          `INSERT INTO org_nodes (employee_id, team_label, is_dept_head, position_x, position_y)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, employee_id`,
          [node.employee_id, node.team_label, node.is_dept_head, node.position_x, node.position_y],
        );
        if (rows[0]) insertedIds.push(rows[0]);
      }

      // 3. Build emp_id â†’ org_node_id map
      const empToNodeId: Record<string, string> = {};
      for (const r of insertedIds) empToNodeId[r.employee_id] = r.id;

      // 4. Update parent_ids based on edges
      for (const { childEmpId, parentEmpId } of data.edgePairs) {
        const childOrgNodeId = empToNodeId[childEmpId];
        const parentOrgNodeId = empToNodeId[parentEmpId];
        if (childOrgNodeId && parentOrgNodeId) {
          await client.query(
            `UPDATE org_nodes SET parent_id = $1 WHERE id = $2`,
            [parentOrgNodeId, childOrgNodeId],
          );
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });
