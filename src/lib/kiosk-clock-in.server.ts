// Device-facing kiosk clock-in endpoint (NFC scanner -> POST /api/kiosk/clock-in).
//
// This is the FIRST raw HTTP route in the app. The interactive clock-in
// (dtr-functions.ts -> clockInDTR) authenticates a human via a Firebase ID token;
// an unattended NFC reader has no such session, so this path authenticates the
// DEVICE with a static API key and resolves the employee from the scanned code.
//
// Security posture (see design doc / security-gate notes):
//   - Auth fails CLOSED - no/invalid key => 401; missing KIOSK_API_KEYS => 401 for all.
//   - Scanned value is only ever used as a parameterized query value ($1).
//   - work_date / time_in / lateness are derived from SERVER PH time, never from
//     the device - a tampered kiosk clock can't backdate a punch or dodge lateness.
//   - Idempotent via UNIQUE(employee_id, work_date) - a re-tap never overwrites
//     the original punch.
//   - Response exposes only the employee's display name (no UUID/email) to limit
//     what a caller can learn by probing codes.
import { createHash, timingSafeEqual } from "node:crypto";
import { pool } from "@/lib/db.server";
import { resolveClientIp, assertOnOfficeNetwork } from "@/lib/office-network-functions";

// -- PH time -------------------------------------------------------------------
// Cloud Run runs in UTC; the business operates in PH (UTC+8, no DST). These mirror
// the canonical helpers in dtr-functions.ts and are kept local on purpose so the
// device path stays self-contained and can never regress the interactive flow.
function phNow(): Date {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}
// Company-wide tardiness rule: any clock-in after 09:00 PH is late. Identical to
// dtr-functions.ts (LATE_CUTOFF_MINUTES) - duplicated intentionally (see above).
const LATE_CUTOFF_MINUTES = 9 * 60;
function lateMinutesFor(timeIn: string): number {
  const [h, m] = timeIn.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return Math.max(0, h * 60 + m - LATE_CUTOFF_MINUTES);
}

// -- Device authentication -----------------------------------------------------
// KIOSK_API_KEYS is a comma-separated list of `key:label` pairs, e.g.
//   "abc123...:kiosk-lobby-01,def456...:kiosk-floor-02"
// Multiple pairs support several readers and key rotation with no code/schema
// change (add the new key, deploy, swap devices, drop the old key next deploy).
type DeviceKey = { key: string; label: string };

function loadDeviceKeys(): DeviceKey[] {
  const raw = process.env.KIOSK_API_KEYS ?? "";
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(":");
      if (idx === -1) return { key: pair, label: "unnamed" };
      return { key: pair.slice(0, idx).trim(), label: pair.slice(idx + 1).trim() || "unnamed" };
    })
    .filter((d) => d.key.length > 0);
}

// Constant-time compare. Hash both sides to a fixed 32-byte digest first so
// timingSafeEqual never throws on length mismatch (the throw path would itself
// leak length).
function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Returns the matched device label, or null when no configured key matches.
// Iterates ALL keys with no early return so total work doesn't depend on which
// key matched (keeps comparison timing flat across devices). Fails closed.
function authenticateDevice(provided: string | null): string | null {
  if (!provided) return null;
  let matchedLabel: string | null = null;
  for (const d of loadDeviceKeys()) {
    if (constantTimeEqual(provided, d.key)) matchedLabel = d.label;
  }
  return matchedLabel;
}

// -- Rate limiting -------------------------------------------------------------
// Per-client-IP sliding window. Throttles tap-storms AND brute-forcing the device
// key. NOTE: in-memory => per Cloud Run instance, not globally shared. That's an
// accepted abuse-damper at kiosk volume; the UNIQUE(employee_id, work_date)
// constraint is the real correctness backstop. Keep the service's max-instances
// low for the kiosk's traffic.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 10_000;
const rateBuckets = new Map<string, number[]>();

function rateLimited(bucketKey: string): boolean {
  const now = Date.now();
  const hits = (rateBuckets.get(bucketKey) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rateBuckets.set(bucketKey, hits);
  return hits.length > RATE_LIMIT;
}

// Control chars (incl. newlines / NUL) are never valid in a scanned code and
// could pollute logs - reject rather than sanitize. Checked by code point so no
// control byte appears in this source.
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

// -- Response helper -----------------------------------------------------------
function json(
  status: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...(extraHeaders ?? {}) },
  });
}

