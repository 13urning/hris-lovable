import { describe, it, expect } from "vitest";
import { computeOtHours, formatOtRange, to12Hour } from "@/lib/ot-hours";

describe("computeOtHours", () => {
  it("computes a normal same-day window", () => {
    expect(computeOtHours("20:00", "23:30")).toEqual({
      hours: 3.5,
      overnight: false,
      minutes: 210,
    });
  });

  it("handles overnight (end past midnight)", () => {
    expect(computeOtHours("20:00", "01:00")).toEqual({ hours: 5, overnight: true, minutes: 300 });
  });

  it("handles a full overnight shift", () => {
    expect(computeOtHours("22:00", "06:00")).toEqual({ hours: 8, overnight: true, minutes: 480 });
  });

  it("rejects a zero-length window (from == to) rather than calling it 24h", () => {
    expect(computeOtHours("20:00", "20:00")).toBeNull();
    expect(computeOtHours("00:00", "00:00")).toBeNull();
  });

  it("accepts a one-minute window", () => {
    expect(computeOtHours("20:00", "20:01")).toEqual({ hours: 0.02, overnight: false, minutes: 1 });
  });

  it("treats the midnight boundary as a one-minute overnight window", () => {
    expect(computeOtHours("23:59", "00:00")).toEqual({ hours: 0.02, overnight: true, minutes: 1 });
  });

  it("rounds to 2 decimals", () => {
    // 20 min = 0.333.. → 0.33; 10 min = 0.166.. → 0.17
    expect(computeOtHours("20:00", "20:20")?.hours).toBe(0.33);
    expect(computeOtHours("20:00", "20:10")?.hours).toBe(0.17);
  });

  it("returns null for malformed input", () => {
    for (const bad of ["8:00", "24:00", "20:60", "2000", "", "20:0", "ab:cd"]) {
      expect(computeOtHours(bad, "21:00")).toBeNull();
      expect(computeOtHours("20:00", bad)).toBeNull();
    }
  });
});

describe("to12Hour", () => {
  it("formats HH:MM and tolerates HH:MM:SS from the DB", () => {
    expect(to12Hour("20:00")).toBe("8:00 PM");
    expect(to12Hour("20:00:00")).toBe("8:00 PM");
    expect(to12Hour("00:05")).toBe("12:05 AM");
    expect(to12Hour("12:00")).toBe("12:00 PM");
    expect(to12Hour("13:30")).toBe("1:30 PM");
  });
});

describe("formatOtRange", () => {
  it("formats a full window", () => {
    expect(formatOtRange("20:00", "01:00")).toBe("8:00 PM – 1:00 AM");
  });
  it("returns null when either endpoint is missing (legacy/budget rows)", () => {
    expect(formatOtRange(null, "01:00")).toBeNull();
    expect(formatOtRange("20:00", null)).toBeNull();
    expect(formatOtRange(null, null)).toBeNull();
  });
});
