// Structured log emitter for Cloud Logging.
//
// Cloud Run captures stdout and Cloud Logging parses a single-line JSON object
// into real, queryable fields — so a logging library would add bundle weight and
// a transitive supply-chain surface for no capability we don't already get from
// the platform. This is ~200 lines of first-party code with zero runtime deps.
//
// THE RULE THIS MODULE LIVES BY: logging never participates in control flow.
// Every emit is individually try-caught and swallowed. A serialisation fault, a
// full pipe, a hostile getter — all of them degrade one log line and nothing
// else. This module is wired into the middleware every authenticated request
// passes through, so a throw in here would fail 100% of the application.
import { AsyncLocalStorage } from "node:async_hooks";
import { redactContext, redactError, scrubString } from "@/lib/log-redact";

const PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "wave-hris-498916";

// Cloud Run injects K_SERVICE automatically, with no configuration required.
// APP_ENV is the documented control, but deriving from K_SERVICE as a fallback
// means environment labelling still works if someone forgets to set it — which
// matters, because alert policies filter on this label and a mislabelled record
// is an alert that silently never fires.
const SERVICE = process.env.K_SERVICE ?? "local";

function resolveEnv(): string {
  const explicit = process.env.APP_ENV;
  if (explicit) return explicit;
  if (SERVICE === "wave-hris") return "production";
  if (SERVICE === "wave-hris-staging") return "staging";
  if (SERVICE === "local") return "development";
  // An unrecognised Cloud Run service. Default to production rather than
  // "unknown": over-alerting is noisy and gets fixed within a day, whereas an
  // unmatched label means production errors quietly raise nothing — which is
  // precisely the failure this whole build exists to end.
  return "production";
}

const ENV = resolveEnv();

export type Severity = "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL";

// Carried for the life of one request so every record emitted while serving a
// single user action shares a trace and reads as one thread in Log Explorer.
export type RequestContext = {
  traceId?: string;
  spanId?: string;
  method?: string;
  path?: string;
  // Filled in by the auth middleware once the token has been verified, so a
  // record emitted anywhere later in the request can attribute the actor
  // without the caller having to thread it through. Pseudonymous only.
  dbUserId?: string | null;
  firebaseUid?: string | null;
};

const requestStore = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestStore.run(ctx, fn);
}

export function currentRequestContext(): RequestContext | undefined {
  return requestStore.getStore();
}

// Attach the resolved actor to the in-flight request so later records inherit
// it. Mutates the store object in place — the store is per-request, so this
// cannot leak an identity across requests.
export function setRequestActor(dbUserId: string | null, firebaseUid: string | null): void {
  try {
    const ctx = requestStore.getStore();
    if (!ctx) return;
    ctx.dbUserId = dbUserId;
    ctx.firebaseUid = firebaseUid;
  } catch {
    /* never throws */
  }
}

// Cloud Run sets X-Cloud-Trace-Context: TRACE_ID/SPAN_ID;o=TRACE_TRUE.
// Parsed defensively — a malformed header must never cost us the request.
export function parseTraceContext(header: string | null | undefined): RequestContext {
  if (!header) return {};
  try {
    const [tracePart] = header.split(";");
    const [traceId, spanId] = tracePart.split("/");
    if (!traceId || !/^[0-9a-f]{8,32}$/i.test(traceId)) return {};
    const ctx: RequestContext = { traceId };
    if (spanId && /^\d+$/.test(spanId)) {
      // Cloud Trace sends the span as a decimal; Cloud Logging wants 16-char hex.
      ctx.spanId = BigInt(spanId).toString(16).padStart(16, "0");
    }
    return ctx;
  } catch {
    return {};
  }
}

export type LogFields = {
  serverFn?: string;
  outcome?: "ok" | "error" | "denied";
  latencyMs?: number;
  dbUserId?: string | null;
  firebaseUid?: string | null;
  status?: number;
  method?: string;
  path?: string;
  [key: string]: unknown;
};

type CloudLogRecord = Record<string, unknown>;

function write(record: CloudLogRecord): void {
  try {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  } catch {
    // Deliberately empty. If we cannot write a log line there is nothing useful
    // left to do, and throwing here would take down the request.
  }
}

