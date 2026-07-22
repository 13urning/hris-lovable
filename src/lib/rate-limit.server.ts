// Shared in-process rate limiter for the server-function (RPC) layer.
//
// Every createServerFn goes through the auth middleware (lib/auth-middleware.ts),
// which is the single choke point where a baseline limit is enforced for ALL
// endpoints. Individual handlers can add a tighter per-operation limit on top for
// abuse-prone writes (e.g. leave filing) by calling enforceRateLimit directly.
//
// The algorithm mirrors the sliding-window damper already proven on the device
// attendance endpoints (lib/device-clock-in.server.ts), lifted here so it can be
// shared instead of copy-pasted.
//
// SCOPE / LIMITATION: state is in-memory, so a window is counted PER Cloud Run
// INSTANCE, not globally. Under scale-out a single caller's requests can spread
// across instances and the effective limit multiplies by the instance count. This
// is deliberately an abuse DAMPER, not a hard quota — the authoritative correctness
// guards remain in the handlers (leave-balance checks, ownership/role assertions,
// DB UNIQUE constraints). For a hard, cluster-wide quota, back this with a shared
// store (Redis / a Postgres counter). See docs/soc-security-spec.md.

export type RateLimitRule = {
  /** Max requests allowed within the window before the next one is rejected. */
  limit: number;
  /** Sliding-window length in milliseconds. */
  windowMs: number;
};

// Baseline applied to EVERY authenticated server function via the auth middleware.
// Generous on purpose: a single page load fans out several server-fn calls (loaders
// + hydration + parallel queries), so this must clear normal interactive bursts
// while still stopping a script that hammers hundreds of calls per minute.
export const GLOBAL_RATE_LIMIT: RateLimitRule = { limit: 300, windowMs: 60_000 };

// Tight limit for an employee filing their own leave. A human files one or two in a
// sitting; anything past a handful per minute is scripted abuse (the incident this
// was added for). Applied on top of the global baseline.
export const LEAVE_WRITE_RATE_LIMIT: RateLimitRule = { limit: 6, windowMs: 60_000 };

// HR/admin filing leave on behalf of employees may legitimately process a small
// batch back-to-back, so this is looser than the self-service limit but still caps
// runaway automation.
export const LEAVE_ONBEHALF_RATE_LIMIT: RateLimitRule = { limit: 30, windowMs: 60_000 };

// Longest window any rule above uses. The periodic sweep drops buckets whose most
// recent hit is older than this — safe because a bucket that cold means it can't be
// throttling anything under any rule. Bump if a longer-windowed rule is added.
const MAX_WINDOW_MS = 60_000;

// bucketKey -> ascending list of hit timestamps (ms). Keyed per caller-and-scope so
// one user hammering one endpoint can't starve other users or other endpoints.
const buckets = new Map<string, number[]>();

// Opportunistic memory reclamation. The live key set is bounded by (active users +
// pre-auth IPs) x scopes, but transient/anonymous IPs would otherwise linger for a
// full window; sweep every SWEEP_EVERY calls to keep the map from accreting them.
let opsSinceSweep = 0;
const SWEEP_EVERY = 500;

function sweep(now: number): void {
  const deadline = now - MAX_WINDOW_MS;
  for (const [key, hits] of buckets) {
    if (hits.length === 0 || hits[hits.length - 1] <= deadline) buckets.delete(key);
  }
}

// User-facing message. It surfaces verbatim in the client's error toasts (handlers
// throw and the UI shows err.message), so it is a plain sentence, not a code.
export const RATE_LIMIT_MESSAGE = "Too many requests — please slow down and try again in a moment.";

/**
 * Record a hit against `bucketKey` and throw when it exceeds `rule` within the
 * sliding window. Call it BEFORE doing the work you want to protect. The recorded
 * hit is kept even when the limit is exceeded, so sustained abuse stays throttled
 * for the remainder of the window rather than being let through once traffic dips.
 */
export function enforceRateLimit(bucketKey: string, rule: RateLimitRule): void {
  const now = Date.now();
  if (++opsSinceSweep >= SWEEP_EVERY) {
    opsSinceSweep = 0;
    sweep(now);
  }

  const cutoff = now - rule.windowMs;
  const hits = (buckets.get(bucketKey) ?? []).filter((t) => t > cutoff);
  hits.push(now);
  buckets.set(bucketKey, hits);

  if (hits.length > rule.limit) {
    throw new Error(RATE_LIMIT_MESSAGE);
  }
}

// Test-only: reset the shared window store so unit tests don't leak state between
// cases. Not used by application code.
export function __resetRateLimiterForTests(): void {
  buckets.clear();
  opsSinceSweep = 0;
}
