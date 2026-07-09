// Wave HRIS — Deployment Security Documentation (.docx generator)
// Tidal Solutions branding per the tidal-docs skill. Google Docs-compatible:
// no Header/Footer zones, FIXED table layout + columnWidths on every table.
// Run: cd Docs/scripts && node generate-security-doc.js
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  AlignmentType, BorderStyle, WidthType, TableLayoutType, ShadingType, LevelFormat, PageBreak,
} = require('docx');

const FONT = 'Montserrat';
const T   = '036A6B';  // primary dark teal
const TL  = '15A6A1';  // primary light teal
const BLK = '010101';  // body text
const GRY = '393939';  // secondary text

const WHITE  = 'FFFFFF';
const TBGD   = 'E0F5F5';
const TBGL   = 'F5FAFA';
const RED_BG = 'FCE4D6';
const YLW_BG = 'FFF8E0';
const GRN_BG = 'E8F5EE';

const pageDate = '07/09/2026';
const DOC_VERSION = 'v1.2';
const DOC_MONTH = 'July 2026';

const LOGO_PATH = path.join(__dirname, '../assets/tidal-logo.png');
const logoData = fs.existsSync(LOGO_PATH) ? fs.readFileSync(LOGO_PATH) : null;

// ── helpers ───────────────────────────────────────────────────────────────────
const NONEBD = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NONEBS = { top: NONEBD, bottom: NONEBD, left: NONEBD, right: NONEBD };
const CELLBD = { style: BorderStyle.SINGLE, size: 4, color: 'D0E8E8' };
const CELLBS = { top: CELLBD, bottom: CELLBD, left: CELLBD, right: CELLBD };
const CELLMG = { top: 70, bottom: 70, left: 120, right: 120 };

const h1 = (text) => new Paragraph({
  children: [new TextRun({ text, bold: true, size: 36, color: T, font: FONT })],
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TL } },
  spacing: { before: 320, after: 160 },
});
const h2 = (text) => new Paragraph({
  children: [new TextRun({ text, bold: true, size: 28, color: TL, font: FONT })],
  spacing: { before: 240, after: 120 },
});
const h3 = (text) => new Paragraph({
  children: [new TextRun({ text, bold: true, size: 24, color: T, font: FONT })],
  spacing: { before: 200, after: 100 },
});
const body = (text, opts = {}) => new Paragraph({
  children: [new TextRun({ text, size: 22, color: BLK, font: FONT, ...opts })],
  spacing: { after: 120 },
});
const bodyRuns = (runs) => new Paragraph({
  children: runs.map((r) => new TextRun({ size: 22, color: BLK, font: FONT, ...r })),
  spacing: { after: 120 },
});
const bullet = (text, opts = {}) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  children: [new TextRun({ text, size: 22, color: BLK, font: FONT, ...opts })],
  spacing: { after: 80 },
});
const subBullet = (text) => new Paragraph({
  numbering: { reference: 'bullets', level: 1 },
  children: [new TextRun({ text, size: 20, color: GRY, font: FONT })],
  spacing: { after: 60 },
});
const spacer = (after = 120) => new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after } });

const cell = (text, width, o = {}) => new TableCell({
  width: { size: width, type: WidthType.DXA },
  borders: CELLBS,
  margins: CELLMG,
  shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR } : undefined,
  children: (Array.isArray(text) ? text : [text]).map((t) => new Paragraph({
    children: [new TextRun({ text: t, size: o.size || 20, bold: o.bold || false, color: o.color || BLK, font: FONT, italics: o.italics || false })],
    spacing: { after: 20 },
  })),
});
const headerRow = (labels, widths) => new TableRow({
  tableHeader: true,
  children: labels.map((l, i) => cell(l, widths[i], { fill: T, color: WHITE, bold: true })),
});
const dataRow = (values, widths, o = {}) => new TableRow({
  children: values.map((v, i) => cell(v, widths[i], { fill: o.fill, bold: o.bold, color: o.color })),
});
const table = (widths, rows) => new Table({
  layout: TableLayoutType.FIXED,
  columnWidths: widths,
  width: { size: 9000, type: WidthType.DXA },
  rows,
});
// Alternating TBGL/null shading for data rows.
const zebraTable = (widths, header, rows, rowOpts = []) => table(widths, [
  headerRow(header, widths),
  ...rows.map((r, i) => dataRow(r, widths, { fill: (rowOpts[i] && rowOpts[i].fill) || (i % 2 === 0 ? TBGL : undefined), ...(rowOpts[i] || {}) })),
]);

const diagramImg = (pngRelPath, w, h, caption) => {
  const abs = path.join(__dirname, pngRelPath);
  const children = [];
  if (fs.existsSync(abs)) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 60 },
      children: [new ImageRun({
        data: fs.readFileSync(abs), type: 'png',
        transformation: { width: w, height: h },
        altText: { title: caption, description: caption, name: caption },
      })],
    }));
  } else {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `[ MISSING DIAGRAM: ${pngRelPath} — run convert-svg-to-png.js ]`, bold: true, size: 22, color: 'B03A2E', font: FONT })],
    }));
  }
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: caption, italics: true, size: 18, color: GRY, font: FONT })],
  }));
  return children;
};

