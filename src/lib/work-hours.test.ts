import { describe, it, expect } from "vitest";
import {
  computeDayFlags,
  computeWorkedHours,
  FULL_DAY_COVERAGE,
  hhmmOfMinutes,
  lateMinutesFor,
  leaveCoverageFor,
  minutesOfDay,
  selfReportCapMinutes,
  STANDARD_HOURS,
  validateSelfReportedTimeOut,
} from "@/lib/work-hours";

const HALF_DAY = STANDARD_HOURS / 2;

// Minimal stand-in for a pg Pool/PoolClient: returns one row with the coverage
// the test wants, and records the query params for assertion.
function fakeDb(leaveFraction: string | number | null, morningCovered: boolean | null = null) {
  const calls: unknown[][] = [];
  return {
    calls,
    db: {
      query: async (_sql: string, params: unknown[]) => {
        calls.push(params);
        return { rows: [{ leave_fraction: leaveFraction, morning_covered: morningCovered }] };
      },
    } as never,
  };
}

describe("computeWorkedHours", () => {
  it("flags a short full day as undertime with the shortfall in minutes", () => {
    expect(computeWorkedHours("09:00", "13:30")).toEqual({
      hoursWorked: 4.5,
      isUndertime: true,
      undertimeMins: 270,
    });
  });

  it("does not flag a complete 9h day", () => {
    expect(computeWorkedHours("08:00", "17:00")).toEqual({
      hoursWorked: 9,
      isUndertime: false,
      undertimeMins: 0,
    });
  });

  it("does NOT flag undertime when a half-day leave halves the standard", () => {
    // The bug: 4.5h worked around an approved half-day leave used to be graded
    // against a full 9h day.
    expect(computeWorkedHours("13:00", "17:30", HALF_DAY)).toEqual({
      hoursWorked: 4.5,
      isUndertime: false,
      undertimeMins: 0,
    });
  });

  it("still flags a short half-day against the halved standard", () => {
    expect(computeWorkedHours("13:00", "16:30", HALF_DAY)).toEqual({
      hoursWorked: 3.5,
      isUndertime: true,
      undertimeMins: 60,
    });
  });

  it("never flags undertime when the whole day is on leave", () => {
    expect(computeWorkedHours("09:00", "10:00", 0)).toEqual({
      hoursWorked: 1,
      isUndertime: false,
      undertimeMins: 0,
    });
  });

  it("clamps an out-before-in punch to zero hours", () => {
    expect(computeWorkedHours("17:00", "09:00").hoursWorked).toBe(0);
  });

  it("tolerates HH:MM:SS punches as returned by pg time columns", () => {
    expect(minutesOfDay("13:30:00")).toBe(810);
    expect(computeWorkedHours("09:00:00", "18:00:00").hoursWorked).toBe(9);
  });
});

describe("lateMinutesFor", () => {
  it("counts minutes past the 09:00 cutoff", () => {
    expect(lateMinutesFor("09:15")).toBe(15);
    expect(lateMinutesFor("13:00")).toBe(240);
  });

  it("is zero on or before the cutoff", () => {
    expect(lateMinutesFor("09:00")).toBe(0);
    expect(lateMinutesFor("07:30")).toBe(0);
  });
});

