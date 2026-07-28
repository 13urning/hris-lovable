import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
// Observability is composed here rather than at each server function because
// this file is the choke point: every one of the 106 createServerFn calls in the
// app runs authMiddleware or strictAuthMiddleware. Listing it FIRST makes it the
// outermost wrapper, so it also observes a failure inside token verification or
// the baseline rate limiter — not just failures in the handler below.
import { observabilityMiddleware } from "@/lib/observability-middleware";

export type AuthRole = "employee" | "hr" | "admin" | "group_head";

export type AuthUserContext = {
  firebaseUid: string;
  dbUserId: string | null; // null on first login, before provisionUser runs
  email: string | null;
  roles: AuthRole[];
  isHR: boolean;
  isAdmin: boolean;
};

// Client half: pull the current Firebase ID token and ship it to the server in
// sendContext. Returns null when no one is signed in — the server half decides
// whether to allow that (provisionUser allows it; everything else doesn't).
const clientAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
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

// Verify the token, resolve the DB user + roles. Anonymous (no token) resolves to
// an empty user so handlers like provisionUser can still run on first login.
// `checkRevoked` additionally rejects tokens that have been revoked (logout,
// password reset, admin disable) at the cost of an extra Firebase lookup — only
// the strict middleware passes it, so the default hot path stays JWKS-local.
async function resolveAuthUser(
  idToken: string | null,
  checkRevoked = false,
): Promise<AuthUserContext> {
  const empty: AuthUserContext = {
    firebaseUid: "",
    dbUserId: null,
    email: null,
    roles: [],
    isHR: false,
    isAdmin: false,
  };
  if (!idToken) return empty;

  const { adminAuth } = await import("@/lib/firebase-admin.server");
  const decoded = await adminAuth.verifyIdToken(idToken, checkRevoked);
  const { pool } = await import("@/lib/db.server");
  // Single round-trip: resolve the user row and aggregate its roles in one query.
  // LEFT JOIN keeps users with no roles; array_remove drops the NULL produced for
  // those so they come back as an empty array. Cast role to text so the aggregate
  // comes back as text[] (well-known OID 1009) — node-postgres won't auto-parse an
  // array of the custom app_role enum and would otherwise hand back a raw
  // "{employee,hr}" string.
  const { rows } = await pool.query<{ id: string; email: string | null; roles: AuthRole[] }>(
    `SELECT u.id, u.email,
            array_remove(array_agg(ur.role::text), NULL) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.firebase_uid = $1
      GROUP BY u.id, u.email
      LIMIT 1`,
    [decoded.uid],
  );
  const roles: AuthRole[] = rows[0]?.roles ?? [];
  return {
    firebaseUid: decoded.uid,
    dbUserId: rows[0]?.id ?? null,
    email: rows[0]?.email ?? decoded.email ?? null,
    roles,
    isHR: roles.includes("hr") || roles.includes("admin"),
    isAdmin: roles.includes("admin"),
  };
}

// Baseline rate limit enforced for EVERY server function at this shared choke
// point (all createServerFn calls run one of these middlewares). Keyed per
// authenticated user, falling back to the client IP for the rare pre-auth call
// (e.g. provisionUser on first login) so one caller can't starve others. Throws
// the shared RATE_LIMIT_MESSAGE, which the client surfaces as an error toast.
// Dynamic imports keep the auth -> office-network -> auth module cycle from
// forming at load time (the established pattern in this file).
async function enforceBaselineRateLimit(user: AuthUserContext): Promise<void> {
  const { enforceRateLimit, GLOBAL_RATE_LIMIT } = await import("@/lib/rate-limit.server");
  let identity = "ip:unknown";
  if (user.firebaseUid) {
    identity = `u:${user.firebaseUid}`;
  } else {
    // Pre-auth call (e.g. provisionUser on first login). Resolve the client IP,
    // but never let a request-context hiccup here block sign-in — fall back to the
    // shared "unknown" bucket instead of throwing.
    try {
      const { resolveClientIp } = await import("@/lib/office-network-functions");
      identity = `ip:${resolveClientIp(getRequest())}`;
    } catch {
      identity = "ip:unknown";
    }
  }
  enforceRateLimit(`global:${identity}`, GLOBAL_RATE_LIMIT);
}

// Attribute every subsequent log record in this request to the resolved actor.
// UUIDs only — the email sitting in `user` is deliberately never passed on.
// Dynamically imported for the same reason db.server is: log.server reaches for
// node:async_hooks, and this module is part of the client bundle.
async function attributeActor(user: AuthUserContext): Promise<void> {
  try {
    const { setRequestActor } = await import("@/lib/log.server");
    setRequestActor(user.dbUserId, user.firebaseUid || null);
  } catch {
    // Attribution is a nicety; never let it block authentication.
  }
}

// Server half: verify the token, resolve the DB user + roles, attach to context.
// Each handler decides what to do with a null user via the assertXxx helpers below.
export const authMiddleware = createMiddleware({ type: "function" })
  .middleware([observabilityMiddleware, clientAuth])
  .server(async ({ next, context }) => {
    const idToken = (context as { idToken: string | null }).idToken;
    const user = await resolveAuthUser(idToken);
    await attributeActor(user);
    await enforceBaselineRateLimit(user);
    return next({ context: { user } });
  });

// Same as authMiddleware but also rejects REVOKED tokens. Reserved for sensitive,
// privilege-bearing operations (user create/delete, role changes, password resets)
// so the extra Firebase round-trip only happens where account takeover / privilege
// escalation is the risk — not on every authenticated request.
export const strictAuthMiddleware = createMiddleware({ type: "function" })
  .middleware([observabilityMiddleware, clientAuth])
  .server(async ({ next, context }) => {
    const idToken = (context as { idToken: string | null }).idToken;
    const user = await resolveAuthUser(idToken, true);
    await attributeActor(user);
    await enforceBaselineRateLimit(user);
    return next({ context: { user } });
  });

// ── Assertions ────────────────────────────────────────────────────────────────
// Each handler calls the assertion it needs. Throws on failure with a stable
// error message; the client surfaces these as toast errors.

export function assertAuthenticated(
  user: AuthUserContext,
): asserts user is AuthUserContext & { firebaseUid: string } {
  if (!user.firebaseUid) throw new Error("UNAUTHENTICATED");
}

export function assertUser(
  user: AuthUserContext,
): asserts user is AuthUserContext & { firebaseUid: string; dbUserId: string } {
  assertAuthenticated(user);
  if (!user.dbUserId) throw new Error("NO_PROFILE");
}

export function assertHR(
  user: AuthUserContext,
): asserts user is AuthUserContext & { firebaseUid: string; dbUserId: string } {
  assertUser(user);
  if (!user.isHR) throw new Error("FORBIDDEN");
}

export function assertAdmin(
  user: AuthUserContext,
): asserts user is AuthUserContext & { firebaseUid: string; dbUserId: string } {
  assertUser(user);
  if (!user.isAdmin) throw new Error("FORBIDDEN");
}
