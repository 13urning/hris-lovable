import { describe, expect, it } from "vitest";
import { generateOccurrenceDates, MAX_OCCURRENCES_PER_SERIES } from "./recurrence";

// These invariants are the security posture of recurring events (caps bound
// the write fan-out; edge rules are the product contract) — keep them green.
describe("generateOccurrenceDates", () => {
  it("weekly repeats on the anchor weekday", () => {
    expect(generateOccurrenceDates("2026-07-06", "weekly", 1, "2026-08-03")).toEqual([
      "2026-07-06",
      "2026-07-13",
      "2026-07-20",
      "2026-07-27",
      "2026-08-03",
    ]);
  });

  it("interval > 1 (biweekly)", () => {
    expect(generateOccurrenceDates("2026-07-06", "weekly", 2, "2026-08-03")).toEqual([
      "2026-07-06",
      "2026-07-20",
      "2026-08-03",
    ]);
  });

  it("monthly on the 31st clamps to short months and never walks", () => {
    expect(generateOccurrenceDates("2026-01-31", "monthly", 1, "2026-06-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
    ]);
  });

  it("monthly clamp lands on Feb 29 in leap years", () => {
    expect(generateOccurrenceDates("2028-01-31", "monthly", 1, "2028-03-31")).toEqual([
      "2028-01-31",
      "2028-02-29",
      "2028-03-31",
    ]);
  });

  it("yearly anchored to Feb 29 skips non-leap years", () => {
    expect(generateOccurrenceDates("2028-02-29", "yearly", 1, "2031-02-28")).toEqual([
      "2028-02-29",
    ]);
  });

  it("plain yearly", () => {
    expect(generateOccurrenceDates("2026-09-15", "yearly", 1, "2028-12-31")).toEqual([
      "2026-09-15",
      "2027-09-15",
      "2028-09-15",
    ]);
  });

  it("daily crosses month boundaries", () => {
    expect(generateOccurrenceDates("2026-07-30", "daily", 1, "2026-08-02")).toEqual([
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });

  it("quarterly = monthly x3", () => {
    expect(generateOccurrenceDates("2026-01-15", "monthly", 3, "2026-12-31")).toEqual([
      "2026-01-15",
      "2026-04-15",
      "2026-07-15",
      "2026-10-15",
    ]);
  });

  it("throws TOO_MANY_OCCURRENCES past the cap", () => {
    expect(() => generateOccurrenceDates("2026-01-01", "daily", 1, "2026-12-31")).toThrow(
      "TOO_MANY_OCCURRENCES",
    );
  });

  it(`allows exactly ${MAX_OCCURRENCES_PER_SERIES} occurrences at the boundary`, () => {
    expect(generateOccurrenceDates("2026-01-05", "weekly", 1, "2027-12-27")).toHaveLength(
      MAX_OCCURRENCES_PER_SERIES,
    );
  });

  it("throws HORIZON_EXCEEDED past 3 years", () => {
    expect(() => generateOccurrenceDates("2026-07-03", "yearly", 1, "2029-07-04")).toThrow(
      "HORIZON_EXCEEDED",
    );
  });

  it("allows the horizon boundary exactly", () => {
    expect(generateOccurrenceDates("2026-07-03", "yearly", 1, "2029-07-03")).toEqual([
      "2026-07-03",
      "2027-07-03",
      "2028-07-03",
      "2029-07-03",
    ]);
  });

  it("throws NO_OCCURRENCES when until precedes the anchor", () => {
    expect(() => generateOccurrenceDates("2026-07-10", "weekly", 1, "2026-07-09")).toThrow(
      "NO_OCCURRENCES",
    );
  });

  it("until = anchor yields the single anchor occurrence", () => {
    expect(generateOccurrenceDates("2026-07-10", "monthly", 1, "2026-07-10")).toEqual([
      "2026-07-10",
    ]);
  });
});
