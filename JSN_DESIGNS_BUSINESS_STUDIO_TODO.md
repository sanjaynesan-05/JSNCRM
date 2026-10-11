# JSN DESIGNS BUSINESS STUDIO — Ordered TODO & Milestone Tracker

**Last updated:** 11 October 2026  
**Workspace:** `D:\jsn mail`  
**Purpose:** Maintain the milestone order, track verified completion, and keep pending work visible.  
**Source of brand standards:** `JSN_DESIGNS_Brand_Guidelines.pdf` (Premium Minimalist Edition, v1.0, October 2026).

> Status is based on the latest project status reported by the owner. This document is a tracker draft; it has not been written into the local repository automatically.

## Current status at a glance

- **Milestones 1, 2A, 2B and 3:** Reported implemented, with documented limitations.
- **Current priority: Milestone 3A — UI Acceptance Testing, Brand Identity Audit & Release Stabilization.**
- **Next planned feature milestone: Milestone 4 — Business Operations Dashboard & Financial Reporting.**
- **No commit created for the latest Milestone 3 implementation.** The owner reports the branch is `main` and one commit ahead of `origin/main`; confirm actual Git status before making changes.

---

## Ordered milestone tracker

### [x] Milestone 1 — Local-first Business Studio Foundation
**Status:** Reported complete.

- React + TypeScript + Vite frontend and Express + SQLite backend foundation.
- Navigation and business application shell.
- Versioned database migrations, validated APIs, local persistence and backup/restore foundation.
- Preserve the original JSN Email Studio and Gmail SMTP/Nodemailer workflow.

### [x] Milestone 2A — Quotations, Business Profile & PDF Export
**Status:** Reported implemented.

- Quotation create/edit, line items, discounts, server-calculated INR paise totals.
- Search/filter, status lifecycle/history, duplication and accepted-quotation-to-order conversion.
- Business profile and quotation defaults.
- Server-generated quotation PDF with persisted data, totals, terms and page numbering.
- Manual PDF download and attachment in Email Studio; no automatic send.

### [x] Milestone 2B — Release Hardening
**Status:** Reported complete with documented limitations.

- Migration and backup/restore regression checks.
- Responsive CSS adjustments and visible form labels.
- Build, tests and `git diff --check` reported passing.
- Known limitation: PDF rendering supports Latin characters only; complex-script shaping is not implemented.
- Known issue: development dependency audit reported 7 findings (5 high, 2 moderate); production-only audit reported 0 findings at last check.

### [x] Milestone 3 — Client Management & Business Operations
**Status:** Reported implemented; automated checks passed; manual UI session not performed.

- Searchable active/archived client directory.
- Client details, validated editing, confirmed archive and restore.
- Related quotation/order links; client-prefilled quotation creation.
- Client balances derived from payment records and tasks attributed only through linked orders.
- Archiving preserves history and blocks new quotations/direct orders until restoration.
- No migration reported as necessary.
- Latest reported checks: `npm test` (7 passed), `npm run build` passed, `git diff --check` passed.

### [ ] Milestone 3A — UI Acceptance Testing, Brand Identity Audit & Release Stabilization
**Status:** Pending — CURRENT PRIORITY. Complete this before starting Milestone 4.

#### A. UI acceptance testing
- [ ] Run the application in an isolated/test-data environment and perform a real browser session.
- [ ] Test client search by name, company, email and client reference.
- [ ] Test client detail navigation, edit/save/reload, validation errors, archive and restore.
- [ ] Verify archived clients cannot be used to create quotations or direct orders.
- [ ] Verify client-prefilled quotation creation selects and persists the correct client.
- [ ] Verify related quotation/order links open the correct records.
- [ ] Recheck quotation detail-table layout at mobile width; this was previously flagged for a fresh visual check.
- [ ] Test at mobile (390px), tablet (768px) and desktop (1366px), or record the actual viewports used.
- [ ] Check page overflow, visible focus, keyboard navigation, labels, dialogs, empty/loading/error states.
- [ ] Perform a broader keyboard-only check for menus, dropdowns, forms and confirmation dialogs.
- [ ] Verify Email Studio visually and confirm its workflow remains intact. Do not send a real email.

#### B. Brand identity audit — use the supplied PDF as the source of truth
Review the Business Studio interface and its customer-facing outputs against `JSN_DESIGNS_Brand_Guidelines.pdf`.

