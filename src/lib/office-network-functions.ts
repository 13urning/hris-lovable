import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { authMiddleware, assertAdmin } from "@/lib/auth-middleware";
import type { Pool } from "pg";

// ── Client IP resolution ────────────────────────────────────────────────────
// On Cloud Run the socket peer is Google's front end, not the user. The real
// client IP arrives in X-Forwarded-For. A client can spoof the LEFTMOST values
// by sending their own header (the infra appends, it does not replace), so only
// the RIGHTMOST entry — the one the trusted infrastructure added — is reliable.
//
// OFFICE_IP_XFF_DEPTH controls how many entries to skip from the right before
// the trusted client IP. Direct Cloud Run = 1 (rightmost). If you later front
// the service with an external HTTPS load balancer, bump this to account for the
// extra trusted hop.
const XFF_DEPTH = Math.max(1, Number(process.env.OFFICE_IP_XFF_DEPTH ?? "1"));

export function resolveClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length) {
    const ip = parts[parts.length - XFF_DEPTH] ?? parts[0];
    return normalizeIp(ip);
  }
  // Fallback for local dev / non-proxied requests.
  return normalizeIp(req.headers.get("x-real-ip") ?? "");
}

// Strip an IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 -> 1.2.3.4) so it matches a
// plain IPv4 cidr, and drop any :port suffix.
function normalizeIp(ip: string): string {
  let v = ip.trim();
  if (v.startsWith("::ffff:")) v = v.slice("::ffff:".length);
  // strip port only for plain IPv4 like 1.2.3.4:5678 (bracketed IPv6 unaffected)
  if (v.includes(".") && v.includes(":")) v = v.split(":")[0];
  return v;
}

// Throws OFF_NETWORK when the IP is not within any active office CIDR.
// Fails OPEN (returns silently) when no active networks are configured, so the
// restriction is opt-in until an admin adds at least one network.
export async function assertOnOfficeNetwork(pool: Pool, ip: string): Promise<void> {
  const { rows: active } = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM office_networks WHERE is_active = true`,
  );
  if (Number(active[0]?.n ?? "0") === 0) return; // opt-in: nothing configured

  if (!ip) throw new Error("OFF_NETWORK");
  let matched = false;
  try {
    const { rowCount } = await pool.query(
      `SELECT 1 FROM office_networks
        WHERE is_active = true AND $1::inet <<= cidr
        LIMIT 1`,
      [ip],
    );
    matched = !!rowCount;
  } catch {
    // $1 was not a valid inet (malformed/empty) — treat as off-network.
    matched = false;
  }
  if (!matched) throw new Error("OFF_NETWORK");
}

// ── Admin CRUD ──────────────────────────────────────────────────────────────

export type OfficeNetwork = {
  id: string;
  label: string;
  cidr: string;
  is_active: boolean;
  created_at: string;
};

export const listOfficeNetworks = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertAdmin(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, label, host(cidr) || '/' || masklen(cidr) AS cidr, is_active, created_at
         FROM office_networks ORDER BY created_at DESC`,
    );
    return rows as OfficeNetwork[];
  });

// Returns the caller's current public IP so the admin can add the office in one
// click ("Add my current network").
export const getMyCurrentIp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertAdmin(context.user);
    return { ip: resolveClientIp(getRequest()) };
  });

export const addOfficeNetwork = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { label: string; cidr: string }) => data)
  .handler(async ({ data, context }) => {
    assertAdmin(context.user);
    const label = data.label.trim();
    const cidr = data.cidr.trim();
    if (!label) throw new Error("LABEL_REQUIRED");
    if (!cidr) throw new Error("CIDR_REQUIRED");
    const { pool } = await import("@/lib/db.server");
    try {
      const { rows } = await pool.query(
        `INSERT INTO office_networks (label, cidr) VALUES ($1, $2::cidr)
         RETURNING id, host(cidr) || '/' || masklen(cidr) AS cidr`,
        [label, cidr],
      );
      return rows[0] as { id: string; cidr: string };
    } catch {
      // Invalid CIDR/inet text rejected by Postgres.
      throw new Error("INVALID_CIDR");
    }
  });

export const setOfficeNetworkActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string; isActive: boolean }) => data)
  .handler(async ({ data, context }) => {
    assertAdmin(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rowCount } = await pool.query(
      `UPDATE office_networks SET is_active = $1 WHERE id = $2`,
      [data.isActive, data.id],
    );
    if (!rowCount) throw new Error("NOT_FOUND");
  });

export const deleteOfficeNetwork = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    assertAdmin(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rowCount } = await pool.query(
      `DELETE FROM office_networks WHERE id = $1`,
      [data.id],
    );
    if (!rowCount) throw new Error("NOT_FOUND");
  });
