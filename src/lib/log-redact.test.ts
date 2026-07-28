// Evidence artifact for the security gate and for an RA 10173 privacy review.
//
// Section 4.2 of the Deployment Security Document states seven NEGATIVE claims
// about what never reaches a log line. Each `describe` below corresponds to one
// of them, in order. These are not conventions being documented — they are the
// assertions that make the claims checkable, so a reviewer can run this file
// rather than take the design's word for it.
//
// The fixtures are deliberately realistic: a real PostgreSQL exclusion-violation
// error whose `detail` echoes literal row values, and a real handler input
// payload of the shape every catch site has in scope.
import { describe, it, expect } from "vitest";
import { redactError, redactContext, scrubString } from "@/lib/log-redact";

const EMP_UUID = "a3f1e2d4-5b6c-4890-9234-567890123456";

// The exclusion violation the leave no-overlap constraint raises. `detail` here
// is exactly what PostgreSQL produces, and it contains an employee UUID and a
// date lifted verbatim out of the offending row.
function pgExclusionViolation() {
  const err = new Error(
    'conflicting key value violates exclusion constraint "leave_requests_no_overlap"',
  ) as Error & Record<string, unknown>;
  err.name = "error";
  err.code = "23P01";
  err.constraint = "leave_requests_no_overlap";
  err.severity = "ERROR";
  err.routine = "check_exclusion_or_unique_constraint";
  err.detail = `Key (employee_id, tsrange(...))=(${EMP_UUID}, ["2026-07-24 00:00:00","2026-07-25 00:00:00")) conflicts with existing key.`;
  err.hint = "Check the employee's existing leave for that range.";
  err.where = "SQL statement in PL/pgSQL function";
  err.internalQuery = "SELECT 1 FROM leave_requests WHERE employee_id = $1";
  err.parameters = [EMP_UUID, "2026-07-24"];
  err.query = "INSERT INTO leave_requests (employee_id, reason) VALUES ($1, $2)";
  err.table = "leave_requests";
  return err;
}

// The 42P08 that caused the four-day silent outage. err.code is the field whose
// absence made that incident so expensive to diagnose, so it must survive.
function pgParamTypeError() {
  const err = new Error("could not determine data type of parameter $5") as Error &
    Record<string, unknown>;
  err.name = "error";
  err.code = "42P08";
  err.severity = "ERROR";
  err.routine = "check_parameter_resolution";
  return err;
}

