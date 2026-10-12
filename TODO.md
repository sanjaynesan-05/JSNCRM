# JSN DESIGNS BUSINESS STUDIO — Ordered TODO & Milestone Tracker

**Last updated:** 12 October 2026
**Workspace:** `D:\jsn mail`
**Rule:** Preserve existing work. Do not commit or push without explicit authorization.

## Current status

- Milestones 1, 2A, 2B and 3 are recorded as implemented in the project history; earlier checks and documented limitations remain in the README.
- **Milestone 3A is blocked/incomplete.** UI acceptance has not been run in this turn. The browser automation helper stopped because it could not determine the active Edge URL with sufficient confidence. API integration tests could not open loopback TCP (`EACCES`).
- **Brand identity PDF audit is deferred at the owner's direction.** It was not performed; the separately requested premium-minimalist UI redesign is recorded below without treating the PDF audit as complete.
- The owner has explicitly directed development to proceed to **Milestone 4 — Invoice Generation & Payment Tracking** while the Milestone 3A blockers are recorded. Milestone 4 implementation is in progress, not accepted or complete.

## Brand refresh — premium minimalist UI

**Status: Implementation complete; visual/browser acceptance pending.**

- [x] Add shared black, white, gold, neutral and light-gray design tokens and reusable component styling across the business app and Email Studio.
- [x] Use Proxima Nova as the first-choice UI font with Arial/Helvetica fallbacks; do not bundle fonts or depend on a third-party font download.
- [x] Restyle navigation, dashboard, records, forms, tables, buttons, responsive layouts, and focus/hover states while retaining existing page components, API routes, data and Gmail SMTP behavior.
- [x] Apply the restrained palette to Email Studio defaults, templates and generated email presentation; preserve email composition and sending workflows.
- [x] Play the provided `src/assets/logo reveal.mp4` once per browser session at 2× speed (~5 seconds), as an uncropped `100vw` × `100dvh` full-screen video, with scroll lock, bottom-right Skip intro, reduced-motion bypass, playback-error fallback and a short fade into the app.
- [ ] Browser-check fullscreen sizing at mobile/tablet/desktop, completion, Skip, reduced-motion bypass, video failure and keyboard focus; confirm Proxima Nova is available in the target Windows environment or assess licensed acquisition.
- [ ] Browser acceptance is still blocked: Computer Use could not determine the active Edge URL confidently, and no Playwright/Puppeteer package is installed in this workspace. Next action: open the local app in Edge at a verifiable URL or provide an approved browser automation environment, then run the responsive/playback checks above.
- [ ] Review the refreshed app and intro with the owner for visual acceptance.
- [ ] Perform the brand identity PDF audit only if separately authorized.

## Milestone 1 — Local-first Business Studio Foundation

- [x] React/TypeScript/Vite frontend and Express/SQLite backend.
- [x] Navigation, local persistence, versioned migrations, database backup/restore.
- [x] Preserve JSN Email Studio and Gmail SMTP/Nodemailer workflow.

## Milestone 2A — Quotations, Business Profile & PDF Export

- [x] Quotation editing, server-calculated INR paise totals, status history, search/filter, duplication and accepted-quotation conversion.
- [x] Business profile and quotation defaults.
- [x] Persisted-data quotation PDF and manual handoff to Email Studio.
- [ ] Investigate reliable Tamil/Devanagari complex-script shaping; current PDF renderer replaces unsupported glyphs with `?`.

## Milestone 2B — Release Hardening

- [x] Migration and backup/restore regression tests.
- [x] Responsive layout and accessible form labels in earlier milestone work.
- [x] Preserve documented Latin-only PDF limitation.
- [ ] Reassess dependency advisories before release (see follow-ups).

## Milestone 3 — Client Management & Business Operations

- [x] Searchable active/archived client directory, details, editing, archive and restore.
- [x] Related quotation/order history and client-prefilled quotation flow.
- [x] Preserve archived client history and order-derived balances.
- [ ] Complete the UI acceptance follow-up in Milestone 3A.

## Milestone 3A — UI Acceptance, Accessibility & Stabilization

**Status: BLOCKED / INCOMPLETE. Do not mark complete based on source review or automated tests alone.**

### Browser acceptance — pending

- [ ] Reopen a stable browser session and verify the intended app URL; the Computer Use helper stopped because it could not determine the current Edge URL with enough confidence.
- [ ] Start the app against isolated test data with loopback access and complete actual browser checks.
- [ ] Client search by name, company, email and client reference.
- [ ] Client detail, edit/save/reload, validation, archive/restore, and archived-client restrictions.
- [ ] Client-prefilled quotation creation and persisted client association.
- [ ] Related quotation/order links open the correct records.
- [ ] Quotation detail tables at mobile width; check mobile/tablet/desktop overflow and focus visibility.
- [ ] Keyboard-only navigation for menus, forms, dropdowns and confirmation dialogs.
- [ ] Loading, empty and error states.
- [ ] Email Studio visual/workflow check. Never send a real email as part of acceptance.
- [ ] Brand identity audit against the supplied guideline PDF — explicitly deferred by the owner; do not start until requested.

