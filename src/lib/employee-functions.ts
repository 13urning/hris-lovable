import { createServerFn } from "@tanstack/react-start";

type EmployeeRow = {
  id: string; full_name: string;
  first_name: string | null; middle_name: string | null; last_name: string | null;
  email: string | null; department: string;
  employee_code: string | null; position: string | null; company: string | null;
  vl_credits: number | null; sl_credits: number | null;
  vl_remaining: number | null; sl_remaining: number | null;
  roles: string[];
  vl_used: number;
  sl_used: number;
};

type ImportEmployee = {
  email: string;
  first_name: string; middle_name: string; last_name: string;
  employee_code: string;
  company: string; department: string; position: string;
  vl_credits: string; sl_credits: string;
};

function joinFullName(first: string, middle: string, last: string): string {
  return [first, middle, last].map((s) => s.trim()).filter(Boolean).join(" ");
}

type ImportResult = {
  email: string; full_name: string;
  success: boolean; temp_password?: string; error?: string;
};

function businessDaysBetween(start: string, end: string): number {
  let count = 0;
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const cur = new Date(s);
  while (cur <= e) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function generateTempPassword(): string {
  // Use crypto.getRandomValues equivalent in Node
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pwd = "";
  for (let i = 0; i < 10; i++) {
    pwd += chars[Math.floor(Math.random() * chars.length)];
  }
  return pwd + "!1";
}

export const fetchAllEmployees = createServerFn({ method: "POST" })
  .handler(async () => {
    const { pool } = await import("@/lib/db.server");

    const [{ rows: profiles }, { rows: roles }, { rows: leaves }] = await Promise.all([
      pool.query(`SELECT * FROM profiles ORDER BY full_name`),
      pool.query(`SELECT user_id, role FROM user_roles`),
      pool.query(`SELECT employee_id, leave_type, start_date, end_date, status FROM leave_requests`),
    ]);

    const currentYear = new Date().getFullYear();

    return profiles.map((p): EmployeeRow => {
      const userRoles = roles.filter((r) => r.user_id === p.id).map((r) => r.role as string);
      const userLeaves = leaves.filter((l) => l.employee_id === p.id);

      const vl_used = userLeaves
        .filter((l) => l.leave_type === "VL" && (l.status === "approved" || l.status === "pending") && new Date(l.start_date).getFullYear() === currentYear)
        .reduce((s, l) => s + businessDaysBetween(l.start_date as string, l.end_date as string), 0);

      const sl_used = userLeaves
        .filter((l) => l.leave_type === "SL" && (l.status === "approved" || l.status === "pending") && new Date(l.start_date).getFullYear() === currentYear)
        .reduce((s, l) => s + businessDaysBetween(l.start_date as string, l.end_date as string), 0);

      return { ...(p as EmployeeRow), roles: userRoles, vl_used, sl_used };
    });
  });

export const updateEmployeeProfile = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; patches: Record<string, string | number> }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const entries = Object.entries(data.patches);
    if (entries.length === 0) return;
    const sets = entries.map(([col], i) => `${col} = $${i + 1}`).join(", ");
    const vals = [...entries.map(([, v]) => v), data.id];
    await pool.query(
      `UPDATE profiles SET ${sets} WHERE id = $${vals.length}`,
      vals,
    );
  });

export const setEmployeeRole = createServerFn({ method: "POST" })
  .inputValidator((data: { userId: string; roles: { user_id: string; role: string }[] }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [data.userId]);
      for (const r of data.roles) {
        await client.query(
          `INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`,
          [r.user_id, r.role],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

export const bulkCreateEmployees = createServerFn({ method: "POST" })
  .inputValidator((data: { employees: ImportEmployee[] }) => data)
  .handler(async ({ data }): Promise<ImportResult[]> => {
    const { pool } = await import("@/lib/db.server");
    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    if (!apiKey) throw new Error("FIREBASE_WEB_API_KEY not configured");

    const results: ImportResult[] = [];

    for (const emp of data.employees) {
      const fullName = joinFullName(emp.first_name ?? "", emp.middle_name ?? "", emp.last_name ?? "");
      if (!emp.email || !emp.first_name || !emp.last_name) {
        results.push({ email: emp.email, full_name: fullName, success: false, error: "email, first_name and last_name are required" });
        continue;
      }

      const tempPassword = generateTempPassword();
      try {
        // 1. Create Firebase user via REST API
        const fbRes = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: emp.email, password: tempPassword, returnSecureToken: false }),
          },
        );
        const fbData = await fbRes.json() as { localId?: string; error?: { message?: string } };
        if (!fbRes.ok || !fbData.localId) {
          throw new Error(fbData.error?.message ?? "Firebase user creation failed");
        }
        const firebaseUid = fbData.localId;

        // 2. Provision DB records in a transaction
        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const { rows: [user] } = await client.query<{ id: string }>(
            `INSERT INTO public.users (firebase_uid, email) VALUES ($1, $2) RETURNING id`,
            [firebaseUid, emp.email],
          );

          await client.query(
            `INSERT INTO profiles (id, full_name, first_name, middle_name, last_name,
                                   email, employee_code, company, department, position,
                                   vl_credits, sl_credits, vl_remaining, sl_remaining, must_change_password)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11,$12,TRUE)`,
            [
              user.id, fullName,
              emp.first_name.trim(),
              emp.middle_name?.trim() || null,
              emp.last_name.trim(),
              emp.email,
              emp.employee_code || null, emp.company || null,
              emp.department || "General", emp.position || null,
              parseInt(emp.vl_credits) || 10, parseInt(emp.sl_credits) || 10,
            ],
          );

          await client.query(
            `INSERT INTO user_roles (user_id, role) VALUES ($1, 'employee')`,
            [user.id],
          );

          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        results.push({ email: emp.email, full_name: fullName, success: true, temp_password: tempPassword });
      } catch (err) {
        results.push({
          email: emp.email, full_name: fullName, success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  });
