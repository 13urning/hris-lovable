import { createServerFn } from "@tanstack/react-start";
import { randomInt } from "node:crypto";
import { authMiddleware, assertHR, assertAdmin } from "@/lib/auth-middleware";

type EmployeeRow = {
  id: string;
  full_name: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  email: string | null;
  department: string;
  employee_code: string | null;
  position: string | null;
  company: string | null;
  vl_credits: number | null;
  vl_remaining: number | null;
  sl_credits: number | null;
  sl_remaining: number | null;
  el_credits: number | null;
  el_remaining: number | null;
  bday_credits: number | null;
  bday_remaining: number | null;
  ml_credits: number | null;
  ml_remaining: number | null;
  pl_credits: number | null;
  pl_remaining: number | null;
  bl_credits: number | null;
  bl_remaining: number | null;
  exclude_from_attendance: boolean;
  roles: string[];
  vl_used: number;
  sl_used: number;
};

type ImportEmployee = {
  email: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  employee_code: string;
  company: string;
  department: string;
  position: string;
  vl_credits: string;
  sl_credits: string;
  el_credits: string;
  bday_credits: string;
  ml_credits: string;
  pl_credits: string;
  bl_credits: string;
};

// "created" = new Firebase login minted (has a temp_password to distribute).
// "linked"  = email already had a login (shared wave-hris-fb pool); we created
//             only the DB rows against the existing uid — no password touched.
// "skipped" = a profile already existed for that uid (already onboarded here).
// "failed"  = validation or an unexpected error (see error).
type ImportStatus = "created" | "linked" | "skipped" | "failed";

type ImportResult = {
  email: string;
  full_name: string;
  success: boolean;
  status: ImportStatus;
  temp_password?: string;
  error?: string;
};

function joinFullName(first: string, middle: string, last: string): string {
  return [first, middle, last]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

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

// CSPRNG temp password using node:crypto.randomInt. The previous Math.random
// version was predictable from V8 internal state.
function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let pwd = "";
  for (let i = 0; i < 10; i++) {
    pwd += chars[randomInt(0, chars.length)];
  }
  return pwd + "!1";
}

// Explicit allowlist of columns the admin UI may patch. Any key not in this set
// is rejected — prevents SQL identifier injection AND silent role/credential
// escalation via crafted patches.
const PATCHABLE_COLUMNS = new Set([
  "full_name",
  "first_name",
  "middle_name",
  "last_name",
  "department",
  "position",
  "company",
  "employee_code",
  "vl_credits",
  "vl_remaining",
  "sl_credits",
  "sl_remaining",
  "el_credits",
  "el_remaining",
  "bday_credits",
  "bday_remaining",
  "ml_credits",
  "ml_remaining",
  "pl_credits",
  "pl_remaining",
  "bl_credits",
  "bl_remaining",
]);

export const fetchAllEmployees = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");

    const [{ rows: profiles }, { rows: roles }, { rows: leaves }] = await Promise.all([
      pool.query(`SELECT * FROM profiles ORDER BY full_name`),
      pool.query(`SELECT user_id, role FROM user_roles`),
      pool.query(
        `SELECT employee_id, leave_type, start_date, end_date, status FROM leave_requests`,
      ),
    ]);

    const currentYear = new Date().getFullYear();

    return profiles.map((p): EmployeeRow => {
      const userRoles = roles.filter((r) => r.user_id === p.id).map((r) => r.role as string);
      const userLeaves = leaves.filter((l) => l.employee_id === p.id);

      const vl_used = userLeaves
        .filter(
          (l) =>
            l.leave_type === "VL" &&
            (l.status === "approved" || l.status === "pending") &&
            new Date(l.start_date).getFullYear() === currentYear,
        )
        .reduce((s, l) => s + businessDaysBetween(l.start_date as string, l.end_date as string), 0);

      const sl_used = userLeaves
        .filter(
          (l) =>
            l.leave_type === "SL" &&
            (l.status === "approved" || l.status === "pending") &&
            new Date(l.start_date).getFullYear() === currentYear,
        )
        .reduce((s, l) => s + businessDaysBetween(l.start_date as string, l.end_date as string), 0);

      return { ...(p as EmployeeRow), roles: userRoles, vl_used, sl_used };
    });
  });

