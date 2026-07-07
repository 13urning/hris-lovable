// Receives Content-Security-Policy violation reports during the Report-Only
// rollout. Browsers POST these unauthenticated (the `report-uri` directive in
// src/server.ts points here), so this endpoint takes NO auth and does nothing but
// log a bounded slice of the report to stdout (→ Cloud Run logs). It never stores
// the body, never parses it as trusted input, and always answers fast so a report
// storm can't back up. Seeing these lets us find what an enforcing policy would
// block before flipping CSP_ENFORCE.

const MAX_LOG_BYTES = 8 * 1024;

export async function handleCspReport(request: Request): Promise<Response> {
  // Browsers only ever POST reports; anything else is noise.
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }
  try {
    const raw = await request.text();
    if (raw.length > 0) {
      // Log a bounded slice only — reports can be large and are attacker-influenced.
      // Not parsed, not stored; the newline strip keeps it to one log line.
      const slice = raw.slice(0, MAX_LOG_BYTES).replace(/[\r\n]+/g, " ");
      console.warn(`[csp-report] ${slice}`);
    }
  } catch {
    // Reporting must never error back to the browser.
  }
  // 204: accepted, nothing to return. Browsers ignore the body of a report response.
  return new Response(null, { status: 204 });
}
