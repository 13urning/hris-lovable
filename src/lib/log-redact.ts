// What may be written to a log record — the RA 10173 technical control.
//
// This module is ALLOWLIST-based on purpose. A denylist ("strip these dangerous
// fields") starts leaking the first time something upstream grows a new
// property: a `pg` minor version adds a field, someone attaches a payload to an
// error, and the logger happily writes it. An allowlist fails the other way —
// an unrecognised field is dropped by default and the worst case is a log line
// that is less useful than it could have been.
//
// The dangerous surface here is NOT console.log. It is:
//   - `pg` error objects, whose `detail` echoes literal row values on a
//     constraint violation (e.g. "Key (employee_id, work_date)=(<uuid>, …)")
//   - the handler's input payload, in scope at every catch site, carrying the
//     free-text `reason` fields that employees fill with medical detail
// Neither is ever serialisable through this module.
//
// Pure and isomorphic — no server-only imports — so the test suite can prove
// each negative claim without standing up a server. That suite is the evidence
// artifact for the security gate and for a privacy review, so the assertions
// here are deliberately testable rather than conventional.

// Error fields that may be written. `detail`, `hint`, `where`, `internalQuery`,
// `parameters`, `query` and everything else on a pg error are dropped by
// omission — they are not listed, so they cannot survive.
const ERROR_FIELDS = ["name", "code", "constraint", "severity", "routine"] as const;

// Context keys that may be written alongside a record. Anything else a caller
// passes is dropped. Actor identity is pseudonymous by construction: the UUID
// and Firebase UID are here, `email` and `full_name` deliberately are not, even
// though the auth middleware holds both in scope.
const CONTEXT_KEYS = new Set([
  "serverFn",
  "outcome",
  "latencyMs",
  "env",
  "service",
  "dbUserId",
  "firebaseUid",
  "status",
  "method",
  "path",
  "durationMs",
  "count",
  "reason_code",
  "channel",
  "constraint",
  "code",
  // Device attendance endpoints. `employeeId` is a UUID and is permitted;
  // `employeeCode` is the number printed on the badge — a DIRECT identifier —
  // and is deliberately absent so it is dropped even where the old console
  // lines used to interpolate it.
  "label",
  "keyId",
  "deviceId",
  "workDate",
  "employeeId",
  "hoursWorked",
  "lateMinutes",
  "dwellMins",
  "retryAfterMinutes",
  // Bounded, newline-stripped CSP violation slice. Attacker-influenced, so it
  // is carried in its own field rather than in `message`: that keeps the
  // message low-cardinality (Error Reporting groups on it) and still runs the
  // content through the scrub like any other string.
  "cspReport",
  // Source IP on device and auth events. Retained deliberately: an unauthorised
  // or off-network attempt is a security event whose whole value is knowing
  // where it came from, and these are office-network addresses rather than
  // employee home connections.
  "ip",
]);

// A stack can be long, and a runaway one would bloat ingestion (which is also a
// billing surface). 8 KB is far more than any real stack needs.
const MAX_STACK = 8_000;
const MAX_STRING = 2_000;

// UUIDs must survive the digit sweep below — the last segment of a UUID can be
// twelve hex characters that happen to all be digits, which would otherwise look
// exactly like a government ID. Actor UUIDs are the whole point of pseudonymous
// logging, so they are protected before the sweep and restored after.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// EVERY quantifier here is BOUNDED, and that is load-bearing rather than
// cosmetic. With an unbounded `+` on the local part, a long run of email-legal
// characters that never reaches an `@` costs O(n²): the run is consumed, the `@`
// fails, the engine gives back one character at a time, then restarts the whole
// walk one position to the right. A 50 KB stack of such characters took seconds
// and could stall the request this module promises never to break.
//
// The bounds are the RFC 5321 limits (local part ≤ 64 octets, domain ≤ 255), so
// no real address is missed — and each start position now costs at most 64
// attempts instead of n, which makes the sweep linear.
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g;
// Candidate runs of digits with optional spaces/dashes. The replacer counts the
// actual digits and only redacts at 9+, which is the shortest PH government ID
// shape (TIN 9–12, SSS 10, PhilHealth 12, Pag-IBIG 12).
const DIGIT_RUN_RE = /\d[\d\s-]{6,}\d/g;

