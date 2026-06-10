import type { Pool } from "pg";

// Walks up org_nodes.parent_id from `employeeId` and returns the ordered chain
// of approver employee_ids — immediate supervisor first, group head last.
// Returns [] if the filer sits at the top of the tree (no parent).
export async function resolveChain(pool: Pool, employeeId: string): Promise<string[]> {
  const { rows: [myRow] } = await pool.query<{ id: string; parent_id: string | null }>(
    `SELECT id, parent_id FROM org_nodes WHERE employee_id = $1 LIMIT 1`,
    [employeeId],
  );
  if (!myRow) throw new Error("NO_ORG_NODE");
  if (!myRow.parent_id) return [];

  const { rows } = await pool.query<{ employee_id: string; depth: number }>(
    `WITH RECURSIVE chain AS (
       SELECT id, employee_id, parent_id, 0 AS depth
       FROM org_nodes WHERE id = $1
       UNION ALL
       SELECT n.id, n.employee_id, n.parent_id, chain.depth + 1
       FROM org_nodes n
       JOIN chain ON n.id = chain.parent_id
       WHERE chain.depth < 20
     )
     SELECT employee_id, depth FROM chain ORDER BY depth ASC`,
    [myRow.parent_id],
  );

  return rows.map((r) => r.employee_id);
}