describe("computeDayFlags", () => {
  it("grades a normal late, short day against the full bars", () => {
    expect(computeDayFlags({ timeIn: "10:00", timeOut: "16:00" })).toEqual({
      lateMinutes: 60,
      hoursWorked: 6,
      isUndertime: true,
      undertimeMins: 180,
    });
  });

  it("waives lateness AND undertime for an AM half-day leave", () => {
    // Employee's morning is on leave; they work 13:00–17:30 (4.5h). Previously
    // this was 240 late minutes AND undertime.
    expect(
      computeDayFlags({
        timeIn: "13:00",
        timeOut: "17:30",
        coverage: { standardHours: HALF_DAY, lateExempt: true },
      }),
    ).toEqual({ lateMinutes: 0, hoursWorked: 4.5, isUndertime: false, undertimeMins: 0 });
  });

  it("keeps the 09:00 cutoff for a PM half-day leave — they still work the morning", () => {
    expect(
      computeDayFlags({
        timeIn: "09:30",
        timeOut: "13:30",
        coverage: { standardHours: HALF_DAY, lateExempt: false },
      }),
    ).toEqual({ lateMinutes: 30, hoursWorked: 4, isUndertime: true, undertimeMins: 30 });
  });

  it("never late-flags an Official Business day", () => {
    expect(computeDayFlags({ timeIn: "11:00", shiftLabel: "OB" }).lateMinutes).toBe(0);
  });

  it("grades lateness but not hours on an open day (no clock-out yet)", () => {
    expect(computeDayFlags({ timeIn: "09:45", timeOut: null })).toEqual({
      lateMinutes: 45,
      hoursWorked: 0,
      isUndertime: false,
      undertimeMins: 0,
    });
  });

  it("defaults to the full-day bars when no coverage is passed", () => {
    expect(computeDayFlags({ timeIn: "09:30", timeOut: "18:00" })).toEqual(
      computeDayFlags({ timeIn: "09:30", timeOut: "18:00", coverage: FULL_DAY_COVERAGE }),
    );
  });
});

describe("leaveCoverageFor", () => {
  it("returns a full day and no exemption when no approved leave covers the date", async () => {
    const { db, calls } = fakeDb("0", null);
    await expect(leaveCoverageFor(db, "emp-1", "2026-07-27")).resolves.toEqual({
      standardHours: 9,
      lateExempt: false,
    });
    expect(calls[0]).toEqual(["emp-1", "2026-07-27"]);
  });

  it("halves the day and waives lateness for an AM half-day", async () => {
    const { db } = fakeDb("0.5", true);
    await expect(leaveCoverageFor(db, "emp-1", "2026-07-27")).resolves.toEqual({
      standardHours: 4.5,
      lateExempt: true,
    });
  });

  it("halves the day but keeps the cutoff for a PM half-day", async () => {
    const { db } = fakeDb("0.5", false);
    await expect(leaveCoverageFor(db, "emp-1", "2026-07-27")).resolves.toEqual({
      standardHours: 4.5,
      lateExempt: false,
    });
  });

  it("returns zero hours and waives lateness for a full-day leave", async () => {
    const { db } = fakeDb("1", true);
    await expect(leaveCoverageFor(db, "emp-1", "2026-07-27")).resolves.toEqual({
      standardHours: 0,
      lateExempt: true,
    });
  });

  it("caps at a full day when AM and PM half-days both cover the date", async () => {
    const { db } = fakeDb("1.0", true);
    await expect(leaveCoverageFor(db, "emp-1", "2026-07-27")).resolves.toEqual({
      standardHours: 0,
      lateExempt: true,
    });
  });

  it("never goes negative if overlapping filings exceed a full day", async () => {
    const { db } = fakeDb("2.5", true);
    await expect(leaveCoverageFor(db, "emp-1", "2026-07-27")).resolves.toMatchObject({
      standardHours: 0,
    });
  });

  it("falls back to a full day when the sum comes back null", async () => {
    const { db } = fakeDb(null, null);
    await expect(leaveCoverageFor(db, "emp-1", "2026-07-27")).resolves.toEqual({
      standardHours: 9,
      lateExempt: false,
    });
  });

  it("does not grant a late exemption for a malformed half-day with no period", async () => {
    // BOOL_OR skips the NULL such a row produces; NULL must not read as exempt.
    const { db } = fakeDb("0.5", null);
    await expect(leaveCoverageFor(db, "emp-1", "2026-07-27")).resolves.toEqual({
      standardHours: 4.5,
      lateExempt: false,
    });
  });
});