// ── body header (logo left, date right) — Rule 4 ─────────────────────────────
const bodyHeaderTable = new Table({
  layout: TableLayoutType.FIXED,
  columnWidths: [5400, 3600],
  width: { size: 9000, type: WidthType.DXA },
  borders: { top: NONEBD, bottom: NONEBD, left: NONEBD, right: NONEBD, insideH: NONEBD, insideV: NONEBD },
  rows: [new TableRow({ children: [
    new TableCell({
      width: { size: 5400, type: WidthType.DXA }, borders: NONEBS,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      children: [new Paragraph({
        children: logoData
          ? [new ImageRun({ data: logoData, transformation: { width: 140, height: 32 }, type: 'png', altText: { title: 'Tidal Solutions', description: 'Tidal Solutions logo', name: 'tidal-logo' } })]
          : [new TextRun({ text: 'TIDAL SOLUTIONS', bold: true, size: 26, color: T, font: FONT })],
      })],
    }),
    new TableCell({
      width: { size: 3600, type: WidthType.DXA }, borders: NONEBS,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: `DATE: ${pageDate}`, size: 20, font: FONT, color: BLK })],
      })],
    }),
  ]})],
});
const bodyHeaderRule = new Paragraph({
  children: [new TextRun({ text: '' })],
  border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: TL } },
  spacing: { before: 60, after: 80 },
});

// ── cover ─────────────────────────────────────────────────────────────────────
const cover = [
  spacer(400),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'DEPLOYMENT SECURITY DOCUMENTATION', bold: true, size: 48, color: T, font: FONT })],
    spacing: { after: 160 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Wave HRIS — Web Application + Device Attendance API', bold: true, size: 28, color: TL, font: FONT })],
    spacing: { after: 400 },
  }),
];

const metaWidths = [2800, 6200];
const coverMeta = table(metaWidths, [
  dataRow(['Client', 'Wave — internal workforce HRIS'], metaWidths, { fill: TBGL }),
  dataRow(['Prepared By', 'Tidal Solutions'], metaWidths),
  dataRow(['Document Version', `${DOC_VERSION} — Production Setup (${DOC_MONTH})`], metaWidths, { fill: TBGL }),
  dataRow(['Date', DOC_MONTH], metaWidths),
  new TableRow({ children: [
    cell('Classification', 2800, { fill: RED_BG, bold: true, color: T }),
    cell('CONFIDENTIAL — For CISO / SOC Review', 6200, { fill: RED_BG, bold: true, color: T }),
  ]}),
  dataRow(['Production Status', 'Live — production since June 2026 (wave-hris on Cloud Run)'], metaWidths, { fill: TBGL }),
  dataRow(['Reviewed By', '[ CISO / Security Officer — Wave ]'], metaWidths),
]);

// ── Section 1 — Executive Summary ─────────────────────────────────────────────
const s1 = [
  h1('1. Executive Summary'),
  body('This document describes the production deployment architecture of Wave HRIS — a full-stack Human Resource Information System that manages daily time reports (DTR), leave, overtime approvals, performance evaluations, and org-chart data for an internal workforce. It is intended for review by the Information Security Officer / SOC team and covers all production data flows, inter-component communication channels, security controls, access controls, and Philippine Data Privacy Act (RA 10173) compliance considerations.'),
  body(`This document reflects the production environment as of ${DOC_MONTH} (main branch). All infrastructure is operated by Tidal Solutions on Google Cloud on behalf of Wave.`),
  body('The system is composed of five primary components:'),
  bullet('Web client — React 19 SSR-hydrated browser application (TanStack Start), authenticated via the Firebase Auth SDK'),
  bullet('Cloud Run — the application monolith (TanStack Start / Nitro SSR): server functions (RPC) for all business logic plus raw HTTP endpoints for unattended attendance devices; services wave-hris (production) and wave-hris-staging (staging), region us-central1'),
  bullet('Cloud SQL — managed PostgreSQL 17 (instance wave-hris) holding the production database wave_hris and the schema-identical, data-independent wave_hris_staging'),
  bullet('Firebase Authentication — identity provider (email/password, ID tokens); production project wave-hris-fb, isolated staging project wave-hris-staging-fb'),
  bullet('Attendance devices — unattended NFC / biometric / kiosk terminals that punch clock-ins via a device-key-authenticated API (no human session)'),
  body('The system handles employee PII (names, emails, employee codes, department/position), attendance records, leave records, and performance evaluations. No payment card data, no health records, and no external customer data are stored or processed. The web app and the device endpoints are internet-reachable; the platform ingress is open by design and every data operation is gated by application-layer authentication and authorization (Section 5).'),
];

