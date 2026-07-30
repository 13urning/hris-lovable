import { describe, it, expect } from "vitest";
import { buildReportCsv, isRealDate, REPORT_COLUMNS } from "@/lib/report-functions";

// NOTE: `generateActivityReport` is a TanStack Start server function wired to
// `authMiddleware` and the DB pool — it is intentionally not exercised here.
// The range/type/count guards (INVALID_RANGE, RANGE_TOO_LARGE, NO_TYPES) live
// inline in that handler; testing them would require either invoking the
// server function (needs a live middleware + DB pool) or refactoring the
// handler's control flow purely for testability, which was out of scope.
//
// The pure parts ARE covered: `isRealDate`, the column contract, and
// `buildReportCsv` (extracted from the handler so the escaping of free-text
// remarks could be tested). The SQL itself is not reachable from unit tests —
// it was verified by preparing and executing all three queries against a
// throwaway Postgres loaded with the production schema.

describe("isRealDate", () => {
  it("accepts valid calendar dates", () => {
    expect(isRealDate("2026-07-10")).toBe(true);
  });

  it("accepts a leap day", () => {
    expect(isRealDate("2024-02-29")).toBe(true);
  });

  it("rejects shape violations", () => {
    expect(isRealDate("07/10/2026")).toBe(false);
    expect(isRealDate("2026-7-1")).toBe(false);
    expect(isRealDate("")).toBe(false);
  });

  it("rejects regex-passing but calendar-invalid dates", () => {
    expect(isRealDate("2026-13-45")).toBe(false);
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("2025-02-29")).toBe(false); // not a leap year
  });
});

describe("report column contract", () => {
  // The CSV layout is an interface: people build spreadsheets, filters and
  // downstream imports against these positions. The remarks columns were added
  // by APPENDING precisely so nothing existing shifted, and this pins that.
  it("keeps the original columns in their original order", () => {
    const original = [
      "record_type",
      "employee_code",
      "employee_name",
      "company",
      "department",
      "email",
      "date",
      "end_date",
      "time_in",
      "time_out",
      "hours_worked",
      "late_minutes",
      "undertime_minutes",
      "is_absent",
      "leave_type",
      "leave_days",
      "half_day_period",
      "ot_requested_hours",
      "ot_request_type",
      "ot_target_month",
      "overtime_hours",
      "status",
      "reason_or_notes",
      "requested_at_ph",
    ];
    expect(REPORT_COLUMNS.slice(0, original.length)).toEqual(original);
  });

  it("exposes both halves of the commentary plus the reviewer", () => {
    expect(REPORT_COLUMNS).toContain("requester_remarks");
    expect(REPORT_COLUMNS).toContain("approver_remarks");
    expect(REPORT_COLUMNS).toContain("reviewed_by_name");
    expect(REPORT_COLUMNS).toContain("reviewed_at_ph");
  });
});

describe("buildReportCsv", () => {
  const headerOf = (csv: string) => csv.split("\r\n")[0].split(",");
  const cell = (csv: string, column: string) => {
    // Naive split is fine only for rows without quoted commas; tests that need
    // quoting assert on the raw line instead.
    const i = headerOf(csv).indexOf(column);
    return csv.split("\r\n")[1].split(",")[i];
  };

  it("emits the header even with no rows", () => {
    const csv = buildReportCsv([]);
    expect(csv).toBe(REPORT_COLUMNS.join(",") + "\r\n");
  });

  it("places each remark in its own column", () => {
    const csv = buildReportCsv([
      {
        record_type: "leave",
        requester_remarks: "family emergency",
        approver_remarks: "approved; coverage arranged",
        reviewed_by_name: "Jane Cruz",
      },
    ]);
    expect(cell(csv, "record_type")).toBe("leave");
    expect(cell(csv, "requester_remarks")).toBe("family emergency");
    // Contains a semicolon, not a comma — survives an unquoted split.
    expect(cell(csv, "approver_remarks")).toBe("approved; coverage arranged");
    expect(cell(csv, "reviewed_by_name")).toBe("Jane Cruz");
  });

  it("quotes remarks containing commas, quotes and newlines", () => {
    // Exactly what free-text remarks look like in practice, and what would
    // corrupt every following column if it were emitted raw.
    const csv = buildReportCsv([
      { requester_remarks: 'Sick, with a "fever"', approver_remarks: "line one\nline two" },
    ]);
    expect(csv).toContain('"Sick, with a ""fever"""');
    expect(csv).toContain('"line one\nline two"');
  });

  it("leaves a missing remark blank rather than writing null", () => {
    const csv = buildReportCsv([{ record_type: "overtime", approver_remarks: null }]);
    expect(cell(csv, "approver_remarks")).toBe("");
    expect(cell(csv, "requester_remarks")).toBe("");
    expect(csv).not.toContain("null");
  });

  it("neutralises a remark that would otherwise be read as a formula", () => {
    // A remark beginning with "=" is a spreadsheet formula-injection vector.
    const csv = buildReportCsv([{ approver_remarks: "=HYPERLINK(evil)" }]);
    expect(cell(csv, "approver_remarks")).toBe("'=HYPERLINK(evil)");
  });

  it("emits one line per record, CRLF-terminated", () => {
    const csv = buildReportCsv([{ record_type: "leave" }, { record_type: "overtime" }]);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.trimEnd().split("\r\n")).toHaveLength(3); // header + 2 records
  });
});
