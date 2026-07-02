// Per-request CSP nonce plumbing (isomorphic-safe).
//
// src/server.ts generates a fresh nonce for each SSR document render and hands it
// to the renderer as the `x-ssr-nonce` request header. TanStack Start keeps the
// active request in an AsyncLocalStorage published on globalThis under a shared
// symbol (Symbol.for("tanstack-start:event-storage")). We read that already-created
// instance directly instead of importing `node:async_hooks`, so this module stays
// isomorphic: on the client the global is absent and the accessor returns
// undefined — no nonce is needed during hydration since the scripts are already in
// the DOM.

export const SSR_NONCE_HEADER = "x-ssr-nonce";

const EVENT_STORAGE_KEY = Symbol.for("tanstack-start:event-storage");

type EventStore = { h3Event?: { req?: { headers?: Headers } } } | undefined;
type EventStorage = { getStore?: () => EventStore } | undefined;

// Reads the nonce for the request currently being rendered, or undefined when
// called outside an SSR request (client hydration, or before a request is active).
export function readSsrNonce(): string | undefined {
  if (typeof window !== "undefined") return undefined;
  try {
    const storage = (globalThis as Record<symbol, unknown>)[EVENT_STORAGE_KEY] as EventStorage;
    const req = storage?.getStore?.()?.h3Event?.req;
    return req?.headers?.get(SSR_NONCE_HEADER) ?? undefined;
  } catch {
    return undefined;
  }
}