// Sentinel used to park UUIDs while the digit sweep runs. A Unicode private-use
// character: it cannot occur in a stack, an SQLSTATE or a constraint name, so the
// round-trip is unambiguous — and unlike a control character it is visible in
// source and does not trip no-control-regex.
const PARK = "\uE000";
const PARKED_RE = /\uE000(\d+)\uE000/g;

// Last-pass sweep over any string bound for a log line. This is a BACKSTOP, not
// the primary control — the allowlist above is. It exists to catch an accidental
// interpolation (`throw new Error(\`no user \${email}\`)`) that reaches the
// emitter inside an otherwise-allowlisted field such as a stack or a message.
export function scrubString(input: string): string {
  const uuids: string[] = [];
  // Strip any pre-existing sentinel so a caller cannot forge one and cause a
  // wrong restoration, then park each UUID behind an index token.
  let out = input.split(PARK).join("");
  out = out.replace(UUID_RE, (m) => `${PARK}${uuids.push(m) - 1}${PARK}`);
  out = out.replace(EMAIL_RE, "[email]");
  out = out.replace(DIGIT_RUN_RE, (m) => {
    const digits = m.replace(/\D/g, "").length;
    return digits >= 9 ? "[id]" : m;
  });
  return out.replace(PARKED_RE, (_, i) => uuids[Number(i)] ?? "");
}

function clamp(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

export type RedactedError = {
  name?: string;
  code?: string;
  constraint?: string;
  severity?: string;
  routine?: string;
  stack?: string;
  message?: string;
};

// Reduce any thrown value to the allowlisted shape. Never throws: a getter that
// blows up or a circular structure degrades the field, not the request.
export function redactError(err: unknown): RedactedError {
  const out: RedactedError = {};
  try {
    if (typeof err === "string") {
      out.name = "Error";
      out.message = clamp(scrubString(err), MAX_STRING);
      return out;
    }
    if (err === null || typeof err !== "object") {
      out.name = "Error";
      out.message = clamp(scrubString(String(err)), MAX_STRING);
      return out;
    }
    const rec = err as Record<string, unknown>;
    for (const field of ERROR_FIELDS) {
      const v = rec[field];
      if (typeof v === "string" && v !== "") out[field] = clamp(scrubString(v), MAX_STRING);
    }
    // The message is an app-authored string (e.g. "OVERLAPPING_LEAVE") and is
    // the most useful single field, but it is also the one most likely to carry
    // an interpolated identifier — so it goes through the sweep like any other.
    if (typeof rec.message === "string") {
      out.message = clamp(scrubString(rec.message), MAX_STRING);
    }
    if (typeof rec.stack === "string") {
      out.stack = clamp(scrubString(rec.stack), MAX_STACK);
    }
    if (!out.name) out.name = "Error";
  } catch {
    return { name: "Error", message: "[unserialisable]" };
  }
  return out;
}

// Reduce a caller-supplied context bag to allowlisted keys and scalar values.
// Objects and arrays are dropped wholesale rather than walked — a nested
// structure is how a request body would sneak in, and there is no legitimate
// reason for a log dimension to be one.
export function redactContext(ctx: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  try {
    if (ctx === null || typeof ctx !== "object" || Array.isArray(ctx)) return out;
    for (const [k, v] of Object.entries(ctx as Record<string, unknown>)) {
      if (!CONTEXT_KEYS.has(k)) continue;
      if (typeof v === "string") out[k] = clamp(scrubString(v), MAX_STRING);
      else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
      else if (typeof v === "boolean") out[k] = v;
      // null, undefined, objects, arrays and functions are omitted.
    }
  } catch {
    return {};
  }
  return out;
}