// ── Section 2 — System Architecture ───────────────────────────────────────────
const invWidths = [2000, 2700, 2400, 1900];
const s2 = [
  h1('2. System Architecture'),
  h2('2.1 Component Inventory'),
  zebraTable(invWidths,
    ['Component', 'Role', 'Hosting / Location', 'Operated By'],
    [
      ['Web client (browser)', 'Employee / HR / admin UI — React 19 SSR-hydrated, Firebase Auth SDK, React Query', 'End-user devices', 'Wave employees'],
      ['Cloud Run — wave-hris', 'Application monolith: SSR, server functions (RPC), device attendance endpoints, auth middleware, security headers', 'GCP us-central1 (staging: wave-hris-staging)', 'Tidal Solutions'],
      ['Cloud SQL — PostgreSQL 17', 'Primary database: wave_hris (prod), wave_hris_staging (staging) on instance wave-hris', 'GCP us-central1 (zonal)', 'Google (managed) / Tidal Solutions'],
      ['Firebase Authentication', 'Identity provider — email/password sign-in, ID token (JWT) issuance', 'Google Cloud (United States)', 'Google (managed)'],
      ['Attendance devices', 'Unattended NFC / biometric / kiosk clock-in terminals', 'Office premises', 'Wave / Tidal Solutions'],
      ['Cloud Build + Artifact Registry', 'CI/CD — Docker image build (Node 22-alpine) and deploy pipeline; trigger staging-deploy on branch ^staging$', 'GCP us-central1', 'Tidal Solutions'],
      ['Secret Manager', 'Credential storage (DB_PASSWORD), injected as env vars at deploy', 'GCP us-central1', 'Google (managed)'],
      ['Nager.Date API', 'Philippine national holiday feed for the holidays calendar (read-only, no key, no PII outbound)', 'External public API', 'Third party'],
    ]),
  spacer(),
  h2('2.2 System Architecture & Data Flow Diagram'),
  body('Figure 1 shows all production components, the data that flows between them, the protocol used on each channel, and the authentication mechanism at each hop.'),
  ...diagramImg('../diagrams/security-diagram-1-architecture.png', 600, 420, 'Figure 1 — Wave HRIS System Architecture & Data Flow'),
  h2('2.3 Architecture Notes'),
  bullet('The app is a monolith — client and server ship from one codebase. TanStack Start server functions are the only API surface for the web app; there is no separate REST or GraphQL service. The one exception is the small set of raw HTTP endpoints for attendance devices.'),
  bullet('Authorization is enforced server-side inside every server function via role assertions. The client-side route gates (_authenticated, _authenticated/_admin) are UX conveniences, not the security boundary.'),
  bullet('The database has no public IP path from the application: Cloud Run connects over the Cloud SQL Unix socket (/cloudsql/wave-hris-498916:us-central1:wave-hris). Developer access requires the Cloud SQL Auth Proxy or an IP listed in the instance Authorized Networks (kept to a single office IP).'),
  bullet('The device endpoints authenticate a device, not a human — unattended terminals hold a channel-scoped X-Device-Key and never a Firebase session.'),
  bullet('Staging is a parallel deployment (wave-hris-staging service, wave_hris_staging database, wave-hris-staging-fb Firebase project) — schema-identical, data-independent, and auth-isolated from production.'),
];

// ── Section 3 — Inter-Component Data Flows ────────────────────────────────────
const dfmWidths = [1500, 1500, 2600, 1500, 1900];
const s3 = [
  h1('3. Inter-Component Data Flows'),
  h2('3.1 Web Clock-In / Attendance Flow'),
  body('Figure 2 documents the step-by-step path of an interactive clock-in from the employee dashboard through authentication, the office-network geofence, and GPS location tagging, to the attendance record write.'),
  ...diagramImg('../diagrams/security-diagram-2-web-clockin.png', 600, 342, 'Figure 2 — Web Clock-In / Attendance Flow'),
  h2('3.2 Device Attendance API Flow'),
  body('Figure 3 documents the hardened path for unattended devices: the four security gates every request passes, and the server-time clock-in / clock-out state machine that makes re-taps idempotent.'),
  ...diagramImg('../diagrams/security-diagram-3-device-api.png', 600, 360, 'Figure 3 — Device Attendance API Flow (Clock-In / Clock-Out State Machine)'),
  h2('3.3 Data Flow Matrix'),
  body('The table below documents every data channel in the production system: what data is transmitted, in which direction, the protocol, and the authentication mechanism.'),
  zebraTable(dfmWidths,
    ['From', 'To', 'Data Transmitted', 'Protocol / Transport', 'Auth / Security Control'],
    [
      ['Browser', 'Firebase Auth', 'Email + password at sign-in; password-change requests', 'HTTPS (TLS 1.2+)', 'Firebase Authentication; returns ID token (JWT, ~1h TTL); forced password change on first login'],
      ['Browser', 'Cloud Run (app)', 'Server-function RPC calls: DTR entries, leave/OT requests, GPS location payload (lat/lon/accuracy/status), admin actions', 'HTTPS (TLS 1.2+)', 'Firebase ID token per call; verified server-side via Admin SDK; per-function role assertions'],
      ['Cloud Run (app)', 'Firebase (Google JWKS)', 'ID token verification; user management (provisioning, password reset, refresh-token revocation)', 'HTTPS (TLS 1.2+)', 'Application Default Credentials — runtime service account with roles/firebaseauth.admin; no key files in the image'],
      ['Cloud Run (app)', 'Cloud SQL', 'All application reads/writes: profiles, DTR, leaves, OT, evaluations, org tree, office networks', 'Unix socket (/cloudsql/…)', 'DB password from Secret Manager; no public IP path; parameterized SQL only'],
      ['Attendance device', 'Cloud Run (device endpoints)', 'employeeCode + channel on POST /api/attendance/clock-in and GET|POST /api/attendance/verify', 'HTTPS (TLS 1.2+)', 'X-Device-Key — SHA-256 + timingSafeEqual, fail-closed, channel-scoped; 30 req / 10 s per-IP rate limit; 4 KB body cap'],
      ['Cloud Run (app)', 'Nager.Date API', 'Country code + year for PH holiday sync — no personal data outbound', 'HTTPS (TLS 1.2+)', 'Public read-only API (no key); results stored in the holidays table'],
      ['Cloud Build', 'Artifact Registry / Cloud Run', 'Docker image (staging-$COMMIT_SHA / $COMMIT_SHA tags); deploy commands', 'Google internal (TLS)', 'Cloud Build service account; pipeline defined in cloudbuild*.yaml in the repo'],
      ['Developer workstation', 'Cloud SQL', 'Manual SQL migrations (scripts/apply-migration.mjs), transactional with rollback', 'Cloud SQL Auth Proxy / TLS TCP 5432', 'gcloud IAM auth (proxy) or Authorized Networks (single office IP); DB password from local .env (git-ignored)'],
    ]),
];

