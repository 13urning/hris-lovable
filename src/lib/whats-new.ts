import type { AuthRole } from "@/lib/auth-middleware";

// ─────────────────────────────────────────────────────────────────────────────
// "What's New" — source of truth for release announcements.
//
// This is the ONLY thing to maintain: when you ship a notable feature, add ONE
// entry below in the same PR. There is no admin UI, no database content to
// curate. The modal (src/components/WhatsNewModal.tsx) shows a user the MAJOR,
// role-matched entries they haven't seen yet, once, on login.
//
// Rules (small discipline, big payoff — see the migration header):
//   • `id` is a stable slug. NEVER reuse or rename it once shipped — it is the
//     per-user "seen" key. Reusing an id hides the new content from anyone who
//     dismissed the old one.
//   • Don't mutate `publishedAt` of an already-shipped entry (it feeds the
//     new-hire cutoff). To re-announce, ship a NEW entry with a new id.
//   • `major: true` is the only thing that pops a modal. Use it sparingly — a
//     genuine feature, not a copy tweak. `major: false` entries are reserved for
//     a future quiet "history" view and never interrupt anyone.
//   • `roles` targets who sees it: `"all"` for everyone, or a list — an entry is
//     shown to a user if ANY of its roles is one of the user's roles.
//   • `highlights` render as PLAIN TEXT bullets. Never put HTML here; it is never
//     dangerouslySetInnerHTML'd.
//
// Newest-first is conventional but not load-bearing — the server sorts by
// `publishedAt` before display.
// ─────────────────────────────────────────────────────────────────────────────

export type WhatsNewEntry = {
  /** Stable, immutable slug. The per-user "seen" key. Never reuse. */
  id: string;
  /** PH calendar date "YYYY-MM-DD" the feature shipped. Feeds the new-hire cutoff. */
  publishedAt: string;
  title: string;
  /** Short bullet points. Rendered as text — no markup. */
  highlights: string[];
  /** Who this is for. "all", or any-of a role list. */
  roles: AuthRole[] | "all";
  /** Only `true` interrupts users with a modal. */
  major: boolean;
};

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: "whats-new-launch",
    publishedAt: "2026-07-06",
    title: "Introducing “What’s New”",
    highlights: [
      "You’ll get a quick heads-up here whenever we ship a notable feature.",
      "You only see announcements relevant to your role — no noise.",
      "Dismiss it once and it won’t show again.",
    ],
    roles: "all",
    major: true,
  },
  {
    id: "admin-calendar-reminders",
    publishedAt: "2026-07-04",
    title: "Calendar events with in-app reminders",
    highlights: [
      "Schedule org events — reviews, meetings, deadlines — including recurring ones.",
      "Set reminders that land in the notification bell, no email needed.",
      "Leave, OT, and attendance-dispute approvals now show in the same inbox.",
    ],
    roles: ["hr", "admin"],
    major: true,
  },

  // Template for the next feature — copy, give it a fresh id, and fill in:
  // {
  //   id: "unique-stable-slug",
  //   publishedAt: "YYYY-MM-DD",
  //   title: "Short, human title",
  //   highlights: ["What changed, in plain language.", "Another point."],
  //   roles: "all", // or ["employee"], ["hr", "admin"], ...
  //   major: true,  // false = no modal (quiet history only)
  // },
];
