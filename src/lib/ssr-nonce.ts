// Per-request CSP nonce plumbing (isomorphic-safe).
//
// src/server.ts generates a fresh nonce for each SSR render and runs the render
// inside an AsyncLocalStorage keyed by SSR_NONCE_STORAGE_KEY (a shared global
// symbol). server.ts owns that store (it's server-only, so it may import
// node:async_hooks); this module only READS it via the global symbol, so it stays
// isomorphic — on the client the store is absent and readSsrNonce() returns
// undefined (no nonce is needed during hydration, the scripts are already in the
// DOM).
//
// Threading via ALS rather than a request header is deliberate: the incoming
// request in the Nitro/h3 runtime is not an undici Request, so reconstructing it
// with `new Request(request, { headers })` throws. ALS avoids touching the request.

export const SSR_NONCE_STORAGE_KEY = Symbol.for("wave-hris:ssr-nonce");

type NonceStore = { getStore?: () => string | undefined } | undefined;

// Reads the nonce for the request currently being rendered, or undefined when
// called outside an SSR request (client hydration, or no active request).
export function readSsrNonce(): string | undefined {
  if (typeof window !== "undefined") return undefined;
  try {
    const store = (globalThis as Record<symbol, unknown>)[SSR_NONCE_STORAGE_KEY] as NonceStore;
    return store?.getStore?.() ?? undefined;
  } catch {
    return undefined;
  }
}