describe("selfReportCapMinutes", () => {
  it("caps each fixed shift at its own end, a standard day after it starts", () => {
    expect(selfReportCapMinutes("6-3", "06:00")).toBe(15 * 60);
    expect(selfReportCapMinutes("7-4", "07:00")).toBe(16 * 60);
    expect(selfReportCapMinutes("8-5", "08:00")).toBe(17 * 60);
    expect(selfReportCapMinutes("9-6", "09:00")).toBe(18 * 60);
  });

  it("keeps the shift's own end even when the employee clocked in early or late", () => {
    // The bar is the roster, not the punch: arriving early cannot extend the day,
    // and arriving late cannot push the ceiling later to make up for it.
    expect(selfReportCapMinutes("8-5", "06:30")).toBe(17 * 60);
    expect(selfReportCapMinutes("8-5", "10:45")).toBe(17 * 60);
  });

  it("measures Official Business from the actual clock-in, having no fixed end", () => {
    expect(selfReportCapMinutes("OB", "07:15")).toBe(7 * 60 + 15 + STANDARD_HOURS * 60);
  });

  it("falls back to a standard day from clock-in for a missing or junk shift", () => {
    expect(selfReportCapMinutes(null, "08:00")).toBe(8 * 60 + STANDARD_HOURS * 60);
    expect(selfReportCapMinutes("", "08:00")).toBe(8 * 60 + STANDARD_HOURS * 60);
    expect(selfReportCapMinutes("nonsense", "08:00")).toBe(8 * 60 + STANDARD_HOURS * 60);
  });
});

describe("validateSelfReportedTimeOut", () => {
  const base = { timeIn: "08:00", shiftLabel: "8-5" };

  it("accepts a time inside the shift", () => {
    expect(validateSelfReportedTimeOut({ ...base, timeOut: "16:30" })).toBeNull();
  });

  it("accepts the shift end exactly", () => {
    expect(validateSelfReportedTimeOut({ ...base, timeOut: "17:00" })).toBeNull();
  });

  it("rejects even one minute past the shift end", () => {
    expect(validateSelfReportedTimeOut({ ...base, timeOut: "17:01" })).toBe("AFTER_SHIFT_END");
  });

  it("rejects a time that would manufacture a long day", () => {
    expect(validateSelfReportedTimeOut({ ...base, timeOut: "23:59" })).toBe("AFTER_SHIFT_END");
  });

  it("rejects clocking out before or exactly at clock-in", () => {
    expect(validateSelfReportedTimeOut({ ...base, timeOut: "07:30" })).toBe("BEFORE_CLOCK_IN");
    expect(validateSelfReportedTimeOut({ ...base, timeOut: "08:00" })).toBe("BEFORE_CLOCK_IN");
  });

  it("rejects malformed input rather than coercing it", () => {
    for (const timeOut of ["", "5pm", "17", "17:60", "24:00", "1730", "17:0"]) {
      expect(validateSelfReportedTimeOut({ ...base, timeOut })).toBe("BAD_FORMAT");
    }
  });

  it("still caps a late arrival at the shift end, leaving the day undertime", () => {
    // Clocked in at 10:00 on an 8-5 and forgot to clock out: the most they can
    // claim is 17:00, i.e. 7h, which stays undertime rather than being rounded up.
    expect(
      validateSelfReportedTimeOut({ timeIn: "10:00", shiftLabel: "8-5", timeOut: "17:00" }),
    ).toBeNull();
    expect(computeWorkedHours("10:00", "17:00")).toMatchObject({
      hoursWorked: 7,
      isUndertime: true,
    });
  });
});

describe("hhmmOfMinutes", () => {
  it("formats with zero padding", () => {
    expect(hhmmOfMinutes(0)).toBe("00:00");
    expect(hhmmOfMinutes(9 * 60 + 5)).toBe("09:05");
    expect(hhmmOfMinutes(17 * 60)).toBe("17:00");
  });

  it("clamps out-of-range values into the day", () => {
    expect(hhmmOfMinutes(-30)).toBe("00:00");
    expect(hhmmOfMinutes(99 * 60)).toBe("23:59");
  });
});
