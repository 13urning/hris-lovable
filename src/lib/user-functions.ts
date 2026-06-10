import { createServerFn } from "@tanstack/react-start";

// Fetch profile + roles for an existing user by Firebase UID.
export const fetchUserData = createServerFn({ method: "POST" })
  .validator((firebaseUid: string) => firebaseUid)
  .handler(async ({ data: firebaseUid }) => {
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
      `SELECT u.id, p.full_name, p.email, p.employee_code, p.department,
              p.position, p.must_change_password
       FROM users u
       JOIN profiles p ON p.id = u.id
       WHERE u.firebase_uid = $1`,
      [firebaseUid],
    );

    if (profileResult.rows.length === 0) return null;

    const rolesResult = await pool.query<{ role: string }>(
      "SELECT role FROM user_roles WHERE user_id = $1",
      [profileResult.rows[0].id],
    );

    return {
      profile: profileResult.rows[0],
      roles: rolesResult.rows.map((r) => r.role),
    };
  });

// Create user, profile, and default employee role for a new Firebase sign-up.
export const provisionUser = createServerFn({ method: "POST" })
  .validator(
    (data: { firebaseUid: string; email: string; fullName?: string }) => data,
  )
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const newId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO users (id, firebase_uid, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (firebase_uid) DO NOTHING`,
      [newId, data.firebaseUid, data.email],
    );

    // Re-fetch the id in case the user already existed
    const { rows } = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [data.firebaseUid],
    );
    const userId = rows[0].id;

    await pool.query(
      `INSERT INTO profiles (id, full_name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [userId, data.fullName ?? data.email.split("@")[0], data.email],
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
  .validator((firebaseUid: string) => firebaseUid)
  .handler(async ({ data: firebaseUid }) => {
    const { pool } = await import("@/lib/db.server");
    const result = await pool.query<{ must_change_password: boolean }>(
      `SELECT p.must_change_password
       FROM profiles p
       JOIN users u ON p.id = u.id
       WHERE u.firebase_uid = $1`,
      [firebaseUid],
    );
    return result.rows[0] ?? null;
  });

// Clear the must_change_password flag after a successful password reset.
export const clearPasswordChangeFlag = createServerFn({ method: "POST" })
  .validator((firebaseUid: string) => firebaseUid)
  .handler(async ({ data: firebaseUid }) => {
    const { pool } = await import("@/lib/db.server");
    await pool.query(
      `UPDATE profiles p
       SET must_change_password = FALSE
       FROM users u
       WHERE p.id = u.id AND u.firebase_uid = $1`,
      [firebaseUid],
    );
  });
