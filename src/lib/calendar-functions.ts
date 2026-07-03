import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware, assertUser, assertAdmin } from "@/lib/auth-middleware";

export type EventReminder = {
  id: string;
  event_id: string;
  notify_user_id: string;
  notify_user_name: string | null;
  fire_at: string;
  offset_minutes: number;
};

export type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  location: string | null;
  created_by: string;
  created_by_name: string | null;
  // Present only for admins (authoring view); empty array for everyone else.
  reminders: EventReminder[];
};

export type AppNotification = {
  id: string;
  type: string;
  event_id: string | null;
  ref_id: string | null;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

// ── Input schemas ─────────────────────────────────────────────────────────────
// Bounds mirror the CHECK constraints in 20260703150000_calendar_events_reminders.sql
// so bad input fails fast with a stable error code instead of a raw pg error.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Cap on reminders per event, enforced on BOTH creation paths (createEvent's
// schema and addReminder's SQL guard) so neither can flood a recipient's inbox.
const MAX_REMINDERS_PER_EVENT = 10;

const reminderInputSchema = z.object({
  // Omitted = notify the creator ("remind me").
  notifyUserId: z.string().uuid().optional(),
  offsetMinutes: z.number().int().min(0).max(40320), // 0 .. 4 weeks
});

const eventFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(200).optional(),
  date: z.string().regex(DATE_RE),
  time: z.string().regex(TIME_RE).optional(),
  allDay: z.boolean().default(false),
  endDate: z.string().regex(DATE_RE).optional(),
  endTime: z.string().regex(TIME_RE).optional(),
});

const createEventSchema = eventFieldsSchema.extend({
  reminders: z.array(reminderInputSchema).max(MAX_REMINDERS_PER_EVENT).default([]),
});

const updateEventSchema = eventFieldsSchema.extend({
  id: z.string().uuid(),
});

function parseOrInvalid<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new Error("INVALID_INPUT");
  return r.data;
}

// PH wall-clock (date + HH:MM) to an absolute instant. PH is fixed UTC+8, no
// DST, so a literal offset is safe and keeps Cloud Run (UTC) and admins (PH)
// agreeing on when "9:00 AM Friday" is.
function phToInstant(date: string, time: string | undefined): Date {
  const d = new Date(`${date}T${time ?? "00:00"}:00+08:00`);
  if (isNaN(d.getTime())) throw new Error("INVALID_DATE");
  return d;
}

function eventInstants(data: z.infer<typeof eventFieldsSchema>): {
  startsAt: Date;
  endsAt: Date | null;
} {
  const startsAt = phToInstant(data.date, data.allDay ? "00:00" : data.time);
  const endsAt = data.endDate
    ? phToInstant(data.endDate, data.allDay ? "00:00" : data.endTime)
    : null;
  if (endsAt && endsAt < startsAt) throw new Error("END_BEFORE_START");
  return { startsAt, endsAt };
}

// FK violation on notify_user_id → the picked recipient doesn't exist.
function isRecipientFkError(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === "23503" && (e.constraint ?? "").includes("notify_user_id");
}

// Stable error codes the client maps to friendly toasts. Anything else is a
// raw pg/runtime error — log it server-side and hand the client an opaque code
// so schema internals (constraint names, SQLSTATE) never reach a toast.
const KNOWN_ERRORS = new Set([
  "INVALID_INPUT",
  "INVALID_DATE",
  "END_BEFORE_START",
  "INVALID_RECIPIENT",
  "REMINDER_LIMIT",
  "NOT_FOUND",
  "UNAUTHENTICATED",
  "NO_PROFILE",
  "FORBIDDEN",
]);

function rethrowMapped(err: unknown): never {
  if (isRecipientFkError(err)) throw new Error("INVALID_RECIPIENT");
  if (err instanceof Error && KNOWN_ERRORS.has(err.message)) throw err;
  console.error("calendar-functions:", err);
  throw new Error("INTERNAL_ERROR");
}

// ── Events (admin authoring) ──────────────────────────────────────────────────

