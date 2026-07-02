import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/hooks/use-auth";
import { resolveFirebaseConfig } from "@/lib/firebase-config";
import { readSsrNonce } from "@/lib/ssr-nonce";
import type { FirebaseOptions } from "firebase/app";
import appCss from "../styles.css?url";

declare global {
  interface Window {
    __FIREBASE_CONFIG__?: FirebaseOptions;
  }
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">That page doesn't exist.</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-2xl">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Wave HRIS" },
      { name: "description", content: "HR platform for Tidal Solutions." },
      { property: "og:title", content: "Wave HRIS" },
      { name: "twitter:title", content: "Wave HRIS" },
      { property: "og:description", content: "HR platform for Tidal Solutions." },
      { name: "twitter:description", content: "HR platform for Tidal Solutions." },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/98ad0f49-93cf-4e95-868c-3c174a9d806b/id-preview-4d50d844--f3ea8ac9-bd9c-46d5-a3c8-602d93d2044b.lovable.app-1778555845416.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/98ad0f49-93cf-4e95-868c-3c174a9d806b/id-preview-4d50d844--f3ea8ac9-bd9c-46d5-a3c8-602d93d2044b.lovable.app-1778555845416.png",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  // Resolve the per-environment PUBLIC Firebase config server-side (from APP_ENV)
  // and inline it so the client SDK mints tokens against the right project. On the
  // client we read back the value SSR already injected, so the rendered <script>
  // is identical on both sides (no hydration mismatch).
  const cfg =
    typeof window === "undefined"
      ? resolveFirebaseConfig()
      : (window.__FIREBASE_CONFIG__ ?? resolveFirebaseConfig());

  // Belt-and-suspenders: the client's project MUST equal the one the server
  // verifies tokens against, or logins silently fail. Fail loud in the logs.
  if (typeof window === "undefined") {
    const expected = process.env.FIREBASE_PROJECT_ID ?? "wave-hris-fb";
    if (cfg.projectId !== expected) {
      console.error(
        `[firebase-config] MISMATCH: client projectId=${cfg.projectId} but ` +
          `FIREBASE_PROJECT_ID=${expected} — logins will fail until these match.`,
      );
    }
  }

  // Per-request CSP nonce (see src/server.ts + lib/ssr-nonce). Present during SSR,
  // undefined on the client; TanStack stamps the same nonce onto the hydration
  // scripts via router.options.ssr.nonce, so both inline-script sources match the
  // Content-Security-Policy header.
  const nonce = readSsrNonce();

  return (
    <html lang="en">
      <head>
        <HeadContent />
        <script
          nonce={nonce}
          // JSON.stringify of a fixed-shape object of known-safe string literals —
          // no user input, not an XSS sink.
          dangerouslySetInnerHTML={{ __html: `window.__FIREBASE_CONFIG__=${JSON.stringify(cfg)}` }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
