import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { logError } from "./lib/log.server";

// NOTE: this is a REQUEST middleware. It sees SSR/document-request failures, but
// it is structurally blind to server-function throws — the transport catches
// those below this layer and serialises them into the RPC response, which is
// exactly how the 23 July 42P08 stayed invisible for four days. Server-function
// coverage comes from the FUNCTION middleware in lib/observability-middleware.
const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    logError("request_middleware_error", error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));
