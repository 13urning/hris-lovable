import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { readSsrNonce } from "./lib/ssr-nonce";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // Per-request CSP nonce (SSR only). TanStack stamps this onto every script it
    // emits — the hydration bootstrap and asset scripts — so they satisfy the
    // script-src 'nonce-…' directive set in src/server.ts. undefined on the client.
    ssr: { nonce: readSsrNonce() },
  });

  return router;
};
