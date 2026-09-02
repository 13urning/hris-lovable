import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeAbsentDates, phDateOf } from "@/lib/attendance-absence";

// Freeze "now" so the strictly-before-today rule is deterministic regardless of
// the machine clock. PH is UTC+8, so 04:00Z on the 15th is still the 15th in PH.
const NOW = new Date("2026-09-15T04:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const NO_HOLIDAYS = new Set<string>();
// A hire date well before the ranges under test, so it never floors the scan
// (the absence-tracking start does that job in its own test).
const HIRED_LONG_AGO = "2026-06-16";

// Calendar anchors used below (all 2026): 09-01 Tue, 09-02 Wed, 09-05 Sat,
// 09-06 Sun, 09-07 Mon, 09-09 Wed, 09-14 Mon, 09-15 Tue (== frozen today).

describe("computeAbsentDates", () => {
  it("flags a plain past weekday with no clock-in and no leave", () => {
    const out = computeAbsentDates(
      "2026-09-01",
      "2026-09-01",
      new Set(),
      [],
      HIRED_LONG_AGO,
      NO_HOLIDAYS,
    );
    expect(out).toEqual(["2026-09-01"]);
  });

  it("does not flag a day the employee clocked in", () => {
    const out = computeAbsentDates(
      "2026-09-01",
      "2026-09-02",
      new Set(["2026-09-01"]),
      [],
      HIRED_LONG_AGO,
      NO_HOLIDAYS,
    );
    expect(out).toEqual(["2026-09-02"]); // Tue covered by a clock-in, Wed still absent
  });

  it("does not flag weekends", () => {
    const out = computeAbsentDates(
      "2026-09-05",
      "2026-09-06",
      new Set(),
      [],
      HIRED_LONG_AGO,
      NO_HOLIDAYS,
    );
    expect(out).toEqual([]);
  });

  it("does not flag a holiday", () => {
    const out = computeAbsentDates(
      "2026-09-01",
      "2026-09-01",
      new Set(),
      [],
      HIRED_LONG_AGO,
      new Set(["2026-09-01"]),
    );
    expect(out).toEqual([]);
  });

  it("does not flag a day covered by an approved/pending leave", () => {
    const out = computeAbsentDates(
      "2026-09-01",
      "2026-09-02",
      new Set(),
      [{ start_date: "2026-09-01", end_date: "2026-09-02" }],
      HIRED_LONG_AGO,
      NO_HOLIDAYS,
    );
    expect(out).toEqual([]);
  });

  it("never flags today or the future (the day is not over)", () => {
    // 09-14 Mon is past; 09-15 is frozen today; 09-16..18 are future.
    const out = computeAbsentDates(
      "2026-09-14",
      "2026-09-18",
      new Set(),
      [],
      HIRED_LONG_AGO,
      NO_HOLIDAYS,
    );
    expect(out).toEqual(["2026-09-14"]);
  });

  it("does not flag days before the employee was hired", () => {
    // Hired Wed 2026-09-09; the 7th (Mon) and 8th (Tue) predate them.
    const out = computeAbsentDates(
      "2026-09-07",
      "2026-09-09",
      new Set(),
      [],
      "2026-09-09",
      NO_HOLIDAYS,
    );
    expect(out).toEqual(["2026-09-09"]);
  });

  it("does not flag days before absence tracking went live", () => {
    // Tracking starts 2026-06-16; this whole range predates it.
    const out = computeAbsentDates(
      "2026-06-08",
      "2026-06-12",
      new Set(),
      [],
      "2026-01-01",
      NO_HOLIDAYS,
    );
    expect(out).toEqual([]);
  });

  it("returns nothing when start is after end", () => {
    const out = computeAbsentDates(
      "2026-09-02",
      "2026-09-01",
      new Set(),
      [],
      HIRED_LONG_AGO,
      NO_HOLIDAYS,
    );
    expect(out).toEqual([]);
  });
});

describe("phDateOf", () => {
  it("maps a late-evening UTC timestamp into the next PH calendar day", () => {
    // 20:00Z + 8h = 04:00 the next day in PH.
    expect(phDateOf("2026-09-14T20:00:00Z")).toBe("2026-09-15");
  });
});
