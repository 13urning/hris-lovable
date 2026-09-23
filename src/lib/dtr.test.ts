import { describe, it, expect } from "vitest";
import { formatDateWithDay } from "@/lib/dtr";

describe("formatDateWithDay", () => {
  it("adds the weekday after the date", () => {
    expect(formatDateWithDay("2026-08-22")).toBe("Aug 22, 2026 Saturday");
    expect(formatDateWithDay("2026-08-24")).toBe("Aug 24, 2026 Monday");
  });

  it("uses the PH calendar day for timestamps, not the UTC one", () => {
    // 17:00 UTC on the 22nd is 01:00 on the 23rd in Manila.
    expect(formatDateWithDay("2026-08-22T17:00:00.000Z")).toBe("Aug 23, 2026 Sunday");
    expect(formatDateWithDay("2026-08-22T15:59:00.000Z")).toBe("Aug 22, 2026 Saturday");
  });

  it("renders a dash for a missing date", () => {
    expect(formatDateWithDay(null)).toBe("—");
    expect(formatDateWithDay(undefined)).toBe("—");
    expect(formatDateWithDay("")).toBe("—");
  });
});
