# Wave HRIS — Technical Documentation

## Table of Contents

1. [Overview](#overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Architecture](#architecture)
5. [Authentication](#authentication)
6. [Database](#database)
7. [Server-Side (API)](#server-side-api)
8. [Client-Side (UI)](#client-side-ui)
9. [Approval Chain System](#approval-chain-system)
10. [Environments & Deployment](#environments--deployment)
11. [Local Development](#local-development)
12. [Environment Variables](#environment-variables)

---

## Overview

Wave HRIS is a full-stack Human Resource Information System built with React and TanStack Start. It handles daily time reports (DTR), leave management, overtime approvals, performance evaluations, and organization chart management. The app is server-side rendered, backed by PostgreSQL on Google Cloud SQL, and authenticated via Firebase.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | TanStack Start (React 19 + Vite + Nitro SSR) |
| Language | TypeScript 5.8, strict mode |
| UI | shadcn/ui (47 Radix primitives) + Tailwind CSS 4 |
| State | TanStack React Query (server state), React Context (auth) |
| Forms | React Hook Form + Zod validation |
| Auth | Firebase Authentication (client SDK + Admin SDK) |
| Database | PostgreSQL 17 on Cloud SQL, `pg` driver |
| Hosting | Cloud Run (production + staging) |
| CI/CD | Cloud Build (Docker → Artifact Registry → Cloud Run) |
| Charts | Recharts |
| Icons | Lucide React |
| Org Chart | @xyflow/react |

---

## Project Structure

```
hris-lovable/
├── src/
│   ├── components/
│   │   ├── AppShell.tsx              # Main layout: sidebar, header, navigation
│   │   ├── StatusBadge.tsx           # Reusable status indicator
│   │   └── ui/                       # 47 shadcn/ui primitives
│   │
│   ├── hooks/
│   │   ├── use-auth.tsx              # Firebase auth context + provider
│   │   └── use-mobile.tsx            # Responsive breakpoint hook
│   │
│   ├── lib/
│   │   ├── db.server.ts              # PostgreSQL pool (Cloud SQL)
│   │   ├── firebase.ts               # Firebase web SDK init
│   │   ├── firebase-admin.server.ts  # Firebase Admin SDK (server-only)
│   │   ├── auth-middleware.ts        # TanStack Start auth middleware
│   │   ├── chain.server.ts           # Approval chain resolver
│   │   ├── dtr-functions.ts          # DTR API server functions
│   │   ├── dtr.ts                    # DTR calculation utilities
│   │   ├── leave-functions.ts        # Leave request server functions
│   │   ├── office-network-functions.ts # Clock-in IP allowlist + admin CRUD
│   │   ├── ot-functions.ts           # Overtime approval server functions
│   │   ├── employee-functions.ts     # Employee management server functions
│   │   ├── org-functions.ts          # Org chart server functions
│   │   ├── user-functions.ts         # User profile/auth server functions
│   │   ├── kpi-functions.ts          # KPI template server functions
│   │   ├── performance-functions.ts  # Performance evaluation server functions
│   │   ├── performance-rating.ts     # Rating calculation utilities
│   │   ├── queries.ts                # React Query wrappers
│   │   ├── utils.ts                  # General utilities (cn(), etc.)
│   │   ├── error-capture.ts          # Error logging
│   │   └── error-page.ts            # HTML error page generator
│   │
│   ├── routes/
│   │   ├── __root.tsx                # Root layout, providers, error boundary
│   │   ├── index.tsx                 # Landing / login redirect
│   │   ├── login.tsx                 # Login page
│   │   ├── _authenticated.tsx        # Auth gate + forced password change
│   │   ├── _authenticated/
│   │   │   ├── dashboard.tsx         # Employee dashboard
│   │   │   ├── dtr.tsx               # Daily time report entry
│   │   │   ├── leaves.tsx            # Leave request management
│   │   │   ├── ot-approvals.tsx      # Overtime approval workflow
│   │   │   ├── performance.tsx       # Performance self-assessment
│   │   │   └── _admin.tsx            # Admin/HR authorization gate
│   │   └── _authenticated/_admin/
│   │       ├── employees.tsx         # Employee directory & management
│   │       ├── activity-log.tsx      # Audit log
│   │       ├── org-chart.tsx         # Organization chart (React Flow)
│   │       ├── kpi-builder.tsx       # KPI template builder
│   │       ├── office-networks.tsx   # Office IP allowlist for clock-in (admin)
│   │       └── performance-admin.tsx # Admin performance evaluations
│   │
│   ├── integrations/supabase/        # Legacy Supabase client (unused in prod)
│   ├── styles.css                    # Global Tailwind CSS
│   ├── router.tsx                    # Router + QueryClient setup
│   ├── start.ts                      # TanStack Start app init
│   └── server.ts                     # Server entry (error wrapper)
│
├── docs/
│   ├── cloud-sql-schema.sql          # Full PostgreSQL schema
│   ├── gcp-migration.md              # Supabase → GCP migration guide
│   └── tech-docs.md                  # This file
│
├── scripts/
│   └── apply-migration.mjs           # Apply a SQL migration to a Cloud SQL DB (no psql)
│
├── Dockerfile                        # Multi-stage Node 22-Alpine build
├── cloudbuild.yaml                   # Production Cloud Build pipeline
├── cloudbuild-staging.yaml           # Staging Cloud Build pipeline
├── vite.config.ts                    # Vite + TanStack Start config
├── tsconfig.json                     # TypeScript config (strict, path aliases)
├── components.json                   # shadcn/ui config
└── package.json
```

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                      Browser                         │
│                                                      │
│  React 19 (SSR hydrated)                             │
│  ├── TanStack Router (file-based routes)             │
│  ├── TanStack Query (server state cache)             │
│  ├── Firebase Auth SDK (sign-in, ID tokens)          │
│  └── shadcn/ui + Tailwind CSS                        │
└──────────────────┬───────────────────────────────────┘
                   │ Server functions (RPC)
                   │ Firebase ID token in header
                   ▼
┌──────────────────────────────────────────────────────┐
│              TanStack Start / Nitro                   │
│              (Cloud Run, port 8080)                   │
│                                                      │
│  Auth middleware:                                     │
│    Firebase Admin SDK → verify token → resolve user   │
│                                                      │
│  Server functions (src/lib/*-functions.ts):           │
│    dtr, leave, ot, employee, org, user,               │
│    kpi, performance, office-network                    │
│                                                      │
│  Database driver: pg Pool                             │
└──────────────────┬───────────────────────────────────┘
                   │ Unix socket (Cloud Run)
                   │ TCP 5432 (local dev via proxy)
                   ▼
┌──────────────────────────────────────────────────────┐
│         Cloud SQL — PostgreSQL 17                     │
│                                                      │
│  Databases:                                           │
│    wave_hris          (production)                    │
│    wave_hris_staging  (staging)                       │
│                                                      │
│  16 tables, 7 enums, stored functions, triggers       │
└──────────────────────────────────────────────────────┘
```

The app is a monolith — client and server are co-located in one codebase. TanStack Start's server functions act as the API layer, invoked via RPC from React Query on the client. There is no separate REST API or GraphQL endpoint.

---

## Authentication

**Provider:** Firebase Authentication (project `wave-hris-fb`)

### Flow

1. User signs in on the login page using Firebase `signInWithEmailAndPassword`.
2. The `useAuth()` hook listens to `onAuthStateChanged` and stores the Firebase user + ID token.
3. On every server function call, the auth middleware (`src/lib/auth-middleware.ts`) extracts the Firebase ID token from the request context.
4. Server-side, Firebase Admin SDK verifies the token, extracts the Firebase UID, then queries `public.users` to resolve the internal UUID.
5. User roles are loaded from `public.user_roles` and attached to the request context.

### Roles

| Role | Access |
|---|---|
| `employee` | Default. Own DTR, leaves, performance self-assessment |
| `hr` | Employee management, approve leaves/DTR, performance admin |
| `admin` | Full system access |
| `group_head` | Approve OT/leaves for direct reports in the org tree |

### User Provisioning

On first login, if no `public.users` row exists for the Firebase UID, `provisionUser()` creates:
- A `users` record (UUID + firebase_uid + email)
- A `profiles` record (with `must_change_password = true`)
- A `user_roles` record (role = `employee`)

The `_authenticated.tsx` route gate forces a password change modal before granting access when `must_change_password` is true.

### Authorization Helpers

Server functions use assertion helpers from the auth middleware:
- `assertAuthenticated()` — any logged-in user
- `assertUser()` — returns the resolved user context
- `assertHR()` — requires `hr` or `admin` role
- `assertAdmin()` — requires `admin` role

---

## Database

**Engine:** PostgreSQL 17 on Google Cloud SQL  
**Driver:** `pg` (Node.js), connection pooled via `Pool`  
**Schema:** `docs/cloud-sql-schema.sql` (634 lines)

### Connection

| Environment | Method |
|---|---|
| Cloud Run | Unix socket at `/cloudsql/wave-hris-498916:us-central1:wave-hris` |
| Local dev | Cloud SQL Auth Proxy on `127.0.0.1:5432` |

Custom type parsers in `db.server.ts` ensure:
- `DATE` → `"YYYY-MM-DD"` string (avoids timezone shift)
- `TIMESTAMPTZ` → ISO 8601 string
- `NUMERIC` → JavaScript number (safe for small values used in this app)

### Tables

| Table | Purpose |
|---|---|
| `users` | Firebase UID ↔ internal UUID mapping |
| `user_roles` | Role assignments (employee/hr/admin/group_head) |
| `profiles` | Employee details: name, department, position, employee code, leave credits |
| `daily_time_reports` | Individual DTR entries (time in/out, hours, absences, OT) |
| `payroll_cutoffs` | Biweekly pay periods (10th/25th cycle) |
| `dtr_cutoff_submissions` | Aggregated DTR stats per employee per cutoff |
| `dtr_approval_logs` | Audit trail for DTR approval actions |
| `leave_requests` | Leave applications with hierarchical approval chain |
| `ot_approval_requests` | OT budget requests + actual hours filings |
| `org_nodes` | Organization hierarchy tree (parent_id references) |
| `kpi_templates` | KPI definitions (title, target, weight, metric unit) |
| `behavioral_competencies` | Behavioral assessment criteria |
| `evaluation_periods` | Performance review periods (quarterly/annual) |
| `performance_evaluations` | Per-employee evaluation records + scores |
| `evaluation_kpi_scores` | Individual KPI scores within an evaluation |
| `evaluation_behavioral_scores` | Behavioral ratings within an evaluation |
| `office_networks` | Allowlisted office IP/CIDR ranges that gate clock-in |

### Key Stored Functions & Triggers

- **`recalc_cutoff_submission()`** — Aggregates DTR metrics (total hours, absences, late count) whenever a DTR row changes.
- **`dtr_before_write()`** — Auto-assigns the cutoff period and mirrors submission status on insert/update.
- **`subs_after_status_change()`** — Locks individual DTR records when the cutoff submission is approved.
- **`auto_generate_employee_code()`** — Auto-generates sequential `EMP-###` codes on profile creation.
- **`has_role()` / `is_hr_or_admin()`** — Role-check helper functions.

### Enums

`app_role`, `cutoff_status`, `dtr_approval_status`, `approval_action`, `leave_type`, `leave_status`, `ot_approval_status`, `ot_request_type`, `evaluation_status`, `period_type`, `rating_scale`

---

## Server-Side (API)

All server-side logic lives in `src/lib/*-functions.ts` as TanStack Start **server functions** — exported async functions marked with `createServerFn()`. These are not traditional REST endpoints; they're RPC calls invoked by the client through TanStack Start's built-in transport.

### Module Breakdown

| Module | Key Functions |
|---|---|
| `user-functions.ts` | `fetchUserData`, `provisionUser`, `changePassword`, `fetchUserRoles` |
| `employee-functions.ts` | `fetchEmployees`, `updateEmployee`, `deleteEmployee` |
| `dtr-functions.ts` | `getTodayDTR`, `clockInDTR`, `clockOutDTR`, `getActivityLogDTRs` — `clockInDTR` enforces the office-network allowlist |
| `leave-functions.ts` | `fileLeaveRequest`, `fileLeaveOnBehalf`, `approveLeaveStep`, `rejectLeaveStep`, `fetchAllLeaves`, `fetchProfilesForLeaveFiling` |
| `ot-functions.ts` | `fetchOTRequests`, `createOTBudgetRequest`, `fileActualOTHours`, `approveOT`, `rejectOT` |
| `org-functions.ts` | `fetchOrgNodes`, `saveOrgNodes` |
| `office-network-functions.ts` | `listOfficeNetworks`, `addOfficeNetwork`, `setOfficeNetworkActive`, `deleteOfficeNetwork`, `getMyCurrentIp`; `assertOnOfficeNetwork`/`resolveClientIp` helpers |
| `kpi-functions.ts` | `fetchKPITemplates`, `saveKPITemplate`, `deleteKPITemplate` |
| `performance-functions.ts` | `fetchEvaluations`, `submitSelfAssessment`, `scoreEvaluation`, `approveEvaluation` |

### Data Access Pattern

Server functions access the database directly via the shared `pg` Pool:

```typescript
import { pool } from "./db.server";

export const fetchEmployees = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { rows } = await pool.query("SELECT ... FROM profiles ...");
    return rows;
  });
```

There is no ORM — all queries are hand-written SQL.

### Business Rules

- **Clock-in geofencing.** `clockInDTR` resolves the caller's public IP from the
  rightmost `X-Forwarded-For` entry (the value the Cloud Run front end appends;
  leftmost entries are client-spoofable) and rejects the clock-in with
  `OFF_NETWORK` unless it falls within an active `office_networks` CIDR. The check
  **fails open** when no networks are active, so the restriction is opt-in: it
  only takes effect once an admin adds at least one network on the Office
  Networks admin page.
- **Clock-in audience.** The dashboard clock-in/out card and recent-attendance
  table are shown to **every** signed-in user, including HR and admins, so
  elevated users track their own attendance too.
- **Tardiness rule.** Any clock-in after **09:00** is late, regardless of the
  employee's shift. `clockInDTR` computes `late_minutes` (minutes past 09:00) at
  clock-in; `late_minutes > 0` means late. Late and undertime are tagged
  independently in the dashboard, attendance history, and clock-in activity log
  (a record can be both).
- **Business date is local, not UTC.** Clock times (`time_in`/`time_out`) and the
  `work_date` are both derived from the browser's local time via `todayIso()`.
  This must not use `toISOString()` (UTC): a clock-in before UTC midnight (before
  08:00 in GMT+8) would otherwise be stored under the previous day and could not
  be clocked out once UTC rolled over.
- **Leave on behalf.** HR/admins can file a leave for another employee via
  `fileLeaveOnBehalf`. A per-request flag either approves it immediately or routes
  it through that employee's normal supervisor chain (`resolveChain`). On-behalf
  filings are annotated in `review_notes` for audit.
- **Leave balance gate (employees).** When an employee self-files via
  `fileLeaveRequest`, every type except **Leave without Pay (WP)** requires enough
  remaining balance to cover the requested business days: VL→`vl_remaining`,
  SL→`sl_remaining`, all other paid types→combined pool. Insufficient balance is
  rejected with `INSUFFICIENT_BALANCE`; with no balance left, WP is the only
  filable type. HR/admins self-filing and `fileLeaveOnBehalf` are **not** gated.
  The leaves page also reflects this client-side (disabled button + message).
- **Cancel vs delete.** An employee (or HR) can **cancel** their own *pending*
  request via `cancelLeaveRequest`, which soft-cancels it (status `cancelled`,
  kept for history). Hard delete (`deleteLeaveRequest`) remains HR-only.
- **Employee leaves view.** The leaves page loads `fetchAllLeaves` for HR and
  `fetchMyLeaves` (own rows only) for employees, so a regular employee can view
  and cancel their own pending requests there.

---

## Client-Side (UI)

### Routing

TanStack Router with file-based route generation. Routes under `_authenticated/` require login; routes under `_authenticated/_admin/` require `hr` or `admin` role.

| Route | Page |
|---|---|
| `/` | Redirect to dashboard or login |
| `/login` | Email/password login |
| `/dashboard` | Employee home — upcoming cutoffs, leave balance, pending approvals |
| `/dtr` | Daily time report entry and cutoff submission |
| `/leaves` | Leave request form, history, and approval queue |
| `/ot-approvals` | OT budget requests, actual hour filing, approval queue |
| `/performance` | Self-assessment for active evaluation periods |
| `/employees` | (Admin) Employee directory with inline editing |
| `/org-chart` | (Admin) Interactive org chart (React Flow) |
| `/kpi-builder` | (Admin) KPI template CRUD |
| `/performance-admin` | (Admin) Evaluation period management and scoring |
| `/activity-log` | (Admin) System audit log |
| `/office-networks` | (Admin) Office IP/CIDR allowlist that gates clock-in |

### Data Fetching

All data is fetched via React Query calling server functions:

```typescript
const { data, isLoading } = useQuery({
  queryKey: ["employees"],
  queryFn: () => fetchEmployees(),
});
```

Mutations use `useMutation` with `queryClient.invalidateQueries` for cache updates.

### Layout

`AppShell.tsx` provides the main layout — collapsible sidebar with navigation links, top header with user info, and a content area. Navigation items are role-gated (admin links hidden from employees).

---

## Approval Chain System

Leave requests and OT filings use a hierarchical approval chain derived from the org chart.

### How It Works

1. When an employee files a leave or OT request, `resolveChain()` in `chain.server.ts` walks up `org_nodes.parent_id` from the filer to the top of the tree.
2. The resulting array of approver employee IDs is stored in the request's `approver_chain` column.
3. `current_approver_index` starts at `0` — the immediate supervisor.
4. When an approver approves, the index increments. The request stays `pending` until all chain members approve, then flips to `approved`.
5. Any approver in the chain can reject, which immediately sets the request to `rejected`.
6. If the filer has no parent in the org tree (they are a group head / top of tree), the chain is empty and the request auto-approves.

### Two-Phase OT Flow

OT uses a two-phase process:
1. **Budget request** (`request_type = 'pre_approved'`): Manager requests an OT budget (hours) for a target month. Goes through the approval chain.
2. **Actual filing** (`request_type = 'actual'`): Employee files actual OT hours against an approved budget. Also goes through the approval chain. Server-side guard prevents filings that would exceed the approved budget (approved + pending combined).

---

## Environments & Deployment

### Production

| Resource | Value |
|---|---|
| Cloud Run service | `wave-hris` |
| URL | `https://wave-hris-m6r23u5lqa-uc.a.run.app` |
| Database | `wave_hris` on instance `wave-hris` |
| Cloud Build config | `cloudbuild.yaml` |
| Trigger | Push to `main` (via `staging-deploy` trigger pattern — prod may be manual) |
| Max instances | 3 |

### Staging

| Resource | Value |
|---|---|
| Cloud Run service | `wave-hris-staging` |
| URL | `https://wave-hris-staging-831274499203.us-central1.run.app` |
| Database | `wave_hris_staging` on the same Cloud SQL instance |
| Cloud Build config | `cloudbuild-staging.yaml` |
| Trigger | `staging-deploy` — auto-deploys on push to `staging` branch |
| Max instances | 2 |

Both environments share the same Firebase project (`wave-hris-fb`) and the same Cloud SQL instance (`wave-hris-498916:us-central1:wave-hris`). The staging database is schema-identical but data-independent.

### Deployment Pipeline

```
git push origin staging
       │
       ▼
Cloud Build trigger (staging-deploy)
       │
       ├── Docker build (Node 22-Alpine, NITRO_PRESET=node-server)
       ├── Push image to Artifact Registry (staging-$COMMIT_SHA tag)
       └── Deploy to Cloud Run (wave-hris-staging)
```

### Staging Workflow

```bash
# Deploy a feature to staging
git checkout staging
git merge main          # or merge a feature branch
git push                # triggers auto-deploy

# Promote to production
git checkout main
git merge staging
git push
# COMMIT_SHA is a trigger-only substitution, so it must be passed explicitly when
# submitting a manual build from local source — otherwise the image tag is invalid.
gcloud builds submit --config=cloudbuild.yaml --region=us-central1 \
  --substitutions=COMMIT_SHA=$(git rev-parse HEAD) .
```

### Database Migrations

Migrations in `supabase/migrations/*.sql` are **not** applied automatically by the
build pipeline — they must be run against each database manually. `psql` is not
required; use the bundled runner (uses the `pg` driver, reads connection details
from `.env`, takes the target database name as an argument):

```bash
# Staging first
node scripts/apply-migration.mjs supabase/migrations/<file>.sql wave_hris_staging
# Then production
node scripts/apply-migration.mjs supabase/migrations/<file>.sql wave_hris
```

> ⚠️ **Ordering:** when a deploy adds code that reads a new table/column, apply
> the migration to that environment's database **before** deploying the code, or
> the new code will error against the missing object. The runner wraps each file
> in a transaction and rolls back on failure. Your machine's IP must be in the
> Cloud SQL instance's Authorized Networks for the direct connection to work.

### Docker Build

The `Dockerfile` is a two-stage build:

1. **Builder stage** (Node 22-Alpine): `npm install` → `NITRO_PRESET=node-server npm run build` → outputs `dist/`
2. **Runner stage** (Node 22-Alpine): Copies `dist/`, runs `node dist/server/index.mjs` on port 8080

The `VITE_FIREBASE_PROJECT_ID` build arg is baked into the client bundle at build time.

---

## Local Development

### Prerequisites

- Node.js 22+
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) authenticated (`gcloud auth login`)
- [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) running

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Start Cloud SQL Auth Proxy (in a separate terminal)
cloud-sql-proxy wave-hris-498916:us-central1:wave-hris --port=5432

# 3. Create .env from example
cp .env.example .env
# Fill in DB_PASSWORD (from Secret Manager or team)

# 4. Start dev server
npm run dev
# App runs at http://localhost:5173
```

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build (default Nitro preset) |
| `npm run build:node` | Build for Cloud Run (`NITRO_PRESET=node-server`) |
| `npm run start` | Run production build locally |
| `npm run preview` | Vite preview of production build |
| `npm run lint` | ESLint check |
| `npm run format` | Prettier format |

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `CLOUD_SQL_UNIX_SOCKET` | Cloud Run | Unix socket path for Cloud SQL sidecar |
| `DB_HOST` | Local dev | Database host (default `127.0.0.1`) |
| `DB_PORT` | Local dev | Database port (default `5432`) |
| `DB_NAME` | Both | Database name (`wave_hris` or `wave_hris_staging`) |
| `DB_USER` | Both | Database user (default `postgres`) |
| `DB_PASSWORD` | Both | Database password (from Secret Manager in Cloud Run) |
| `FIREBASE_PROJECT_ID` | Server | Firebase project ID for Admin SDK |
| `FIREBASE_WEB_API_KEY` | Server | Firebase web API key |
| `VITE_FIREBASE_PROJECT_ID` | Build-time | Baked into client bundle for Firebase web SDK |
| `APP_ENV` | Cloud Run | `staging` or omitted for production |
| `PORT` | Cloud Run | Injected by Cloud Run (8080) |
| `OFFICE_IP_XFF_DEPTH` | Cloud Run (optional) | Entries to skip from the right of `X-Forwarded-For` when resolving the client IP for clock-in geofencing. Default `1` (direct Cloud Run). Increase if an external HTTPS load balancer is added in front. |

### GCP Resources Reference

| Resource | Identifier |
|---|---|
| GCP Project | `wave-hris-498916` |
| Cloud SQL Instance | `wave-hris-498916:us-central1:wave-hris` |
| Artifact Registry | `us-central1-docker.pkg.dev/wave-hris-498916/wave-hris/app` |
| Firebase Project | `wave-hris-fb` |
| Cloud Build Trigger | `staging-deploy` (branch: `^staging$`) |
| Service Account | `831274499203-compute@developer.gserviceaccount.com` |
