// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// When NITRO_PRESET=vercel, build for Vercel Functions instead of Cloudflare Workers.
const nitroPreset = process.env.NITRO_PRESET;
const isVercel = nitroPreset === "vercel";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  ...(nitroPreset
    ? {
        nitro: {
          preset: nitroPreset,
          // Vercel `deploy --prebuilt` expects this exact structure (Build Output API v3).
          ...(isVercel && {
            output: {
              dir: ".vercel/output",
              publicDir: ".vercel/output/static",
              serverDir: ".vercel/output/functions/__server.func",
            },
          }),
        },
      }
    : {}),
});
