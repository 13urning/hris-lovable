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

const pageDate = '07/28/2026';
const DOC_VERSION = 'v1.4';
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
  dataRow(['Document Version', `${DOC_VERSION} — Production Setup + Observability Design (${DOC_MONTH})`], metaWidths, { fill: TBGL }),
  dataRow(['Date', `28 July 2026`], metaWidths),
  new TableRow({ children: [
    cell('Classification', 2800, { fill: RED_BG, bold: true, color: T }),
    cell('CONFIDENTIAL — For CISO / SOC Review', 6200, { fill: RED_BG, bold: true, color: T }),
  ]}),
  dataRow(['Production Status', 'Live — production since June 2026 (wave-hris on Cloud Run). Sections 1–10 are as-built. Section 11 (observability and logging) is PROPOSED — pre-build design intent, approved for implementation on branch fix/half-day-leave-dtr-grading.'], metaWidths, { fill: TBGL }),
  dataRow(['Reviewed By', '[ CISO / Security Officer — Wave ]'], metaWidths),
]);

// ── Section 1 — Executive Summary ─────────────────────────────────────────────
const s1 = [
  h1('1. Executive Summary'),
  body('This document describes the production deployment architecture of Wave HRIS — a full-stack Human Resource Information System that manages daily time reports (DTR), leave, overtime approvals, performance evaluations, and org-chart data for an internal workforce. It is intended for review by the Information Security Officer / SOC team and covers all production data flows, inter-component communication channels, security controls, access controls, and Philippine Data Privacy Act (RA 10173) compliance considerations.'),
  body(`This document reflects the production environment as of ${DOC_MONTH} (main branch). All infrastructure is operated by Tidal Solutions on Google Cloud on behalf of Wave.`),
  bodyRuns([
    { text: 'Changes since v1.3 (this revision, v1.4). ', bold: true },
    { text: 'This revision adds a production observability and logging capability, prompted by a four-day silent outage. From 23 July 2026 07:27 until 27 July, a PostgreSQL 42P08 parse error broke all leave filing — both employee self-service and HR file-on-behalf — and produced zero Cloud Logging entries. The first and only signal was an employee emailing a screenshot. Root cause of the blind spot: a server-function throw is caught by the TanStack Start transport and serialized to the client, so it never reaches the request middleware in start.ts or the fetch catch in src/server.ts, and was never written to stderr. The design that closes this is documented in the new Section 11 and Figure 4, with the resulting controls folded into Sections 2 through 10. Two latent defects found during the same review are fixed by the change: lib/error-capture.ts registers its handlers through globalThis.addEventListener, which does not exist in the Node runtime, so uncaught exceptions and unhandled rejections were silently discarded; and the pg pool in lib/db.server.ts has no error listener, which in Node means an idle-client failure terminates the container process. This revision also adds a new internal data flow — pseudonymous employee identifiers written to Cloud Logging — which changes the data-classification and access-control posture and is treated accordingly in Sections 4, 6, and 7.' },
  ]),
  bodyRuns([
    { text: 'Status of this revision. ', bold: true },
    { text: 'Sections 1 through 10 describe the system as built and running in production. Section 11 is design intent that has been approved but not yet implemented; it is written in the future tense and will be restated as as-built fact once the work clears the QA and security gates. Items in Sections 4, 5, 6, 8, 9, and 10 that depend on the observability build are marked as planned so a reader can tell current reality from committed design.' },
  ]),
  body('The system is composed of five primary components:'),
  bullet('Web client — React 19 SSR-hydrated browser application (TanStack Start), authenticated via the Firebase Auth SDK'),
  bullet('Cloud Run — the application monolith (TanStack Start / Nitro SSR): server functions (RPC) for all business logic plus raw HTTP endpoints for unattended attendance devices; services wave-hris (production) and wave-hris-staging (staging), region us-central1'),
  bullet('Cloud SQL — managed PostgreSQL 17 (instance wave-hris) holding the production database wave_hris and the schema-identical, data-independent wave_hris_staging'),
  bullet('Firebase Authentication — identity provider (email/password, ID tokens); production project wave-hris-fb, isolated staging project wave-hris-staging-fb'),
  bullet('Attendance devices — unattended NFC / biometric / kiosk terminals that punch clock-ins via a device-key-authenticated API (no human session)'),
  body('A sixth, non-request-serving capability is added by this revision: Cloud Logging, Error Reporting, and Cloud Monitoring provide structured logging, error grouping, and alerting for the Cloud Run services. These are managed Google Cloud services consumed from within the existing project — they add no new service to operate, no sidecar container, and no third-party data processor (Sections 5.4, 7.4, and 11).'),
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
      ['CI/CD — GitHub Actions + Workload Identity Federation', 'Keyless deploy: builds the Docker image (Node 22-alpine), pushes to Artifact Registry, and runs gcloud run deploy to wave-hris on push to main via GitHub OIDC → WIF. cloudbuild.yaml is retained for manual/local builds', 'GitHub-hosted runners → GCP us-central1', 'Tidal Solutions'],
      ['Secret Manager', 'Credential storage (DB_PASSWORD), injected as env vars at deploy', 'GCP us-central1', 'Google (managed)'],
      ['Nager.Date API', 'Philippine national holiday feed for the holidays calendar (read-only, no key, no PII outbound)', 'External public API', 'Third party'],
      ['Cloud Logging (PLANNED)', 'Ingests structured JSON written to stdout by the Cloud Run services; Log Router directs production to a dedicated 90-day bucket with a restricted Log View, staging to _Default at 30 days, and a narrow security-audit view at 400 days', 'GCP us-central1', 'Google (managed) / Tidal Solutions'],
      ['Error Reporting (PLANNED)', 'Groups ERROR-severity entries by stack signature and notifies on a newly seen signature — the primary detection control for a silent regression', 'GCP (project-scoped)', 'Google (managed) / Tidal Solutions'],
      ['Cloud Monitoring (PLANNED)', 'Log-based metrics, alert policies, and an uptime check; delivers to an email distribution and a Google Chat webhook', 'GCP (project-scoped)', 'Tidal Solutions'],
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
  bullet('Production deploys are keyless: GitHub Actions authenticates to Google Cloud through Workload Identity Federation (GitHub OIDC → the github-deployer service account) and runs build/push/deploy on push to main — no service-account key file exists for CI/CD. cloudbuild.yaml remains in the repo for manual builds.'),
  bullet('Observability is in-process, not a separate tier (PLANNED): the application writes one Cloud Logging JSON object per line to stdout and Cloud Run captures it natively. There is no logging agent, no OpenTelemetry collector sidecar, and no second always-on service — a deliberate choice to avoid adding an operational component and a per-instance resource cost to a small deployment (Section 11.1).'),
  bullet('The RPC surface has a single instrumentation choke point (PLANNED): all 106 server functions run through either authMiddleware (102) or strictAuthMiddleware (4) in src/lib/auth-middleware.ts. Wrapping those two middleware bodies instruments the entire RPC surface without touching the 17 feature modules that define the functions.'),
  bullet('Environment separation in logs depends on APP_ENV (PLANNED): the variable is currently read only by the Firebase config resolver and is not reliably set on either Cloud Run service, and the deploy workflow sets no environment variables. It must be set explicitly per service so every log entry and every alert policy can be filtered by environment (Sections 10 and 11.5).'),
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
  h2('3.3 Observability and Log Pipeline (PLANNED)'),
  body('Figure 4 documents the logging path introduced by this revision: where a log record is created, where personal data is removed from it, how it reaches Cloud Logging, and how it becomes an alert. This is a new internal data flow — it moves employee-linked pseudonymous identifiers out of the database tier and into a log store with its own retention and access model, which is why it is treated as a first-class flow rather than an implementation detail.'),
  ...diagramImg('../diagrams/security-diagram-4-observability.png', 600, 414, 'Figure 4 — Observability and Log Pipeline (planned design)'),
  body('Three properties of this flow matter for security review. First, the redaction gate sits between the application and stdout, so nothing reaches Cloud Logging without passing an allowlist. Second, the error-logging wrapper is placed inside the server-function boundary, which is the only layer where a handler throw is observable — the same throw is invisible to the request middleware and to the Nitro fetch handler above it. Third, the pipeline is fail-open: every logging call is individually guarded, and the wrapper rethrows the original error object unchanged, so a fault in the logging path can degrade a log line but can never alter application behaviour or take down a request.'),
  spacer(),
  h2('3.4 Data Flow Matrix'),
  body('The table below documents every data channel in the production system: what data is transmitted, in which direction, the protocol, and the authentication mechanism. It covers CI/CD and developer access as well as runtime traffic.'),
  zebraTable(dfmWidths,
    ['From', 'To', 'Data Transmitted', 'Protocol / Transport', 'Auth / Security Control'],
    [
      ['Browser', 'Firebase Auth', 'Email + password at sign-in; password-change requests', 'HTTPS (TLS 1.2+)', 'Firebase Authentication; returns ID token (JWT, ~1h TTL); forced password change on first login'],
      ['Browser', 'Cloud Run (app)', 'Server-function RPC calls: DTR entries, leave/OT requests, GPS location payload (lat/lon/accuracy/status), admin actions', 'HTTPS (TLS 1.2+)', 'Firebase ID token per call; verified server-side via Admin SDK; per-function role assertions'],
      ['Cloud Run (app)', 'Firebase (Google JWKS)', 'ID token verification; user management (provisioning, password reset, refresh-token revocation)', 'HTTPS (TLS 1.2+)', 'Application Default Credentials — runtime service account with roles/firebaseauth.admin; no key files in the image'],
      ['Cloud Run (app)', 'Cloud SQL', 'All application reads/writes: profiles, DTR, leaves, OT, evaluations, org tree, office networks', 'Unix socket (/cloudsql/…)', 'DB password from Secret Manager; no public IP path; parameterized SQL only'],
      ['Attendance device', 'Cloud Run (device endpoints)', 'employeeCode + channel on POST /api/attendance/clock-in and GET|POST /api/attendance/verify', 'HTTPS (TLS 1.2+)', 'X-Device-Key — SHA-256 + timingSafeEqual, fail-closed, channel-scoped; 30 req / 10 s per-IP rate limit; 4 KB body cap'],
      ['Cloud Run (app)', 'Nager.Date API', 'Country code + year for PH holiday sync — no personal data outbound', 'HTTPS (TLS 1.2+)', 'Public read-only API (no key); results stored in the holidays table'],
      ['GitHub Actions (CI)', 'Artifact Registry / Cloud Run', 'Docker image ($GITHUB_SHA / latest tags); gcloud run deploy on push to main', 'HTTPS — GitHub OIDC → Google STS token exchange', 'Keyless via Workload Identity Federation (github-pool / github-provider) impersonating github-deployer@wave-hris-498916; no SA keys. cloudbuild.yaml retained for manual builds'],
      ['HR / Admin browser', 'Local disk (CSV download)', 'Bulk export: org-wide attendance / leave / OT rows — employee code, name, company, department, email, dates, hours, notes (≤366-day window)', 'HTTPS (TLS 1.2+); server-function RPC → CSV', 'Firebase ID token + assertHR (hr or admin); server-side date/range validation; CSV formula-injection escaping; system/service account excluded'],
      ['Developer workstation', 'Cloud SQL', 'Manual SQL migrations (scripts/apply-migration.mjs), transactional with rollback', 'Cloud SQL Auth Proxy / TLS TCP 5432', 'gcloud IAM auth (proxy) or Authorized Networks (single office IP); DB password from local .env (git-ignored)'],
      ['Cloud Run (app) — PLANNED', 'Cloud Logging', 'Structured JSON log records: severity, message, trace and span IDs, server-function name, HTTP method/path/status, latency, outcome, APP_ENV, and pseudonymous actor IDs (internal user UUID, Firebase UID). Error records add error name, SQLSTATE, constraint name, and stack. No request bodies, no names, no emails, no free-text reasons', 'stdout capture on the Cloud Run instance (in-process, no network hop)', 'Redaction allowlist applied before write; runtime service account needs roles/logging.logWriter; entries land in an IAM-gated bucket and are readable only through a restricted Log View'],
      ['Cloud Logging — PLANNED', 'Error Reporting / Cloud Monitoring', 'ERROR-severity entries for signature grouping; log-based counter metrics (server_fn_calls, server_fn_errors) labelled by function name and environment', 'Internal Google Cloud service-to-service, project-scoped', 'Google-managed within wave-hris-498916; no data leaves the project and no third-party processor is introduced'],
      ['Cloud Monitoring — PLANNED', 'Email distribution / Google Chat space', 'Alert notifications: policy name, condition, affected service and environment, error signature, and a link back to the Log Explorer query. Metric values and function names only — no employee identifiers in the notification payload', 'HTTPS (TLS 1.2+) — Monitoring notification channels', 'Email to a named distribution; Google Chat via an incoming webhook URL stored in Secret Manager (a bearer credential — see Section 9)'],
      ['Operator browser — PLANNED', 'Cloud Logging (Log Explorer)', 'Read access to production log records containing pseudonymous employee identifiers', 'HTTPS (TLS 1.2+), Google Cloud console or gcloud', 'Google Workspace SSO + IAM; roles/logging.viewAccessor on the restricted production Log View, granted to the wave-hris-log-readers group only (Section 6.1)'],
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
      ['Application log records (PLANNED): severity, message, trace/span ID, server-function name, HTTP method/path/status, latency, APP_ENV', 'Operational — non-personal', 'Cloud Logging — prod bucket (90 days), staging _Default (30 days)', '90 days prod / 30 days staging', 'Technical telemetry only. Written to stdout as one JSON object per line and captured natively by Cloud Run'],
      ['Actor identifiers in log records (PLANNED): internal user UUID (dbUserId), Firebase UID', 'Pseudonymous ID — personal data under RA 10173', 'Cloud Logging — prod bucket, restricted Log View', '90 days (400 days for the narrow security-audit view)', 'Deliberately pseudonymous: logs carry opaque UUIDs, never names or emails. Re-identification requires a separate, access-controlled query against the users table, which is itself the minimization control'],
      ['Error diagnostics in log records (PLANNED): error name, SQLSTATE code, constraint name, stack trace', 'Operational — non-personal by construction', 'Cloud Logging — prod bucket', '90 days', 'Allowlist-serialized. The PostgreSQL detail, hint, where, internalQuery, and parameters fields are hard-dropped because detail echoes literal row values on constraint violations'],
      ['Device diagnostics in log records (PLANNED): device key ID, channel label, client IP', 'Pseudonymous / network identifier', 'Cloud Logging — prod bucket', '90 days', 'Client IP is personal data under RA 10173 and is retained only for the geofence and abuse-investigation purpose. Raw employee codes are removed from the not-found and ambiguous-match log lines by this change'],
    ]),
  spacer(120),
  bodyRuns([
    { text: 'Bulk export note. ', bold: true },
    { text: 'HR/admin can export attendance, leave, and OT records (and the employee master list) as CSV via the Reports page and the admin tables. Exports are server-authoritative (assertHR), capped at a 366-day window, exclude the system/service account, and pass every cell through a spreadsheet formula-injection guard. An export is a copy of already-authorized PII written to the operator’s device — that copy leaves the platform’s technical controls and is governed by the employee privacy notice and retention policy (Sections 7 and 10).' },
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
  spacer(),
  h3('What is NOT written to logs (PLANNED)'),
  body('These are enforced negative claims, not conventions. The log serializer is allowlist-based: a field is omitted unless it has been explicitly permitted, so a newly added property on an error or a context object is excluded by default rather than leaked by default. Unit tests assert each claim below and run in CI.'),
  bullet('Employee names, email addresses, home addresses, or government identifiers (TIN, SSS, PhilHealth, Pag-IBIG) — actor identity in a log record is always an opaque UUID'),
  bullet('Free-text reason and review-note fields from leave requests, overtime filings, and attendance disputes — employees type medical and personal detail into these, so no server-function input payload is logged in any form, on any code path, including error paths'),
  bullet('Salary, leave credit balances, or performance evaluation scores'),
  bullet('PostgreSQL error detail, hint, where, internalQuery, or parameters fields — detail echoes literal row values on a constraint violation (for example a key tuple containing an employee UUID and date)'),
  bullet('Firebase ID tokens, session tokens, the DB password, device API keys, or any Authorization / X-Device-Key header value'),
  bullet('GPS coordinates captured at web clock-in — location stays in the attendance record and is never mirrored into a log line'),
  bullet('Request or response bodies, in whole or in part'),
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
      ['Content Security Policy', 'Nonce-based, strict-dynamic — enforcement-ready, env-driven', "Per-request nonce, object-src 'none', base-uri 'self', frame-ancestors 'none', and frame-src limited to 'self' plus the project's firebaseapp.com Auth-helper origin (the Firebase sign-in iframe, derived from the same env the Admin SDK uses so staging stays isolated); violations POSTed to the in-app collector via report-uri /api/csp-report. The legacy https: fallback is removed from script-src (gate condition). Setting CSP_ENFORCE=true on the Cloud Run service switches Report-Only to the blocking header — no redeploy; rollback is the same flip"],
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
      ['CI/CD', 'GitHub Actions via Workload Identity Federation — GitHub OIDC federated to the github-deployer service account; no service-account key files', 'Deploy runs only from main (plus manual workflow_dispatch). The federated identity is scoped to the github-pool provider and impersonates a single deployer SA; cloudbuild.yaml is retained for manual builds (Cloud Build SA)'],
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
  bullet('CSV export safety: report and table exports pass every string cell through a formula-injection guard (a leading =, +, -, @, tab or CR is prefixed with a single quote so spreadsheets render it as text, not a formula) and RFC-4180-quote values containing commas, quotes or newlines. The bulk report export (generateActivityReport) is assertHR-gated with server-side date-range validation (calendar-valid dates, start ≤ end, ≤366 days).'),
  spacer(),
  h2('5.4 Observability and Logging Controls (PLANNED)'),
  body('Logging is treated as a security control and as a processing activity in its own right. The controls below govern what is written, what is prevented from being written, and what happens when something goes wrong in the logging path itself.'),
  h3('Log integrity and coverage'),
  bullet('Structured JSON: every server-side log record is a single-line JSON object using the Cloud Logging special fields (severity, message, logging.googleapis.com/trace, logging.googleapis.com/spanId, logging.googleapis.com/labels, httpRequest), so Cloud Logging parses it into queryable fields rather than opaque text.'),
  bullet('Guaranteed error capture: an observability wrapper inside authMiddleware and strictAuthMiddleware wraps the downstream handler, logs any throw with its stack and SQLSTATE, and rethrows the original error unchanged. This closes the gap that hid the 23 July 42P08 failure — server-function throws are serialized to the client by the transport and are not visible to the request middleware or the Nitro fetch handler.'),
  bullet('Process-level capture: process.on(\'uncaughtException\') and process.on(\'unhandledRejection\') handlers log and, for an uncaught exception, exit non-zero so Cloud Run replaces the instance rather than leaving it in an undefined state. This replaces the current lib/error-capture.ts guard, which tests for globalThis.addEventListener and therefore never registers under Node.'),
  bullet('Database fault capture: a pool.on(\'error\') listener on the pg pool logs idle-client failures. Attaching it also removes a latent hard-crash — an EventEmitter error event with no listener terminates the Node process, so a Cloud SQL restart or a reaped connection could kill the container silently.'),
  bullet('Trace correlation: the trace ID is parsed from the Cloud Run X-Cloud-Trace-Context header at the edge and carried in AsyncLocalStorage for the life of the request, so every record emitted while serving one user action shares a trace and reads as a single thread in Log Explorer.'),
  bullet('Fail-open by construction: each logging call is individually wrapped so a serialization or I/O fault degrades a log line and nothing else. A redaction failure emits a placeholder rather than throwing. Logging never participates in control flow.'),
  spacer(60),
  h3('PII redaction (RA 10173 technical control)'),
  bullet('Allowlist, not denylist: the serializer emits only fields explicitly permitted for the record type. Error objects contribute name, code (SQLSTATE), constraint, severity, routine, and stack; everything else on the object is dropped. A denylist would silently start leaking the first time a new field appeared upstream, which is the failure mode this design rejects.'),
  bullet('Pseudonymous actors: the actor on a record is the internal user UUID and Firebase UID, never the email or name that the middleware already holds in context. Resolving a UUID to a person is a separate, access-controlled database query, which keeps the log store minimized by default while remaining operationally useful.'),
  bullet('No payloads: server-function inputs are never logged. This is absolute and covers error paths, because the leave, overtime, and dispute reason fields are free text that routinely contains medical detail.'),
  bullet('Final scrub: a last-pass regular-expression sweep removes email addresses and long digit runs (TIN, SSS, PhilHealth, Pag-IBIG shapes) from any message string before write, as a backstop against an accidental interpolation reaching the emitter.'),
  bullet('Tested, not asserted: src/lib/log-redact.test.ts proves each negative claim in Section 4.2 against representative PostgreSQL errors and context objects, and runs in CI. This is the evidence artifact for the security gate and for a privacy review.'),
  bullet('Lint enforcement: an ESLint no-console rule scoped to src/server.ts and src/lib/**/*.server.ts prevents an unstructured, unredacted call from being reintroduced.'),
  spacer(60),
  h3('Detection and alerting'),
  bullet('New error signature: Error Reporting groups ERROR-severity records by stack signature (via the ReportedErrorEvent @type payload) and notifies the moment a signature is seen for the first time. This is the control that would have surfaced the 42P08 within minutes of the first affected employee rather than after four days.'),
  bullet('Per-function failure: an alert fires when any single server function records five or more errors in ten minutes. A global error-rate threshold alone can miss one feature failing completely while the rest of the application stays healthy, which is exactly what happened on 23 July.'),
  bullet('Supporting policies: overall server-function error ratio above 5% over ten minutes; Cloud Run 5xx response class; an uptime check against the production root path; Cloud SQL CPU above 80% and disk above 85% (the f1-micro instance is shared by both environments); and log ingestion above 25 GiB per month as a runaway-loop cost guard.'),
  bullet('Environment scoping: every policy filters on the Cloud Run service name and the APP_ENV label so production alerts are distinct from staging noise and only production notifies.'),
  bullet('Notification channels: an email distribution and a Google Chat webhook, both native Cloud Monitoring channel types. No SMS or paging channel is configured — the agreed response posture is next-business-morning, accepted deliberately against the four-day status quo (Section 8).'),
  bullet('Notification content: alert payloads carry the policy name, condition, service, environment, error signature, and a link to the Log Explorer query. No employee identifier is placed in a notification, which keeps personal data out of email and chat systems.'),
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
      ['hr', 'Employee management, leave/DTR approvals, on-behalf leave filing, activity log, holidays calendar, today roster, bulk CSV report export (attendance/leave/OT)', 'Admin-only functions (e.g. office networks CRUD, password resets where admin-gated)', 'assertHR (hr or admin) on every HR function, including the report export; on-behalf actions annotated in review_notes for audit'],
      ['admin', 'Full system access: all HR capabilities plus office networks, KPI builder, performance admin, org chart, employee password resets', '—', 'assertAdmin; sensitive operations additionally use strictAuthMiddleware (checkRevoked)'],
      ['Device identity', 'POST /api/attendance/clock-in and /verify for its bound channel only', 'Any human-facing function, any other channel, any read of employee data beyond a display name', 'X-Device-Key auth (fail-closed, constant-time), per-channel scoping, rate limiting'],
      ['Log reader — wave-hris-log-readers (PLANNED)', 'Production application logs through the restricted Log View: technical telemetry plus pseudonymous actor UUIDs; the 400-day security-audit view', 'Raw production log buckets outside the view; the application UI and its data; any ability to write, alter, or delete log entries', 'Google Group membership bound to roles/logging.viewAccessor on the named Log View. Group membership is the sole grant path and is reviewed quarterly'],
      ['Project viewer (current state)', 'Today, any principal holding roles/viewer on wave-hris-498916 can read all Cloud Logging entries in the project', 'n/a', 'GAP — no restricted view exists yet. Creating the group and the view is a prerequisite action for the observability build, since that build increases what logs contain (Sections 8 and 10, #15)'],
    ],
    [
      {}, {}, {}, {}, {}, {}, { fill: YLW_BG },
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
  bullet('Bulk CSV exports are restricted to HR/admin, capped at a 366-day window, and exclude the system/service account; they carry only fields the role is already authorized to view. Because an export leaves the platform boundary, it is governed by the privacy notice and retention policy, and export-access logging is a recommended follow-up (Section 10, #13).'),
  bullet('Logging is minimized at the point of creation (PLANNED): the log store holds opaque UUIDs rather than names or emails, so a reader of the logs cannot identify an employee without separate, access-controlled access to the database. Free-text reason fields, which routinely contain health information, are never written to logs on any path. The lawful basis for the logging activity itself is legitimate interest in the security, availability, and integrity of a system processing employee data — the 23 July outage is the concrete demonstration of that interest.'),
  spacer(60),
  h2('7.3 Data Retention'),
  bullet('Attendance, leave, and evaluation records are retained in Cloud SQL for operational and audit purposes; DTR records are locked (not purged) once a cutoff submission is approved.'),
  bullet('RECOMMENDED ACTION: define a formal retention policy with Wave (recommended: 12–36 months for attendance detail, then purge or anonymize) and implement a scheduled purge job (pg_cron). No automated purge mechanism currently exists.'),
  bullet('Approval trails (dtr_approval_logs, review notes, soft-cancelled requests) provide audit traceability without hard deletes.'),
  bullet('Log retention is deliberately bounded (PLANNED): production application logs are kept for 90 days, staging for 30. Storage beyond 30 days costs approximately one cent per gigabyte-month, so the limit is set by RA 10173\'s storage-limitation principle rather than by cost — 90 days is long enough to investigate a slow-burning defect across two payroll cutoffs and short enough to be defensible for records containing pseudonymous personal data. A narrow 400-day security-audit view retains only authentication failures, administrative actions, and device authentication events, where a longer forensic window has a stated purpose. Retention is enforced automatically by the Cloud Logging bucket configuration, with no manual purge step.'),
  spacer(60),
  h2('7.4 Third-Party Data Processors'),
  zebraTable(procWidths,
    ['Processor', 'Data Processed', 'Location', 'Privacy Policy'],
    [
      ['Google Cloud Platform (Cloud Run, Cloud SQL, Cloud Build, Secret Manager)', 'All application data and database content; build artifacts; secrets', 'United States (us-central1)', 'https://cloud.google.com/privacy'],
      ['Google — Firebase Authentication', 'Employee emails and credential hashes; ID token issuance', 'United States', 'https://firebase.google.com/support/privacy'],
      ['Nager.Date', 'None — public holiday dates fetched read-only; no personal data transmitted', 'External public API', 'https://date.nager.at'],
      ['Google — Cloud Logging, Error Reporting, Cloud Monitoring (PLANNED)', 'Application log records containing pseudonymous employee identifiers (internal UUID, Firebase UID) and client IP addresses; alert notifications carrying no employee identifiers', 'United States (us-central1)', 'https://cloud.google.com/privacy'],
    ]),
  spacer(60),
  body('No new processor is introduced by the observability change. A third-party error-tracking service was evaluated and deliberately rejected: it would have placed pseudonymous employee identifiers with a new processor, requiring a data processing agreement and an addition to the processor register, for a capability that Error Reporting already provides inside the existing Google Cloud boundary. All observability data stays within project wave-hris-498916 and under the Google Cloud terms already in force.'),
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
      ['HR/Admin bulk CSV export copies PII outside the platform boundary', 'Low', 'Medium', 'Accepted (controlled)', 'Export is assertHR-gated, capped at 366 days, formula-injection-escaped, and excludes the system account. The file lands on an operator device, outside platform controls — mitigated by least-privilege HR/admin assignment, the privacy notice, and the retention policy. Export-access logging (who exported what and when) is a recommended follow-up (Section 10, #13).'],
      ['No production error visibility — a server-function failure can run undetected for days', 'Occurred', 'High', 'Remediation designed', 'REALISED on 23 July 2026: a PostgreSQL 42P08 broke all leave filing for four days with zero log entries, detected only by an employee email. Root cause is structural, not an omission — the transport serializes handler throws to the client, so they never reach any existing catch. Section 11 is the approved remediation; until it ships, leave filing and other critical paths depend on user reports. Owner: Tidal Solutions — Engineering.'],
      ['Alerting is business-hours only — no paging channel', 'Medium', 'Medium', 'Accepted (user decision)', 'ACCEPTED TRADEOFF recorded at the design gate. Notifications go to an email distribution and a Google Chat webhook; no SMS or on-call rotation is configured, so a failure starting Friday evening may not be actioned until Monday. Weighed explicitly against the four-day status quo and judged sufficient for an internal HRIS with no external customer SLA. Revisit if the system becomes payroll-critical. Owner: Wave (CISO) — to reconsider at the next review.'],
      ['Client-side (browser) errors remain uninstrumented', 'Medium', 'Low-Medium', 'Deferred (deliberate)', 'The six browser console calls and React render errors stay invisible to Cloud Logging. Deferred rather than forgotten: a client error sink accepts untrusted input and needs its own rate limiting, payload caps, and redaction, which is a distinct design problem from server-side logging and would have widened the blast radius of this change. Backlogged (Section 10, #19). Owner: Tidal Solutions.'],
      ['Production logs are readable by any principal with roles/viewer until the restricted Log View exists', 'Medium', 'Medium', 'Open — prerequisite', 'The observability change increases what logs contain (pseudonymous employee identifiers), so broad read access becomes materially more sensitive. The wave-hris-log-readers group and the restricted Log View are console actions that must be completed before or alongside the rollout (Section 10, #15). Owner: Tidal Solutions — DevOps.'],
      ['Log volume is estimated, not measured — free-tier headroom unconfirmed', 'Low', 'Low', 'Accepted (monitored)', 'Sizing assumes roughly 300 employees and about 350 MB of log ingestion per month, well inside the 50 GiB monthly free allocation. Headcount is unconfirmed; above roughly 5,000 employees the assumption needs rechecking. Mitigated by the 25 GiB per month ingestion alert, which converts a cost surprise or a runaway log loop into a notification. Owner: Tidal Solutions — DevOps.'],
      ['Observability instrumentation sits at the single choke point every authenticated request passes through', 'Low', 'High', 'Mitigated by design', 'A throw inside the logging wrapper in auth-middleware.ts would fail 100% of authenticated requests. Controls: every logging call is individually try-caught and swallowed; the wrapper rethrows the original error object unmodified; redaction degrades to a placeholder rather than throwing; and the change ships to staging first. Rollback is a Cloud Run revision retarget (roughly 30 seconds, no data implications, since logging is write-only to stdout).'],
      ['Build configuration diverges across branches — cloudbuild-staging.yaml exists only on staging', 'Medium', 'Low-Medium', 'Open', 'cloudbuild.yaml is tracked on both main and staging; cloudbuild-staging.yaml is tracked on staging only. Three consequences: docs/soc-security-spec.md is scoped to the production build on main yet documents the staging deploy as gcloud builds submit --config=cloudbuild-staging.yaml, a file absent from the branch it describes, so the document is internally inconsistent; anyone working from main cannot deploy staging without first switching branches, a non-obvious trap; and the two build configurations can drift silently because they never sit side by side to be diffed. Remediation: merge cloudbuild-staging.yaml into main so both configurations live on one branch, then correct the spec (Section 10, #18). Owner: Tidal Solutions — DevOps.'],
    ],
    [
      { fill: YLW_BG }, { fill: YLW_BG }, {}, {}, {}, { fill: GRN_BG }, { fill: YLW_BG }, {}, {}, { fill: YLW_BG }, {},
      { fill: RED_BG }, { fill: YLW_BG }, {}, { fill: YLW_BG }, {}, {}, { fill: YLW_BG },
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
      ['Developer .env (DB password, local config)', 'Local development', 'Developer machines — git-ignored', 'Plaintext on dev machines only. Rotate the shared DB password if a laptop is lost/compromised. Legacy SUPABASE_* variables remain in some local .env files though the client is removed — scrub on next rotation (Section 10, #14).'],
      ['GitHub Actions deploy identity (WIF)', 'CI/CD pipeline (build + deploy to Cloud Run)', 'Keyless — GitHub OIDC federated to github-deployer@wave-hris-498916 via workloadIdentityPools/github-pool', 'No long-lived key exists; short-lived tokens are minted per run via Workload Identity Federation, scoped to the github-pool provider and a single deployer SA. cloudbuild.yaml retained for manual builds (Cloud Build SA).'],
      ['Google Chat incoming webhook URL (PLANNED)', 'Cloud Monitoring notification channel', 'Secret Manager — referenced by the notification channel, never committed to the repository', 'A BEARER CREDENTIAL: anyone holding the URL can post arbitrary messages into the alerting space, which enables convincing spoofed alerts and alert-fatigue abuse. It grants no read access to logs or application data. Rotate by deleting and recreating the webhook in the Chat space if the URL is exposed. Not consumed by application code — only by the Monitoring channel configuration.'],
      ['Cloud Logging write permission (PLANNED)', 'Cloud Run runtime service account', 'GCP IAM — roles/logging.logWriter on 831274499203-compute@developer.gserviceaccount.com', 'No key material. Write-only by design: the runtime identity can append log entries but is not granted read access to log buckets, so a compromised application instance cannot mine historical logs for employee identifiers.'],
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
      ['12', 'Migrate CI/CD to keyless deploy — GitHub Actions + Workload Identity Federation (GitHub OIDC → github-deployer SA); no long-lived service-account keys for deployment', 'COMPLETED', '✅ Done', 'Tidal Solutions — DevOps'],
      ['13', 'Add export-access logging for bulk CSV report exports (who exported which record types and range, and when) for RA 10173 accountability', 'MEDIUM', 'Open', 'Tidal Solutions'],
      ['14', 'Scrub legacy SUPABASE_* variables from developer .env files and templates (client and dependency already removed) — dead configuration / secret hygiene', 'LOW', 'Open', 'Tidal Solutions — DevOps'],
      ['15', 'PREREQUISITE (console action, cannot be done in code): create the Google Group wave-hris-log-readers, create the restricted production Log View and the 400-day security-audit view, and bind roles/logging.viewAccessor to the group. Then remove reliance on broad roles/viewer for log access. Must be complete before or alongside the observability rollout, because that rollout increases what logs contain', 'HIGH', 'Open', 'Tidal Solutions — DevOps + Wave (CISO)'],
      ['16', 'PREREQUISITE (console action): set APP_ENV=production on the wave-hris service and APP_ENV=staging on wave-hris-staging via gcloud run services update, then add the variable to the deploy workflow so it survives future deployments. Environment separation of logs and alert policies depends on it', 'HIGH', 'Open', 'Tidal Solutions — DevOps'],
      ['17', 'PREREQUISITE (console action): create the email distribution and the Google Chat incoming webhook, store the webhook URL in Secret Manager, and register both as Cloud Monitoring notification channels. No SMS channel is to be configured (Section 8, accepted tradeoff)', 'HIGH', 'Open', 'Tidal Solutions — DevOps'],
      ['18', 'Merge cloudbuild-staging.yaml into main so both build configurations live side by side on one branch, then correct docs/soc-security-spec.md, which is scoped to main but documents a staging deploy using a file absent from main', 'MEDIUM', 'Open', 'Tidal Solutions — DevOps'],
      ['19', 'Client-side error capture: an /api/client-error sink with its own rate limiting, payload caps, and redaction for browser and React render errors. Deliberately out of scope for the current change (Section 8)', 'LOW', 'Backlog', 'Tidal Solutions'],
      ['20', 'After the observability build ships, verify the detection control end to end: deliberately trigger a distinct error signature on staging and confirm it reaches Error Reporting, the per-function alert, and both notification channels. An untested alert is a hypothesis, not a control', 'HIGH', 'Open', 'Tidal Solutions — Engineering'],
      ['21', 'Confirm the employee-headcount and log-volume assumption (about 300 employees, roughly 350 MB per month) once the first full month of ingestion data exists, and re-check free-tier headroom', 'LOW', 'Open', 'Tidal Solutions — DevOps'],
      ['22', 'Fold the observability work into the employee privacy notice: state that application logs retain pseudonymous identifiers and client IP addresses for 90 days for security and availability purposes', 'MEDIUM', 'Open', 'Wave HR + Tidal Solutions'],
    ],
    [
      { fill: YLW_BG }, { fill: YLW_BG }, { fill: YLW_BG }, {}, {}, {}, {}, {}, { fill: GRN_BG }, { fill: GRN_BG }, { fill: GRN_BG }, { fill: GRN_BG }, {}, {},
      { fill: YLW_BG }, { fill: YLW_BG }, { fill: YLW_BG }, {}, {}, { fill: YLW_BG }, {}, {},
    ]),
];

