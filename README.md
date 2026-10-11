# JSN DESIGNS BUSINESS STUDIO

JSN DESIGNS BUSINESS STUDIO is a local-first business workspace built around the existing JSN Mail Studio email editor. It combines that editor and its Gmail SMTP workflow with a SQLite foundation for clients, quotations, invoices, orders, payments, and tasks.

This document describes the code that exists in this repository. The app includes the local database and validated API, an email editor, client and quotation workflows, project/order tracking, task and payment entry, a database-backed dashboard, and backup/restore.

## Contents

- [Requirements](#requirements)
- [Install and run](#install-and-run)
- [Configuration](#configuration)
- [Application guide](#application-guide)
- [Architecture](#architecture)
- [Database and business rules](#database-and-business-rules)
- [HTTP API](#http-api)
- [Backup and restore](#backup-and-restore)
- [Security and privacy](#security-and-privacy)
- [Build and tests](#build-and-tests)
- [Troubleshooting](#troubleshooting)
- [Future scope](#future-scope)

## Requirements

- Windows, macOS, or Linux.
- Node.js 20 or newer and npm.
- A modern browser.
- A Gmail or Google Workspace account with SMTP access and a Google App Password to send email. Gmail configuration is optional for using business records and the editor preview.

## Install and run

From PowerShell on the current Windows workspace:

```powershell
cd "D:\jsn mail"
npm install
Copy-Item .env.example .env
```

Edit `.env` to configure Gmail if needed, then start the local frontend and API together:

```powershell
npm run dev
```

Open <http://localhost:5173>. The Express API listens on `127.0.0.1:5000`; Vite forwards `/api` requests to it. The database is created and initialized on the first server start.

To run only the API, use `npm start`. To build and type-check the frontend and backend, use `npm run build`. `npm run preview` serves the built frontend only; it does not start the Express API. Keep the API running separately when previewing the frontend.

## Configuration

Copy `.env.example` to `.env`. Values are read by the backend at startup.

| Variable             | Default                                                                 | Description                                                              |
| -------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GMAIL_USER`         | Empty                                                                   | Gmail/Google Workspace sender address.                                   |
| `GMAIL_APP_PASSWORD` | Empty                                                                   | Gmail App Password used by Nodemailer. It is never sent to the browser.  |
| `PORT`               | `5000`                                                                  | Express API port.                                                        |
| `HOST`               | `127.0.0.1`                                                             | Express bind host. Loopback is the intended default.                     |
| `CLIENT_URL`         | `http://localhost:5173`                                                 | Browser origin permitted by CORS and state-changing request checks.      |
| `DATABASE_PATH`      | `%LOCALAPPDATA%\JSN Designs Business Studio\business.sqlite` on Windows | SQLite database file. Set an absolute path if you want another location. |
| `BACKUP_DIR`         | `%LOCALAPPDATA%\JSN Designs Business Studio\backups` on Windows         | Folder for generated backup snapshots.                                   |

On systems without `LOCALAPPDATA` or `APPDATA`, the database and backup folders default to `JSN Designs Business Studio` under the current working directory. The restore upload staging directory also lives under the local application data folder (or current working directory fallback). Database files are kept outside frontend source, public assets, and generated frontend bundles.

Restart the API after changing `.env`. Do not put secrets in `VITE_` variables: Vite variables are available to frontend code.

## Application guide

The sidebar provides Dashboard, Email Studio, Quotations, Invoices, Orders & Projects, Clients, and Settings. Navigation uses browser history; the selected section is highlighted, and the sidebar collapses on wider screens and becomes a mobile drawer on narrow screens.

### Dashboard

Dashboard values come from SQLite queries. It shows active client count, draft/sent quotation count, active order count, open task count, outstanding order balances, and up to five upcoming open tasks. A new database displays zero counts and an honest empty task state; no sample revenue, orders, or clients are fabricated.

The dashboard also shows open and overdue invoice counts and links to the invoice list. It deliberately does not add invoice money to the existing order-balance figure.

### Email Studio

The original email editor remains available from the Email Studio navigation item. It supports:

- To, CC, BCC, subject, greeting, title, body, closing, and signature fields.
- Rich text formatting and keyboard shortcuts, including bold, italic, and underline.
- Lists, links, alignment, font sizing, and text color.
- Addable, reorderable, duplicable, and removable email sections.
- Paragraph, list, image, call-to-action, divider, and table blocks.
- The existing spreadsheet-style table editor.
- Desktop and mobile previews, generated HTML view, source inspection, and HTML copy.
- Automatic local draft save in browser storage under `jsn-mail-draft`. This is an unsent composition, separate from SQLite business records.
- Up to ten attachments per send, each limited to 10 MB. The browser and API enforce the limit.
- Send-test and send-email actions with status notifications and a confirmation view after success.
- Gmail SMTP delivery through Nodemailer. The JSN Designs logo is attached inline using the `cid:jsn-logo` content ID.

The shared HTML generator and its email-safe output remain integrated. Business status changes do not trigger email or other external requests.

### Clients

The Clients screen provides a searchable active/archived directory (name, company, email, and client reference), creation, details, editing, archive, and restore. The detail view shows timestamps and notes, linked quotations, orders with payment-derived balances, and tasks attributed only through their linked orders. Quotation references open in the quotation detail view; client references from quotations and order details open the matching client record. Creating a quotation from a client preselects that client. Email values are normalized to lowercase; editing preserves the stable client ID, generated reference, and creation time. Archiving is confirmed and reversible; it never removes linked business records. Archived clients remain readable and editable, but cannot be selected for new quotations or direct orders until restored. The API defaults to active clients and supports `status=archived|all` and a `search` term.

### Quotations

The Quotations screen creates and edits draft quotations with client selection, descriptions, line items, quantities, INR unit prices, percentage or fixed discounts, issue/valid dates, terms, and notes. The API recalculates monetary values when saved. Users can search by reference/client/title/description, filter by status, inspect line items, duplicate into a new draft, and convert accepted quotations to orders. Only drafts can be edited. Transitions are `draft → sent|cancelled` and `sent → accepted|rejected|expired|cancelled`; changes are audited and final states cannot be reopened. Conversion remains transactional and idempotent.

Quotation dashboard amounts show the total value of displayed quotations; accepted value is separate and is not collected revenue. Users can download a server-generated PDF from the list or details view. The PDF uses the persisted quotation values, includes the bundled JSN logo, client and business contact details, saved line items, totals, terms, and page numbering; internal notes are excluded. PDF text supports Latin characters; other scripts are replaced with `?` because the current PDF renderer does not perform complex script shaping. Tax is not calculated. Settings supports editing the validated business profile and quotation defaults. After downloading a PDF, the details view can open Email Studio; the downloaded file must be attached manually and reviewed before the user sends it. Opening Email Studio or downloading a PDF does not mark a quotation as sent.

### Invoices

The Invoices screen supports direct draft invoices and confirmed creation from accepted quotations or orders. A source can have one non-void invoice; orders converted from a quotation keep both source links, and the same source cannot be invoiced once through the quote and again through the order. Drafts can be edited; issuing stores client and business contact snapshots, locks commercial fields, and adds a status-history record. An issued invoice may be voided only before payment; a void invoice can produce a linked reissue draft. Paid and outstanding states are derived from persisted payments and due dates. Invoice numbers are allocated transactionally in `INV-YYYY-NNNN` form using the issue year.

All invoice values currently use INR paise. Tax is not calculated and this is a non-GST baseline; GST registration, place-of-supply, rate, and tax breakdown requirements have not been established. Payment instructions are not yet configurable separately from invoice terms. Invoice PDFs are generated from persisted items and the issue-time client/business snapshots, contain totals, amount paid, balance due, and terms, and do not mutate invoice state. Complex-script PDF shaping remains unsupported. Download the PDF and attach/review it manually in Email Studio; no invoice email is sent automatically.

PDF rendering investigation: PDFKit can embed TTF/TTC fonts and the installed Fontkit dependency contains Indic shaping paths for Tamil and Devanagari. The current PDF services still replace non-Latin characters and use standard fonts, so that capability is not enabled or claimed. A follow-up should prototype licensed Noto fonts and verify visual output, wrapping, and extracted text before support is enabled. See [PDFKit font embedding](https://pdfkit.org/docs/text.html), [Fontkit shaping source](https://github.com/foliojs/fontkit/tree/master/src/opentype/shapers), and [HarfBuzz script coverage](https://harfbuzz.github.io/what-does-harfbuzz-do.html).

Invoice receipts for order-linked invoices are written once to the existing `payments` table and linked by `invoice_payments.order_payment_id`; the same payment ID supplies both invoice and order balances. Older order payments are allocated when the invoice is created. Order receipts recorded through the existing order payment form are allocated to the linked invoice. Direct invoice receipts live only in `invoice_payments`. The dashboard keeps invoice status counts separate from the existing order balance. The baseline enforces a single invoice per source order or quotation and requires an order-linked invoice total to match its agreed order amount.

### Orders & Projects

The Orders & Projects screen creates direct orders, updates order status and delivery state, and shows agreed, paid, and outstanding amounts. It can add independent or project-linked tasks, change task status, record partial payments against an order, and inspect payment history. The API rejects payments above the outstanding balance. Order and task forms include due dates, priorities, descriptions, and requirements.

### Settings

Settings reports whether Gmail is configured without disclosing its password. It provides a database backup download and a restore upload. The database path can be changed with `DATABASE_PATH` in `.env`.

## Architecture

The repository keeps the Vite frontend at the project root and the Express API in `server/`:

```text
src/
  App.tsx                         Business Studio shell, navigation and dashboard
  EmailStudio.tsx                 Preserved email editor and send workflow
  main.tsx                        React entry point and toast provider
  components/SpreadsheetTableEditor.tsx
  pages/QuotationsPage.tsx         Quotation editor, detail view, lifecycle and conversion
  pages/InvoicesPage.tsx           Invoice drafts, lifecycle, payments, and PDF handoff
  pages/ProjectsPage.tsx           Order, task and payment workflows
  pages/ClientsPage.tsx            Searchable client directory, details and lifecycle actions
  services/api/apiClient.ts        Shared local API client
  services/html.service.ts        Shared email HTML generation and sanitization
  types/email.ts                  Email editor data types
  assets/JSN DESIGN.png           Existing brand asset
  styles.css
  styles-extensions.css
server/
  index.ts                        Environment loading, database initialization and listener
  app.ts                          Express middleware and route registration
  db/database.ts                  SQLite setup, migrations and restore operations
  db/migrations/001_initial.sql   Initial versioned schema
  schemas/business.ts             Zod validation schemas
  routes/email.routes.ts          Existing email API with runtime payload validation
  routes/business.routes.ts       Business data, dashboard and backup API
  routes/invoice.routes.ts        Invoice lifecycle, payment allocation and PDF API
  services/invoice-pdf.ts         Snapshot-based invoice PDF generation
  services/html.service.ts        Server re-export of the shared HTML generator
  services/mail.service.ts        Gmail SMTP transport
  business.test.ts                API and database tests using temporary data
  invoice-database.test.ts        Invoice migration and backup/restore preservation
  invoice-pdf.test.ts              Invoice PDF contents and pagination
  invoice.test.ts                  Invoice API lifecycle/accounting regression tests
```

Frontend components call typed local API helpers and do not run SQL. The server uses parameterized SQL through `better-sqlite3`. Express middleware includes Helmet, CORS, rate limiting, and Origin/Host checks for state-changing methods. Zod validates untrusted business and email request payloads.

## Database and business rules

The SQLite file is local and is never placed in `public/`, `src/`, or `dist/`. At startup the server creates the parent directory, enables foreign keys, uses WAL journaling and a five-second busy timeout, applies any pending versioned migrations, then checks SQLite and foreign-key integrity before listening. Migration versions and application timestamps are stored in `schema_migrations`. Migrations are additive/versioned; startup does not reset existing data.

Migration **001** creates the core business tables. Migration **002** adds quotation lifecycle history and the single-row business profile. Startup applies pending numbered migrations to fresh and existing databases:

| Table             | Purpose                                                                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clients`         | Client contact information, unique client reference, timestamps, and archive marker.                                                                     |
| `quotations`      | Client relationship, unique quotation reference, status, dates, currency, terms, notes, and server-calculated totals.                                    |
| `quotation_items` | Separate line items with quantity, paise unit price, calculated line total, and sort order.                                                              |
| `orders`          | Client relationship, optional unique source quotation, copied project description and agreed amount, requirements, status, priority, and delivery dates. |
| `payments`        | Order-linked payment entries with amount, date, method, reference, and notes.                                                                            |
| `tasks`           | Tasks that can stand alone or reference an order, with status, priority, and due date.                                                                   |
| `quotation_status_history` | Timestamped quotation status changes with optional metadata. |
| `business_profile` | Local business details and quotation defaults (INR only). |

Foreign keys preserve historical relationships. Clients can be archived instead of deleted. Quotations retain their own line items, and converting one copies its title, description, currency, and agreed total into the order so later quotation status changes do not rewrite the order amount.

### Currency and quotation calculations

Amounts are stored as integer minor units. For INR, one unit is one paise. The API calculates all quotation values; it ignores client-supplied totals.

- A line total is `Math.round(quantity × unit_price_minor)`.
- The subtotal is the sum of line totals.
- Percentage discount is `Math.round(subtotal_minor × percentage ÷ 100)`.
- Fixed `discount_value` is submitted in rupees and converted to paise with `Math.round(discount_value × 100)`.
- Quantities and prices cannot be negative; percentages cannot exceed 100%; discounts cannot exceed the subtotal; unsafe or invalid totals are rejected.
- Tax is stored as zero in this milestone. Tax calculation is not implemented.

### Statuses and transitions

- Quotation: `draft`, `sent`, `accepted`, `rejected`, `expired`, `cancelled`.
- Order: `new`, `confirmed`, `in_progress`, `client_review`, `revisions`, `ready_for_delivery`, `delivered`, `on_hold`, `cancelled`, `closed`.
- Invoice stored lifecycle: `draft → issued → void`; the displayed `partially_paid`, `paid`, and `overdue` states are derived from allocated payment totals and the due date.
- Task: `pending`, `in_progress`, `completed`, `cancelled`.
- Priority: `low`, `normal`, `high`, `urgent`.

Quotation conversion is transactional and unique by source quotation. It returns the existing order if the same quotation is submitted for conversion again. Only an accepted quotation converts by default. An API caller must explicitly send `{"confirm_unaccepted":true}` to override that rule. Payments cannot exceed the current outstanding amount. Outstanding balances are derived from payment records; delivery does not mark an order as paid.

Date-only values use `YYYY-MM-DD`; stored timestamps use ISO 8601. References are generated locally (for example `CL-YYYYMMDD-...`, `QT-YYYYMMDD-...`, and `OR-YYYYMMDD-...`).

## HTTP API

The API base is `http://127.0.0.1:5000/api` when running directly; frontend code uses the Vite `/api` proxy. JSON validation errors return a JSON object with an `error` message. IDs are UUIDs.

### Health and dashboard

| Method | Path         | Result                                                                            |
| ------ | ------------ | --------------------------------------------------------------------------------- |
| `GET`  | `/health`    | API health and service name.                                                      |
| `GET`  | `/dashboard` | Counts, outstanding amount in paise, and upcoming open tasks from actual records. |

Dashboard counts include open and overdue invoices; invoice amounts remain outside the order outstanding figure.

### Clients

| Method  | Path                   | Result                                                                                             |
| ------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `GET`   | `/clients`             | Search/filter clients; `search` matches name, company, email, or reference; `status` is `active` (default), `archived`, or `all`. |
| `GET`   | `/clients/:id`         | Read a client, linked quotations/orders, order-derived payments/balances, and tasks linked through those orders. |
| `POST`  | `/clients`             | Create a client. Required: `name`; optional: `company_name`, `email`, `phone`, `address`, `notes`. |
| `PUT`   | `/clients/:id`         | Update validated contact and notes fields; preserves ID, reference, and creation timestamp. |
| `PATCH` | `/clients/:id/archive` | Archive an active client.                                                                          |
| `PATCH` | `/clients/:id/restore` | Restore an archived client to the active directory.                                                 |

Example:

```json
{
  "name": "A Client",
  "company_name": "Example Studio",
  "email": "client@example.com",
  "phone": "+91 90000 00000",
  "address": "Mumbai, India",
  "notes": "Prefers email updates"
}
```

### Quotations

| Method  | Path                      | Result                                                                                                           |
| ------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/quotations`             | List quotations; optional `search`, `status`, `from`, and `to` filters.                                           |
| `POST`  | `/quotations`             | Create a quotation and its line items; server calculates line, subtotal, discount, and total amounts.            |
| `PUT`   | `/quotations/:id`         | Recalculate and replace quotation details/items transactionally. Converted quotations are locked.                |
| `GET`   | `/quotations/:id`         | Read one quotation and its line items.                                                                           |
| `PATCH` | `/quotations/:id/status`  | Set a quotation status. JSON: `{"status":"accepted"}`. Converted quotations are locked.                          |
| `POST`  | `/quotations/:id/duplicate` | Duplicate quotation content into a new draft with a new reference.                                              |
| `GET`   | `/quotations/:id/pdf`      | Stream a customer-facing PDF generated from the saved quotation and current business profile.                   |
| `POST`  | `/quotations/:id/convert` | Convert an accepted quotation. JSON body may be `{}`; optional explicit override: `{"confirm_unaccepted":true}`. |
| `GET`   | `/business-profile`       | Read local business details and quotation defaults.                                                               |
| `PUT`   | `/business-profile`       | Update validated business details and quotation defaults.                                                         |

Example creation request (unit prices are paise; fixed discount value is rupees):

```json
{
  "client_id": "00000000-0000-4000-8000-000000000001",
  "title": "Brand identity",
  "description": "Logo and visual identity package",
  "items": [
    { "description": "Logo design", "quantity": 1, "unit_price_minor": 250000 },
    { "description": "Brand guide", "quantity": 1, "unit_price_minor": 100000 }
  ],
  "discount_type": "percentage",
  "discount_value": 10,
  "issue_date": "2026-10-09",
  "valid_until": "2026-11-09",
  "terms": "Two revision rounds included",
  "notes": ""
}
```

`discount_type` is `none`, `fixed`, or `percentage`; `discount_value` defaults to zero. `items` must contain at least one item. The example client ID must be replaced with a real client ID returned by `POST /clients`.

### Orders, payments, and tasks

| Method  | Path                   | Result                                                                                                                                                |
| ------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/orders`              | List orders with client names and derived paid/outstanding paise amounts.                                                                             |
| `POST`  | `/orders`              | Create an order directly. Required: `client_id`, `title`, `agreed_amount_minor`; optional: description, requirements, priority, order date, due date. |
| `PATCH` | `/orders/:id/status`   | Change order status. Setting `delivered` records `delivered_at`.                                                                                      |
| `GET`   | `/orders/:id/payments` | List an order's payments.                                                                                                                             |
| `POST`  | `/orders/:id/payments` | Record a payment. `amount_minor` is required; amount cannot exceed outstanding balance.                                                               |
| `GET`   | `/tasks`               | List tasks, including linked order reference where present.                                                                                           |
| `POST`  | `/tasks`               | Create an independent or order-linked task. Required: `title`; optional: `order_id`, description, status, priority, due date.                         |
| `PATCH` | `/tasks/:id/status`    | Change task status. Completing a task records its completion timestamp.                                                                               |

Payment example:

```json
{
  "amount_minor": 50000,
  "payment_date": "2026-10-09",
  "payment_method": "Bank transfer",
  "reference": "TXN-12345",
  "notes": "Advance payment"
}
```

### Invoices

| Method | Path | Result |
| ------ | ---- | ------ |
| `GET` | `/invoices` | Search by invoice/client and filter `status`, `date_field=issue|due`, `from`, and `to`. |
| `POST` | `/invoices` | Create a draft; optional `source_order_id` or `source_quotation_id` requires `confirm_source: true`. Amounts are recalculated server-side. |
| `GET` | `/invoices/:id` | Read saved details, derived status/balance, line items, payment entries, and status history. |
| `PUT` | `/invoices/:id` | Edit an unissued draft; issued and void invoices are immutable. |
| `PATCH` | `/invoices/:id/status` | JSON `{"action":"issue"}` or `{"action":"void"}`; issuance snapshots client/business details. |
| `POST` | `/invoices/:id/reissue` | Create a draft from a void invoice, linked to the original. |
| `POST` | `/invoices/:id/payments` | Record an issued invoice payment; requires `amount_minor`, `payment_date`, and a UUID `idempotency_key`. |
| `GET` | `/invoices/:id/pdf` | Download a PDF from persisted invoice data and issue snapshots; drafts have no customer PDF. |

For invoices linked to orders, payment creation also creates exactly one existing order payment and the invoice ledger entry references it. This endpoint and `/orders/:id/payments` use a transaction and reject repeat references, duplicate submission keys, and amounts beyond the remaining invoice/order balance. The invoice list uses derived status; database status history stores only draft, issued, and void transitions. Invoice numbering is unique and generated in the server transaction by issue year.

This records ₹500.00. Payments inherit the order currency; this milestone defaults to INR.

### Backups and email

| Method | Path            | Result                                                                           |
| ------ | --------------- | -------------------------------------------------------------------------------- |
| `GET`  | `/backup`       | Create a consistent SQLite snapshot in `BACKUP_DIR` and return it as a download. |
| `POST` | `/restore`      | Restore one SQLite file uploaded as multipart field `backup` (maximum 200 MB).   |
| `GET`  | `/email/config` | Return connection status and configured sender address, never the App Password.  |
| `POST` | `/email/test`   | Send the current email payload to the configured sender address.                 |
| `POST` | `/email/send`   | Send the current email payload to its To recipients.                             |

Email endpoints retain the editor's multipart request format: JSON content in form field `payload`, and zero or more uploaded files in `attachments`. To, CC, and BCC addresses and the subject are validated by the server. Attachment filenames are normalized before sending. No real email is sent by the automated test suite.

## Backup and restore

1. Open **Settings** and choose **Download database backup**. SQLite creates a consistent snapshot; the API stores a dated `.sqlite` file in `BACKUP_DIR` and streams it to the browser.
2. Keep the downloaded backup in a private location outside the repository. Backups contain client and financial records.
3. To restore, select a backup file in Settings and choose **Restore backup**. The API accepts one file up to 200 MB and checks SQLite integrity, foreign-key integrity, schema version, and required tables before replacing the active database.
4. Before replacement, the current database is retained beside the active file as `business.sqlite.recovery-<timestamp>`. If replacement cannot complete, the API attempts to restore the prior file. After a successful restore, verify the displayed records and retain the recovery file until satisfied.

Restore accepts backups produced with this schema version. Restoring an older backup replaces the current business data with the contents of that backup. Take a fresh backup first if you may need the current records.

## Security and privacy

- By default, Express listens only on `127.0.0.1` and Vite binds its local development server. The application has no authentication, user accounts, or authorization model.
- CORS is limited to `CLIENT_URL`; state-changing requests validate supplied Origin and loopback Host values. Helmet security headers and a 60-request-per-15-minute rate limit are enabled.
- On 2026-10-09, `npm audit` reported 7 development-tree findings (5 high, 2 moderate); `npm audit --omit=dev` reported 0 production findings. Affected packages are `tailwindcss`, `braces`, `chokidar`, `fast-glob`, `micromatch`, `postcss-nested`, and `postcss-selector-parser`. The current Tailwind 3.4.19 range is affected; npm proposes Tailwind 4.3.3, a major upgrade. This audit was not force-fixed because Tailwind 4 requires build configuration and CSS compatibility work. Re-run both audit commands before release.
- SQL values are passed as parameters. Business request bodies are validated at runtime. Database files and backups are not served by Vite.
- Gmail credentials stay in the backend environment. Email attachment bytes are held in memory for the request and are not kept as a permanent upload archive.
- `.env`, SQLite/database files, backup files, and upload data are excluded by `.gitignore`. Check the ignore rules before storing any custom data path inside the repository.

This app is designed for one trusted local user. Loopback binding is not a substitute for authentication or operating-system account security. Do not change `HOST` to a network-facing address or expose the API to an untrusted network. Do not commit or share database backups casually.

## Build and tests

Run from the project root:

```powershell
npm run build
npm test
```

`npm run build` runs the TypeScript project build and Vite production build. `npm test` runs Node's test runner through `tsx`, using a temporary SQLite database and temporary backup files. Coverage includes:

- New database initialization, repeatable migration, foreign-key enforcement, integrity checks, and empty dashboard aggregation.
- Client input validation and email normalization.
- Quotation percentage and fixed discounts, paise rounding, negative/invalid values, and backend total calculations.
- Quotation edit recalculation, transactional line-item replacement, and edit/status lock after conversion.
- Accepted-quotation conversion, rejection of unaccepted conversion by default, and duplicate conversion prevention.
- Payment balance calculations and overpayment rejection; task creation and status updates.
- Database-backed dashboard aggregation, snapshot backup, invalid-backup rejection, successful restore, and recovery-file preservation.
- Invoice migration and backup/restore preservation; invoice PDF persisted content and pagination.
- Invoice lifecycle/accounting API regression cases are present but require a runtime that permits local loopback TCP.
- Existing generated email HTML and email API input validation/config secrecy.

Tests do not use the normal `%LOCALAPPDATA%` business database and do not send real email. A production dependency security scan can be run with `npm audit --omit=dev`; the complete dependency tree can be inspected with `npm audit`.

### Invoice milestone verification (2026-10-12)

- `npm test`: 4 passed, 0 failed, 2 skipped. Both skips are loopback-dependent API integration suites; the runtime reports `EACCES`. Migration/backup and invoice PDF tests ran.
- `npm run build`: passed. The sandboxed Vite process could not asynchronously resolve `index.html` (`EPERM`); the requested build ran outside that filesystem restriction and passed.
- `git diff --check`: passed (Git emitted working-copy line-ending warnings).
- `npm audit`: 7 development-tree findings (5 high, 2 moderate) in the Tailwind 3 dependency path; the offered all-fix requires breaking Tailwind 4. No force upgrade was run. `npm audit --omit=dev`: 0 findings.
- Manual browser acceptance was not performed because the Computer Use helper stopped when it could not determine the active Edge URL with sufficient confidence. See [TODO.md](TODO.md) for blockers and next actions.

### Release verification (2026-10-09)

- `npm test`: 7 passed, 0 failed, 0 skipped. This run included migration preservation for an existing quotation and line item, and backup/restore preservation for quotation, item, and business profile data.
- `npm run build` and `git diff --check`: passed.
- Dependency audit: 7 development-tree findings (5 high, 2 moderate); production-only audit: 0 findings. `npm audit fix --dry-run` proposed no dependency changes. See [Security and privacy](#security-and-privacy) for affected packages and the major Tailwind upgrade requirement.
- Manual UI checks: desktop (1366px), tablet (768px), and mobile (390px) page widths showed no document-level horizontal overflow. The quotation editor was inspected at mobile width; line-item fields now stack with visible labels. Keyboard Tab moved focus from the editor close control to the client selector, which retained a visible browser focus outline. Settings and quotation details were inspected at desktop width.
- Verification limits: the local app began returning HTTP 429 during the follow-up mobile detail-table visual check, so the detail-table CSS adjustment needs a fresh browser check after the local rate limit resets. The email editor was reviewed in source but not manually exercised in the browser. Automated email tests do not send mail.

## Troubleshooting

### Port 5000 or 5173 is already in use

Stop the other process or change `PORT` for Express. If you change the Vite port, update `CLIENT_URL` to the corresponding origin and restart both processes. The Vite proxy target is configured in `vite.config.ts` and must continue to point to the Express port.

### The dashboard says records are unavailable

Confirm `npm run dev` is still running and that the API started successfully. Check the terminal for SQLite initialization errors. If using a custom `DATABASE_PATH`, make sure its parent directory is writable and that the file is a valid SQLite database.

### Gmail shows as not connected or sending fails

Confirm `GMAIL_USER` and `GMAIL_APP_PASSWORD` are set in `.env`, that the account permits SMTP access, and that the App Password is current. Restart the API after editing `.env`. The UI reports the configured sender address, not the password.

### Restore reports an invalid backup

Choose a complete SQLite backup generated by this application. A renamed file is not necessarily a valid backup. Confirm the file is below the 200 MB upload limit. A rejected backup is not installed; the active database remains in use.

### The frontend loads but API calls fail in preview

`npm run preview` serves only `dist`; it does not run the API or configure the development proxy. Start the API separately and configure a frontend server/proxy for `/api` if you use a non-development deployment.

## Future scope

Potential follow-on work includes direct attachment handoff from quotation details to Email Studio and configurable logo asset management. Tax calculation, user authentication, and multi-user deployment are not implemented.