export async function handleKioskClockIn(request: Request): Promise<Response> {
  const ip = resolveClientIp(request);

  if (request.method !== "POST") {
    return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" }, { allow: "POST" });
  }

  // Throttle early - before auth - so this also caps device-key guessing.
  if (rateLimited(ip)) {
    return json(429, { ok: false, code: "RATE_LIMITED" }, { "retry-after": "10" });
  }

  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return json(415, { ok: false, code: "UNSUPPORTED_MEDIA_TYPE" });
  }

  // Device auth - fail closed.
  const deviceLabel = authenticateDevice(request.headers.get("x-kiosk-key"));
  if (!deviceLabel) {
    console.warn(`[kiosk] unauthorized ip=${ip}`);
    return json(401, { ok: false, code: "UNAUTHORIZED" });
  }

  // Parse + validate body (size-capped before parse).
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json(400, { ok: false, code: "INVALID_REQUEST" });
  }
  if (raw.length > 4096) return json(400, { ok: false, code: "INVALID_REQUEST" });

  let parsed: { employeeCode?: unknown; deviceId?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return json(400, { ok: false, code: "INVALID_REQUEST" });
  }

  const employeeCode = typeof parsed.employeeCode === "string" ? parsed.employeeCode.trim() : "";
  if (!employeeCode || employeeCode.length > 64 || hasControlChars(employeeCode)) {
    return json(400, { ok: false, code: "INVALID_REQUEST" });
  }
  const deviceId = typeof parsed.deviceId === "string" ? parsed.deviceId.trim().slice(0, 64) : "";

  try {
    // Geofence - same control as the interactive clock-in. Fails OPEN when no
    // office networks are configured; the device key is the always-on gate.
    try {
      await assertOnOfficeNetwork(pool, ip);
    } catch {
      console.warn(`[kiosk] off_network device=${deviceLabel} ip=${ip}`);
      return json(403, { ok: false, code: "OFF_NETWORK" });
    }

    // Resolve scanned code -> employee. employee_code has no UNIQUE constraint, so
    // LIMIT 2 lets us refuse an ambiguous match rather than clock in the wrong
    // person. Always parameterized - never string-interpolated.
    const { rows: matches } = await pool.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM profiles WHERE employee_code = $1 LIMIT 2`,
      [employeeCode],
    );
    if (matches.length === 0) {
      console.warn(`[kiosk] not_found device=${deviceLabel} code=${employeeCode}`);
      return json(404, { ok: false, code: "EMPLOYEE_NOT_FOUND" });
    }
    if (matches.length > 1) {
      console.warn(`[kiosk] ambiguous device=${deviceLabel} code=${employeeCode}`);
      return json(409, { ok: false, code: "AMBIGUOUS_EMPLOYEE" });
    }
    const employee = matches[0];

    const now = phNow();
    const workDate = now.toISOString().slice(0, 10); // YYYY-MM-DD (PH)
    const timeIn = now.toISOString().slice(11, 16); // HH:MM (PH)
    const lateMinutes = lateMinutesFor(timeIn);

    // Idempotent upsert: ON CONFLICT DO NOTHING means a second tap the same day is
    // a safe no-op and is race-safe (exactly one of two concurrent taps inserts).
    const { rows: inserted } = await pool.query<{ id: string }>(
      `INSERT INTO daily_time_reports
         (employee_id, work_date, time_in, shift_label, cutoff_id, is_undertime, undertime_minutes, late_minutes)
       VALUES ($1, $2, $3, NULL, NULL, FALSE, 0, $4)
       ON CONFLICT (employee_id, work_date) DO NOTHING
       RETURNING id`,
      [employee.id, workDate, timeIn, lateMinutes],
    );

    if (inserted.length === 0) {
      // Already clocked in today - return the existing punch, unchanged.
      const { rows: existing } = await pool.query<{ time_in: string | null }>(
        `SELECT time_in FROM daily_time_reports WHERE employee_id = $1 AND work_date = $2`,
        [employee.id, workDate],
      );
      console.log(`[kiosk] already device=${deviceLabel} emp=${employee.id} date=${workDate}`);
      return json(200, {
        ok: true,
        code: "ALREADY_CLOCKED_IN",
        employee: { name: employee.full_name },
        timeIn: existing[0]?.time_in?.slice(0, 5) ?? null,
        workDate,
      });
    }

    console.log(
      `[kiosk] clocked_in device=${deviceLabel} deviceId=${deviceId} emp=${employee.id} date=${workDate} time=${timeIn} late=${lateMinutes}`,
    );
    return json(201, {
      ok: true,
      code: "CLOCKED_IN",
      employee: { name: employee.full_name },
      timeIn,
      workDate,
      lateMinutes,
    });
  } catch (err) {
    // Never leak SQL/stack to the device.
    console.error("[kiosk] server_error", err);
    return json(500, { ok: false, code: "SERVER_ERROR" });
  }
}