// ── Section 4 — Data Classification and Storage ───────────────────────────────
const dtWidths = [1900, 1500, 1900, 1400, 2300];
const s4 = [
  h1('4. Data Classification and Storage'),
  h2('4.1 Data Types Handled'),
  zebraTable(dtWidths,
    ['Data Element', 'Classification', 'Where Stored', 'Retention', 'Notes'],
    [
      ['Employee identity: name, email, employee code, department, position', 'PII', 'profiles, users', 'While employed', 'Core HR master data; employee codes auto-generated (EMP-###)'],
      ['Firebase UID', 'Pseudonymous ID', 'users', 'While account active', 'Maps the identity provider to the internal UUID'],
      ['Attendance records: time in/out, shift, hours, late/undertime flags', 'Operational — HR sensitive', 'daily_time_reports', 'Indefinite (operational)', 'Locked when the cutoff submission is approved (trigger-enforced)'],
      ['GPS location at web clock-in/out: lat, lon, accuracy, capture status', 'PII — location', 'daily_time_reports (location columns)', 'With the DTR record', 'Audit-only; optional (denial never blocks the punch); stripped from employee-facing payloads — HR/admin audit views only'],
      ['Leave requests: type, dates, reason, review notes', 'PII — HR sensitive', 'leave_requests', 'Indefinite (operational)', 'Soft-cancel keeps history; on-behalf filings annotated for audit'],
      ['OT requests: budget + actual hours', 'Operational', 'ot_approval_requests', 'Indefinite (operational)', 'Two-phase approval; server-side budget guard'],
      ['Performance evaluations, KPI + behavioral scores', 'Sensitive HR data', 'performance_evaluations (+ score tables)', 'Per HR policy', 'Visible to the employee (self-assessment) and HR/admin'],
      ['Leave credits (VL/SL balances)', 'Operational', 'profiles', 'While employed', 'Gates employee self-filed leave requests'],
      ['Office network allowlist (IP/CIDR)', 'Internal configuration', 'office_networks', 'Until removed', 'Drives the clock-in geofence; admin-managed'],
      ['Passwords', 'Credential', 'NOT stored in the app DB — Firebase Auth manages credentials (hashed)', 'n/a', 'The application database never sees or stores a password'],
      ['Admin-issued temporary passwords', 'Credential', 'Not stored — generated via CSPRNG, returned once', 'n/a', 'Existing refresh tokens revoked on reset'],
    ]),
  spacer(),
  h2('4.2 What is NOT Stored'),
  bullet('Passwords or password hashes in the application database — credentials live exclusively in Firebase Authentication'),
  bullet('Payment or financial information — the DTR cutoff module groups time reports for review only and does not compute or disburse pay'),
  bullet('Health or medical records of any kind — not in scope'),
  bullet('External customer data — all data subjects are internal workforce members'),
  bullet('GPS location on device punches — only the interactive web clock-in/out carries a location payload; the device path has none'),
  bullet('Service-account key files — the container image ships no credentials; the Admin SDK uses Application Default Credentials'),
  bullet('Plaintext temporary passwords — generated with a CSPRNG, shown once to the admin, never written to the database or logs'),
];

