import { createMiddleware } from "@tanstack/react-start";

export type AuthRole = "employee" | "hr" | "admin" | "group_head";

export type AuthUserContext = {
  firebaseUid: string;
  dbUserId: string | null;          // null on first login, before provisionUser runs
  email: string | null;
  roles: AuthRole[];
  isHR: boolean;
  isAdmin: boolean;
};

// Client half: pull the current Firebase ID token and ship it to the server in
// sendContext. Returns null when no one is signed in — the server half decides
// whether to allow that (provisionUser allows it; everything else doesn't).
const clientAuth = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    let idToken: string | null = null;
    if (typeof window !== "undefined") {
      const { auth } = await import("@/lib/firebase");
      try {
        idToken = (await auth.currentUser?.getIdToken()) ?? null;
      } catch {
        idToken = null;
      }
    }
    return next({ sendContext: { idToken } });
  });

// Server half: verify the token, resolve the DB user + roles, attach to context.
// Anonymous (no token) is allowed through with user=null so that handlers like
// provisionUser can still run on first login. Each handler decides what to do
// with a null user via the assertXxx helpers below.
export const authMiddleware = createMiddleware({ type: "function" })
  .middleware([clientAuth])
  .server(async ({ next, context }) => {
    const idToken = (context as { idToken: string | null }).idToken;
    let user: AuthUserContext = {
      firebaseUid: "",
      dbUserId: null,
      email: null,
      roles: [],
      isHR: false,
      isAdmin: false,
    };

    if (idToken) {
      const { adminAuth } = await import("@/lib/firebase-admin.server");
      const decoded = await adminAuth.verifyIdToken(idToken);
      const { pool } = await import("@/lib/db.server");
      const { rows } = await pool.query<{ id: string; email: string | null }>(
        `SELECT id, email FROM users WHERE firebase_uid = $1 LIMIT 1`,
        [decoded.uid],
      );
      const dbUserId = rows[0]?.id ?? null;
      let roles: AuthRole[] = [];
      if (dbUserId) {
        const { rows: roleRows } = await pool.query<{ role: AuthRole }>(
          `SELECT role FROM user_roles WHERE user_id = $1`,
          [dbUserId],
        );
        roles = roleRows.map((r) => r.role);
      }
      user = {
        firebaseUid: decoded.uid,
        dbUserId,
        email: rows[0]?.email ?? decoded.email ?? null,
        roles,
        isHR: roles.includes("hr") || roles.includes("admin"),
        isAdmin: roles.includes("admin"),
      };
    }

    return next({ context: { user } });
  });

// ── Assertions ────────────────────────────────────────────────────────────────
// Each handler calls the assertion it needs. Throws on failure with a stable
// error message; the client surfaces these as toast errors.

export function assertAuthenticated(user: AuthUserContext): asserts user is AuthUserContext & { firebaseUid: string } {
  if (!user.firebaseUid) throw new Error("UNAUTHENTICATED");
}

export function assertUser(user: AuthUserContext): asserts user is AuthUserContext & { firebaseUid: string; dbUserId: string } {
  assertAuthenticated(user);
  if (!user.dbUserId) throw new Error("NO_PROFILE");
}

export function assertHR(user: AuthUserContext): asserts user is AuthUserContext & { firebaseUid: string; dbUserId: string } {
  assertUser(user);
  if (!user.isHR) throw new Error("FORBIDDEN");
}

export function assertAdmin(user: AuthUserContext): asserts user is AuthUserContext & { firebaseUid: string; dbUserId: string } {
  assertUser(user);
  if (!user.isAdmin) throw new Error("FORBIDDEN");
}
