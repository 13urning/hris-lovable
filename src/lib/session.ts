// Client-side login-session expiry policy + storage helpers.
//
// Firebase keeps a user signed in indefinitely (it silently refreshes the ID
// token via the refresh token), so the app enforces its own session lifetime:
//   • Idle timeout     — log out after SESSION_IDLE_MS of no activity.
//   • Absolute cap      — log out SESSION_ABSOLUTE_MS after login regardless of
//                         activity (a session can never outlive this).
// Whichever comes first wins. Timestamps live in localStorage so the policy
// survives reloads and is shared across tabs.

export const SESSION_IDLE_MS = 60 * 60 * 1000; // 1 hour of inactivity
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000; // 12 hour hard cap from login
export const SESSION_WARN_MS = 60 * 1000; // surface the "expiring soon" warning 1 min before

const START_KEY = "wave.session.start";
const ACTIVITY_KEY = "wave.session.lastActivity";

function read(key: string): number | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(key);
  return v ? Number(v) : null;
}

function write(key: string, val: number) {
  if (typeof window !== "undefined") window.localStorage.setItem(key, String(val));
}

/** Stamp the session start + initial activity once, on first authentication.
 *  Existing values are preserved so a reload doesn't reset the clocks. */
export function ensureSessionStarted(ts: number = Date.now()) {
  if (read(START_KEY) == null) write(START_KEY, ts);
  if (read(ACTIVITY_KEY) == null) write(ACTIVITY_KEY, ts);
}

export function markActivity(ts: number = Date.now()) {
  write(ACTIVITY_KEY, ts);
}

export function getSessionStart() {
  return read(START_KEY);
}

export function getLastActivity() {
  return read(ACTIVITY_KEY);
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(START_KEY);
  window.localStorage.removeItem(ACTIVITY_KEY);
}

/** Milliseconds until the session expires (idle or absolute, whichever sooner).
 *  Returns Infinity when the session hasn't been started yet. */
export function msUntilExpiry(ts: number = Date.now()): number {
  const start = read(START_KEY);
  const last = read(ACTIVITY_KEY);
  if (start == null || last == null) return Infinity;
  return Math.min(last + SESSION_IDLE_MS, start + SESSION_ABSOLUTE_MS) - ts;
}
