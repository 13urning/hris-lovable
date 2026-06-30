// Device-facing attendance endpoints:
//   POST /api/attendance/clock-in  -> handleDeviceClockIn  (clocks an employee in)
//   POST /api/attendance/verify    -> handleDeviceVerify   (confirms a device key)
//
// CHANNEL-AGNOSTIC BY DESIGN. These routes know nothing about NFC specifically.
// They authenticate a trusted DEVICE (not a human) and accept an employee number
// (`employeeCode`) that the device produced. Any source that can output an
// employee number works: NFC reader, face-recognition server, fingerprint /
// biometric terminal, or a manual kiosk keypad.
//
// Each device/channel gets its own `key:label:channel` triple in DEVICE_API_KEYS,
// so keys are independently authenticated, SCOPED TO A CHANNEL, and revocable. A
// key bound to "nfc" can only submit channel=nfc; cross-channel use is refused
// (403 CHANNEL_NOT_ALLOWED). This means a leaked NFC key can't masquerade as the
// face-recognition channel.
//
// The interactive web clock-in (dtr-functions.ts -> clockInDTR) authenticates a
// human via a Firebase ID token; an unattended device has no such session, which
// is why this is a separate raw HTTP route with device-key auth.
//
// Security posture (see handover doc / security-gate notes):
//   - Auth fails CLOSED - no/invalid key => 401; missing DEVICE_API_KEYS => 401 for all.
//   - Each key is scoped to a channel; cross-channel use => 403.
//   - Scanned value is only ever used as a parameterized query value ($1).
//   - work_date / time_in / lateness are derived from SERVER PH time, never from
//     the device - a tampered device clock can't backdate a punch or dodge lateness.
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
// DEVICE_API_KEYS is a comma-separated list of `key:label:channel` triples, e.g.
//   "abc123...:nfc-lobby-01:nfc,def456...:face-gate:face,ghi789...:biometric-hr:biometric"
// The third field BINDS the key to a channel. A 2-field entry ("key:label") or a
// channel of "*" leaves the key unrestricted (any channel) for backward compat.
// Splitting on ":" is safe because base64url keys never contain ":".
// Multiple entries support several devices/channels and key rotation with no
// code/schema change.
const ANY_CHANNEL = "*";
type DeviceKey = { key: string; label: string; channel: string };

