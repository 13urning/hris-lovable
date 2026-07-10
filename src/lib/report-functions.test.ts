import { describe, it, expect } from "vitest";
import { isRealDate } from "@/lib/report-functions";

// NOTE: `generateActivityReport` is a TanStack Start server function wired to
// `authMiddleware` and the DB pool — it is intentionally not exercised here.
// The range/type/count guards (INVALID_RANGE, RANGE_TOO_LARGE, NO_TYPES) live
// inline in that handler; testing them would require either invoking the
// server function (needs a live middleware + DB pool) or refactoring the
// handler's control flow purely for testability, which was out of scope.
// Only the pure `isRealDate` guard is unit-tested below.

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
