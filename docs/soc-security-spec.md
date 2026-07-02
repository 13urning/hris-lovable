# Wave HRIS — Build, Infrastructure & Security Spec (SOC Handoff)

**Prepared for:** SOC / VAPT team
**System:** Wave HRIS (Human Resource Information System)
**Environment of record:** Production, `main` branch
**Doc date:** 2026-07-02
**Owner:** Engineering (Wave HRIS)

> Scope note: this document describes the **production build on `main`**. Where staging
> differs materially, it is called out. Companion docs: [`tech-docs.md`](tech-docs.md)
> (full technical reference) and `WaveHRIS-Device-ClockIn-API-Handover.pdf` (device
> attendance API). This spec is the security-facing summary; the two companions are the
> authoritative deep references.

---

## 1. System Overview

Wave HRIS is a full-stack, server-side-rendered web application for managing daily time
reports (DTR), leave, overtime approvals, performance evaluations, and org-chart data for
an internal workforce. It is a **monolith**: client and server ship from one codebase, and
the "API" is TanStack Start **server functions** (RPC over HTTP), not a separate REST/GraphQL
service. There is also a small set of **raw HTTP endpoints** for unattended attendance
devices (NFC / biometric / kiosk).

- **Users:** internal employees, HR, admins, and group heads (approval chain).
- **Data class:** employee PII (names, emails, employee codes, department/position),
  attendance records, leave records, and performance evaluations. No payment card data,
  no external customer data.
- **Public exposure:** the web app and the device endpoints are internet-reachable
  (Cloud Run, `--allow-unauthenticated` at the platform layer; application-layer auth gates
  all data — see §5).

---

## 2. Build / Application Stack

| Layer | Technology |
|---|---|
| Framework | TanStack Start (React 19 + Vite 7 + Nitro SSR) |
| Language | TypeScript 5.8, `strict` mode |
| UI | shadcn/ui (Radix primitives) + Tailwind CSS 4 |
| Client state | TanStack React Query (server state), React Context (auth) |
| Forms / validation | React Hook Form + **Zod** |
| Auth | Firebase Authentication — web SDK (client) + Admin SDK (server) |
| Database | PostgreSQL 17 (Cloud SQL), `pg` driver, **no ORM** |
| Runtime | Node.js 22 (Alpine) |
| Charts / org chart | Recharts, `@xyflow/react` |

**Notable build facts**
- Package name is still `tanstack_start_ts` (cosmetic; not rebranded).
- A legacy Supabase client (`src/integrations/supabase/`) remains in the tree but is
  **unused in production** — the app was migrated Supabase → GCP. Candidate for removal.
- All server-side data access is **hand-written parameterized SQL** through a shared `pg`
  connection pool — no dynamic string-built queries (see §6, SQLi).

---

## 3. Infrastructure Topology

```
Browser (React SSR, Firebase Auth SDK)
        │  RPC server-functions (Firebase ID token in context)
        │  + raw device endpoints (X-Device-Key header)
        ▼
Cloud Run  (Nitro node-server, port 8080)
   prod:    wave-hris
   staging: wave-hris-staging
        │  Unix socket  /cloudsql/<instance>
        ▼
Cloud SQL — PostgreSQL 17   (instance: wave-hris)
   prod DB:    wave_hris
   staging DB: wave_hris_staging
```

### GCP resources

| Resource | Identifier |
|---|---|
| GCP Project | `wave-hris-498916` (region `us-central1`) |
| Cloud Run (prod) | `wave-hris` — `https://wave-hris-m6r23u5lqa-uc.a.run.app` |
| Cloud Run (staging) | `wave-hris-staging` — `https://wave-hris-staging-831274499203.us-central1.run.app` |
| Cloud SQL instance | `wave-hris-498916:us-central1:wave-hris` (PostgreSQL 17, `db-f1-micro`, zonal) |
| Databases | `wave_hris` (prod), `wave_hris_staging` (staging) — same instance |
| Artifact Registry | `us-central1-docker.pkg.dev/wave-hris-498916/wave-hris/app` |
| CI/CD | Cloud Build — `cloudbuild.yaml` (prod), `cloudbuild-staging.yaml` (staging); trigger `staging-deploy` on branch `^staging$` |
| Secrets | Secret Manager (`DB_PASSWORD`) |
| Runtime service account | `831274499203-compute@developer.gserviceaccount.com` (granted `roles/firebaseauth.admin`) |
| Firebase (auth) | `wave-hris-fb` |