export const listCalendarEvents = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    // Everyone signed in can see the org calendar. Reminder details (who gets
    // nudged, when) are authoring metadata — admins only.
    if (context.user.isAdmin) {
      const { rows } = await pool.query(
        `SELECT e.id, e.title, e.description, e.starts_at, e.ends_at, e.all_day,
                e.location, e.created_by, p.full_name AS created_by_name,
                COALESCE(r.reminders, '[]'::json) AS reminders
           FROM calendar_events e
           LEFT JOIN profiles p ON p.id = e.created_by
           LEFT JOIN LATERAL (
             SELECT json_agg(json_build_object(
                      'id', er.id,
                      'event_id', er.event_id,
                      'notify_user_id', er.notify_user_id,
                      'notify_user_name', np.full_name,
                      'fire_at', er.fire_at,
                      'offset_minutes', er.offset_minutes
                    ) ORDER BY er.fire_at) AS reminders
               FROM event_reminders er
               LEFT JOIN profiles np ON np.id = er.notify_user_id
              WHERE er.event_id = e.id
           ) r ON true
          ORDER BY e.starts_at`,
      );
      return rows as CalendarEvent[];
    }
    const { rows } = await pool.query(
      `SELECT e.id, e.title, e.description, e.starts_at, e.ends_at, e.all_day,
              e.location, e.created_by, p.full_name AS created_by_name,
              '[]'::json AS reminders
         FROM calendar_events e
         LEFT JOIN profiles p ON p.id = e.created_by
        ORDER BY e.starts_at`,
    );
    return rows as CalendarEvent[];
  });

export const createEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: z.input<typeof createEventSchema>) => data)
  .handler(async ({ data, context }) => {
    assertAdmin(context.user);
    const input = parseOrInvalid(createEventSchema, data);
    const { startsAt, endsAt } = eventInstants(input);

    const { pool } = await import("@/lib/db.server");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO calendar_events (title, description, starts_at, ends_at, all_day, location, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          input.title,
          input.description || null,
          startsAt,
          endsAt,
          input.allDay,
          input.location || null,
          context.user.dbUserId,
        ],
      );
      const eventId = rows[0].id;
      for (const rem of input.reminders) {
        const fireAt = new Date(startsAt.getTime() - rem.offsetMinutes * 60_000);
        await client.query(
          `INSERT INTO event_reminders (event_id, notify_user_id, fire_at, offset_minutes, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            eventId,
            rem.notifyUserId ?? context.user.dbUserId,
            fireAt,
            rem.offsetMinutes,
            context.user.dbUserId,
          ],
        );
      }
      await client.query("COMMIT");
      return { id: eventId };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      rethrowMapped(err);
    } finally {
      client.release();
    }
  });

export const updateEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: z.input<typeof updateEventSchema>) => data)
  .handler(async ({ data, context }) => {
    assertAdmin(context.user);
    const input = parseOrInvalid(updateEventSchema, data);
    const { startsAt, endsAt } = eventInstants(input);

    const { pool } = await import("@/lib/db.server");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rowCount } = await client.query(
        `UPDATE calendar_events
            SET title = $1, description = $2, starts_at = $3, ends_at = $4,
                all_day = $5, location = $6, updated_at = now()
          WHERE id = $7`,
        [
          input.title,
          input.description || null,
          startsAt,
          endsAt,
          input.allDay,
          input.location || null,
          input.id,
        ],
      );
      if (!rowCount) throw new Error("NOT_FOUND");
      // Re-arm undelivered reminders against the new start. Reminders that
      // already materialized keep their notification (snapshots are history).
      await client.query(
        `UPDATE event_reminders
            SET fire_at = $1::timestamptz - make_interval(mins => offset_minutes)
          WHERE event_id = $2`,
        [startsAt, input.id],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      rethrowMapped(err);
    } finally {
      client.release();
    }
  });

export const deleteEvent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    assertAdmin(context.user);
    const id = parseOrInvalid(z.string().uuid(), data.id);
    const { pool } = await import("@/lib/db.server");
    // Reminders cascade away; delivered notifications survive via SET NULL.
    const { rowCount } = await pool.query(`DELETE FROM calendar_events WHERE id = $1`, [id]);
    if (!rowCount) throw new Error("NOT_FOUND");
  });

// ── Reminders ─────────────────────────────────────────────────────────────────

export const addReminder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { eventId: string; notifyUserId?: string; offsetMinutes: number }) => data)
  .handler(async ({ data, context }) => {
    assertAdmin(context.user);
    const input = parseOrInvalid(reminderInputSchema.extend({ eventId: z.string().uuid() }), data);
    const { pool } = await import("@/lib/db.server");
    try {
      const { rowCount } = await pool.query(
        `INSERT INTO event_reminders (event_id, notify_user_id, fire_at, offset_minutes, created_by)
         SELECT e.id, $2, e.starts_at - make_interval(mins => $3::int), $3, $4
           FROM calendar_events e
          WHERE e.id = $1
            AND (SELECT count(*) FROM event_reminders r WHERE r.event_id = e.id) < $5`,
        [
          input.eventId,
          input.notifyUserId ?? context.user.dbUserId,
          input.offsetMinutes,
          context.user.dbUserId,
          MAX_REMINDERS_PER_EVENT,
        ],
      );
      if (!rowCount) {
        // Zero rows is either a missing event or the cap — disambiguate.
        const { rowCount: exists } = await pool.query(
          `SELECT 1 FROM calendar_events WHERE id = $1`,
          [input.eventId],
        );
        throw new Error(exists ? "REMINDER_LIMIT" : "NOT_FOUND");
      }
    } catch (err) {
      rethrowMapped(err);
    }
  });

export const deleteReminder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    assertAdmin(context.user);
    const id = parseOrInvalid(z.string().uuid(), data.id);
    const { pool } = await import("@/lib/db.server");
    const { rowCount } = await pool.query(`DELETE FROM event_reminders WHERE id = $1`, [id]);
    if (!rowCount) throw new Error("NOT_FOUND");
  });

// Recipient picker for the authoring UI.
export const fetchProfilesForEventPicker = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertAdmin(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, full_name, department FROM profiles ORDER BY full_name`,
    );
    return rows as { id: string; full_name: string; department: string | null }[];
  });