// ── Section 5 — Security Controls ─────────────────────────────────────────────
const encWidths = [2200, 2600, 4200];
const aaWidths = [2200, 2800, 4000];
const s5 = [
  h1('5. Security Controls'),
  h2('5.1 Encryption'),
  zebraTable(encWidths,
    ['Layer', 'Mechanism', 'Scope'],
    [
      ['Transit — all public channels', 'TLS 1.2+ / 1.3 (HTTPS)', 'Browser ↔ Cloud Run, devices ↔ Cloud Run, Firebase, Nager.Date — Google-managed certificates on *.run.app'],
      ['Transit — app ↔ database', 'Cloud SQL Unix socket', 'Traffic never traverses a public network; no TCP listener exposed to the internet from the app path'],
      ['At rest — Cloud SQL', 'AES-256 (Google-managed default encryption)', 'All databases, replicas, and backups on instance wave-hris'],
      ['Secrets', 'Secret Manager', 'DB_PASSWORD encrypted at rest, IAM-gated, injected as an env var at deploy — never baked into the image'],
      ['HTTP security headers', 'Set on every response (src/server.ts)', 'Strict-Transport-Security (max-age=31536000; includeSubDomains), X-Content-Type-Options: nosniff, X-Frame-Options: DENY, Referrer-Policy: strict-origin-when-cross-origin, Permissions-Policy: camera=(), microphone=(), geolocation=(self) — (self) permits only the app’s own document to request location for the audit-only clock-in tagging'],
      ['Content Security Policy', 'Nonce-based, strict-dynamic — enforcement-ready, env-driven', "Per-request nonce, object-src 'none', base-uri 'self', frame-ancestors 'none'; violations POSTed to the in-app collector via report-uri /api/csp-report. The legacy https: fallback is removed from script-src (gate condition). Setting CSP_ENFORCE=true on the Cloud Run service switches Report-Only to the blocking header — no redeploy; rollback is the same flip"],
    ]),
  spacer(),
  h2('5.2 Authentication and Authorization'),
  zebraTable(aaWidths,
    ['Service / Channel', 'Authentication Method', 'Authorization Model'],
    [
      ['Web login', 'Firebase email/password', 'First login provisions users + profiles (must_change_password = true) + user_roles (employee); a forced password-change modal gates access until changed'],
      ['Server functions (RPC)', 'Firebase ID token per call, verified with the Admin SDK against Google JWKS', 'Role assertions on every function: assertAuthenticated, assertUser, assertHR (hr or admin), assertAdmin. Employees are limited to own-rows queries (e.g. fetchMyLeaves); anonymous calls pass only for first-login provisioning'],
      ['Sensitive admin operations', 'strictAuthMiddleware — verifyIdToken with checkRevoked', 'Revoked sessions are rejected on high-impact paths; explicit logout revokes the caller’s refresh tokens'],
      ['Device endpoints', 'X-Device-Key — SHA-256 digest compared with timingSafeEqual across all configured keys; fail-closed (missing DEVICE_API_KEYS means all requests 401)', 'Per-channel key scoping (key:label:channel): a key bound to nfc cannot submit channel=face (403 CHANNEL_NOT_ALLOWED). Responses expose only the employee display name'],
      ['Cloud SQL', 'DB user + password from Secret Manager (app); gcloud IAM via Auth Proxy (developers)', 'No public IP path from the app; developer direct connections require Authorized Networks (single office IP)'],
      ['Firebase Admin SDK', 'Application Default Credentials — Cloud Run runtime service account', 'Scoped by IAM (roles/firebaseauth.admin); no service-account key files are shipped in the image'],
      ['CI/CD', 'Cloud Build service account', 'Pipeline defined in-repo (cloudbuild.yaml / cloudbuild-staging.yaml); staging auto-deploys from the staging branch, production is promoted from main'],
    ]),
  spacer(),
  h2('5.3 Network Security'),
  bullet('Cloud Run: only HTTPS (443) is exposed; TLS termination and certificates are Google-managed. Platform ingress is --allow-unauthenticated by design for a public web app — every data operation is gated at the application layer.'),
  bullet('Cloud SQL: no public path from the application (Unix socket). Direct access is limited to the Cloud SQL Auth Proxy (IAM) or the instance Authorized Networks, kept to a single office IP.'),
  bullet('Device endpoints: sliding-window rate limit of 30 requests / 10 s per client IP (per instance — prod max 3, staging max 2 instances); 4 KB body cap before parsing; application/json required; control characters rejected; employeeCode length-bounded; channel matched to a strict slug regex.'),
  bullet('Clock-in geofencing: the client IP is resolved from the rightmost X-Forwarded-For entry (appended by the Cloud Run front end — leftmost entries are client-spoofable and ignored); depth configurable via OFFICE_IP_XFF_DEPTH. Punches must fall within an active office_networks CIDR; the check fails open when no networks are active (opt-in restriction — see Section 8).'),
  bullet('Anti-tamper time: work_date, time_in and lateness are derived from server PH time, never from the device or browser clock.'),
  bullet('Error handling: SSR errors are normalized to a branded 500 page; SQL errors and stack traces are never returned to clients (the device path returns an opaque SERVER_ERROR).'),
  bullet('Injection: all queries are hand-written parameterized SQL ($1, $2, …) through the shared pg pool — no ORM, no string-built queries, including on the device path.'),
];

