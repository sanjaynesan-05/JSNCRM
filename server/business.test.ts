import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import {
  openDatabase,
  initializeDatabase,
  setDatabaseForTests,
} from "./db/database.ts";
import { createApp } from "./app.ts";
import { generateEmailHtml } from "./services/html.service.ts";
import type { EmailDraft } from "../src/types/email.ts";
import { extractPdfText } from "./quotation-pdf-test-utils.ts";

test("business database, APIs, calculations, backups and HTML generation", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "jsn-business-test-"));
  const dbPath = join(root, "business.sqlite");
  process.env.DATABASE_PATH = dbPath;
  process.env.BACKUP_DIR = join(root, "backups");
  process.env.GMAIL_USER = "";
  process.env.GMAIL_APP_PASSWORD = "";
  const db = initializeDatabase();
  const server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const call = async (path: string, method = "GET", body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: (await r.json()) as any };
  };
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    setDatabaseForTests();
    delete process.env.DATABASE_PATH;
    delete process.env.BACKUP_DIR;
    rmSync(root, { recursive: true, force: true });
  });

  await t.test(
    "database initialization, repeatable migrations and constraints",
    async () => {
      assert.deepEqual(db.pragma("foreign_keys"), [{ foreign_keys: 1 }]);
      assert.deepEqual(db.pragma("integrity_check"), [
        { integrity_check: "ok" },
      ]);
      assert.equal(
        (
          db
            .prepare("SELECT COUNT(*) count FROM schema_migrations")
            .get() as any
        ).count,
        6,
      );
      const reopened = openDatabase(dbPath);
      reopened.close();
      assert.equal(
        (
          db
            .prepare("SELECT COUNT(*) count FROM schema_migrations")
            .get() as any
        ).count,
        6,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) count FROM clients").get() &&
          (db.prepare("SELECT COUNT(*) count FROM clients").get() as any).count,
        0,
      );
      assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
      const legacyPath = join(root, "legacy.sqlite");
      const legacy = new Database(legacyPath);
      legacy.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
      legacy.exec(readFileSync(join(process.cwd(), "server/db/migrations/001_initial.sql"), "utf8"));
      legacy.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)").run(new Date().toISOString());
      legacy.prepare("INSERT INTO clients(id,client_code,name,created_at,updated_at) VALUES(?,?,?,?,?)").run("00000000-0000-4000-8000-000000000001", "CL-LEGACY", "Legacy client", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
      legacy.prepare("INSERT INTO quotations(id,quotation_number,client_id,title,subtotal_minor,total_minor,issue_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("00000000-0000-4000-8000-000000000002", "QT-LEGACY", "00000000-0000-4000-8000-000000000001", "Legacy quotation", 2500, 2500, "2020-01-01", "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
      legacy.prepare("INSERT INTO quotation_items(id,quotation_id,description,quantity,unit_price_minor,line_total_minor,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").run("00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000002", "Legacy line item", 1, 2500, 2500, "2020-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z");
      legacy.close();
      const upgradedLegacy = openDatabase(legacyPath);
      assert.equal((upgradedLegacy.prepare("SELECT name FROM clients WHERE client_code='CL-LEGACY'").get() as any).name, "Legacy client");
      assert.equal((upgradedLegacy.prepare("SELECT total_minor FROM quotations WHERE quotation_number='QT-LEGACY'").get() as any).total_minor, 2500);
      assert.equal((upgradedLegacy.prepare("SELECT description FROM quotation_items WHERE quotation_id='00000000-0000-4000-8000-000000000002'").get() as any).description, "Legacy line item");
      assert.equal((upgradedLegacy.prepare("SELECT COUNT(*) count FROM schema_migrations").get() as any).count, 6);
      upgradedLegacy.close();
    },
  );

  try {
    await fetch(`${base}/health`);
  } catch (error) {
    const cause = (error as Error & { cause?: NodeJS.ErrnoException }).cause;
    if (cause?.code === "EACCES") {
      t.diagnostic(
        "This runtime blocks loopback TCP connections; API integration cases are skipped in this environment.",
      );
      t.skip("API integration requires local TCP access.");
      return;
    }
    throw error;
  }

  await t.test(
    "validates clients; calculates quotation; converts once; tracks payment and task",
    async () => {
      const profileDefaults = await call("/business-profile");
      assert.equal(profileDefaults.status, 200);
      assert.equal(profileDefaults.data.currency, "INR");
      assert.equal(profileDefaults.data.default_validity_days, 30);
      const profileUpdate = await call("/business-profile", "PUT", {
        business_name: "JSN Designs",
        contact_person: "Studio",
        email: "hello@example.com",
        phone: "+91 90000 00000",
        address: "Mumbai, India",
        website: "https://example.com",
        default_terms: "Payment due within 14 days.",
        default_validity_days: 21,
        currency: "INR",
      });
      assert.equal(profileUpdate.status, 200);
      assert.equal(profileUpdate.data.business_name, "JSN Designs");
      const profileDbReopen = openDatabase(dbPath);
      assert.equal((profileDbReopen.prepare("SELECT business_name FROM business_profile WHERE id=1").get() as any).business_name, "JSN Designs");
      profileDbReopen.close();
      assert.equal((await call("/business-profile", "PUT", {
        business_name: "", contact_person: "", email: "bad-email", phone: "", address: "", website: "", default_terms: "", default_validity_days: 0, currency: "USD",
      })).status, 400);
      assert.equal((await call("/clients", "POST", { name: "" })).status, 400);
      const made = await call("/clients", "POST", {
        name: "A Client",
        email: "CLIENT@example.com",
      });
      assert.equal(made.status, 201);
      const client = made.data;
      assert.equal(client.email, "client@example.com");
      const quotationInput = {
        client_id: client.id,
        title: "Brand identity",
        items: [
          { description: "Logo", quantity: 2, unit_price_minor: 10000 },
          { description: "Guide", quantity: 1, unit_price_minor: 5000 },
        ],
        discount_type: "percentage",
        discount_value: 10,
      };
      const quote = await call("/quotations", "POST", quotationInput);
      assert.equal(quote.status, 201);
      assert.equal(quote.data.subtotal_minor, 25000);
      assert.equal(quote.data.discount_minor, 2500);
      assert.equal(quote.data.total_minor, 22500);
      const pdfResponse = await fetch(`${base}/quotations/${quote.data.id}/pdf`);
      assert.equal(pdfResponse.status, 200);
      assert.match(pdfResponse.headers.get("content-type") || "", /application\/pdf/);
      assert.match(pdfResponse.headers.get("content-disposition") || "", /^attachment; filename="quotation_[A-Za-z0-9._-]+\.pdf"$/);
      const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
      assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
      const pdfText = await extractPdfText(pdfBytes);
      assert.ok(pdfText.text.includes("Brand identity"));
      assert.ok(pdfText.text.includes("Logo"));
      assert.ok(pdfText.text.includes("INR 225.00"));
      assert.equal((await call(`/quotations/${quote.data.id}`)).data.status, "draft");
      const missingPdf = await call("/quotations/00000000-0000-4000-8000-000000000000/pdf");
      assert.equal(missingPdf.status, 404);
      const largeQuotation = await call("/quotations", "POST", {
        client_id: client.id,
        title: "Long multi-page quotation",
        items: Array.from({ length: 100 }, (_, index) => ({ description: `Service ${index + 1} — ${"Extended work description ".repeat(8)}`, quantity: 1, unit_price_minor: 1000 })),
      });
      assert.equal(largeQuotation.status, 201);
      const multiPage = await fetch(`${base}/quotations/${largeQuotation.data.id}/pdf`);
      assert.equal(multiPage.status, 200);
      const multiPageBytes = Buffer.from(await multiPage.arrayBuffer());
      assert.equal(multiPageBytes.subarray(0, 5).toString(), "%PDF-");
      assert.ok((await extractPdfText(multiPageBytes)).pageCount > 1);
      const copied = await call(`/quotations/${quote.data.id}/duplicate`, "POST", {});
      assert.equal(copied.status, 201);
      assert.equal(copied.data.status, "draft");
      assert.notEqual(copied.data.quotation_number, quote.data.quotation_number);
      const updatedQuote = await call(`/quotations/${quote.data.id}`, "PUT", {
        ...quotationInput,
        title: "Brand identity updated",
      });
      assert.equal(updatedQuote.status, 200);
      assert.equal(updatedQuote.data.title, "Brand identity updated");
      assert.equal(updatedQuote.data.total_minor, 22500);
      assert.equal(
        (
          await call("/quotations", "POST", {
            client_id: client.id,
            title: "Bad",
            items: [{ description: "X", quantity: -1, unit_price_minor: 2 }],
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call("/quotations", "POST", {
            client_id: client.id,
            title: "Bad",
            items: [{ description: "X", quantity: 1, unit_price_minor: -1 }],
          })
        ).status,
        400,
      );
      const fixed = await call("/quotations", "POST", {
        client_id: client.id,
        title: "Fixed discount",
        items: [
          {
            description: "Half paise rounding",
            quantity: 0.5,
            unit_price_minor: 101,
          },
        ],
        discount_type: "fixed",
        discount_value: 0.26,
      });
      assert.equal(fixed.data.subtotal_minor, 51);
      assert.equal(fixed.data.discount_minor, 26);
      assert.equal(fixed.data.total_minor, 25);
      assert.equal(
        (
          await call("/quotations", "POST", {
            client_id: client.id,
            title: "Excess discount",
            items: [
              { description: "Logo", quantity: 1, unit_price_minor: 100 },
            ],
            discount_type: "fixed",
            discount_value: 2,
          })
        ).status,
        400,
      );
      assert.equal(
        (await call(`/quotations/${quote.data.id}/convert`, "POST", {})).status,
        409,
      );
      assert.equal(
        (
          await call(`/quotations/${quote.data.id}/status`, "PATCH", {
            status: "sent",
          })
        ).status,
        200,
      );
      assert.equal((await call(`/quotations/${quote.data.id}/status`, "PATCH", { status: "accepted" })).status, 200);
      const details = await call(`/quotations/${quote.data.id}`);
      assert.deepEqual(details.data.status_history.map((h: any) => h.new_status), ["draft", "sent", "accepted"]);
      const first = await call(
        `/quotations/${quote.data.id}/convert`,
        "POST",
        {},
      );
      assert.equal(first.status, 201);
      assert.equal(first.data.agreed_amount_minor, 22500);
      const again = await call(
        `/quotations/${quote.data.id}/convert`,
        "POST",
        {},
      );
      assert.equal(again.data.id, first.data.id);
      assert.equal(
        (
          await call(`/quotations/${quote.data.id}`, "PUT", {
            ...quotationInput,
            title: "Should stay frozen after conversion",
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await call(`/quotations/${quote.data.id}/status`, "PATCH", {
            status: "rejected",
          })
        ).status,
        409,
      );
      const quotationList = await call("/quotations");
      assert.ok(
        quotationList.data.some((row: any) => row.id === quote.data.id),
      );
      const orderList = await call("/orders");
      const listedOrder = orderList.data.find(
        (row: any) => row.id === first.data.id,
      );
      assert.equal(listedOrder.outstanding_minor, 22500);
      assert.equal(
        (
          await call(`/orders/${first.data.id}/status`, "PATCH", {
            status: "in_progress",
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await call(`/orders/${first.data.id}/payments`, "POST", {
            amount_minor: 5000,
          })
        ).data.outstanding_minor,
        17500,
      );
      assert.equal(
        (
          await call(`/orders/${first.data.id}/payments`, "POST", {
            amount_minor: 18000,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await call("/tasks", "POST", {
            order_id: first.data.id,
            title: "Prepare files",
            due_date: "2026-10-20",
          })
        ).status,
        201,
      );
      const task = (await call("/tasks")).data[0];
      assert.equal(
        (
          await call(`/tasks/${task.id}/status`, "PATCH", {
            status: "completed",
          })
        ).status,
        200,
      );
      const originalClient = (await call(`/clients/${client.id}`)).data.client;
      assert.equal((await call("/clients/not-a-uuid")).status, 400);
      assert.equal((await call(`/clients/${client.id}`, "PUT", { name: "", email: "bad" })).status, 400);
      const edited = await call(`/clients/${client.id}`, "PUT", { name: "A Client Updated", company_name: "JSN Studio", email: " NEW@EXAMPLE.COM ", phone: "+91 123", address: "Pune", notes: "Updated notes" });
      assert.equal(edited.status, 200);
      assert.equal(edited.data.email, "new@example.com");
      assert.equal(edited.data.client_code, originalClient.client_code);
      assert.equal(edited.data.created_at, originalClient.created_at);
      assert.equal((await call("/clients?search=JSN%20Studio")).data[0].id, client.id);
      assert.equal((await call(`/clients/${client.id}`)).data.quotations.some((q: any) => q.id === quote.data.id), true);
      const clientDetails = await call(`/clients/${client.id}`);
      assert.equal(clientDetails.data.orders.some((o: any) => o.id === first.data.id && o.paid_minor === 5000 && o.outstanding_minor === 17500), true);
      assert.equal(clientDetails.data.tasks.some((t: any) => t.id === task.id && t.order_number === first.data.order_number), true);
      const archiveResult = await call(`/clients/${client.id}/archive`, "PATCH");
      assert.equal(archiveResult.status, 200);
      assert.equal((await call("/clients")).data.some((row: any) => row.id === client.id), false);
      assert.equal((await call("/clients?status=archived&search=CL-")).data[0].id, client.id);
      assert.equal((await call(`/clients/${client.id}`)).data.quotations.some((q: any) => q.id === quote.data.id), true);
      assert.equal((await call("/quotations", "POST", quotationInput)).status, 404);
      assert.equal((await call("/orders", "POST", { client_id: client.id, title: "Archived order", agreed_amount_minor: 100 })).status, 404);
      assert.equal((await call(`/clients/${client.id}/restore`, "PATCH")).status, 200);
      assert.equal((await call("/clients")).data.some((row: any) => row.id === client.id), true);
      const dashboard = await call("/dashboard");
      assert.equal(dashboard.data.clients, 1);
      assert.equal(dashboard.data.active_orders, 1);
      assert.equal(dashboard.data.outstanding_minor, 17500);
    },
  );

  await t.test(
    "backs up a consistent database and restores only a valid snapshot",
    async () => {
      const download = await fetch(`${base}/backup`);
      assert.equal(download.status, 200);
      assert.match(
        download.headers.get("content-type") || "",
        /application\/octet-stream|application\/vnd\.sqlite3/,
      );
      const saved = join(root, "backup.sqlite");
      await db.backup(saved);
      const backupDb = openDatabase(saved);
      assert.equal(
        (backupDb.prepare("SELECT COUNT(*) count FROM clients").get() as any)
          .count,
        1,
      );
      backupDb.close();
      const before = (
        db.prepare("SELECT COUNT(*) count FROM clients").get() as any
      ).count;
      const invalid = join(root, "invalid.sqlite");
      writeFileSync(invalid, "not a database");
      const invalidForm = new FormData();
      invalidForm.append(
        "backup",
        new Blob([readFileSync(invalid)], { type: "application/octet-stream" }),
        "invalid.sqlite",
      );
      const rejected = await fetch(`${base}/restore`, {
        method: "POST",
        body: invalidForm,
      });
      assert.equal(rejected.status, 400);
      assert.equal(
        (db.prepare("SELECT COUNT(*) count FROM clients").get() as any).count,
        before,
      );
      const validForm = new FormData();
      validForm.append(
        "backup",
        new Blob([readFileSync(saved)], { type: "application/octet-stream" }),
        "backup.sqlite",
      );
      const restored = await fetch(`${base}/restore`, {
        method: "POST",
        body: validForm,
      });
      assert.equal(restored.status, 200);
      assert.equal(
        (
          initializeDatabase()
            .prepare("SELECT COUNT(*) count FROM clients")
            .get() as any
        ).count,
        1,
      );
      assert.ok(
        readdirSync(root).some((name) =>
          name.startsWith("business.sqlite.recovery-"),
        ),
      );
      const restoredDb = initializeDatabase();
      assert.equal((restoredDb.prepare("SELECT business_name FROM business_profile WHERE id=1").get() as any).business_name, "JSN Designs");
      assert.ok((restoredDb.prepare("SELECT COUNT(*) count FROM quotations").get() as any).count > 0);
      assert.ok((restoredDb.prepare("SELECT COUNT(*) count FROM quotation_items").get() as any).count > 0);
    },
  );

  await t.test("keeps the existing email HTML generator usable", () => {
    const draft = {
      subject: "Hello",
      greeting: "Hi",
      title: "Note",
      body: "Safe <b>formatting</b>",
      sections: [],
      closing: "Thanks",
      signature: "JSN Designs",
      typography: {},
    } as unknown as EmailDraft;
    const html = generateEmailHtml(draft, "cid:jsn-logo");
    assert.match(html, /cid:jsn-logo/);
    assert.match(html, /Hello/);
    assert.match(html, /<b>formatting<\/b>/);
  });

  await t.test(
    "email API rejects invalid input without sending mail",
    async () => {
      const form = new FormData();
      form.append(
        "payload",
        JSON.stringify({ to: "not-an-address", subject: "Bad" }),
      );
      const invalid = await fetch(`${base}/email/send`, {
        method: "POST",
        body: form,
      });
      assert.equal(invalid.status, 400);
      const invalidCopy = new FormData();
      invalidCopy.append(
        "payload",
        JSON.stringify({
          to: "client@example.com",
          cc: "bad address",
          subject: "Bad",
        }),
      );
      assert.equal(
        (
          await fetch(`${base}/email/send`, {
            method: "POST",
            body: invalidCopy,
          })
        ).status,
        400,
      );
      const withAttachment = new FormData();
      withAttachment.append("payload", JSON.stringify({ to: "client@example.com", subject: "Quotation", greeting: "Hello", title: "Quotation attached", sections: [], closing: "Regards", signature: "JSN Designs" }));
      withAttachment.append("attachments", new Blob([Buffer.from("%PDF-1.4 test")], { type: "application/pdf" }), "quotation_QT-test.pdf");
      const attachmentResponse = await fetch(`${base}/email/send`, { method: "POST", body: withAttachment });
      assert.equal(attachmentResponse.status, 503, "Valid attachment payload should pass validation and stop at unconfigured SMTP without sending.");
      const config = await fetch(`${base}/email/config`);
      assert.equal(config.status, 200);
      assert.equal("password" in ((await config.json()) as object), false);
    },
  );
});
