import { describe, it, expect } from "vitest";
import {
  validateAllRequestsInput,
  ALL_REQUESTS_MAX_RANGE_DAYS,
  ALL_REQUESTS_ROW_LIMIT,
} from "@/lib/all-requests";

// NOTE: `fetchAllRequests` is a TanStack Start server function wired to
// authMiddleware + assertAdmin + the DB pool — it is intentionally not
// exercised here (same rationale as report-functions.test.ts). The pure part
// — `validateAllRequestsInput`, shared with the server function's handler —
// IS fully covered below. The SQL itself was checked by hand against the
// migrations / cloud-sql-schema.sql; see the report to the requesting agent
// for whether a live DB was reachable to sanity-check it directly.

describe("validateAllRequestsInput", () => {
  it("passes a valid input straight through", () => {
    expect(validateAllRequestsInput({ startDate: "2026-07-01", endDate: "2026-07-31" })).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-31",
    });
  });

  it("allows a same-day range", () => {
    expect(validateAllRequestsInput({ startDate: "2026-07-10", endDate: "2026-07-10" })).toEqual({
      startDate: "2026-07-10",
      endDate: "2026-07-10",
    });
  });

  describe("INVALID_INPUT (shape)", () => {
    it.each([
      [null],
      [undefined],
      ["2026-07-01"],
      [42],
      [[]],
      [{}],
      [{ startDate: "2026-07-01" }],
      [{ endDate: "2026-07-01" }],
      [{ startDate: 20260701, endDate: "2026-07-31" }],
      [{ startDate: "2026-07-01", endDate: null }],
    ])("rejects %j", (bad) => {
      expect(() => validateAllRequestsInput(bad)).toThrowError("INVALID_INPUT");
    });
  });

  describe("INVALID_DATE (calendar validity)", () => {
    it("rejects a fake calendar date (Feb 30)", () => {
      expect(() =>
        validateAllRequestsInput({ startDate: "2026-02-01", endDate: "2026-02-30" }),
      ).toThrowError("INVALID_DATE");
    });

    it("rejects a malformed date", () => {
      expect(() =>
        validateAllRequestsInput({ startDate: "2026/07/01", endDate: "2026-07-31" }),
      ).toThrowError("INVALID_DATE");
    });

    it("rejects month 13", () => {
      expect(() =>
        validateAllRequestsInput({ startDate: "2026-13-01", endDate: "2026-13-05" }),
      ).toThrowError("INVALID_DATE");
    });

    it("rejects year 0000 rather than letting Postgres throw on the cast", () => {
      expect(() =>
        validateAllRequestsInput({ startDate: "0000-01-01", endDate: "0000-01-02" }),
      ).toThrowError("INVALID_DATE");
    });
  });

  describe("INVALID_RANGE", () => {
    it("rejects end before start", () => {
      expect(() =>
        validateAllRequestsInput({ startDate: "2026-07-31", endDate: "2026-07-01" }),
      ).toThrowError("INVALID_RANGE");
    });
  });

  describe("RANGE_TOO_LARGE", () => {
    it(`allows exactly ${ALL_REQUESTS_MAX_RANGE_DAYS} days`, () => {
      // 2024 is a leap year, so 2024-01-01 .. 2025-01-01 spans exactly 366 days.
      expect(() =>
        validateAllRequestsInput({ startDate: "2024-01-01", endDate: "2025-01-01" }),
      ).not.toThrow();
    });

    it(`rejects ${ALL_REQUESTS_MAX_RANGE_DAYS + 1} days`, () => {
      expect(() =>
        validateAllRequestsInput({ startDate: "2024-01-01", endDate: "2025-01-02" }),
      ).toThrowError("RANGE_TOO_LARGE");
    });
  });

  it("exposes the row limit and range cap as stable constants", () => {
    expect(ALL_REQUESTS_ROW_LIMIT).toBe(5000);
    expect(ALL_REQUESTS_MAX_RANGE_DAYS).toBe(366);
  });
});
