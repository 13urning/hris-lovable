
## Scope

Build a minimal-but-real HRIS in this blank template, then layer the per-cut-off DTR approval workflow on top. Cut-offs end on the **10th** and **25th** of each month:

- **Cut-off 1:** 26th of prev month → 10th of current month (payout: 15th)
- **Cut-off 2:** 11th → 25th of current month (payout: end of month)

## Stack

- Lovable Cloud (auth + Postgres + RLS)
- TanStack Start file routes, TanStack Query, shadcn/ui, Tailwind
- `user_roles` table with `app_role` enum: `employee`, `hr`, `admin` (`has_role` security-definer fn)

## Database (single migration)

Tables:
1. `profiles` (id=auth.users.id, full_name, department, employee_code, created_at) — auto-created via trigger
2. `user_roles` (id, user_id, role) + `has_role()`
3. `payroll_cutoffs` (id, cutoff_name, start_date, end_date, payout_date, status, created_at)
4. `daily_time_reports` (id, employee_id, work_date, time_in, time_out, hours_worked, late_minutes, is_absent, is_leave, leave_type, overtime_hours, notes, **cutoff_id**, **approval_status**, **locked_at**, **approved_by**, **approved_at**, **rejection_reason**, **correction_notes**, created_at, updated_at)
5. `dtr_cutoff_submissions` (all 19 fields you listed) + UNIQUE(employee_id, cutoff_id)
6. `dtr_approval_logs` (id, dtr_cutoff_submission_id, action, action_by, action_date, notes)

Enums: `app_role`, `cutoff_status` (open|closed|paid), `dtr_approval_status` (draft|submitted|pending_approval|approved|rejected|needs_correction), `approval_action` (submitted|approved|rejected|needs_correction|unlocked|resubmitted).

Triggers / functions:
- Auto-create profile + default `employee` role on signup
- `recalc_cutoff_submission(employee_id, cutoff_id)` — recomputes totals (days, hours, late_count, absent_count, overtime_hours, leave_days, missing_dtr_count) from DTR rows
- DTR insert/update/delete trigger → calls recalc + auto-assigns `cutoff_id` from work_date
- Block DTR edits when parent submission is `approved` (locked_at set)
- Seed current + next 2 cut-offs

RLS:
- Employees: read/write their own DTRs + submissions; read all cut-offs
- HR/Admin: full read; approve/reject/unlock submissions; insert approval logs
- All policies use `has_role()` to avoid recursion

## Routes

```
src/routes/
  __root.tsx                       (existing — wire QueryClient + auth context)
  index.tsx                        (landing → redirect by role)
  login.tsx                        (email/password + signup)
  _authenticated.tsx               (gate)
  _authenticated/
    dashboard.tsx                  (employee dashboard + Cut Off Summary card)
    dtr.tsx                        (employee DTR list/entry, submit-for-approval)
    _admin.tsx                     (hr/admin gate)
    _admin/
      admin.tsx                    (admin dashboard: pending, missing, approved, rejected, late)
      cutoff-approval.tsx          (the Cut Off Approval page with filters + bulk actions + CSV export)
      cutoff-approval.$id.tsx      (drill-down: per-employee DTR detail + approve/reject/needs-correction/unlock + log history)
      cutoffs.tsx                  (manage payroll_cutoffs)
      employees.tsx                (list + assign roles/department)
```

## Cut Off Approval page

Columns exactly as requested: Cut off period, Employee, Department, Days submitted, Total hours, Late count, Absent count, OT hours, Leave days, Missing DTR count, Status.

Filters: cut-off, employee, department, status, date range.

Bulk actions: approve / reject / needs-correction / export CSV (client-side via Blob).

Per-row drill-down → cutoff-approval.$id shows every DTR row, approval log timeline, action buttons. Unlock is admin-only.

## Employee dashboard — Cut Off Summary card

Current cut-off (auto-derived from today), DTRs submitted, missing DTRs (= working-day count − submitted), total hours, current status, **Submit for Approval** button (disabled if already submitted or no DTRs).

## Design

Editorial / professional HR aesthetic — `instrument-serif-work-sans` typography, **Slate & Steel** palette (cool grays + blue accent), generous whitespace, table-first UX, subtle motion via `framer-motion` on cards. Tokens in `src/styles.css` (oklch). All colors via semantic tokens.

## Build order

1. Enable Lovable Cloud
2. Migration (enums, tables, triggers, RLS, seed cut-offs)
3. Design system + base layout/header
4. Auth: login/signup, `_authenticated` gate, auth context in router
5. Employee DTR page + dashboard with Cut Off Summary
6. Admin Cut Off Approval page (list + filters + bulk + CSV)
7. Admin drill-down detail + approval log
8. Admin dashboard widgets + cut-offs/employees management
9. QA: smoke-test signup → DTR → submit → HR approve → lock

## Out of scope (will note for follow-up)

Payroll computation/payslips, leave request workflow, biometric integration, multi-company, notifications/email, time-zone handling beyond `Asia/Manila` assumption.