describe("claim 1 — no names, emails, addresses or government identifiers", () => {
  it("drops an email interpolated into an error message", () => {
    const out = redactError(new Error("no profile for maria.santos@wavehris.ph"));
    expect(out.message).toBe("no profile for [email]");
    expect(JSON.stringify(out)).not.toContain("maria.santos");
  });

  it("drops an email that reaches the stack", () => {
    const err = new Error("boom") as Error;
    err.stack = "Error: boom\n    at handler (/app/x.js:1:1) user=alex.panganiban@wavehris.ph";
    expect(redactError(err).stack).not.toContain("@wavehris.ph");
  });

  it("redacts government-ID-shaped digit runs (TIN, SSS, PhilHealth, Pag-IBIG)", () => {
    expect(scrubString("TIN 123-456-789-000")).toBe("TIN [id]");
    expect(scrubString("SSS 3412345678")).toBe("SSS [id]");
    expect(scrubString("PhilHealth 12 3456789012")).toBe("PhilHealth [id]");
  });

  it("leaves short digit runs alone so ordinary numbers stay readable", () => {
    expect(scrubString("latency 184 ms, 12 rows")).toBe("latency 184 ms, 12 rows");
    expect(scrubString("filed for 2026-07-24")).toBe("filed for 2026-07-24");
  });

  it("DELIBERATELY over-redacts a full timestamp — this is not a bug", () => {
    // "2026-07-24 00:00:00" carries 14 digits and trips the sweep. Erring toward
    // over-redaction is the correct failure direction for a compliance control,
    // and adding a date-shaped exemption would hand anyone a formatting trick
    // for smuggling an identifier past it. The record's own Cloud Logging
    // timestamp is the authoritative one, so nothing operational is lost.
    expect(scrubString("at 2026-07-24 00:00:00")).toContain("[id]");
  });

  it("cannot be tricked by a forged parking sentinel in the input", () => {
    // scrubString parks UUIDs behind a private-use sentinel while it sweeps for
    // digit runs. A caller who plants that sentinel must not be able to make a
    // parked UUID restore into the wrong place.
    const SENTINEL = "\uE000";
    const forged = `${SENTINEL}0${SENTINEL} and ${EMP_UUID}`;
    // The planted sentinel is stripped; the genuine UUID still round-trips.
    expect(scrubString(forged)).toBe(`0 and ${EMP_UUID}`);
  });

  it("PRESERVES actor UUIDs — pseudonymous identity is the point", () => {
    expect(scrubString(`resolved ${EMP_UUID}`)).toBe(`resolved ${EMP_UUID}`);
    expect(redactContext({ dbUserId: EMP_UUID }).dbUserId).toBe(EMP_UUID);
  });

  it("drops employeeCode — the badge number is a direct identifier", () => {
    // The device endpoints used to interpolate this into not-found and
    // ambiguous-match lines. employeeId (a UUID) is permitted; the code is not.
    const out = redactContext({
      serverFn: "handleDeviceClockIn",
      employeeId: EMP_UUID,
      employeeCode: "EMP-00417",
      label: "lobby-nfc",
    });
    expect(out).toEqual({
      serverFn: "handleDeviceClockIn",
      employeeId: EMP_UUID,
      label: "lobby-nfc",
    });
  });

  it("never emits email or full_name from a context bag, even when handed them", () => {
    const out = redactContext({
      dbUserId: EMP_UUID,
      email: "maria.santos@wavehris.ph",
      full_name: "Maria Santos",
      fullName: "Maria Santos",
      address: "12 Mabini St, Makati",
    });
    expect(out).toEqual({ dbUserId: EMP_UUID });
  });
});

describe("claim 2 — no free-text reason or review notes, and no input payload at all", () => {
  it("drops a handler input payload wholesale", () => {
    const out = redactContext({
      serverFn: "fileLeaveRequest",
      data: {
        leaveType: "SL",
        reason: "chemotherapy session, will be unreachable",
        startDate: "2026-07-24",
      },
    });
    expect(out).toEqual({ serverFn: "fileLeaveRequest" });
    expect(JSON.stringify(out)).not.toContain("chemotherapy");
  });

  it("drops reason and review_notes even when passed as top-level scalars", () => {
    const out = redactContext({
      serverFn: "rejectLeaveStep",
      reason: "employee is being managed out",
      review_notes: "performance concerns discussed privately",
      notes: "see HR file",
    });
    expect(out).toEqual({ serverFn: "rejectLeaveStep" });
  });

  it("drops the payload on the ERROR path too — the path most likely to log it", () => {
    const err = pgExclusionViolation();
    const serialised = JSON.stringify(redactError(err));
    expect(serialised).not.toContain("reason");
    expect(serialised).not.toContain("INSERT INTO");
  });
});

describe("claim 3 — no salary, leave credits or performance scores", () => {
  it("drops compensation and evaluation fields from a context bag", () => {
    const out = redactContext({
      serverFn: "fetchMyProfile",
      salary: 85000,
      monthly_rate: 85000,
      vl_remaining: 8,
      sl_remaining: 15,
      score: 4.5,
      rating: "exceeds",
    });
    expect(out).toEqual({ serverFn: "fetchMyProfile" });
  });
});