### Deployment pipeline
- **Container:** two-stage Dockerfile (Node 22-alpine builder → runner), `NITRO_PRESET=node-server`, listens on `PORT=8080` (Cloud Run injected). Runs as the default node user in Alpine.
- **Staging:** auto-deploys on push to `staging` branch (Cloud Build trigger).
- **Production:** promoted from `staging` → `main`; image built and deployed via `cloudbuild.yaml` (`gcloud builds submit ... --substitutions=COMMIT_SHA=...`).
- **DB connection:** Cloud Run → Cloud SQL over the **Unix socket** (no public DB IP path in prod). Local dev uses the Cloud SQL Auth Proxy; direct connections require the developer IP to be in the instance's Authorized Networks.
- **Migrations:** SQL files under `supabase/migrations/` are applied **manually per database** (`scripts/apply-migration.mjs`), not by the pipeline. Ordering rule: migrate before deploying code that reads new objects.

### Max instances
Prod max 3, staging max 2 (relevant to the in-memory device rate-limiter — see §6).

---

## 4. Data Model & Sensitivity

PostgreSQL, single `public` schema, ~16–18 tables, 11 enums, plus stored functions/triggers
for DTR aggregation, cutoff locking, and employee-code generation.

**PII / sensitive tables:** `users` (Firebase UID ↔ internal UUID, email), `profiles`
(name, department, position, employee code, leave credits), `daily_time_reports`,
`leave_requests`, `ot_approval_requests`, `performance_evaluations` (+ score children),
`office_networks` (allowlisted office IP/CIDR ranges).

- No passwords are stored in the app DB — credentials live in Firebase Auth.
- `TIMESTAMPTZ`/`DATE`/`NUMERIC` are normalized by custom type parsers in `db.server.ts`.
- Business dates are computed in **PH local time** (UTC+8), not UTC, by design.

---

## 5. Authentication & Authorization

**Identity provider:** Firebase Authentication (`wave-hris-fb`), email/password.