export const updateEmployeeProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string; patches: Record<string, string | number> }) => data)
  .handler(async ({ data, context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");

    // Filter to allowlisted columns only — anything else is silently dropped.
    const safeEntries = Object.entries(data.patches).filter(([col]) => PATCHABLE_COLUMNS.has(col));
    if (safeEntries.length === 0) return;

    const sets = safeEntries.map(([col], i) => `"${col}" = $${i + 1}`).join(", ");
    const vals = [...safeEntries.map(([, v]) => v), data.id];
    await pool.query(`UPDATE profiles SET ${sets} WHERE id = $${vals.length}`, vals);
  });

// Toggle whether an employee is tracked for attendance/absence monitoring.
// `excluded = true` opts them out (no synthesized absences, hidden from the HR
// activity log and today roster). HR/admin only.
export const setAttendanceTracking = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string; excluded: boolean }) => data)
  .handler(async ({ data, context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");
    await pool.query(`UPDATE profiles SET exclude_from_attendance = $1 WHERE id = $2`, [
      data.excluded,
      data.id,
    ]);
  });

// Admin-only employee deletion. Cascade-deletes the DB rows (profile, roles,
// leaves, DTRs, evaluations) via FK constraints. Best-effort Firebase Auth
// cleanup — failure logged but does not block the DB delete.
export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    assertAdmin(context.user);
    if (data.id === context.user.dbUserId) throw new Error("CANNOT_DELETE_SELF");
    const { pool } = await import("@/lib/db.server");

    const {
      rows: [user],
    } = await pool.query<{ firebase_uid: string | null }>(
      `SELECT firebase_uid FROM users WHERE id = $1`,
      [data.id],
    );
    if (!user) throw new Error("NOT_FOUND");

    if (user.firebase_uid) {
      try {
        const { adminAuth } = await import("@/lib/firebase-admin.server");
        await adminAuth.deleteUser(user.firebase_uid);
      } catch (err) {
        console.warn("[deleteEmployee] Firebase Auth delete failed for", user.firebase_uid, err);
      }
    }

    await pool.query(`DELETE FROM users WHERE id = $1`, [data.id]);
  });

// Admin-only password reset. Sets the employee's Firebase Auth password to a
// freshly generated temporary one, flags must_change_password so they're forced
// to choose a new password on next login, and revokes existing refresh tokens so
// active sessions can't outlive the reset. Returns the temp password ONCE — it is
// never stored and can't be retrieved again.
export const resetEmployeePassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }): Promise<{ temp_password: string }> => {
    assertAdmin(context.user);
    const { pool } = await import("@/lib/db.server");

    const {
      rows: [user],
    } = await pool.query<{ firebase_uid: string | null }>(
      `SELECT firebase_uid FROM users WHERE id = $1`,
      [data.id],
    );
    if (!user) throw new Error("NOT_FOUND");
    if (!user.firebase_uid) throw new Error("NO_AUTH_ACCOUNT");

    const tempPassword = generateTempPassword();

    const { adminAuth } = await import("@/lib/firebase-admin.server");
    await adminAuth.updateUser(user.firebase_uid, { password: tempPassword });
    // Best-effort: invalidate existing sessions. Failure here must not leave the
    // password un-reset, so it's logged rather than thrown.
    try {
      await adminAuth.revokeRefreshTokens(user.firebase_uid);
    } catch (err) {
      console.warn("[resetEmployeePassword] revokeRefreshTokens failed", err);
    }

    await pool.query(`UPDATE profiles SET must_change_password = TRUE WHERE id = $1`, [data.id]);

    return { temp_password: tempPassword };
  });