// ── Notifications (the in-app inbox) ─────────────────────────────────────────

// The polling entrypoint. Lazily materializes the CALLER'S due reminders into
// notification rows, then returns the inbox. There is no cron: a reminder due
// while the recipient was offline surfaces on their next poll, which is the
// desired inbox behavior. The partial unique index on notifications(reminder_id)
// makes the INSERT the atomic claim — concurrent polls (or the 3 prod Cloud Run
// instances) can race freely and at most one insert wins per reminder.
export const getMyNotifications = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const me = context.user.dbUserId;
    const { pool } = await import("@/lib/db.server");

    await pool.query(
      `INSERT INTO notifications (user_id, type, reminder_id, event_id, title, body)
       SELECT r.notify_user_id, 'event_reminder', r.id, r.event_id, e.title,
              CASE
                WHEN e.all_day THEN 'On ' || to_char(e.starts_at AT TIME ZONE 'Asia/Manila', 'Mon FMDD, YYYY')
                WHEN r.offset_minutes = 0 THEN 'Happening now'
                ELSE 'Starts ' || to_char(e.starts_at AT TIME ZONE 'Asia/Manila', 'Mon FMDD, YYYY FMHH12:MI AM')
              END
         FROM event_reminders r
         JOIN calendar_events e ON e.id = r.event_id
        WHERE r.notify_user_id = $1
          AND r.fire_at <= now()
       ON CONFLICT (reminder_id) WHERE reminder_id IS NOT NULL DO NOTHING`,
      [me],
    );

    // Opportunistic retention: read notifications older than 90 days age out.
    await pool.query(
      `DELETE FROM notifications
        WHERE user_id = $1 AND read_at IS NOT NULL AND created_at < now() - interval '90 days'`,
      [me],
    );

    const [countRes, listRes] = await Promise.all([
      pool.query<{ unread: number }>(
        `SELECT count(*) FILTER (WHERE read_at IS NULL)::int AS unread
           FROM notifications WHERE user_id = $1`,
        [me],
      ),
      pool.query(
        `SELECT id, type, event_id, ref_id, title, body, read_at, created_at
           FROM notifications
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 50`,
        [me],
      ),
    ]);
    return {
      unreadCount: countRes.rows[0]?.unread ?? 0,
      items: listRes.rows as AppNotification[],
    };
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const id = parseOrInvalid(z.string().uuid(), data.id);
    const { pool } = await import("@/lib/db.server");
    // Owner-scoped: a forged id no-ops instead of touching someone else's row.
    await pool.query(
      `UPDATE notifications SET read_at = now()
        WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
      [id, context.user.dbUserId],
    );
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    await pool.query(
      `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
      [context.user.dbUserId],
    );
  });
