import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Server-side code must go through lib/log.server, never console. A bare
  // console call on Cloud Run produces an unstructured line with no severity,
  // no trace correlation and — critically — no redaction, so an employee
  // identifier could reach the log store without passing the RA 10173 control
  // in lib/log-redact. The emitter itself is exempt: it IS the writer.
  //
  // Client-side console calls are untouched. They run in the browser, never
  // reach Cloud Logging, and routing them to a server sink is a separate scope
  // decision (deferred at the design gate).
  {
    files: ["src/server.ts", "src/start.ts", "src/lib/**/*.server.ts", "src/lib/*-functions.ts"],
    ignores: ["src/lib/log.server.ts"],
    rules: {
      "no-console": "error",
    },
  },
  eslintPluginPrettier,
);