export const setEmployeeRole = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { userId: string; roles: { user_id: string; role: string }[] }) => data)
  .handler(async ({ data, context }) => {
    assertAdmin(context.user);
    const { pool } = await import("@/lib/db.server");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [data.userId]);
      for (const r of data.roles) {
        await client.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, $2)`, [
          r.user_id,
          r.role,
        ]);
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
  .middleware([authMiddleware])
  .inputValidator((data: { employees: ImportEmployee[] }) => data)
  .handler(async ({ data, context }): Promise<ImportResult[]> => {
    assertAdmin(context.user);
    const { pool } = await import("@/lib/db.server");
    const { adminAuth } = await import("@/lib/firebase-admin.server");

    const results: ImportResult[] = [];

    for (const emp of data.employees) {
      const fullName = joinFullName(
        emp.first_name ?? "",
        emp.middle_name ?? "",
        emp.last_name ?? "",
      );
      // Canonicalize once: Firebase treats email case-insensitively and stores it
      // lowercased, so use the same canonical form for the Auth call, the lookup,
      // and the DB rows — otherwise "A@x" and "a@x" could yield duplicate profiles.
      const email = (emp.email ?? "").trim().toLowerCase();
      if (!email || !emp.first_name || !emp.last_name) {
        results.push({
          email,
          full_name: fullName,
          success: false,
          status: "failed",
          error: "email, first_name and last_name are required",
        });
        continue;
      }

      const tempPassword = generateTempPassword();
      try {
        // Create the Firebase login via the ADMIN SDK (server-credentialed) instead
        // of the public accounts:signUp REST endpoint — so account creation can
        // never be performed by anyone holding the (public) web API key. If the
        // email already has a login (the wave-hris-fb Auth pool is SHARED across
        // staging/prod, so a user created in one environment already exists in the
        // other), LINK to it: create only the DB rows and leave the shared password
        // untouched (no updateUser; must_change_password=FALSE for linked users).
        let firebaseUid: string;
        let intent: "create" | "link";
        try {
          firebaseUid = (await adminAuth.createUser({ email, password: tempPassword })).uid;
          intent = "create";
        } catch (err) {
          if ((err as { code?: string }).code === "auth/email-already-exists") {
            firebaseUid = (await adminAuth.getUserByEmail(email)).uid;
            intent = "link";
          } else {
            throw err;
          }
        }

        const client = await pool.connect();
        let status: Exclude<ImportStatus, "failed">;
        try {
          await client.query("BEGIN");

          // Upsert the users row keyed by the (unique) firebase_uid; a concurrent
          // import or a prior half-completed run may already own it.
          const ins = await client.query<{ id: string }>(
            `INSERT INTO public.users (firebase_uid, email) VALUES ($1, $2)
             ON CONFLICT (firebase_uid) DO NOTHING RETURNING id`,
            [firebaseUid, email],
          );
          const userId =
            ins.rows[0]?.id ??
            (
              await client.query<{ id: string }>(
                `SELECT id FROM public.users WHERE firebase_uid = $1`,
                [firebaseUid],
              )
            ).rows[0].id;

          // Never clobber an already-onboarded profile — if one exists for this
          // uid in THIS database, skip (the identity is already set up here).
          const existingProfile = await client.query(`SELECT 1 FROM profiles WHERE id = $1`, [
            userId,
          ]);
          if (existingProfile.rowCount) {
            await client.query("COMMIT");
            status = "skipped";
          } else {
            const parseCredit = (
              raw: string | undefined,
              fallback: number | null,
            ): number | null => {
              if (raw === undefined || raw === "") return fallback;
              const n = parseInt(raw);
              return Number.isFinite(n) ? n : fallback;
            };
            const vl = parseCredit(emp.vl_credits, 10);
            const sl = parseCredit(emp.sl_credits, 10);
            const el = parseCredit(emp.el_credits, null);
            const bday = parseCredit(emp.bday_credits, null);
            const ml = parseCredit(emp.ml_credits, null);
            const pl = parseCredit(emp.pl_credits, null);
            const bl = parseCredit(emp.bl_credits, null);
            // must_change_password only for freshly-created logins. A linked user
            // already has a working (shared) password; forcing a change would
            // rewrite it in the other environment too.
            const mustChange = intent === "create";
            const profIns = await client.query(
              `INSERT INTO profiles (id, full_name, first_name, middle_name, last_name,
                                     email, employee_code, company, department, position,
                                     vl_credits, vl_remaining,
                                     sl_credits, sl_remaining,
                                     el_credits, el_remaining,
                                     bday_credits, bday_remaining,
                                     ml_credits, ml_remaining,
                                     pl_credits, pl_remaining,
                                     bl_credits, bl_remaining,
                                     must_change_password)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                       $11,$11, $12,$12, $13,$13, $14,$14, $15,$15, $16,$16, $17,$17,
                       $18)
               ON CONFLICT (id) DO NOTHING`,
              [
                userId,
                fullName,
                emp.first_name.trim(),
                emp.middle_name?.trim() || null,
                emp.last_name.trim(),
                email,
                emp.employee_code || null,
                emp.company || null,
                emp.department || "General",
                emp.position || null,
                vl,
                sl,
                el,
                bday,
                ml,
                pl,
                bl,
                mustChange,
              ],
            );

            await client.query(
              `INSERT INTO user_roles (user_id, role) VALUES ($1, 'employee')
               ON CONFLICT DO NOTHING`,
              [userId],
            );

            await client.query("COMMIT");
            // If a racing writer inserted the profile between our check and insert,
            // profIns affects 0 rows — treat as skipped, not created/linked.
            status = profIns.rowCount ? (intent === "create" ? "created" : "linked") : "skipped";
          }
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }

        results.push({
          email,
          full_name: fullName,
          success: true,
          status,
          // Only a freshly-created login has a distributable password.
          ...(status === "created" ? { temp_password: tempPassword } : {}),
        });
      } catch (err) {
        results.push({
          email,
          full_name: fullName,
          success: false,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  });