**Brand standards to verify**
- [ ] **Positioning and feel:** premium minimalism; confident, precise, contemporary; clarity before decoration.
- [ ] **Logo artwork:** use the supplied master artwork; do not recreate or retype the JSN monogram; preserve proportions and spacing.
- [ ] **Approved variants:** stacked primary lockup, horizontal lockup for headers/narrow spaces, monogram for small/avatar uses, wordmark alone only when the brand is already clear.
- [ ] **Clear space:** keep at least the height of the “D” in DESIGNS around the complete logo.
- [ ] **Minimum logo sizes:** digital stacked logo at least 120px wide; monogram at least 24px. Print stacked logo at least 30mm; monogram at least 8mm. Test final-size use.
- [ ] **Background treatment:** black logo on white/light neutral; white logo on black/dark. Gold logo is an accent variant, not the default.
- [ ] **Palette:** Primary Black `#000000`; Primary White `#FFFFFF`; Accent Gold `#D4AF37`; Neutral Dark `#1A1A1A`; Neutral Gray `#6B6B6B`; Light Gray `#F5F5F5`.
- [ ] **Gold use:** restrained accents, fine rules, selected highlights and small icons; never rely on gold alone for essential information or use it for long body text.
- [ ] **Typography:** Proxima Nova where licensed/available; practical fallback Arial or Helvetica. Headings Bold/ExtraBold, subheadings Semibold, body Regular. Do not distribute unlicensed font files.
- [ ] **Spacing and layout:** consistent 8px digital spacing rhythm; deliberate whitespace; aligned edges and margins; one primary message at a time; left alignment for information-heavy layouts.
- [ ] **Graphic details:** restrained diagonal motifs, thin black/gold rules, simple geometry, flat color, consistent outline icon style; avoid heavy decorative borders, glow, bevel and excessive gradients.
- [ ] **Accessibility:** strong black-on-white or white-on-black contrast; gold is not the only indicator of status/action.
- [ ] **Quotations and PDFs:** consistent logo placement, readable pricing, aligned tables, restrained accents and generous margins.
- [ ] **Email Studio/signature:** compact logo/wordmark, readable text, limited links and restrained imagery.
- [ ] **Consistency across screens:** sidebar, dashboard, clients, quotations, orders/projects, settings, dialogs, buttons, inputs, tables, status indicators and empty states.
- [ ] **Brand audit outcome:** record each check as Pass / Needs adjustment / Not applicable, with screenshots or exact file references for issues.
- [ ] Fix only confirmed inconsistencies; preserve existing workflows and avoid a needless redesign.
- [ ] Verify that any bundled logo is the approved supplied artwork and not a recreated approximation.

#### C. Release stabilization
- [ ] Rerun `npm test`.
- [ ] Rerun `npm run build`.
- [ ] Rerun `git diff --check`.
- [ ] Inspect actual `git status`, branch and diff; preserve all existing modifications.
- [ ] Confirm backup/restore tests use temporary data, not the user's normal database.
- [ ] Update README only with checks actually performed.
- [ ] Publish a factual acceptance report listing passed, failed, blocked and not-tested items.
- [ ] Do not create a commit unless explicitly authorized.

**Exit gate:** Do not begin Milestone 4 until the acceptance session and brand audit are completed or any blocked items are explicitly accepted and recorded.

### [ ] Milestone 4 — Business Operations Dashboard & Financial Reporting
**Status:** Planned; do not start until Milestone 3A is accepted.

- [ ] Review current dashboard metrics and their underlying SQL before proposing additions.
- [ ] Add useful recent quotation/order activity based on real records.
- [ ] Review upcoming and overdue tasks.
- [ ] Consider active/archived client counts where useful.
- [ ] Add navigation from dashboard metrics to the relevant record lists.
- [ ] Define financial metrics precisely: quoted value, accepted quotation value, agreed order value, collected payments and outstanding balances must remain distinct.
- [ ] Keep all totals server-derived from persisted data; never fabricate revenue.
- [ ] Add tests for metric calculations, empty states, date boundaries and payment/balance accuracy.
- [ ] Check responsive layout and brand consistency.
- [ ] Update README, run tests/build/diff checks and report actual results.

---

## Cross-milestone follow-ups (not blockers for every feature)

These remain visible and should be prioritized deliberately rather than mixed into unrelated work.

### [ ] PDF complex-script shaping
- [ ] Investigate a reliable shaping-capable rendering pipeline for Tamil and Devanagari.
- [ ] Test mixed English/Tamil/Devanagari, combining marks, conjuncts, line wrapping and page breaks.
- [ ] Confirm licensing, packaging, Windows compatibility and PDF text/visual output.
- [ ] Until verified, retain the documented Latin-only limitation; do not claim support based on font embedding alone.

### [ ] Development dependency advisories
- [ ] Re-run `npm audit` and `npm audit --omit=dev` before release.
- [ ] Review current advisories, dependency paths and compatible fixes.
- [ ] Plan a tested Tailwind major-version migration separately if still required.
- [ ] Do not use force upgrades or blindly introduce breaking build/CSS changes.
- [ ] Keep the production/development finding distinction in the README accurate.

### [ ] Git delivery hygiene
- [ ] Inspect the real working tree and diff before every milestone.
- [ ] Keep unrelated changes intact.
- [ ] When ready and authorized, create a descriptive commit and verify branch/upstream status.
- [ ] Do not claim a commit exists until Git confirms it.

### [ ] Future scope — intentionally not included yet
- [ ] Direct PDF attachment handoff from quotation details to Email Studio.
- [ ] Configurable logo asset management.
- [ ] Tax calculation.
- [ ] Authentication and multi-user deployment.

These are not part of Milestone 3A or Milestone 4 unless explicitly reprioritized.

---

## Immediate next actions — in order

1. [ ] Open the current workspace and inspect Git status/diff.
2. [ ] Start the application with isolated/test data.
3. [ ] Complete Milestone 3A UI acceptance tests.
4. [ ] Complete the JSN DESIGNS brand identity audit against the supplied PDF.
5. [ ] Fix verified UI/brand defects without breaking existing behavior.
6. [ ] Run tests, build and diff checks again.
7. [ ] Update this tracker with actual results and unresolved blockers.
8. [ ] Only then begin Milestone 4.

## Brand guideline reference

The uploaded guideline is titled **JSN DESIGNS — Brand Identity Guidelines**, Premium Minimalist Edition, Version 1.0, October 2026. Relevant sections:
- Pages 2–3: brand foundation, logo system, color palette and typography.
- Pages 4–5: layout, graphic elements, photography, applications and logo do/don't rules.
- Page 6: brand governance, master assets, versioning and final checks.