// ── Section 6 — Access Controls ───────────────────────────────────────────────
const roleWidths = [1400, 2700, 2300, 2600];
const s6 = [
  h1('6. Access Controls'),
  h2('6.1 Role Matrix'),
  zebraTable(roleWidths,
    ['Role', 'Can Access', 'Cannot Access', 'Enforcement Mechanism'],
    [
      ['employee (default)', 'Own dashboard, clock-in/out, own attendance history, own leave requests (file, view, cancel pending), own OT filings, performance self-assessment', 'Other employees’ records, approval queues, admin/HR pages, office networks, KPI builder', 'Own-rows SQL queries keyed to the resolved user; assertHR / assertAdmin on privileged functions; leave-balance gate on self-filing'],
      ['group_head', 'Approvals for direct reports (leave / OT) via the org-tree approval chain', 'Records of employees outside their subtree; admin functions', 'resolveChain() walks org_nodes.parent_id; approver order enforced by current_approver_index'],
      ['hr', 'Employee management, leave/DTR approvals, on-behalf leave filing, activity log, holidays calendar, today roster', 'Admin-only functions (e.g. office networks CRUD, password resets where admin-gated)', 'assertHR (hr or admin) on every HR function; on-behalf actions annotated in review_notes for audit'],
      ['admin', 'Full system access: all HR capabilities plus office networks, KPI builder, performance admin, org chart, employee password resets', '—', 'assertAdmin; sensitive operations additionally use strictAuthMiddleware (checkRevoked)'],
      ['Device identity', 'POST /api/attendance/clock-in and /verify for its bound channel only', 'Any human-facing function, any other channel, any read of employee data beyond a display name', 'X-Device-Key auth (fail-closed, constant-time), per-channel scoping, rate limiting'],
    ]),
  spacer(),
  h2('6.2 Session and Account Controls'),
  bullet('Client-side session policy: 1-hour idle timeout and 12-hour absolute cap from login (lib/session.ts + SessionGuard), tracked in localStorage across tabs; a warning dialog offers "Stay signed in" about one minute before expiry.'),
  bullet('Server-side revocation: explicit logout revokes the caller’s refresh tokens; sensitive admin operations verify tokens with checkRevoked so revoked sessions cannot ride out the ID-token TTL.'),
  bullet('First-login hardening: provisioning sets must_change_password = true and the auth gate forces a password change before any access.'),
  bullet('Admin password resets: temporary passwords come from a CSPRNG (node:crypto randomInt), are returned exactly once, are never stored, and revoke the user’s existing refresh tokens.'),
  bullet('Route gates (_authenticated, _authenticated/_admin) mirror the server-side rules in the UI, but the enforced boundary is always the per-function assertion.'),
];

// ── Section 7 — DPA Compliance ────────────────────────────────────────────────
const procWidths = [2000, 3000, 1600, 2400];
const s7 = [
  h1('7. Philippine Data Privacy Act (RA 10173) Compliance'),
  h2('7.1 Lawful Basis and Consent'),
  bullet('Processing is grounded in the employment relationship: attendance, leave, overtime, and performance data are collected to administer HR obligations for an internal workforce.'),
  bullet('GPS location capture at web clock-in/out is permission-based: the browser Geolocation API prompts the employee, and denial or unavailability never blocks the punch — the record simply carries a specific "unavailable" reason instead of coordinates.'),
  bullet('RECOMMENDED ACTION: publish an internal employee privacy notice that names the data categories processed (including audit-only clock-in location) and the retention rules, and obtain acknowledgment at onboarding.'),
  spacer(60),
  h2('7.2 Data Minimization'),
  bullet('Clock-in location is audit-only: coordinates are stored with the attendance record, stripped from all employee-facing payloads, and visible only in HR/admin audit views. It never gates the punch.'),
  bullet('Device endpoints disclose only the employee display name in responses — never UUIDs or emails — limiting what employee-code probing can enumerate.'),
  bullet('The holiday sync sends no personal data outbound (country code + year only).'),
  bullet('No health, financial, or biometric payloads are stored: biometric matching happens on the device; the API receives only an employee code and channel label.'),
  spacer(60),
  h2('7.3 Data Retention'),
  bullet('Attendance, leave, and evaluation records are retained in Cloud SQL for operational and audit purposes; DTR records are locked (not purged) once a cutoff submission is approved.'),
  bullet('RECOMMENDED ACTION: define a formal retention policy with Wave (recommended: 12–36 months for attendance detail, then purge or anonymize) and implement a scheduled purge job (pg_cron). No automated purge mechanism currently exists.'),
  bullet('Approval trails (dtr_approval_logs, review notes, soft-cancelled requests) provide audit traceability without hard deletes.'),
  spacer(60),
  h2('7.4 Third-Party Data Processors'),
  zebraTable(procWidths,
    ['Processor', 'Data Processed', 'Location', 'Privacy Policy'],
    [
      ['Google Cloud Platform (Cloud Run, Cloud SQL, Cloud Build, Secret Manager)', 'All application data and database content; build artifacts; secrets', 'United States (us-central1)', 'https://cloud.google.com/privacy'],
      ['Google — Firebase Authentication', 'Employee emails and credential hashes; ID token issuance', 'United States', 'https://firebase.google.com/support/privacy'],
      ['Nager.Date', 'None — public holiday dates fetched read-only; no personal data transmitted', 'External public API', 'https://date.nager.at'],
    ]),
  spacer(60),
  body('Cross-border note: employee personal data is stored in the United States (us-central1). Under RA 10173 this is permissible with adequate safeguards (Google Cloud’s certifications and DPA terms apply), but the storage location should be named in the employee privacy notice. A future migration to an Asia-Pacific region (e.g. asia-southeast1) would reduce both latency and cross-border considerations.', { italics: true }),
];

