// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

// DEFECT FIX. This module previously registered ONLY through the two branches
// below, and the addEventListener guard is false in the Node 22 runtime Cloud
// Run executes — so no listener was ever attached, consumeLastCapturedError()
// always returned undefined, and the recovery path in server.ts fell back to a
// generic message instead of a real stack. It has been a no-op in production
// for the life of the service.
//
// The Node-correct hooks are process.on. They are attached first and
// unconditionally; the addEventListener branch is kept for any runtime that
// genuinely provides it (and is harmless where it does not).
if (typeof process !== "undefined" && typeof process.on === "function") {
  process.on("uncaughtException", (error) => record(error));
  process.on("unhandledRejection", (reason) => record(reason));
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