**Request flow**
1. Client signs in via Firebase (`signInWithEmailAndPassword`); `useAuth()` tracks the user + ID token.
2. Each server-function call ships the Firebase **ID token** to the server (auth middleware, client half).
3. Server half verifies the token with the Firebase **Admin SDK** (`verifyIdToken`, validated against Google's public JWKS).
4. Server resolves the internal user + roles from Postgres (`users` ⋈ `user_roles`) in a single query and attaches them to the request context.
5. Anonymous calls are allowed through with `user=null` **only** so first-login provisioning can run; every other handler enforces an assertion.

**Admin SDK credentials:** Application Default Credentials. On Cloud Run this is the runtime
service account (`firebaseauth.admin`); no service-account key files are shipped in the image.

**Roles & gates** (`employee` / `hr` / `admin` / `group_head`):
`assertAuthenticated` → any signed-in user, `assertUser` → resolved DB user,
`assertHR` → `hr` or `admin`, `assertAdmin` → `admin`. Client routes are additionally gated
(`_authenticated`, `_authenticated/_admin`), but **authorization is enforced server-side** in
each function — the route gates are UX, not the security boundary.

**Session lifetime:** enforced **client-side** (`lib/session.ts` + `SessionGuard.tsx`): 1-hour
idle timeout and 12-hour absolute cap, tracked in `localStorage`. ⚠️ This is a UX control — the
Firebase ID token itself remains valid server-side for its normal ~1h lifetime regardless of
client idle state (see §7 residual risks).

**Provisioning & password reset:** first login creates `users` + `profiles`
(`must_change_password = true`) + `user_roles` (`employee`); a forced password-change modal
gates access until changed. Admin-initiated temp passwords use a **CSPRNG** (`node:crypto`
`randomInt`), are returned once and never stored, and revoke existing refresh tokens.

---

## 6. Security Controls (implemented)

**HTTP security headers** — applied to *every* response (`src/server.ts`):
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- ✅ **Content-Security-Policy** now shipped in **Report-Only** mode (`Content-Security-Policy-Report-Only`), nonce-based (`'nonce-…' 'strict-dynamic'`), per-request nonce, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`. Flip `CSP_ENFORCE` in `src/server.ts` to enforce after a clean monitoring window — see §7 #1.

**Injection (SQLi/OWASP A03):** all queries are parameterized (`$1`, `$2`, …) via `pg`; no
ORM, no string-interpolated SQL, including on the device path.

**AuthZ / IDOR (A01):** server-side role assertions on every function; employees see
own-rows only (e.g. `fetchMyLeaves`), HR/admin actions gated by `assertHR`/`assertAdmin`.

**Error handling:** SSR errors are normalized to a branded 500 page; SQL/stack traces are
never returned to clients (device path returns opaque `SERVER_ERROR`).

**Secrets:** `DB_PASSWORD` via Secret Manager; Admin SDK via ADC (no key files in the image).
The Firebase **web** config (`apiKey`, etc.) is embedded in the client bundle — this is public
by design (it is an identifier, not a secret).

### Device attendance endpoints (raw HTTP)
`POST /api/attendance/clock-in` and `GET|POST /api/attendance/verify` authenticate a **device**,
not a human (unattended NFC/biometric/kiosk terminals have no Firebase session). Controls:
- **Device-key auth**, fail-closed: missing/invalid key → `401`; missing `DEVICE_API_KEYS` → all `401`.
- Keys compared in **constant time** (SHA-256 + `timingSafeEqual`), iterating all keys so timing doesn't reveal which matched.
- **Per-channel key scoping** (`key:label:channel`): a key bound to `nfc` cannot submit `channel=face` → `403 CHANNEL_NOT_ALLOWED`. Limits blast radius of a leaked key.
- **Rate limiting:** sliding window, 30 req / 10 s per client IP; throttles tap-storms and key brute-forcing. ⚠️ In-memory, **per Cloud Run instance** — not global (mitigated by low max-instances + DB uniqueness backstop).
- **Input hardening:** 4 KB body cap before parse, `application/json` required, control chars rejected, `employeeCode` length-bounded, channel matched to a strict slug regex.
- **Anti-tamper:** `work_date` / `time_in` / lateness are derived from **server** PH time, never the device — a tampered device clock can't backdate a punch or dodge lateness.
- **Idempotent:** `UNIQUE(employee_id, work_date)` + `ON CONFLICT DO NOTHING`; a re-tap is a safe no-op and race-safe.
- **Minimal disclosure:** responses expose only the employee display name (no UUID/email) to limit what code-probing reveals.

### Clock-in geofencing
Both the interactive and device clock-ins can restrict punches to allowlisted office
IP/CIDR ranges (`office_networks`). Client IP is taken from the **rightmost** `X-Forwarded-For`
entry (the value Cloud Run's front end appends; leftmost entries are client-spoofable);
depth configurable via `OFFICE_IP_XFF_DEPTH`. ⚠️ **Fails open** when no networks are active
(opt-in) — see §7.

---

## 7. Known Gaps & Residual Risks (disclose to SOC)

Remediated on branch `security/pre-soc-hardening` (design cleared `cloud-architect`; code
cleared `security-gate` **PASS-WITH-CONDITIONS**, 2026-07-02). #1, #2, #7, #8 are addressed
in code; #3–#6 are **accepted-by-design** with the rationale below.

| # | Item | Risk | Status / mitigation |
|---|---|---|---|
| 1 | **CSP** | XSS impact not contained by policy | ✅ **FIXED (Report-Only).** Nonce + `'strict-dynamic'` CSP now emitted (`src/server.ts`). **Operational:** monitor reports, drop `https:` from `script-src`, then set `CSP_ENFORCE=true` to enforce. |
| 2 | **Session lifetime is client-side only** | A captured/ revoked ID token remained usable up to its ~1h TTL | ✅ **FIXED.** Sensitive admin ops now verify `checkRevoked` (`strictAuthMiddleware`); explicit logout revokes the caller's refresh tokens. Hot path stays JWKS-local (~1h TTL) by design. |
| 3 | **Geofence fails open** | Clock-in unrestricted until an admin adds ≥1 active network | Accepted (opt-in by design). Confirm networks are configured in prod if geofencing is required. |
| 4 | **Device rate-limit is per-instance** | Effective limit scales with instance count | Accepted. Keep max-instances low; `UNIQUE(employee_id, work_date)` is the correctness backstop. Central rate-limit (Redis) is a future candidate. |
| 5 | **Cloud Run is `--allow-unauthenticated`** | Public ingress at platform layer | Accepted — required for a public web app; all data is gated at the application layer. |
| 6 | **Prod & staging share one Cloud SQL instance** | Noisy-neighbor / blast-radius | Accepted. DBs are separate (`wave_hris` vs `wave_hris_staging`); adequate at current scale. |
| 7 | **Prod/staging Firebase isolation** | Staging auth ops could touch prod accounts (shared project) | ✅ **FIXED.** Dedicated staging project `wave-hris-staging-fb` + per-env SSR config injection now on this branch (prod safely falls back to `wave-hris-fb`). **Operational:** set `APP_ENV=staging` + `FIREBASE_PROJECT_ID` on Cloud Run **before** the staging deploy (see §8). |
| 8 | **Legacy Supabase client present** | Dead code / supply-chain surface | ✅ **FIXED.** `src/integrations/supabase/` deleted and `@supabase/supabase-js` removed from dependencies. |

---

## 8. VAPT Readiness Package

Per our secure-SDLC gate, the SOC/pentest team needs a target and two accounts.
**Recommend testing against staging** (`wave-hris-staging`) to avoid touching production
employee data; the build is identical.

| Item | Value |
|---|---|
| Target URL (staging, recommended) | `https://wave-hris-staging-831274499203.us-central1.run.app` |
| Target URL (production) | `https://wave-hris-m6r23u5lqa-uc.a.run.app` |
| Auth type | Firebase email/password (login page) |
| Device endpoints | `POST /api/attendance/clock-in`, `GET /api/attendance/verify` — require `X-Device-Key`; a scoped test key can be issued on request |
| **Test account — normal user** | ⚠️ TO PROVISION (role `employee`) |
| **Test account — admin** | ⚠️ TO PROVISION (role `admin`) |
| In-scope | Web app (SSR + server functions), device attendance endpoints, authn/authz, IDOR, injection, session handling |
| Out-of-scope (confirm) | GCP control plane, Firebase console, DoS/stress testing on shared Cloud SQL |

**Action items before handoff**
1. Provision one `employee` and one `admin` test account (staging) and share credentials over a secure channel.
2. Issue a scoped test `X-Device-Key` if device endpoints are in scope.
3. Confirm production is on the intended Firebase project and unaffected by the staging isolation work (gap #7).
4. State whether geofencing must be active for the test (gap #3).

---

*Sources: `src/server.ts`, `src/lib/auth-middleware.ts`, `src/lib/firebase.ts`,
`src/lib/firebase-admin.server.ts`, `src/lib/device-clock-in.server.ts`, `src/lib/db.server.ts`,
`src/lib/employee-functions.ts`, `Dockerfile`, `cloudbuild.yaml`, `docs/tech-docs.md`,
`docs/gcp-migration.md`, verified against `main` on 2026-07-02.*