// ── Section 8 — Residual Risks ────────────────────────────────────────────────
const riskWidths = [2600, 1200, 1400, 1100, 2700];
const s8 = [
  h1('8. Residual Risks and Mitigations'),
  zebraTable(riskWidths,
    ['Risk', 'Likelihood', 'Impact', 'Status', 'Mitigation'],
    [
      ['CSP ships Report-Only until the CSP_ENFORCE env var is set — an XSS payload is logged (via /api/csp-report) but not blocked until then', 'Low', 'Medium-High', '✅ Ready', 'Policy is enforcement-ready: https: fallback dropped from script-src, violation collector live, and the build verified locally with CSP_ENFORCE=true (login render, hydration, Firebase sign-in — zero violations). Operational: set CSP_ENFORCE=true on the Cloud Run service after a clean report window; rollback is unsetting it.'],
      ['Clock-in geofence fails open when no office network is active', 'Config-dependent', 'Medium', 'Accepted (opt-in)', 'By design the restriction activates only once an admin adds a network. Confirm office_networks is populated in production if geofencing is required (Section 10, #2).'],
      ['Device rate limit is per Cloud Run instance, not global', 'Low', 'Low-Medium', 'Accepted', 'Effective limit scales with instance count — kept low (prod max 3). UNIQUE(employee_id, work_date) is the correctness backstop. Central limiter (Redis/Memorystore) is a future candidate.'],
      ['Cloud Run ingress is --allow-unauthenticated (public at the platform layer)', 'By design', 'Medium', 'Accepted', 'Required for a public web app. All data operations are authenticated and authorized at the application layer; device endpoints are fail-closed.'],
      ['Production and staging share one Cloud SQL instance', 'Low', 'Medium', 'Accepted', 'Databases are separate (wave_hris vs wave_hris_staging). Noisy-neighbor/blast-radius risk judged adequate at current scale; split instances if load grows.'],
      ['Session lifetime (1h idle / 12h cap) is enforced client-side only', 'Low', 'Medium', 'Mitigated', 'The Firebase ID token keeps its ~1h server validity regardless of client idle state. Sensitive admin ops verify checkRevoked; logout revokes refresh tokens.'],
      ['Docker base image floats on node:22-alpine (no digest pin)', 'Low', 'Medium', 'Open', 'Pin the base image to a digest in the Dockerfile so rebuilds are reproducible and upstream changes are deliberate (Section 10, #5).'],
      ['Migrations are applied manually per database (ordering risk)', 'Low', 'Medium', 'Process control', 'Rule: migrate before deploying code that reads new objects. The runner wraps each file in a transaction and rolls back on failure.'],
      ['Device clock-out is write-once — an accidental early clock-out needs HR correction', 'Low', 'Low', 'Accepted (by design)', 'Write-once (time_out IS NULL guard) deliberately prevents payroll-hour inflation and undertime laundering via re-taps. HR retains a correction path; a tap log + anomaly flag is a future enhancement.'],
      ['Employee PII stored in a US region (cross-border under RA 10173)', 'N/A (compliance)', 'DPA consideration', 'Open', 'Permissible with safeguards; name the location in the privacy notice (Section 7.4). Consider an APAC region on a future migration.'],
    ],
    [
      { fill: YLW_BG }, { fill: YLW_BG }, {}, {}, {}, { fill: GRN_BG }, { fill: YLW_BG }, {}, {}, { fill: YLW_BG },
    ]),
];

// ── Section 9 — Secrets Inventory ─────────────────────────────────────────────
const secWidths = [2000, 1900, 2400, 2700];
const s9 = [
  h1('9. Secrets and Credentials Inventory'),
  zebraTable(secWidths,
    ['Credential', 'Used By', 'Production Storage', 'Exposure Risk / Notes'],
    [
      ['DB_PASSWORD', 'App (pg pool), migration runner', 'Secret Manager — injected as env var at deploy', 'Server-side only, never in the image or client bundle. Rotate on personnel change or suspected exposure.'],
      ['DEVICE_API_KEYS (key:label:channel entries)', 'Device attendance endpoints', 'Cloud Run env var', 'HIGH VALUE for attendance integrity — compared as SHA-256 digests in constant time; channel scoping limits a leaked key to its own channel. Rotate per device on decommission.'],
      ['Firebase web config (apiKey, project id)', 'Browser bundle', 'Baked at build (VITE_FIREBASE_PROJECT_ID)', 'Intentionally public — an identifier, not a secret. Access control lives in token verification and server-side assertions.'],
      ['FIREBASE_WEB_API_KEY', 'Server (auth flows)', 'Cloud Run env var', 'Server-side convenience for Identity Toolkit calls; not a bearer credential on its own.'],
      ['Runtime service account (831274499203-compute@…)', 'Cloud Run — Admin SDK via ADC', 'GCP IAM (roles/firebaseauth.admin)', 'No key file exists to leak; permissions scoped by IAM. Review grants periodically.'],
      ['Developer .env (DB password, local config)', 'Local development', 'Developer machines — git-ignored', 'Plaintext on dev machines only. Rotate the shared DB password if a laptop is lost/compromised.'],
      ['Cloud Build credentials', 'CI/CD pipeline', 'Google-managed service account', 'No credentials are committed to the repository; pipeline configs are declarative YAML.'],
    ]),
];