// ── Section 11 — Observability Implementation Plan ────────────────────────────
const schemaWidths = [1900, 1300, 2400, 3400];
const planWidths = [420, 2080, 3600, 2900];
const policyWidths = [2000, 3500, 1200, 2300];
const s11 = [
  h1('11. Observability Implementation Plan (PLANNED)'),
  body('This section is design intent approved at the architecture gate on 28 July 2026 and not yet implemented. It is the specification the build follows and the reference the QA and security gates trace against. Once the work has cleared both gates it will be restated as as-built fact and this heading will lose its PLANNED marker.'),
  h2('11.1 Design Decisions and Rejected Alternatives'),
  bullet('Structured JSON to stdout, no logging library. Cloud Run captures stdout natively and Cloud Logging parses a single-line JSON object into real fields, so a logging dependency would add bundle weight and a transitive supply-chain surface for no capability gain. The emitter is roughly 180 lines of first-party code with no runtime dependencies.'),
  bullet('Instrumentation in the function-middleware chain, not the request pipeline. This is forced by the failure mode rather than chosen for convenience: the TanStack Start transport catches a handler throw and serializes it into the RPC response, so the error is invisible to the request middleware in start.ts, to the Nitro fetch handler in server.ts, and to Cloud Run access logs. The function middleware is the only layer inside the boundary where the throw can be observed.'),
  bullet('Allowlist redaction, not denylist. A denylist fails silently the first time an upstream field is added; an allowlist fails safe. This is the difference between a claim and a control, and it is what makes the negative assertions in Section 4.2 testable.'),
  bullet('REJECTED — OpenTelemetry with Cloud Trace spans. Evaluated and declined for this change. It would not have detected the 23 July incident any faster, because that was a silent throw and not a latency problem. It also carries real delivery risk here: the auto-instrumentation packages patch CommonJS require, while Nitro bundles this application into a single ESM artifact, so instrumenting pg would require externalising it from the build plus an experimental Node ESM loader hook. The log schema deliberately uses OpenTelemetry-compatible trace and span fields, so adding spans later is additive rather than a rewrite.'),
  bullet('REJECTED — an OpenTelemetry collector sidecar. Solves the bundling problem but adds an always-on second container and a per-instance resource cost, which the deployment constraints exclude.'),
  bullet('REJECTED — a third-party error tracker. Better error grouping than Error Reporting, but it would introduce a new data processor handling pseudonymous employee identifiers, requiring a data processing agreement and a processor-register entry under RA 10173 (Section 7.4).'),
  spacer(),
  h2('11.2 Log Record Schema'),
  body('Every server-side record is one JSON object per line using Cloud Logging special fields, so the platform indexes them as structured data rather than text.'),
  zebraTable(schemaWidths,
    ['Field', 'Type', 'Example', 'Notes'],
    [
      ['severity', 'string', 'ERROR', 'Cloud Logging special field: DEBUG, INFO, WARNING, ERROR, CRITICAL'],
      ['message', 'string', 'server_fn failed', 'Short, stable, low-cardinality text — never an interpolated value'],
      ['logging.googleapis.com/trace', 'string', 'projects/wave-hris-498916/traces/<id>', 'Parsed from the X-Cloud-Trace-Context header; groups one user action into one thread'],
      ['logging.googleapis.com/spanId', 'string', '0000000000000042', 'Second half of the same header; OpenTelemetry-compatible for a later upgrade'],
      ['logging.googleapis.com/labels', 'object', '{ env, service, serverFn }', 'Low-cardinality dimensions; the source of the log-based metric labels'],
      ['httpRequest', 'object', '{ requestMethod, requestUrl, status, latency }', 'Cloud Logging special field; renders as a first-class request record'],
      ['serverFn', 'string', 'fileLeaveRequest', 'The function name — the key dimension for per-function failure alerting'],
      ['actor.dbUserId / actor.firebaseUid', 'string (UUID)', 'a3f1… / kQ7x…', 'Pseudonymous only. The middleware also holds the email; it is deliberately not emitted'],
      ['latencyMs', 'number', '184', 'Wall-clock duration of the server-function invocation'],
      ['outcome', 'string', 'error', 'ok, error, or denied — makes the metric filter trivial and stable'],
      ['err.name / err.code / err.constraint', 'string', 'error / 42P08 / leave_requests_no_overlap', 'Allowlisted error fields. err.code is the SQLSTATE that was missing on 23 July'],
      ['err.stack', 'string', 'Error: …\\n    at …', 'Allowlisted. Also drives Error Reporting signature grouping'],
      ['@type', 'string', 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent', 'Present on ERROR and above; this is what makes Error Reporting group and notify on a new signature'],
    ]),
  spacer(),
  h2('11.3 Build Order — File by File'),
  body('The order is deliberate: the redaction gate and its tests are built first so that nothing can be written before the control that governs what may be written exists.'),
  zebraTable(planWidths,
    ['#', 'File', 'Change', 'Notes'],
    [
      ['1', 'src/lib/log-redact.ts (new)', 'Allowlist serializers for error objects and context objects; hard-drop list for PostgreSQL detail, hint, where, internalQuery, parameters; final regex sweep for email addresses and long digit runs', 'Pure and isomorphic so it is unit-testable without a server. Built first — it is the compliance control'],
      ['2', 'src/lib/log-redact.test.ts (new)', 'Vitest suite asserting every negative claim in Section 4.2 against representative pg errors and context objects', 'The evidence artifact for the security gate and privacy review. Must fail before the implementation exists'],
      ['3', 'src/lib/log.server.ts (new)', 'Cloud Logging JSON emitter to stdout; AsyncLocalStorage request store; helpers logInfo, logWarn, logError; the ReportedErrorEvent @type on ERROR and above', 'No runtime dependencies. Every call individually try-caught and swallowed'],
      ['4', 'src/lib/observability-middleware.ts (new)', 'createMiddleware({ type: "function" }) wrapper: start timer, await next(), on throw log with stack and SQLSTATE then rethrow the original error unchanged, on success emit an INFO record with latency and outcome', 'Must never alter control flow. The rethrow is the original object, not a copy or a wrapper'],
      ['5', 'src/lib/auth-middleware.ts (modify)', 'Compose the observability middleware into the .server() bodies of authMiddleware and strictAuthMiddleware', 'THE KEY CHANGE — instruments all 106 server functions with no edit to the 17 feature modules. context.user is already in scope, so actor attribution is free'],
      ['6', 'src/server.ts (modify)', 'Open the AsyncLocalStorage store around fetch; parse X-Cloud-Trace-Context; replace the console.error calls at the swallowed-SSR-error path and the outer catch; emit an httpRequest access record', 'Establishes the trace context that every downstream record inherits'],
      ['7', 'src/lib/error-capture.ts (modify)', 'Add process.on(\'uncaughtException\') and process.on(\'unhandledRejection\') handlers that log through the emitter; exit non-zero on an uncaught exception', 'DEFECT FIX — the existing globalThis.addEventListener guard never registers under Node, so these faults are currently discarded silently'],
      ['8', 'src/lib/db.server.ts (modify)', 'Attach pool.on(\'error\') and log idle-client failures', 'DEFECT FIX — an EventEmitter error event with no listener terminates the Node process. This is a latent hard-crash, not only an observability gap'],
      ['9', 'src/lib/device-clock-in.server.ts (modify)', 'Convert 12 console calls to structured records with named fields; remove the raw employeeCode from the not-found and ambiguous-match lines', 'The existing discipline of logging the employee UUID rather than full_name is correct and is preserved. employeeCode is a direct identifier and is dropped'],
      ['10', 'Remaining server-side call sites (modify)', 'Convert the 7 remaining server-side console calls: employee-functions.ts (2), calendar-functions.ts (1), whats-new-functions.ts (1), csp-report.server.ts (1), src/server.ts (2, covered in step 6)', 'Of 25 console calls in src/, 19 are server-side and migrate. The 6 client-side calls in __root.tsx, use-auth.tsx, geolocation.ts, and start.ts run in the browser, never reach Cloud Logging, and stay as they are (Section 8)'],
      ['11', 'eslint.config.js (modify)', 'no-console rule scoped to src/server.ts and src/lib/**/*.server.ts', 'Prevents an unstructured, unredacted call from being reintroduced'],
    ]),
  spacer(),
  h2('11.4 Google Cloud Configuration'),
  body('These are console or gcloud actions in project wave-hris-498916. Items marked PREREQUISITE must be complete before the application change is deployed to production, and are tracked as numbered items in Section 10.'),
  bullet('PREREQUISITE — set APP_ENV=production on the wave-hris service and APP_ENV=staging on wave-hris-staging (gcloud run services update), then add the variable to .github/workflows/deploy.yml. The workflow currently sets no environment variables, so existing service configuration persists across deploys, but relying on that is fragile.'),
  bullet('PREREQUISITE — create the Google Group wave-hris-log-readers, the restricted production Log View, and the 400-day security-audit view; bind roles/logging.viewAccessor to the group and stop relying on project-wide roles/viewer for log access.'),
  bullet('PREREQUISITE — create the email distribution and the Google Chat incoming webhook; store the webhook URL in Secret Manager and register both as Cloud Monitoring notification channels.'),
  bullet('Grant roles/logging.logWriter to the Cloud Run runtime service account. Write-only: the runtime identity must not receive log read access.'),
  bullet('Create the production log bucket with 90-day retention and route wave-hris logs to it; leave staging on _Default at 30 days.'),
  bullet('Create two log-based counter metrics, server_fn_calls and server_fn_errors, labelled by serverFn and env.'),
  bullet('Create the alert policies in Section 11.5 and the uptime check against the production root path.'),
  spacer(),
  h2('11.5 Alert Policies'),
  zebraTable(policyWidths,
    ['Policy', 'Condition', 'Priority', 'Channel'],
    [
      ['New error signature', 'Error Reporting notifies on the first occurrence of a previously unseen error signature in production', 'P1', 'Email + Google Chat'],
      ['Single-function failure', 'Any one serverFn label records 5 or more errors within 10 minutes (env=production)', 'P1', 'Email + Google Chat'],
      ['Elevated error ratio', 'server_fn_errors / server_fn_calls exceeds 5% over 10 minutes (env=production)', 'P2', 'Email + Google Chat'],
      ['Cloud Run 5xx', 'run.googleapis.com/request_count with response_code_class=5xx above threshold over 10 minutes', 'P2', 'Email + Google Chat'],
      ['Uptime failure', 'Uptime check against the production root path fails twice consecutively', 'P1', 'Email + Google Chat'],
      ['Cloud SQL saturation', 'CPU utilisation above 80% for 15 minutes, or disk utilisation above 85%', 'P2', 'Email'],
      ['Log ingestion volume', 'Project log ingestion exceeds 25 GiB in a calendar month', 'P3', 'Email'],
    ]),
  spacer(60),
  body('No SMS or paging channel is configured. The agreed response posture is next business morning (Section 8, accepted tradeoff).', { italics: true }),
  spacer(),
  h2('11.6 Cost'),
  body('At the assumed volume of roughly 350 MB of log ingestion per month, the entire design sits inside the Google Cloud free allocations. Cloud Logging ingestion is free to 50 GiB per project per month. Alert policies, notification channels, uptime checks, and Error Reporting carry no charge. Log-based counter metrics generate negligible volume. The only line item is retention beyond 30 days, billed at approximately one cent per gigabyte-month, which at this volume is a few cents per month across the 90-day production bucket and the 400-day security-audit view. Total expected cost is under one US dollar per month, against an approved ceiling of five. Because cost is not the binding constraint, retention was set by the RA 10173 storage-limitation principle rather than by price (Section 7.3).'),
  spacer(),
  h2('11.7 Blast Radius, Rollout, and Rollback'),
  bullet('Blast radius: the change touches src/lib/auth-middleware.ts, the single choke point through which every authenticated request passes. A throw inside the logging wrapper would fail 100% of authenticated requests. This is the principal risk of the change and the reason for the fail-open constraints in Section 5.4.'),
  bullet('Rollout: staging first (wave-hris-staging), verified against real traffic including a deliberately induced error, before production. Production deploys through the existing GitHub Actions pipeline on merge to main.'),
  bullet('Rollback: retarget Cloud Run traffic to the previous revision — gcloud run services update-traffic wave-hris --to-revisions=<previous>=100. Roughly 30 seconds, with no data implications, because logging is write-only to stdout and no schema or persisted state changes.'),
  bullet('No database migration is involved. No change to authentication, authorization, or any existing data flow other than the addition of the log pipeline.'),
  spacer(),
  h2('11.8 Verification'),
  body('The following must be demonstrated before the change is considered complete. Items 1 through 4 are the security gate evidence; item 5 is the acceptance test for the capability itself.'),
  bullet('1. The redaction test suite passes and covers every negative claim in Section 4.2, including a PostgreSQL constraint violation whose detail field contains literal row values.'),
  bullet('2. A staging error produces a Cloud Logging entry with severity ERROR, a populated stack, the SQLSTATE in err.code, and a trace ID shared with the other records from the same request.'),
  bullet('3. No log entry produced during a full staging exercise contains an email address, an employee name, a free-text reason, or a token.'),
  bullet('4. Log entries carry the correct env label and production alert policies do not fire on staging activity.'),
  bullet('5. END TO END: deliberately trigger a distinct error signature on staging and confirm it reaches Error Reporting, raises the per-function alert, and arrives on both notification channels. An untested alert is a hypothesis, not a control (Section 10, #20).'),
  bullet('6. Regression: the full test suite, lint, typecheck, and production build are clean, and an induced fault inside the logging wrapper is shown to degrade a log line without failing the request.'),
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
      ...s1, ...s2, ...s3, ...s4, ...s5, ...s6, ...s7, ...s8, ...s9, ...s10, ...s11,
      ...footer,
    ],
  }],
});

const OUT = path.join(__dirname, `../documents/WaveHRIS-Deployment-Security-Doc-${DOC_VERSION}.docx`);
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(OUT, buffer);
  console.log(`OK  ${OUT}  (${Math.round(buffer.length / 1024)} KB)`);
});
