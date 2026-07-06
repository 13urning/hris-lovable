import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, assertUser } from "@/lib/auth-middleware";
import { WHATS_NEW } from "@/lib/whats-new";
import { visibleEntries } from "@/lib/whats-new-select";

// Stable error codes assertUser can throw; anything else is masked to
// INTERNAL_ERROR so raw pg/runtime internals never reach a client toast.
const KNOWN_ERRORS = new Set(["UNAUTHENTICATED", "NO_PROFILE", "FORBIDDEN"]);

function rethrowMapped(err: unknown): never {
  if (err instanceof Error && KNOWN_ERRORS.has(err.message)) throw err;
  console.error("whats-new-functions:", err);
  throw new Error("INTERNAL_ERROR");
}

async function loadState(me: string): Promise<{ watermark: string | null; seen: Set<string> }> {
  const { pool } = await import("@/lib/db.server");
  const [prof, seenRes] = await Promise.all([
    pool.query<{ whats_new_watermark: string | null }>(
      `SELECT whats_new_watermark FROM profiles WHERE id = $1`,
      [me],
    ),
    pool.query<{ entry_id: string }>(`SELECT entry_id FROM whats_new_seen WHERE user_id = $1`, [
      me,
    ]),
  ]);
  return {
    watermark: prof.rows[0]?.whats_new_watermark ?? null,
    seen: new Set(seenRes.rows.map((r) => r.entry_id)),
  };
}

// The polling entrypoint. Returns exactly the entries to render, or [] when
// there's nothing new. Read-only — no state is mutated on view (the watermark is
// managed by the DB default/backfill; "seen" is written only on dismiss).
export const getMyWhatsNew = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    try {
      const { watermark, seen } = await loadState(context.user.dbUserId);
      return { entries: visibleEntries(WHATS_NEW, context.user.roles, watermark, seen) };
    } catch (err) {
      rethrowMapped(err);
    }
  });

// Acknowledge everything the user is currently being shown. Takes NO client
// input: the server recomputes the exact set getMyWhatsNew would return and
// claims those ids as seen. Nothing to trust or validate, and no IDOR surface —
// user_id comes from the verified token, never the body. Idempotent via the PK.
export const dismissWhatsNew = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const me = context.user.dbUserId;
    try {
      const { watermark, seen } = await loadState(me);
      const ids = visibleEntries(WHATS_NEW, context.user.roles, watermark, seen).map((e) => e.id);
      if (ids.length === 0) return { ok: true };

      const { pool } = await import("@/lib/db.server");
      await pool.query(
        `INSERT INTO whats_new_seen (user_id, entry_id)
         SELECT $1, x FROM unnest($2::text[]) AS x
         ON CONFLICT (user_id, entry_id) DO NOTHING`,
        [me, ids],
      );
      return { ok: true };
    } catch (err) {
      rethrowMapped(err);
    }
  });