// ── Section 10 — Security Actions ─────────────────────────────────────────────
const actWidths = [500, 4100, 1300, 1300, 1800];
const s10 = [
  h1('10. Security Actions and Operational Follow-Ups'),
  body('Production is live; the actions below harden the deployment, complete the compliance posture, and prepare the VAPT handoff to the SOC team (recommended target: staging — identical build, no production employee data).'),
  zebraTable(actWidths,
    ['#', 'Action', 'Priority', 'Status', 'Owner'],
    [
      ['1', 'Enforce CSP: policy is enforcement-ready (https: dropped per the gate condition, report collector live, verified locally with CSP_ENFORCE=true). Remaining step is operational — set CSP_ENFORCE=true on the Cloud Run service after a clean report window', 'HIGH', 'Env flip pending', 'Tidal Solutions — DevOps'],
      ['2', 'Confirm office_networks is populated in production if clock-in geofencing must be active (the check fails open with zero active networks)', 'HIGH', 'Open', 'Wave HR + Tidal Solutions'],
      ['3', 'Provision VAPT test accounts on staging — one employee role, one admin role — and issue a scoped test X-Device-Key; share over a secure channel with the SOC team', 'HIGH', 'Open', 'Tidal Solutions'],
      ['4', 'Define and document a data retention policy with Wave (recommended 12–36 months) and implement a scheduled purge job (pg_cron)', 'MEDIUM', 'Open', 'Wave (CISO) + Tidal Solutions'],
      ['5', 'Pin the Docker base image to a digest (node:22-alpine@sha256:…) for reproducible builds', 'MEDIUM', 'Open', 'Tidal Solutions — DevOps'],
      ['6', 'Publish the employee privacy notice covering clock-in GPS location capture, data categories, retention, and US data residency', 'MEDIUM', 'Open', 'Wave HR + Tidal Solutions'],
      ['7', 'Establish a rotation schedule for DB_PASSWORD and DEVICE_API_KEYS (on personnel change, device decommission, or suspected exposure)', 'MEDIUM', 'Open', 'Tidal Solutions'],
      ['8', 'Evaluate a central rate limiter (Redis / Memorystore) for the device endpoints if max-instances ever increases', 'LOW', 'Backlog', 'Tidal Solutions'],
      ['9', 'Staging Firebase isolation — dedicated wave-hris-staging-fb project with per-environment SSR config injection', 'COMPLETED', '✅ Done', 'Tidal Solutions'],
      ['10', 'Remove the legacy Supabase client and dependency (dead code / supply-chain surface)', 'COMPLETED', '✅ Done', 'Tidal Solutions'],
      ['11', 'Ship HTTP security headers on every response + nonce-based CSP in Report-Only mode', 'COMPLETED', '✅ Done', 'Tidal Solutions'],
    ],
    [
      { fill: YLW_BG }, { fill: YLW_BG }, { fill: YLW_BG }, {}, {}, {}, {}, {}, { fill: GRN_BG }, { fill: GRN_BG }, { fill: GRN_BG },
    ]),
];

// ── footer ────────────────────────────────────────────────────────────────────
const footer = [
  spacer(240),
  new Paragraph({
    children: [new TextRun({ text: '' })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: TL } },
    spacing: { before: 120, after: 120 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: `CONFIDENTIAL — Tidal Solutions × Wave  |  Deployment Security Documentation ${DOC_VERSION}  |  ${DOC_MONTH}`,
      size: 18, color: GRY, font: FONT,
    })],
  }),
];

// ── document ──────────────────────────────────────────────────────────────────
const doc = new Document({
  styles: { default: { document: { run: { font: FONT, size: 22, color: BLK } } } },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 480, hanging: 240 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 900, hanging: 240 } } } },
        ],
      },
    ],
  },
  sections: [{
    properties: {
      page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } },
    },
    children: [
      bodyHeaderTable,
      bodyHeaderRule,
      ...cover,
      coverMeta,
      new Paragraph({ children: [new PageBreak()] }),
      ...s1, ...s2, ...s3, ...s4, ...s5, ...s6, ...s7, ...s8, ...s9, ...s10,
      ...footer,
    ],
  }],
});

const OUT = path.join(__dirname, `../documents/WaveHRIS-Deployment-Security-Doc-${DOC_VERSION}.docx`);
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT, buffer);
  console.log(`OK  ${OUT}  (${Math.round(buffer.length / 1024)} KB)`);
});
