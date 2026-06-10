# Wave HRIS — Google Cloud Migration Guide

Full step-by-step guide for migrating Wave HRIS from Supabase + Vercel to Google Cloud.
Tested on Windows 11 with PowerShell. All commands are single-line (no backslash continuations).

---

## Variables to replace when running on a new account

| Placeholder | Description | Personal account value |
|---|---|---|
| `PROJECT_ID` | GCP project ID | `wave-hris-498916` |
| `INSTANCE_ID` | Cloud SQL instance name | `wave-hris` |
| `DB_NAME` | PostgreSQL database name | `wave_hris` |
| `BUCKET_NAME` | Cloud Storage bucket | `wave-hris-498916-dumps` |
| `REGION` | GCP region | `us-central1` |
| `SUPABASE_PROJECT_REF` | Supabase project reference | `yludsfvsotwwuontmfjf` |
| `SUPABASE_DB_HOST` | Supabase direct DB host | `db.yludsfvsotwwuontmfjf.supabase.co` |

---

## Prerequisites

- Google Cloud account with billing enabled
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- [Supabase CLI](https://supabase.com/docs/guides/cli) installed (`supabase --version` should print a version)
- Access to the Supabase project dashboard

---

## Phase 1 — Google Cloud Project Setup

### Step 1.1 — Authenticate and set project

```powershell
gcloud auth login
gcloud config set project PROJECT_ID
gcloud config get project
```

Expected output: `PROJECT_ID`

### Step 1.2 — Enable required APIs

```powershell
gcloud services enable sqladmin.googleapis.com run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com identitytoolkit.googleapis.com
```

Takes 30–60 seconds. No output means success.

---

## Phase 2 — Cloud SQL (PostgreSQL Database)

### Step 2.1 — Create the Cloud SQL instance

```powershell
gcloud sql instances create INSTANCE_ID --database-version=POSTGRES_17 --edition=ENTERPRISE --tier=db-f1-micro --region=REGION --storage-type=SSD --storage-size=10GB --no-storage-auto-increase --availability-type=zonal
```

> Takes 5–10 minutes. The `--edition=ENTERPRISE` flag is required to use the `db-f1-micro` (cheapest) tier. Without it, GCP defaults to Enterprise Plus which only accepts expensive performance-optimized tiers.

### Step 2.2 — Set the postgres user password

```powershell
gcloud sql users set-password postgres --instance=INSTANCE_ID --password=YOUR_STRONG_PASSWORD
```

Save this password in a password manager. You will need it later.

### Step 2.3 — Create the application database

```powershell
gcloud sql databases create DB_NAME --instance=INSTANCE_ID
```

### Step 2.4 — Verify instance and database

```powershell
gcloud sql instances describe INSTANCE_ID --format="value(state,databaseVersion,region)"
gcloud sql databases list --instance=INSTANCE_ID
```

Expected output:
```
RUNNABLE   POSTGRES_17   REGION
NAME       CHARSET   COLLATION
postgres   UTF8      en_US.UTF8
DB_NAME    UTF8      en_US.UTF8
```

---

## Phase 3 — Export Supabase Database

### Step 3.1 — Reset Supabase DB password

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Open the **hris-lovable** project
3. Go to **Settings → Database**
4. Click **Reset database password** and set a new strong password
5. Save it in your password manager — do NOT share it in chat or commit it to git

### Step 3.2 — Dump the public schema (run with Docker Desktop open)

In PowerShell on your local machine:

```powershell
$env:PGPASSWORD = 'YOUR_SUPABASE_DB_PASSWORD'
supabase db dump --db-url "postgresql://postgres@SUPABASE_DB_HOST:5432/postgres" --schema public -f wave_hris_dump.sql
```

> The Supabase CLI uses Docker internally to run pg_dump. Docker Desktop must be running before executing this command.
>
> **Windows gotcha:** Do not put the password inside the URL if it contains `@` or `!` characters — bash and PowerShell treat these as special characters. Always set `$env:PGPASSWORD` separately.

This creates `wave_hris_dump.sql` in your current directory.

---

## Phase 4 — Import into Cloud SQL

### Step 4.1 — Create a Cloud Storage bucket

```powershell
gcloud storage buckets create gs://BUCKET_NAME --location=REGION
```

### Step 4.2 — Upload the dump file

```powershell
gcloud storage cp wave_hris_dump.sql gs://BUCKET_NAME/
```

### Step 4.3 — Get the Cloud SQL service account email

```powershell
gcloud sql instances describe INSTANCE_ID --format="value(serviceAccountEmailAddress)"
```

Note the email — it looks like `pNNNNNNNNNN-XXXXX@gcp-sa-cloud-sql.iam.gserviceaccount.com`

### Step 4.4 — Grant Cloud SQL access to the bucket

Replace `SA_EMAIL` with the email from Step 4.3:

```powershell
gcloud storage buckets add-iam-policy-binding gs://BUCKET_NAME --member="serviceAccount:SA_EMAIL" --role="roles/storage.objectViewer"
```

### Step 4.5 — Upload and apply the clean schema

> ⚠️ The Supabase dump cannot be imported directly into Cloud SQL because the schema
> references `auth.users` (a Supabase-only schema). Use the Cloud SQL-compatible
> schema file instead: `docs/cloud-sql-schema.sql`.

Upload the clean schema to the bucket:

```powershell
gcloud storage cp docs/cloud-sql-schema.sql gs://BUCKET_NAME/
```

In Cloud Shell, download it and apply it:

```bash
gsutil cp gs://BUCKET_NAME/cloud-sql-schema.sql .
gcloud sql connect INSTANCE_ID --user=postgres --database=DB_NAME < cloud-sql-schema.sql
```

Expected output: a mix of `CREATE TABLE`, `CREATE FUNCTION`, `CREATE TRIGGER`, and a final `DO` for the payroll cutoff seed. "Already exists" errors are harmless if re-running.

### Step 4.6 — Verify the schema

```bash
gcloud sql connect INSTANCE_ID --user=postgres --database=DB_NAME
```

Inside psql:

```sql
\dt
SELECT COUNT(*) FROM payroll_cutoffs;
\q
```

Expected: **10 tables**, **8 payroll cutoff rows**.

### ✅ Phase 4 complete — verified 2026-06-10

```
 public | daily_time_reports     | table | postgres
 public | dtr_approval_logs      | table | postgres
 public | dtr_cutoff_submissions | table | postgres
 public | leave_requests         | table | postgres
 public | org_nodes              | table | postgres
 public | ot_approval_requests   | table | postgres
 public | payroll_cutoffs        | table | postgres
 public | profiles               | table | postgres
 public | user_roles             | table | postgres
 public | users                  | table | postgres
(10 rows)   |   payroll_cutoffs count: 8
```

> ⚠️ **Missing tables:** The 6 performance module tables (`evaluation_periods`,
> `kpi_templates`, `performance_evaluations`, `evaluation_kpi_scores`,
> `evaluation_behavioral_scores`, `behavioral_competencies`) are not in local
> migrations. Dump them separately from Supabase and apply after this step.

---

## Phase 5 — Firebase Authentication [ TODO ]

Replace Supabase Auth with Google Cloud Identity Platform (Firebase Auth).

### What needs to happen:
- Create a Firebase project linked to the GCP project
- Enable Email/Password sign-in provider
- Export existing users from Supabase Auth
- Import users into Firebase (note: passwords use different hashing — users will need to reset passwords)
- Rewrite `src/hooks/use-auth.tsx` to use Firebase Auth SDK
- Rewrite `src/integrations/supabase/auth-middleware.ts` to validate Firebase JWTs
- Replace `handle_new_user` Supabase trigger with a Cloud Function

---

## Phase 6 — Replace Supabase Client in App Code [ TODO ]

Replace all `@supabase/supabase-js` database calls with a direct PostgreSQL client.

### Files to update (100+ locations across 15 files):
- `src/integrations/supabase/client.ts` — replace with `pg` or Prisma client
- `src/integrations/supabase/client.server.ts` — replace with server-side pg client
- `src/hooks/use-auth.tsx` — replace with Firebase Auth
- All route files under `src/routes/_authenticated/` — replace `.from()` query calls

### Environment variables to replace:
| Old (Supabase) | New (GCP) |
|---|---|
| `VITE_SUPABASE_URL` | Cloud SQL connection string |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Firebase `apiKey` |
| `SUPABASE_SERVICE_ROLE_KEY` | Cloud SQL service account key (via Secret Manager) |

---

## Phase 7 — Cloud Run (App Hosting) [ TODO ]

Host the TanStack Start SSR app on Cloud Run.

### Steps:
1. Write a `Dockerfile` in the project root
2. Create an Artifact Registry repository for Docker images
3. Build and push the Docker image
4. Deploy to Cloud Run
5. Configure environment variables via Secret Manager
6. Set up custom domain

### Create Artifact Registry repo:
```powershell
gcloud artifacts repositories create wave-hris --repository-format=docker --location=REGION
```

### Build and push image (run from project root):
```powershell
gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT_ID/wave-hris/app:latest
```

### Deploy to Cloud Run:
```powershell
gcloud run deploy wave-hris --image REGION-docker.pkg.dev/PROJECT_ID/wave-hris/app:latest --region REGION --platform managed --allow-unauthenticated
```

---

## Phase 8 — CI/CD (Auto-deploy on git push) [ TODO ]

Set up Cloud Build to automatically deploy when code is pushed to `main`.

### Steps:
1. Connect GitHub repo to Cloud Build
2. Create `cloudbuild.yaml` in project root
3. Set up trigger on `main` branch push

---

## Phase 9 — Custom Domain + DNS [ TODO ]

Point your domain to the Cloud Run service URL.

---

## Migrating to the Company Google Account

When ready to move from personal to company GCP account:

1. Create a new GCP project in the company account
2. Run all commands in Phases 1–4 with the new `PROJECT_ID`
3. The app code requires no changes — only environment variables change
4. For Firebase Auth: export users from personal Firebase project, import to company Firebase project (users will need to reset passwords)
5. Update DNS to point to the new Cloud Run URL
6. Decommission the personal account resources to stop billing

---

## Cost Estimate (personal dev account)

| Service | Tier | Est. monthly cost |
|---|---|---|
| Cloud SQL | db-f1-micro Enterprise | ~$7–10 |
| Cloud Run | Pay per request (free tier covers most dev usage) | ~$0–2 |
| Artifact Registry | First 0.5 GB free | ~$0 |
| Cloud Storage | First 5 GB free | ~$0 |
| Secret Manager | First 6 active secrets free | ~$0 |
| **Total** | | **~$7–12/month** |

---

## Troubleshooting

### `ERROR: Invalid Tier for ENTERPRISE_PLUS Edition`
Add `--edition=ENTERPRISE` to the `gcloud sql instances create` command.

### `!! event not found` in bash
The `!` character triggers bash history expansion. Always set passwords via `$env:PGPASSWORD` (PowerShell) or `export PGPASSWORD=` (bash) rather than embedding them in URLs.

### `Cannot assign requested address` (IPv6 error in Cloud Shell)
Cloud Shell tries to connect via IPv6. Use the Supabase connection pooler host (`aws-0-ap-southeast-1.pooler.supabase.com`) or dump locally using Docker + Supabase CLI instead.

### `supabase db dump` fails with Docker error
Docker Desktop must be running before invoking the Supabase CLI dump command. Open Docker Desktop and wait for "Engine running" status before retrying.

### `\` line continuation in PowerShell
PowerShell uses backtick `` ` `` for line continuation, not `\`. Use single-line commands to avoid this entirely.
