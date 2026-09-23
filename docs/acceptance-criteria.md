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

---

# Acceptance Criteria — All Requests (admin)

Feature: one admin-only, read-only page listing every request filed by any employee —
leave, OT budget (pre-approved), OT actual hours, and attendance disputes.
Date: 2026-09-23 · Design gate: explicitly declined by user (no architecture change).

Before this change, admins saw every leave (`fetchAllLeaves`), only the OT waiting on
themselves (`fetchMyPendingOTApprovals`), and only *pending* disputes
(`fetchAllPendingDisputes`). No surface showed org-wide OT or decided disputes.

## Functional

- **AC-R1** A user with the `admin` role can open "All Requests" (`/all-requests`)
  from the navigation drawer. The link is not shown to HR, group heads or employees.
- **AC-R2** The page lists, in one table, every leave request, OT budget request, OT
  actual-hours filing and attendance dispute from **all employees**, whose filing
  date (`created_at`, Philippine time) falls inside the selected range (inclusive),
  newest first. The default range is the last 90 days, ending today.
- **AC-R3** The admin can filter by request type (all or one of the four), by status
  (all / pending / approved / rejected / cancelled), by date range, and by employee
  name or employee code (free-text search). A count for each status is shown for the
  current type + date selection.
- **AC-R4** Each row shows the employee (name, department), the request type, what
  was requested (leave: type, dates, half-day period; OT budget: hours + target month;
  OT actual: hours, work date, time range; dispute: work date, original → requested
  times), the status, and when it was filed (PH time).
- **AC-R5** A pending row shows who it is waiting on (current approver's name) and its
  position in the chain ("step N of M"). A decided row shows when it was decided and,
  where the database records it (leave, dispute), by whom. OT stores no reviewer, so
  its reviewer is shown as unavailable rather than guessed.
- **AC-R6** The admin can open a row to read the full requester text (leave reason,
  OT justification, dispute reason) and the approver's review notes.
- **AC-R7** The page is read-only: it has no approve, reject, cancel, delete or edit
  controls. Acting on a request still goes through the existing approval screens.

## Non-functional / security

- **AC-R8** The server function requires an authenticated user with the `admin` role
  (`assertAdmin`). HR, group heads and employees receive `FORBIDDEN`; anonymous callers
  receive `UNAUTHENTICATED`. The page itself redirects non-admins to `/dashboard`
  (the `_admin` layout alone admits HR, so the page adds its own admin check).
- **AC-R9** The server function's only input is the filed-date range, validated
  server-side: dates must be real `YYYY-MM-DD` dates, end ≥ start, and end − start
  ≤ 366 days. The page runs the same validator, so it never blocks a range the server
  accepts. Type, status and search filter the already-authorized rows client-side and
  never reach the server. All SQL is parameterized. The response is capped at a fixed
  number of rows and says when it was truncated, so the page can tell the admin to
  narrow the range.
- **AC-R10** Free text (reasons, notes) is rendered as plain text through React's
  default escaping — no `dangerouslySetInnerHTML`.
- **AC-R11** No new personal data is collected or stored. Viewing is limited to the
  admin role, which already holds full control of employee records (RA 10173:
  purpose-limited access by the role that administers the records).
- **AC-R12** Lint, typecheck, production build and the full test suite pass. The pure
  input-validation logic has unit tests covering the shape checks, date checks and the
  366-day cap.