describe("claim 4 — no PostgreSQL detail, hint, where, internalQuery or parameters", () => {
  const out = redactError(pgExclusionViolation());
  const serialised = JSON.stringify(out);

  it("keeps the fields that make an error diagnosable", () => {
    expect(out.code).toBe("23P01");
    expect(out.constraint).toBe("leave_requests_no_overlap");
    expect(out.severity).toBe("ERROR");
    expect(out.routine).toBe("check_exclusion_or_unique_constraint");
  });

  it("drops detail, which echoes literal row values", () => {
    expect(serialised).not.toContain("conflicts with existing key");
    expect(serialised).not.toContain("2026-07-24 00:00:00");
  });

  it("drops hint, where, internalQuery, parameters and query", () => {
    expect(serialised).not.toContain("Check the employee");
    expect(serialised).not.toContain("PL/pgSQL");
    expect(serialised).not.toContain("SELECT 1 FROM leave_requests");
    expect(serialised).not.toContain("INSERT INTO");
  });

  it("drops any field not on the allowlist — a new pg field cannot leak by default", () => {
    const err = pgParamTypeError();
    (err as Record<string, unknown>).someFutureFieldWithRowData =
      `employee ${EMP_UUID} salary 85000`;
    expect(JSON.stringify(redactError(err))).not.toContain("salary");
  });

  it("preserves the SQLSTATE that was missing on 23 July", () => {
    expect(redactError(pgParamTypeError()).code).toBe("42P08");
  });
});

describe("claim 5 — no tokens, passwords, device keys or auth headers", () => {
  it("drops credential-shaped keys from a context bag", () => {
    const out = redactContext({
      serverFn: "clockIn",
      idToken: "eyJhbGciOiJSUzI1NiIsImtpZCI6IjE",
      authorization: "Bearer eyJhbGciOiJSUzI1NiI",
      "x-device-key": "dev_live_8f3a2b1c",
      deviceKey: "dev_live_8f3a2b1c",
      DB_PASSWORD: "hunter2",
      sessionToken: "sess_abc123",
    });
    expect(out).toEqual({ serverFn: "clockIn" });
  });
});

describe("claim 6 — no GPS coordinates", () => {
  it("drops latitude and longitude", () => {
    const out = redactContext({
      serverFn: "clockIn",
      latitude: 14.5547,
      longitude: 121.0244,
      lat: 14.5547,
      lng: 121.0244,
      accuracy: 12,
    });
    expect(out).toEqual({ serverFn: "clockIn" });
  });
});

describe("claim 7 — no request or response bodies", () => {
  it("drops body, payload, params and headers in any nesting", () => {
    const out = redactContext({
      serverFn: "updateEmployee",
      body: { full_name: "Maria Santos", salary: 85000 },
      payload: { reason: "medical" },
      params: [EMP_UUID, "2026-07-24"],
      headers: { authorization: "Bearer x" },
      response: { rows: [{ email: "a@b.ph" }] },
    });
    expect(out).toEqual({ serverFn: "updateEmployee" });
  });

  it("drops nested objects even under an allowlisted key name", () => {
    // `constraint` is allowlisted as a string; handed an object it must not be
    // walked, or a body could ride in under a permitted name.
    const out = redactContext({ constraint: { nested: "leave_requests_no_overlap" } });
    expect(out).toEqual({});
  });
});

describe("fail-open — the logger must never break a request", () => {
  it("survives an error whose getters throw", () => {
    const hostile = {
      get message() {
        throw new Error("nope");
      },
      get stack() {
        throw new Error("nope");
      },
    };
    expect(() => redactError(hostile)).not.toThrow();
    expect(redactError(hostile)).toEqual({ name: "Error", message: "[unserialisable]" });
  });

  it("survives a circular context object", () => {
    const circular: Record<string, unknown> = { serverFn: "x" };
    circular.self = circular;
    expect(() => redactContext(circular)).not.toThrow();
    expect(redactContext(circular)).toEqual({ serverFn: "x" });
  });

  it("handles non-object throws", () => {
    expect(redactError("plain string boom").message).toBe("plain string boom");
    expect(redactError(undefined).name).toBe("Error");
    expect(redactError(null).name).toBe("Error");
    expect(() => redactContext(null)).not.toThrow();
    expect(() => redactContext([1, 2, 3])).not.toThrow();
  });

  it("clamps a runaway stack rather than emitting it whole", () => {
    const err = new Error("boom");
    err.stack = "x".repeat(50_000);
    const stack = redactError(err).stack ?? "";
    expect(stack.length).toBeLessThan(8_100);
    expect(stack).toContain("[truncated]");
  });
});