function loadDeviceKeys(): DeviceKey[] {
  const raw = process.env.DEVICE_API_KEYS ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(":").map((s) => s.trim());
      return {
        key: parts[0] ?? "",
        label: parts[1] || "unnamed",
        channel: (parts[2] || ANY_CHANNEL).toLowerCase(),
      };
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

// Non-secret, stable identifier for a key (sha256 prefix). Safe to share / log so
// an integrator can confirm WHICH credential they hold without exposing the key.
function keyId(key: string): string {
  return "kid_" + createHash("sha256").update(key).digest("hex").slice(0, 12);
}

// Returns the matched device record, or null when no configured key matches.
// Iterates ALL keys with no early return so total work doesn't depend on which
// key matched (keeps comparison timing flat across devices). Fails closed.
function authenticateDevice(provided: string | null): DeviceKey | null {
  if (!provided) return null;
  let matched: DeviceKey | null = null;
  for (const d of loadDeviceKeys()) {
    if (constantTimeEqual(provided, d.key)) matched = d;
  }
  return matched;
}

// -- Rate limiting -------------------------------------------------------------
// Per-client-IP sliding window. Throttles tap-storms AND brute-forcing the device
// key. NOTE: in-memory => per Cloud Run instance, not globally shared. That's an
// accepted abuse-damper at device volume; the UNIQUE(employee_id, work_date)
// constraint is the real correctness backstop. Keep the service's max-instances
// low for this traffic.
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

// -- Input helpers -------------------------------------------------------------
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

// `channel` is a short source slug (e.g. "nfc", "face", "biometric", "kiosk")
// used for audit attribution AND per-key scoping. Kept to a strict slug so it's
// log-safe and can never be the "*" wildcard sentinel.
const CHANNEL_RE = /^[A-Za-z0-9_-]{1,32}$/;

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

// POST /api/attendance/verify — confirms a device key without any side effect.
// Lets an integrator check they hold the right credential (and see its bound
// channel + non-secret key id) without clocking anyone in. No DB write, no
// geofence; still constant-time auth + rate limited + fail-closed.
export async function handleDeviceVerify(request: Request): Promise<Response> {
  const ip = resolveClientIp(request);

  if (request.method !== "POST") {
    return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" }, { allow: "POST" });
  }
  if (rateLimited(ip)) {
    return json(429, { ok: false, code: "RATE_LIMITED" }, { "retry-after": "10" });
  }

  const device = authenticateDevice(request.headers.get("x-device-key"));
  if (!device) {
    console.warn(`[device-verify] unauthorized ip=${ip}`);
    return json(401, { ok: false, code: "UNAUTHORIZED" });
  }

  console.log(
    `[device-verify] ok keyId=${keyId(device.key)} label=${device.label} channel=${device.channel} ip=${ip}`,
  );
  return json(200, {
    ok: true,
    code: "KEY_VALID",
    keyId: keyId(device.key),
    label: device.label,
    channel: device.channel === ANY_CHANNEL ? null : device.channel,
  });
}

export async function handleDeviceClockIn(request: Request): Promise<Response> {
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
  const device = authenticateDevice(request.headers.get("x-device-key"));
  if (!device) {
    console.warn(`[device-clockin] unauthorized ip=${ip}`);
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

  let parsed: { employeeCode?: unknown; deviceId?: unknown; channel?: unknown };
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

  // Resolve the request's channel, then enforce the key's binding. If the request
  // omits `channel`, it defaults to the key's bound channel (or the label for an
  // unrestricted key). A bound key may only act on its own channel.
  let channel: string;
  if (parsed.channel !== undefined) {
    if (typeof parsed.channel !== "string" || !CHANNEL_RE.test(parsed.channel.trim())) {
      return json(400, { ok: false, code: "INVALID_REQUEST" });
    }
    channel = parsed.channel.trim().toLowerCase();
  } else {
    channel = device.channel === ANY_CHANNEL ? device.label : device.channel;
  }
  if (device.channel !== ANY_CHANNEL && channel !== device.channel) {
    console.warn(
      `[device-clockin] channel_not_allowed keyId=${keyId(device.key)} bound=${device.channel} requested=${channel} ip=${ip}`,
    );
    return json(403, { ok: false, code: "CHANNEL_NOT_ALLOWED" });
  }

  try {
    // Geofence - same control as the interactive clock-in. Fails OPEN when no
    // office networks are configured; the device key is the always-on gate.
    try {
      await assertOnOfficeNetwork(pool, ip);
    } catch {
      console.warn(
        `[device-clockin] off_network label=${device.label} channel=${channel} ip=${ip}`,
      );
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
      console.warn(
        `[device-clockin] not_found label=${device.label} channel=${channel} code=${employeeCode}`,
      );
      return json(404, { ok: false, code: "EMPLOYEE_NOT_FOUND" });
    }
    if (matches.length > 1) {
      console.warn(
        `[device-clockin] ambiguous label=${device.label} channel=${channel} code=${employeeCode}`,
      );
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
      console.log(
        `[device-clockin] already label=${device.label} channel=${channel} emp=${employee.id} date=${workDate}`,
      );
      return json(200, {
        ok: true,
        code: "ALREADY_CLOCKED_IN",
        employee: { name: employee.full_name },
        timeIn: existing[0]?.time_in?.slice(0, 5) ?? null,
        workDate,
      });
    }

    console.log(
      `[device-clockin] clocked_in label=${device.label} channel=${channel} deviceId=${deviceId} emp=${employee.id} date=${workDate} time=${timeIn} late=${lateMinutes}`,
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
    console.error("[device-clockin] server_error", err);
    return json(500, { ok: false, code: "SERVER_ERROR" });
  }
}