function build(severity: Severity, message: string, fields: LogFields, err?: unknown) {
  const ctx = currentRequestContext() ?? {};
  const safe = redactContext(fields);

  const labels: Record<string, string> = { env: ENV, service: SERVICE };
  if (typeof safe.serverFn === "string") labels.serverFn = safe.serverFn;

  const record: CloudLogRecord = {
    severity,
    // Kept short, stable and low-cardinality — never an interpolated value.
    // Cardinality here drives Error Reporting's grouping quality.
    message: scrubString(message),
    "logging.googleapis.com/labels": labels,
    ...safe,
  };

  if (ctx.traceId) {
    record["logging.googleapis.com/trace"] = `projects/${PROJECT_ID}/traces/${ctx.traceId}`;
  }
  if (ctx.spanId) record["logging.googleapis.com/spanId"] = ctx.spanId;

  // Actor identity is pseudonymous by construction. redactContext already
  // dropped anything else; these two are UUIDs and survive on purpose. An
  // explicit field wins over the request-scoped one so a caller can attribute a
  // record to a different subject (e.g. HR acting on another employee).
  const actor: Record<string, string> = {};
  const ctxDbUserId = typeof safe.dbUserId === "string" ? safe.dbUserId : ctx.dbUserId;
  const ctxUid = typeof safe.firebaseUid === "string" ? safe.firebaseUid : ctx.firebaseUid;
  if (typeof ctxDbUserId === "string" && ctxDbUserId) actor.dbUserId = ctxDbUserId;
  if (typeof ctxUid === "string" && ctxUid) actor.firebaseUid = ctxUid;
  if (Object.keys(actor).length > 0) record.actor = actor;
  delete record.dbUserId;
  delete record.firebaseUid;

  if (err !== undefined) record.err = redactError(err);

  // This @type is what makes Error Reporting group the record by stack
  // signature and notify on a signature it has never seen before — the control
  // that turns a four-day outage into a five-minute one.
  if (severity === "ERROR" || severity === "CRITICAL") {
    record["@type"] =
      "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent";
    // Error Reporting reads the stack out of `message`, so it has to carry the
    // stack text — while `err` keeps the structured fields for Log Explorer.
    const stack = (record.err as { stack?: string } | undefined)?.stack;
    if (stack) record.message = `${scrubString(message)}\n${stack}`;
  }

  return record;
}

export function logInfo(message: string, fields: LogFields = {}): void {
  try {
    write(build("INFO", message, fields));
  } catch {
    /* never throws */
  }
}

export function logWarn(message: string, fields: LogFields = {}): void {
  try {
    write(build("WARNING", message, fields));
  } catch {
    /* never throws */
  }
}

export function logError(message: string, err?: unknown, fields: LogFields = {}): void {
  try {
    write(build("ERROR", message, fields, err ?? new Error(message)));
  } catch {
    /* never throws */
  }
}

export function logCritical(message: string, err?: unknown, fields: LogFields = {}): void {
  try {
    write(build("CRITICAL", message, fields, err ?? new Error(message)));
  } catch {
    /* never throws */
  }
}

// An httpRequest field renders as a first-class request record in Log Explorer
// rather than as loose properties.
export function logHttpRequest(fields: {
  method?: string;
  path?: string;
  status?: number;
  latencyMs?: number;
}): void {
  try {
    const record = build("INFO", "request", {
      status: fields.status,
      method: fields.method,
      path: fields.path,
      latencyMs: fields.latencyMs,
    });
    record.httpRequest = {
      requestMethod: fields.method,
      requestUrl: fields.path,
      status: fields.status,
      latency:
        fields.latencyMs !== undefined ? `${(fields.latencyMs / 1000).toFixed(3)}s` : undefined,
    };
    write(record);
  } catch {
    /* never throws */
  }
}

// Process-level faults. The existing error-capture module guarded on
// globalThis.addEventListener, which is undefined under Node — so these have
// been discarded silently for the life of the service.
let processHandlersInstalled = false;

export function installProcessHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;
  try {
    process.on("unhandledRejection", (reason) => {
      logError("unhandled_rejection", reason);
    });
    process.on("uncaughtException", (err) => {
      logCritical("uncaught_exception", err);
      // Exit non-zero so Cloud Run replaces the instance. A process that has
      // taken an uncaught exception is in an undefined state and should not
      // keep serving requests.
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 100).unref();
    });
  } catch {
    /* never throws */
  }
}

// Emitted once at startup so a missing APP_ENV is itself visible in the logs
// rather than being a silent misconfiguration discovered during an incident.
export function logStartup(): void {
  if (!process.env.APP_ENV && SERVICE !== "local") {
    logWarn("app_env_not_set", { service: SERVICE, env: ENV });
  }
  logInfo("server_start", { service: SERVICE, env: ENV });
}

export const __testing = { resolveEnv, ENV, SERVICE, PROJECT_ID };
