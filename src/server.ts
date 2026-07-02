import "./lib/error-capture";

import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { SSR_NONCE_STORAGE_KEY } from "./lib/ssr-nonce";

// Per-request CSP nonce store, published on a shared global symbol so the
// isomorphic reader in lib/ssr-nonce can pull it during SSR without importing
// node:async_hooks. Reuse an existing instance if one is already on globalThis.
const globalForNonce = globalThis as Record<symbol, unknown>;
const nonceStorage: AsyncLocalStorage<string> =
  (globalForNonce[SSR_NONCE_STORAGE_KEY] as AsyncLocalStorage<string> | undefined) ??
  (globalForNonce[SSR_NONCE_STORAGE_KEY] = new AsyncLocalStorage<string>());

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// Baseline security headers applied to every response.
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

// Content-Security-Policy for HTML document responses. Shipped in REPORT-ONLY mode
// first: violations are reported (browser console / a report endpoint) but nothing
// is blocked, so a mis-scoped directive can't take the app down. Flip CSP_ENFORCE
// to true to switch the header to enforcing "Content-Security-Policy" — only after
// the report window is clean (see docs/soc-security-spec.md).
//
// 'strict-dynamic' + the per-request nonce trusts the SSR hydration bootstrap to
// load the app's module chunks without host-allowlisting every asset path.
const CSP_ENFORCE = false;

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // 'https:' and 'unsafe-inline' are CSP1/CSP2 fallbacks that modern browsers
    // IGNORE when a nonce + 'strict-dynamic' are present. Drop 'https:' before
    // flipping CSP_ENFORCE on (security-gate finding) — nonce + strict-dynamic is
    // sufficient and 'https:' would otherwise loosen script-src on legacy browsers.
    `script-src 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.googleapis.com",
    "frame-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    // Collect violations during the Report-Only window (see lib/csp-report.server).
    "report-uri /api/csp-report",
  ].join("; ");
}

// Applies the baseline headers, and — when a nonce is supplied (HTML SSR path) —
// the (report-only) CSP built for that request's nonce.
function withSecurityHeaders(response: Response, nonce?: string): Response {
  const headers: Record<string, string> = { ...SECURITY_HEADERS };
  if (nonce) {
    const name = CSP_ENFORCE ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
    headers[name] = buildCsp(nonce);
  }
  // Handler responses expose mutable headers, so set them in place to avoid
  // re-streaming the body. Fall back to a copy if a response has frozen headers.
  try {
    for (const [key, value] of Object.entries(headers)) {
      if (!response.headers.has(key)) response.headers.set(key, value);
    }
    return response;
  } catch {
    const copied = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers)) {
      if (!copied.has(key)) copied.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: copied,
    });
  }
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // Device-facing attendance endpoints are raw HTTP routes that bypass the
      // Firebase-token auth used by the SSR app (an unattended device — NFC, face,
      // biometric — has no session). Intercept here, before delegating to
      // TanStack, and still apply the baseline security headers. Imported lazily
      // so the pg pool isn't spun up unless such a request actually arrives.
      const { pathname } = new URL(request.url);
      if (pathname === "/api/attendance/clock-in" || pathname === "/api/attendance/verify") {
        const mod = await import("./lib/device-clock-in.server");
        const handler = pathname.endsWith("/verify")
          ? mod.handleDeviceVerify
          : mod.handleDeviceClockIn;
        return withSecurityHeaders(await handler(request));
      }

      // CSP violation report sink (unauthenticated; browsers POST here via the
      // report-uri directive). Handled before SSR; no nonce/CSP needed on it.
      if (pathname === "/api/csp-report") {
        const { handleCspReport } = await import("./lib/csp-report.server");
        return withSecurityHeaders(await handleCspReport(request));
      }

      // Per-request CSP nonce: generate it, run the SSR render inside the nonce
      // AsyncLocalStorage so router.tsx + __root.tsx can read it back (via
      // lib/ssr-nonce), and emit a matching CSP. We do NOT touch the request —
      // reconstructing it (`new Request`) throws in this Nitro/h3 runtime because
      // the incoming request isn't an undici Request.
      const nonce = randomBytes(16).toString("base64");
      const handler = await getServerEntry();
      const response = await nonceStorage.run(nonce, async () => {
        const res = await handler.fetch(request, env, ctx);
        return normalizeCatastrophicSsrResponse(res);
      });
      return withSecurityHeaders(response, nonce);
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(brandedErrorResponse());
    }
  },
};
