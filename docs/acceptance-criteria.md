# Acceptance Criteria — Admin Data Export (Reports)

Feature: HR/admin-facing CSV export of attendance, leave requests, and OT requests.
Date: 2026-07-10 · Design gate: explicitly declined by user (build-direct).

## Functional

- **AC-1** An HR or admin user can open a "Data Export" page from the app navigation
  (`/reports`) and generate a CSV for a chosen date range and any combination of
  record types (attendance / leave / overtime).
- **AC-2** Attendance rows are selected by `work_date` within the range (inclusive).
  Leave and OT rows are selected by the date the request was **filed**
  (`created_at`, Philippine time), matching the ad-hoc report delivered 2026-07-10.
- **AC-3** The CSV uses one unified header row (`record_type` first column); columns
  not applicable to a record type are blank. Values containing commas, quotes, or
  newlines are quoted per RFC 4180; free-text cells starting with `= + - @` are
  neutralized (formula-injection guard via the shared `csvEscape`), and the download
  carries a UTF-8 BOM so Excel renders accented names (shared `triggerCSVDownload`).
- **AC-4** The system service account (`localadmin@hris.local`) and employees flagged
  `exclude_from_attendance` are excluded from all three datasets, consistent with
  every other monitoring surface (admin dashboard, DTR rollups).
- **AC-5** The file downloads in-browser as `hris-report_<start>_to_<end>.csv` and a
  success toast reports per-type row counts.

## Non-functional / security

- **AC-6** The server function requires an authenticated user with the `hr` or
  `admin` role (`assertHR`); employees and anonymous callers receive
  FORBIDDEN/UNAUTHENTICATED errors. The route itself sits under the `_admin` gate
  (redirects non-HR to dashboard, unauthenticated to login).
- **AC-7** Input is validated server-side: dates must be `YYYY-MM-DD`, end ≥ start,
  range ≤ 366 days, at least one record type. All SQL uses parameterized queries.
- **AC-8** Lint, typecheck, production build, and the full test suite pass.

## Evidence (at build time)

- SQL parity check vs the delivered one-off report (2026-06-15 → 2026-07-10):
  491 attendance / 43 leave / 39 OT rows — exact match, end-bound includes a
  request filed 2026-07-10 10:04 PH.
- `npx tsc --noEmit` clean; `npm test` 38/38 green; node-server build boots;
  `/reports` redirects unauthenticated users to `/login`.
