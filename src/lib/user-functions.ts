import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, assertAuthenticated, assertUser } from "@/lib/auth-middleware";

// Fetch profile + roles for the currently signed-in user. Returns null when
// the caller is anonymous or hasn't been provisioned yet — both are normal
// during the bootstrap flow.
export const fetchUserData = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (!context.user.firebaseUid || !context.user.dbUserId) return null;

    const { pool } = await import("@/lib/db.server");

    const profileResult = await pool.query<{
      id: string;
      full_name: string;
      email: string;
      employee_code: string | null;
      department: string;
      position: string | null;
      must_change_password: boolean;
    }>(
      `SELECT p.id, p.full_name, p.email, p.employee_code, p.department,
              p.position, p.must_change_password
       FROM profiles p
       WHERE p.id = $1`,
      [context.user.dbUserId],
    );

    if (profileResult.rows.length === 0) return null;

    return {
      profile: profileResult.rows[0],
      roles: context.user.roles,
    };
  });

// Provision a DB user/profile/role for the currently signed-in Firebase user.
// Idempotent. firebaseUid + email come from the verified token, not the body.
export const provisionUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { fullName?: string }) => data)
  .handler(async ({ data, context }) => {
    assertAuthenticated(context.user);
    const { pool } = await import("@/lib/db.server");
    const email = context.user.email ?? "";
    const newId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO users (id, firebase_uid, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (firebase_uid) DO NOTHING`,
      [newId, context.user.firebaseUid, email],
    );

    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [context.user.firebaseUid],
    );
    const userId = rows[0].id;

    await pool.query(
      `INSERT INTO profiles (id, full_name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [userId, data.fullName ?? email.split("@")[0], email],
    );

    await pool.query(
      `INSERT INTO user_roles (user_id, role)
       VALUES ($1, 'employee')
       ON CONFLICT DO NOTHING`,
      [userId],
    );

    return userId;
  });

// Fetch only the must_change_password flag for the auth gate.
export const getProfileFlags = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const result = await pool.query<{ must_change_password: boolean }>(
      `SELECT must_change_password FROM profiles WHERE id = $1`,
      [context.user.dbUserId],
    );
    return result.rows[0] ?? null;
  });

// Revoke the caller's own Firebase refresh tokens on explicit logout, so a
// captured refresh token on a shared/kiosk device can't silently mint new sessions
// after sign-out. Best-effort — the client still signs out even if this throws.
export const revokeOwnSessions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertAuthenticated(context.user);
    const { adminAuth } = await import("@/lib/firebase-admin.server");
    await adminAuth.revokeRefreshTokens(context.user.firebaseUid);
  });

// Clear the must_change_password flag after a successful password reset.
export const clearPasswordChangeFlag = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    await pool.query(
      `UPDATE profiles SET must_change_password = FALSE WHERE id = $1`,
      [context.user.dbUserId],
    );
  });