### Verification recorded 12 October 2026

- `npm test`: **passed, 0 failures**; 4 tests passed and 2 API integration tests skipped because the environment blocks loopback TCP (`EACCES`). Invoice PDF, fresh/legacy migration and invoice backup/restore checks ran.
- `npm run build`: passed after running outside the filesystem sandbox; sandboxed Vite failed with `EPERM` resolving `index.html` asynchronously.
- `git diff --check`: passed; Git printed line-ending conversion warnings for touched files.
- `npm audit`: 7 development-tree findings (5 high, 2 moderate); fixes offered by npm require a breaking Tailwind 4 upgrade. No force upgrade was run.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Browser UI acceptance: **not performed**; helper stopped with a browser URL confidence error. API integration behavior also remains unverified in this environment due loopback denial.
- No commit or push was made.

## Milestone 4 — Invoice Generation & Payment Tracking

**Status: Implementation in progress; end-to-end acceptance is blocked by the Milestone 3A/browser and loopback constraints above.**

### Implemented in this working tree — pending API/browser acceptance

- [x] Additive migration `003_invoices.sql` with invoice, line-item, payment-link, status-history and number-sequence tables/indexes.
- [x] Invoice list, search, status/date filtering, direct draft editor and source selection for clients, accepted quotations and orders.
- [x] Transactional server invoice numbering (`INV-YYYY-NNNN`), Zod validation, server totals in INR paise and duplicate source protection.
- [x] Draft edit, issue snapshot, immutable issued values, void without payment, and linked reissue draft.
- [x] Computed paid/partial/overdue states, payment amount validation, idempotency and payment references.
- [x] Order-linked receipts use the existing order payment row with a single invoice allocation link; direct invoice receipts stay invoice-only. Dashboard adds invoice counts without combining invoice and order money.
- [x] Persisted invoice PDF with snapshots, line items, totals, payment/balance, terms and pagination. Email handoff is manual; no SMTP auto-send.
- [x] README and root TODO documentation updated; temporary prior-turn artifacts removed only after inspection.
- [x] Focused database migration/backup and PDF tests passed.

### Acceptance and business decisions — pending

- [ ] Run integration tests in a local runtime that permits loopback TCP; verify invoice create/edit/issue/void/reissue, source uniqueness, concurrent numbering, snapshots, payments, duplicate protection and existing order-payment regression.
- [ ] Verify accepted-quotation and order invoice preselection, including converted quotation/order source identity.
- [ ] Exercise invoice UI at desktop/mobile widths, keyboard focus, form validation, payment history and manual PDF/Email Studio handoff. Do not send email.
- [ ] Verify backup/restore through application API with invoice/payment records (direct SQLite backup/restore test passed).
- [ ] Decide whether a single non-void invoice per source and the order-total match rule fit the business workflow; current implementation enforces this baseline.
- [ ] Configure payment instructions separately if required; currently invoice terms are the only configured payment guidance.
- [ ] Financial dashboard values stay pending until the accounting model has passed API acceptance; current dashboard exposes invoice counts only.
- [ ] GST/tax: no tax is calculated. Establish business registration, place of supply, rates and invoice rules before implementing or claiming GST support.
- [ ] Review PDF font/shaping options; retain Tamil/Devanagari limitation until reliably implemented and visually verified.
- [ ] Re-run required tests, build, audits and diff check after any acceptance fixes.

## Cross-milestone follow-ups

### PDF complex-script shaping

- [x] Investigate the current stack: PDFKit embeds TTF/TTC fonts, and installed `fontkit@2.0.4` contains Indic shaping paths for Devanagari and Tamil. The invoice/quotation services still sanitize non-Latin input and use standard fonts, so support is not enabled.
- [ ] Prototype with correctly licensed Noto Sans Tamil and Noto Sans Devanagari fonts; verify mixed Latin/script layout, shaped conjuncts/marks, line wrapping, text extraction and visual output before shipping.
- [ ] Test mixed English/Tamil/Devanagari, combining marks, conjuncts, wrapping and page breaks with a shaping-capable renderer.
- [ ] Confirm font license, notices, packaging and Windows support. Until then, preserve the Latin-only support statement.

### Dependency advisories

- [ ] Re-run `npm audit` and `npm audit --omit=dev` before release.
- [ ] Review current `braces` (high) and `postcss-selector-parser` (moderate) dependency paths and compatible fixes.
- [ ] Plan/test Tailwind 4 migration separately; do not use `npm audit fix --force` without migration work.

### Delivery hygiene

- [ ] Preserve the untracked owner roadmap draft until the owner decides it can be archived; its useful entries are merged into this tracked tracker.
- [ ] Inspect final status and diff before future commits. No commit/push is authorized by this task.
