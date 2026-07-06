import type { AuthRole } from "@/lib/auth-middleware";
import type { WhatsNewEntry } from "@/lib/whats-new";

// Pure selection logic for the What's New modal — no server/db imports, so it's
// cheap to unit-test and safe to import anywhere. The server functions
// (whats-new-functions.ts) call visibleEntries with the code-defined WHATS_NEW
// array plus the caller's per-user state.

export function roleMatch(entry: WhatsNewEntry, roles: AuthRole[]): boolean {
  return entry.roles === "all" || entry.roles.some((r) => roles.includes(r));
}

// Start of an entry's PH-calendar publish day, as an absolute instant. PH is a
// fixed UTC+8 with no DST, so the literal offset is exact. Comparing this to the
// user's watermark means "entry's day began after you joined" — so an entry
// published on a user's own join day counts as before-their-time (no flood).
export function publishInstant(publishedAt: string): number {
  return new Date(`${publishedAt}T00:00:00+08:00`).getTime();
}

// The single source of truth for "what should this user see": MAJOR entries,
// role-matched, published after their watermark, not already dismissed, oldest
// first. Used by BOTH getMyWhatsNew (to render) and dismissWhatsNew (to claim as
// seen), so the two can never disagree about the set.
export function visibleEntries(
  entries: WhatsNewEntry[],
  roles: AuthRole[],
  watermark: string | null,
  seen: Set<string>,
  now: number = Date.now(),
): WhatsNewEntry[] {
  // A missing watermark should only ever occur transiently mid-migration; treat
  // it as "now" (show nothing) rather than "beginning of time" (flood).
  const cutoff = watermark ? new Date(watermark).getTime() : now;
  return entries
    .filter(
      (e) =>
        e.major && roleMatch(e, roles) && !seen.has(e.id) && publishInstant(e.publishedAt) > cutoff,
    )
    .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
}
