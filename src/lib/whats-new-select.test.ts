import { describe, it, expect } from "vitest";
import type { WhatsNewEntry } from "@/lib/whats-new";
import { visibleEntries, roleMatch, publishInstant } from "@/lib/whats-new-select";

const entry = (over: Partial<WhatsNewEntry> & Pick<WhatsNewEntry, "id">): WhatsNewEntry => ({
  publishedAt: "2026-06-01",
  title: "t",
  highlights: ["h"],
  roles: "all",
  major: true,
  ...over,
});

// A watermark instant that is clearly BEFORE the June entries below, so an
// "existing user" sees them. 2026-05-01 PH.
const OLD_WM = "2026-05-01T00:00:00+08:00";

describe("roleMatch", () => {
  it("matches everyone for 'all'", () => {
    expect(roleMatch(entry({ id: "a", roles: "all" }), ["employee"])).toBe(true);
  });
  it("matches when any role intersects", () => {
    expect(roleMatch(entry({ id: "a", roles: ["hr", "admin"] }), ["admin"])).toBe(true);
  });
  it("does not match when no role intersects", () => {
    expect(roleMatch(entry({ id: "a", roles: ["hr", "admin"] }), ["employee"])).toBe(false);
  });
});

describe("publishInstant", () => {
  it("anchors to PH-local midnight (UTC+8)", () => {
    // 2026-07-06 00:00 +08:00 === 2026-07-05 16:00Z
    expect(publishInstant("2026-07-06")).toBe(Date.parse("2026-07-05T16:00:00Z"));
  });
});

describe("visibleEntries", () => {
  const roles = ["employee"] as const;

  it("returns major, role-matched, unseen, post-watermark entries", () => {
    const entries = [entry({ id: "a", publishedAt: "2026-06-10" })];
    const out = visibleEntries(entries, [...roles], OLD_WM, new Set());
    expect(out.map((e) => e.id)).toEqual(["a"]);
  });

  it("excludes minor entries (never pops a modal)", () => {
    const entries = [entry({ id: "a", major: false, publishedAt: "2026-06-10" })];
    expect(visibleEntries(entries, [...roles], OLD_WM, new Set())).toEqual([]);
  });

  it("excludes entries the user has already seen", () => {
    const entries = [entry({ id: "a", publishedAt: "2026-06-10" })];
    expect(visibleEntries(entries, [...roles], OLD_WM, new Set(["a"]))).toEqual([]);
  });

  it("excludes entries whose roles don't target the user", () => {
    const entries = [entry({ id: "a", roles: ["hr", "admin"], publishedAt: "2026-06-10" })];
    expect(visibleEntries(entries, [...roles], OLD_WM, new Set())).toEqual([]);
  });

  it("hides history from a new hire whose watermark is after the entries", () => {
    const entries = [
      entry({ id: "old1", publishedAt: "2026-06-01" }),
      entry({ id: "old2", publishedAt: "2026-06-10" }),
    ];
    // Joined 2026-07-01 — everything above predates them.
    const out = visibleEntries(entries, [...roles], "2026-07-01T09:00:00+08:00", new Set());
    expect(out).toEqual([]);
  });

  it("treats an entry published on the user's own join day as before-their-time", () => {
    const entries = [entry({ id: "sameday", publishedAt: "2026-07-01" })];
    // Watermark = join at 09:00 on the same PH day. Entry anchors to 00:00 PH,
    // which is < the watermark, so it must NOT show.
    const out = visibleEntries(entries, [...roles], "2026-07-01T09:00:00+08:00", new Set());
    expect(out).toEqual([]);
  });

  it("shows an entry published the day AFTER the user joined", () => {
    const entries = [entry({ id: "next", publishedAt: "2026-07-02" })];
    const out = visibleEntries(entries, [...roles], "2026-07-01T09:00:00+08:00", new Set());
    expect(out.map((e) => e.id)).toEqual(["next"]);
  });

  it("sorts oldest-first by publishedAt", () => {
    const entries = [
      entry({ id: "newer", publishedAt: "2026-06-20" }),
      entry({ id: "older", publishedAt: "2026-06-05" }),
    ];
    const out = visibleEntries(entries, [...roles], OLD_WM, new Set());
    expect(out.map((e) => e.id)).toEqual(["older", "newer"]);
  });

  it("falls back to 'now' (shows nothing) when watermark is null", () => {
    const entries = [entry({ id: "a", publishedAt: "2026-06-10" })];
    // now() pinned well after the entry → cutoff is after it → hidden.
    const out = visibleEntries(
      entries,
      [...roles],
      null,
      new Set(),
      Date.parse("2026-08-01T00:00:00Z"),
    );
    expect(out).toEqual([]);
  });
});
