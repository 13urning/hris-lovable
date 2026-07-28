// The middleware that closes the hole.
//
// On 23 July a Postgres 42P08 broke every leave filing for four days and wrote
// nothing to Cloud Logging. The reason is structural, not an oversight: the
// TanStack Start transport catches a server-function throw BELOW the request
// pipeline and serialises it into the RPC response body. Nothing propagates up,
// so the request middleware in start.ts, the Nitro fetch handler in server.ts
// and Cloud Run's own access logs are all blind to it.
//
// A function-type middleware is the only layer inside that boundary where the
// throw is observable. This is that layer.
//
// NON-NEGOTIABLE: this must never alter control flow. It rethrows the ORIGINAL
// error object — not a copy, not a wrapper — so every downstream `catch` that
// matches on `err.code` or `instanceof` keeps behaving exactly as before. Every
// log call is individually swallowed. It is composed into the two auth
// middlewares, through which all 106 server functions pass, so a throw in here
// would fail the entire application.
// Everything server-only is reached through a dynamic import INSIDE the
// .server() closure — the established pattern in this codebase (see
// auth-middleware's db and rate-limit imports). This module is pulled into the
// client bundle through auth-middleware, so a static `@tanstack/react-start/server`
// or `node:async_hooks` import here fails the build's import-protection pass.
import { createMiddleware } from "@tanstack/react-start";

// TanStack posts server functions to `${TSS_SERVER_FN_BASE}${functionId}`, where
// the build-generated id looks like
//   src_lib_leave-functions_ts--fileLeaveRequest_createServerFn_handler
// The readable name in the middle is the label we want: it is the dimension the
// per-function failure alert groups on, and it is bounded (106 values), so it is
// safe as a Cloud Logging label.
const ID_NOISE = /_createServerFn_handler$|^.*--/g;

// Pure and isomorphic so it can be unit-tested without a request. Takes the URL
// as a string rather than reaching for getRequest(), which also keeps the
// server-only import out of this module's top level.
export function serverFnLabel(requestUrl: string): string {
  try {
    const url = new URL(requestUrl);
    const marker = "/_serverFn/";
    const at = url.pathname.indexOf(marker);
    const raw =
      at >= 0
        ? decodeURIComponent(url.pathname.slice(at + marker.length))
        : (url.searchParams.get("_serverFnId") ?? "");
    if (!raw) return "unknown";
    const name = raw.replace(ID_NOISE, "");
    // Guard the label against anything unexpected in the id: cap the length and
    // keep it to identifier characters so one malformed request can't create a
    // high-cardinality label and inflate the log-based metric.
    return (name || raw).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "unknown";
  } catch {
    return "unknown";
  }
}

export const observabilityMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const startedAt = Date.now();
    let serverFn = "unknown";
    let logInfo: LogInfo = noopInfo;
    let logError: LogError = noopError;
    try {
      const [{ getRequest }, log, { RATE_LIMIT_MESSAGE }] = await Promise.all([
        import("@tanstack/react-start/server"),
        import("@/lib/log.server"),
        import("@/lib/rate-limit.server"),
      ]);
      logInfo = log.logInfo;
      logError = log.logError;
      expectedOutcomes.set(RATE_LIMIT_MESSAGE, "RATE_LIMITED");
      serverFn = serverFnLabel(getRequest().url);
    } catch {
      // Resolving the logger must never cost the request. If it fails we run
      // with no-ops and the handler below is unaffected.
    }

    try {
      const result = await next();
      logInfo("server_fn", {
        serverFn,
        outcome: "ok",
        latencyMs: Date.now() - startedAt,
      });
      return result;
    } catch (err) {
      // Thrown assertion strings (UNAUTHENTICATED, FORBIDDEN, NOT_PENDING …) are
      // ordinary authorization outcomes, not faults. Logging them at ERROR would
      // train Error Reporting to treat a user hitting a permission boundary as a
      // new incident, and would drown the signal this build exists to produce.
      const message = err instanceof Error ? err.message : String(err);
      const expected = expectedOutcomes.get(message);
      if (expected) {
        logInfo("server_fn", {
          serverFn,
          outcome: "denied",
          latencyMs: Date.now() - startedAt,
          reason_code: expected,
        });
      } else {
        logError("server_fn_failed", err, {
          serverFn,
          outcome: "error",
          latencyMs: Date.now() - startedAt,
        });
      }
      // The original object, unmodified. This line is the contract.
      throw err;
    }
  },
);

// Business outcomes the application throws deliberately as flow control, mapped
// to a stable low-cardinality code. These are logged at INFO with
// outcome=denied so they stay queryable — a spike in FORBIDDEN or RATE_LIMITED
// is worth seeing — without polluting the error signal that Error Reporting
// groups on.
//
// Anything NOT in this map is treated as a fault. That default is deliberate:
// an unrecognised throw is exactly what 42P08 was, and it must be loud.
type LogInfo = (message: string, fields?: Record<string, unknown>) => void;
type LogError = (message: string, err?: unknown, fields?: Record<string, unknown>) => void;
const noopInfo: LogInfo = () => {};
const noopError: LogError = () => {};

export const expectedOutcomes = new Map<string, string>([
  ["UNAUTHENTICATED", "UNAUTHENTICATED"],
  ["NO_PROFILE", "NO_PROFILE"],
  ["FORBIDDEN", "FORBIDDEN"],
  ["NOT_FOUND", "NOT_FOUND"],
  ["NOT_PENDING", "NOT_PENDING"],
  ["NOT_CURRENT_APPROVER", "NOT_CURRENT_APPROVER"],
  ["OVERLAPPING_LEAVE", "OVERLAPPING_LEAVE"],
  ["INSUFFICIENT_BALANCE", "INSUFFICIENT_BALANCE"],
  ["HALF_DAY_PERIOD_REQUIRED", "HALF_DAY_PERIOD_REQUIRED"],
  ["EMPLOYEE_REQUIRED", "EMPLOYEE_REQUIRED"],
  ["NO_ORG_NODE", "NO_ORG_NODE"],
  // RATE_LIMIT_MESSAGE is a user-facing sentence rather than a code, so it is
  // registered at runtime (from the dynamic import above) and mapped to a short
  // label instead of being used verbatim.
]);
