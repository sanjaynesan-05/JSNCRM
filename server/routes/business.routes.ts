import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import multer from "multer";
import { z } from "zod";
import { createQuotationPdf } from "../services/quotation-pdf.ts";
import { localDate } from "../services/date.ts";
import { createAsyncRouter } from "../async-router.ts";
import { PostgresDatabase } from "../db/postgres.ts";
import {
  getDatabase,
  removeDatabaseFile,
  restoreDatabase,
  transaction,
} from "../db/database.ts";
import {
  clientSchema,
  orderSchema,
  orderStatusSchema,
  paymentSchema,
  paymentReversalSchema,
  quotationSchema,
  businessProfileSchema,
  taskSchema,
  taskStatusSchema,
} from "../schemas/business.ts";

const router = createAsyncRouter();
const restoreUpload = multer({
  dest: join(
    process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd(),
    "JSN Designs Business Studio",
    "restore-temp",
  ),
  limits: { files: 1, fileSize: 200 * 1024 * 1024 },
});
const now = () => new Date().toISOString();
const today = () => localDate();
const ref = (prefix: string) =>
  `${prefix}-${today().replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
const bad = (res: any, message: string, status = 400) =>
  res.status(status).json({ error: message });
const parsed = <S extends z.ZodType>(
  schema: S,
  body: unknown,
): z.ZodSafeParseResult<z.output<S>> => schema.safeParse(body);

router.get("/dashboard", async (_req, res) => {
  const db = getDatabase();
  const currentDate = today();
  const counts = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM clients WHERE archived_at IS NULL) clients,
    (SELECT COUNT(*) FROM quotations WHERE status IN ('draft','sent')) open_quotations,
    (SELECT COUNT(*) FROM orders WHERE status NOT IN ('closed','cancelled')) active_orders,
    (SELECT COUNT(*) FROM tasks WHERE status IN ('pending','in_progress')) open_tasks,
    (SELECT COUNT(*) FROM invoices WHERE status IN ('draft','issued')) open_invoices,
    (SELECT COUNT(*) FROM invoices WHERE status='issued' AND due_date<? AND total_minor>(SELECT COALESCE(SUM(ip.amount_minor-COALESCE(pr.amount_minor,0)),0) FROM invoice_payments ip LEFT JOIN payment_reversals pr ON pr.invoice_payment_id=ip.id WHERE ip.invoice_id=invoices.id)) overdue_invoices`,
    )
    .get(currentDate);
  const outstanding = await db
    .prepare(
      `SELECT COALESCE(SUM(o.agreed_amount_minor - COALESCE(p.paid,0)),0) amount_minor FROM orders o LEFT JOIN (SELECT p.order_id,SUM(p.amount_minor-COALESCE(r.amount_minor,0)) paid FROM payments p LEFT JOIN payment_reversals r ON r.order_payment_id=p.id GROUP BY p.order_id) p ON p.order_id=o.id WHERE o.status NOT IN ('cancelled','closed')`,
    )
    .get();
  const upcomingTasks = await db
    .prepare(
      `SELECT id,title,due_date,status,priority FROM tasks WHERE status IN ('pending','in_progress') ORDER BY due_date IS NULL,due_date LIMIT 5`,
    )
    .all();
  res.json({
    ...(counts as object),
    outstanding_minor: (outstanding as any).amount_minor,
    upcoming_tasks: upcomingTasks,
  });
});

router.get("/clients", async (req, res) => {
  const query = z.object({ search: z.string().trim().max(200).optional(), status: z.enum(["active", "archived", "all"]).default("active") }).safeParse(req.query);
  if (!query.success) return bad(res, "Invalid client filters.");
  const { search = "", status } = query.data;
  const archived = status === "archived" ? "IS NOT NULL" : "IS NULL";
  const statusClause = status === "all" ? "1=1" : `archived_at ${archived}`;
  const term = `%${search}%`;
  res.json(await getDatabase().prepare(`SELECT * FROM clients WHERE ${statusClause} AND (CAST(? AS TEXT)='' OR name LIKE ? OR COALESCE(company_name,'') LIKE ? OR COALESCE(email,'') LIKE ? OR client_code LIKE ?) ORDER BY created_at DESC`).all(search, term, term, term, term));
});
router.get("/clients/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return bad(res, "Invalid client id.");
  const db = getDatabase();
  const currentDate = today();
  const client = await db.prepare("SELECT * FROM clients WHERE id=?").get(id.data) as any;
  if (!client) return bad(res, "Client not found.", 404);
  const quotations = await db.prepare("SELECT id,quotation_number,title,status,total_minor,currency,issue_date,valid_until FROM quotations WHERE client_id=? ORDER BY created_at DESC").all(id.data);
  const invoices = await db.prepare(`SELECT i.id,i.invoice_number,i.title,i.total_minor,i.currency,i.issue_date,i.due_date,
    CASE WHEN i.status='draft' THEN 'draft' WHEN i.status='void' THEN 'void' WHEN COALESCE(p.paid,0)>=i.total_minor THEN 'paid' WHEN i.due_date<? THEN 'overdue' WHEN COALESCE(p.paid,0)>0 THEN 'partially_paid' ELSE 'issued' END status
    FROM invoices i LEFT JOIN (SELECT ip.invoice_id,SUM(ip.amount_minor-COALESCE(pr.amount_minor,0)) paid FROM invoice_payments ip LEFT JOIN payment_reversals pr ON pr.invoice_payment_id=ip.id GROUP BY ip.invoice_id) p ON p.invoice_id=i.id
    WHERE i.client_id=? ORDER BY i.created_at DESC`).all(currentDate,id.data);
  const orders = await db.prepare(`SELECT o.id,o.order_number,o.title,o.status,o.agreed_amount_minor,o.currency,o.order_date,o.due_date,COALESCE(p.paid,0) paid_minor,o.agreed_amount_minor-COALESCE(p.paid,0) outstanding_minor FROM orders o LEFT JOIN (SELECT p.order_id,SUM(p.amount_minor-COALESCE(r.amount_minor,0)) paid FROM payments p LEFT JOIN payment_reversals r ON r.order_payment_id=p.id GROUP BY p.order_id) p ON p.order_id=o.id WHERE o.client_id=? ORDER BY o.created_at DESC`).all(id.data) as any[];
  const tasks = await db.prepare(`SELECT t.id,t.order_id,o.order_number,t.title,t.status,t.priority,t.due_date,t.completed_at FROM tasks t JOIN orders o ON o.id=t.order_id WHERE o.client_id=? ORDER BY t.due_date IS NULL,t.due_date`).all(id.data);
  const outstanding_minor = orders.filter((o) => !["cancelled", "closed"].includes(o.status)).reduce((sum, o) => sum + o.outstanding_minor, 0);
  res.json({ client, quotations, invoices, orders, tasks, outstanding_minor });
});
router.post("/clients", async (req, res) => {
  const input = parsed(clientSchema, req.body);
  if (!input.success)
    return bad(
      res,
      input.error.issues[0]?.message || "Invalid client details.",
    );
  const db = getDatabase(),
    id = randomUUID(),
    stamp = now();
  try {
    await db.prepare(
      "INSERT INTO clients(id,client_code,name,company_name,email,phone,address,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      ref("CL"),
      input.data.name,
      input.data.company_name || null,
      input.data.email || null,
      input.data.phone || null,
      input.data.address || null,
      input.data.notes || null,
      stamp,
      stamp,
    );
  } catch (e) {
    return bad(
      res,
      e instanceof Error && e.message.includes("UNIQUE")
        ? "Client code collision; retry."
        : "Unable to create client.",
      409,
    );
  }
  res.status(201).json(await db.prepare("SELECT * FROM clients WHERE id=?").get(id));
});
router.put("/clients/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return bad(res, "Invalid client id.");
  const input = parsed(clientSchema, req.body);
  if (!input.success) return bad(res, input.error.issues[0]?.message || "Invalid client details.");
  const db = getDatabase();
  const data = input.data;
  const result = await db.prepare("UPDATE clients SET name=?,company_name=?,email=?,phone=?,address=?,notes=?,updated_at=? WHERE id=?").run(data.name, data.company_name || null, data.email || null, data.phone || null, data.address || null, data.notes || null, now(), id.data);
  if (!result.changes) return bad(res, "Client not found.", 404);
  res.json(await db.prepare("SELECT * FROM clients WHERE id=?").get(id.data));
});
router.patch("/clients/:id/archive", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return bad(res, "Invalid client id.");
  const stamp = now();
  const info = await getDatabase()
    .prepare(
      "UPDATE clients SET archived_at=?,updated_at=? WHERE id=? AND archived_at IS NULL",
    )
    .run(stamp, stamp, id.data);
  return info.changes
    ? res.json({ ok: true })
    : bad(res, "Client not found.", 404);
});
router.patch("/clients/:id/restore", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return bad(res, "Invalid client id.");
  const stamp = now();
  const info = await getDatabase().prepare("UPDATE clients SET archived_at=NULL,updated_at=? WHERE id=? AND archived_at IS NOT NULL").run(stamp, id.data);
  return info.changes ? res.json({ ok: true }) : bad(res, "Archived client not found.", 404);
});

router.get("/quotations", async (req, res) => {
  const query = z.object({ status: z.enum(["draft", "sent", "accepted", "rejected", "expired", "cancelled"]).optional(), from: z.string().date().optional(), to: z.string().date().optional(), search: z.string().trim().max(200).optional() }).safeParse(req.query);
  if (!query.success) return bad(res, "Invalid quotation filters.");
  const { status, from, to, search = "" } = query.data;
  res.json(await getDatabase().prepare(`SELECT q.*,c.name client_name,o.id converted_order_id,o.order_number converted_order_number,i.id converted_invoice_id,i.invoice_number converted_invoice_number FROM quotations q JOIN clients c ON c.id=q.client_id LEFT JOIN orders o ON o.quotation_id=q.id LEFT JOIN invoices i ON i.source_quotation_id=q.id AND i.status <> 'void' WHERE (CAST(? AS TEXT) IS NULL OR q.status=?) AND (CAST(? AS TEXT) IS NULL OR q.issue_date>=?) AND (CAST(? AS TEXT) IS NULL OR q.issue_date<=?) AND (CAST(? AS TEXT)='' OR q.quotation_number LIKE ? OR c.name LIKE ? OR q.title LIKE ? OR COALESCE(q.description,'') LIKE ?) ORDER BY q.created_at DESC`).all(status ?? null,status ?? null,from ?? null,from ?? null,to ?? null,to ?? null,search,`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`));
});
router.post("/quotations", async (req, res) => {
  const input = parsed(quotationSchema, req.body);
  if (!input.success)
    return bad(res, input.error.issues[0]?.message || "Invalid quotation.");
  const db = getDatabase(),
    d = input.data,
    id = randomUUID(),
    stamp = now();
  const itemTotals = d.items.map((i) =>
    Math.round(i.quantity * i.unit_price_minor),
  );
  if (itemTotals.some((n) => !Number.isSafeInteger(n)))
    return bad(res, "Line item amount is too large.");
  const subtotal = itemTotals.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(subtotal))
    return bad(res, "Quotation amount is too large.");
  const discount =
    d.discount_type === "percentage"
      ? Math.round((subtotal * d.discount_value) / 100)
      : d.discount_type === "fixed"
        ? Math.round(d.discount_value * 100)
        : 0;
  if (d.discount_type === "fixed" && discount > subtotal)
    return bad(res, "Fixed discount cannot exceed the subtotal.");
  const total = subtotal - discount;
  if (
    !Number.isSafeInteger(discount) ||
    !Number.isSafeInteger(total) ||
    total < 0
  )
    return bad(res, "Quotation amount is invalid.");
  try {
    await transaction(db, async () => {
      if (
        !await db
          .prepare("SELECT 1 FROM clients WHERE id=? AND archived_at IS NULL")
          .get(d.client_id)
      )
        throw new Error("CLIENT_NOT_FOUND");
      await db.prepare(
        `INSERT INTO quotations(id,quotation_number,client_id,title,description,subtotal_minor,discount_type,discount_value,discount_minor,total_minor,issue_date,valid_until,terms,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        id,
        ref("QT"),
        d.client_id,
        d.title,
        d.description || null,
        subtotal,
        d.discount_type,
        d.discount_value,
        discount,
        total,
        d.issue_date || today(),
        d.valid_until || null,
        d.terms || null,
        d.notes || null,
        stamp,
        stamp,
      );
      const insert = db.prepare(
        "INSERT INTO quotation_items(id,quotation_id,description,quantity,unit_price_minor,line_total_minor,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      );
      for (const [index, item] of d.items.entries())
        await insert.run(
          randomUUID(),
          id,
          item.description,
          item.quantity,
          item.unit_price_minor,
          itemTotals[index],
          index,
          stamp,
          stamp,
        );
      await db.prepare("INSERT INTO quotation_status_history(id,quotation_id,previous_status,new_status,changed_at,metadata) VALUES(?,?,?,?,?,?)").run(randomUUID(), id, null, "draft", stamp, null);
    })();
  } catch (e) {
    return bad(
      res,
      e instanceof Error && e.message === "CLIENT_NOT_FOUND"
        ? "Client not found."
        : "Unable to save quotation.",
      e instanceof Error && e.message === "CLIENT_NOT_FOUND" ? 404 : 500,
    );
  }
  res.status(201).json({
    ...(await db.prepare("SELECT * FROM quotations WHERE id=?").get(id) as object),
    items: await db
      .prepare(
        "SELECT * FROM quotation_items WHERE quotation_id=? ORDER BY sort_order",
      )
      .all(id),
  });
});
router.put("/quotations/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const input = parsed(quotationSchema, req.body);
  if (!id.success) return bad(res, "Invalid quotation id.");
  if (!input.success)
    return bad(res, input.error.issues[0]?.message || "Invalid quotation.");
  const db = getDatabase();
  const existing = await db
    .prepare("SELECT status FROM quotations WHERE id=?")
    .get(id.data) as { status: string } | undefined;
  if (!existing) return bad(res, "Quotation not found.", 404);
  if (existing.status !== "draft") return bad(res, "Only draft quotations can be edited. Duplicate this quotation to make a new draft.", 409);
  if (await db.prepare("SELECT 1 FROM orders WHERE quotation_id=?").get(id.data))
    return bad(
      res,
      "A quotation converted to an order can no longer be edited.",
      409,
    );
  const d = input.data;
  const itemTotals = d.items.map((item) =>
    Math.round(item.quantity * item.unit_price_minor),
  );
  if (itemTotals.some((amount) => !Number.isSafeInteger(amount)))
    return bad(res, "Line item amount is too large.");
  const subtotal = itemTotals.reduce((sum, amount) => sum + amount, 0);
  if (!Number.isSafeInteger(subtotal))
    return bad(res, "Quotation amount is too large.");
  const discount =
    d.discount_type === "percentage"
      ? Math.round((subtotal * d.discount_value) / 100)
      : d.discount_type === "fixed"
        ? Math.round(d.discount_value * 100)
        : 0;
  if (d.discount_type === "fixed" && discount > subtotal)
    return bad(res, "Fixed discount cannot exceed the subtotal.");
  const total = subtotal - discount;
  if (![discount, total].every(Number.isSafeInteger) || total < 0)
    return bad(res, "Quotation amount is invalid.");
  const stamp = now();
  try {
    await transaction(db, async () => {
      if (
        !await db
          .prepare("SELECT 1 FROM clients WHERE id=? AND archived_at IS NULL")
          .get(d.client_id)
      )
        throw new Error("CLIENT_NOT_FOUND");
      await db.prepare(
        `UPDATE quotations SET client_id=?,title=?,description=?,subtotal_minor=?,discount_type=?,discount_value=?,discount_minor=?,total_minor=?,issue_date=?,valid_until=?,terms=?,notes=?,updated_at=? WHERE id=?`,
      ).run(
        d.client_id,
        d.title,
        d.description || null,
        subtotal,
        d.discount_type,
        d.discount_value,
        discount,
        total,
        d.issue_date || today(),
        d.valid_until || null,
        d.terms || null,
        d.notes || null,
        stamp,
        id.data,
      );
      await db.prepare("DELETE FROM quotation_items WHERE quotation_id=?").run(
        id.data,
      );
      const insert = db.prepare(
        "INSERT INTO quotation_items(id,quotation_id,description,quantity,unit_price_minor,line_total_minor,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      );
      for (const [index, item] of d.items.entries())
        await insert.run(
          randomUUID(),
          id.data,
          item.description,
          item.quantity,
          item.unit_price_minor,
          itemTotals[index],
          index,
          stamp,
          stamp,
        );
    })();
  } catch (error) {
    return bad(
      res,
      error instanceof Error && error.message === "CLIENT_NOT_FOUND"
        ? "Client not found."
        : "Unable to update quotation.",
      error instanceof Error && error.message === "CLIENT_NOT_FOUND"
        ? 404
        : 500,
    );
  }
  return res.json({
    ...(await db
      .prepare("SELECT * FROM quotations WHERE id=?")
      .get(id.data) as object),
    items: await db
      .prepare(
        "SELECT * FROM quotation_items WHERE quotation_id=? ORDER BY sort_order",
      )
      .all(id.data),
  });
});
router.get("/quotations/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return bad(res, "Invalid quotation id.");
  const q = await getDatabase()
    .prepare(
      "SELECT q.*,c.name client_name,o.id converted_order_id,o.order_number converted_order_number,i.id converted_invoice_id,i.invoice_number converted_invoice_number FROM quotations q JOIN clients c ON c.id=q.client_id LEFT JOIN orders o ON o.quotation_id=q.id LEFT JOIN invoices i ON i.source_quotation_id=q.id AND i.status <> 'void' WHERE q.id=?",
    )
    .get(id.data);
  if (!q) return bad(res, "Quotation not found.", 404);
  res.json({
    ...(q as object),
    items: await getDatabase()
      .prepare(
        "SELECT * FROM quotation_items WHERE quotation_id=? ORDER BY sort_order",
      )
      .all(id.data),
    status_history: await getDatabase().prepare("SELECT previous_status,new_status,changed_at,metadata FROM quotation_status_history WHERE quotation_id=? ORDER BY changed_at").all(id.data),
  });
});
router.delete("/quotations/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return bad(res, "Invalid quotation id.");
  const db = getDatabase();
  try {
    await transaction(db, async () => {
      const quotation = await db.prepare("SELECT id FROM quotations WHERE id=?").get(id.data);
      if (!quotation) throw new Error("NOT_FOUND");
      if (await db.prepare("SELECT 1 FROM orders WHERE quotation_id=?").get(id.data) ||
          await db.prepare("SELECT 1 FROM invoices WHERE source_quotation_id=?").get(id.data)) {
        throw new Error("LINKED_RECORD");
      }
      await db.prepare("DELETE FROM quotation_status_history WHERE quotation_id=?").run(id.data);
      await db.prepare("DELETE FROM quotation_items WHERE quotation_id=?").run(id.data);
      await db.prepare("DELETE FROM quotations WHERE id=?").run(id.data);
    })();
    return res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return bad(
      res,
      message === "NOT_FOUND"
        ? "Quotation not found."
        : message === "LINKED_RECORD"
          ? "This quotation cannot be deleted because it is linked to an order or invoice."
          : "Unable to delete quotation.",
      message === "NOT_FOUND" ? 404 : message === "LINKED_RECORD" ? 409 : 500,
    );
  }
});
router.get("/quotations/:id/pdf", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return bad(res, "Invalid quotation id.");
  const db = getDatabase();
  const quotation = await db.prepare(`SELECT q.*, c.name client_name, c.company_name, c.email client_email, c.phone client_phone, c.address client_address,
    COALESCE(p.business_name,'') business_name, COALESCE(p.contact_person,'') contact_person, COALESCE(p.email,'') email,
    COALESCE(p.phone,'') phone, COALESCE(p.address,'') address, COALESCE(p.website,'') website
    FROM quotations q JOIN clients c ON c.id=q.client_id LEFT JOIN business_profile p ON p.id=1 WHERE q.id=?`).get(id.data) as any;
  if (!quotation) return bad(res, "Quotation not found.", 404);
  const items = await db.prepare("SELECT description,quantity,unit_price_minor,line_total_minor FROM quotation_items WHERE quotation_id=? ORDER BY sort_order").all(id.data) as any[];
  const filename = `quotation_${quotation.quotation_number.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
  res.status(200);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  try {
    createQuotationPdf(quotation, items, res, () => { if (!res.headersSent) bad(res, "Unable to generate quotation PDF.", 500); else res.destroy(); });
  } catch {
    return bad(res, "Unable to generate quotation PDF.", 500);
  }
});
router.patch("/quotations/:id/status", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id),
    body = z
      .object({
        status: z.enum([
          "draft",
          "sent",
          "accepted",
          "rejected",
          "expired",
          "cancelled",
        ]),
      })
      .safeParse(req.body);
  if (!id.success || !body.success)
    return bad(res, "Invalid quotation status request.");
  const db = getDatabase();
  if (
    await db
      .prepare("SELECT 1 FROM orders WHERE quotation_id=?")
      .get(id.data)
  )
    return bad(
      res,
      "A quotation converted to an order can no longer change status.",
      409,
    );
  const transitions: Record<string, string[]> = { draft: ["sent", "cancelled"], sent: ["accepted", "rejected", "expired", "cancelled"] };
  try {
    const changed = await transaction(db, async () => {
      const current = await db.prepare("SELECT status FROM quotations WHERE id=?").get(id.data) as { status: string } | undefined;
      if (!current) throw new Error("NOT_FOUND");
      if (!transitions[current.status]?.includes(body.data.status)) throw new Error("INVALID_TRANSITION");
      const stamp = now();
      await db.prepare("UPDATE quotations SET status=?,updated_at=? WHERE id=?").run(body.data.status, stamp, id.data);
      await db.prepare("INSERT INTO quotation_status_history(id,quotation_id,previous_status,new_status,changed_at,metadata) VALUES(?,?,?,?,?,?)").run(randomUUID(), id.data, current.status, body.data.status, stamp, null);
      return { previous_status: current.status };
    })();
    return res.json({ ok: true, status: body.data.status, ...changed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return bad(res, message === "NOT_FOUND" ? "Quotation not found." : "That quotation status transition is not allowed.", message === "NOT_FOUND" ? 404 : 409);
  }
});

router.post("/quotations/:id/duplicate", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return bad(res, "Invalid quotation id.");
  const db = getDatabase(), newId = randomUUID(), stamp = now();
  try {
    await transaction(db, async () => {
      const source = await db.prepare("SELECT * FROM quotations WHERE id=?").get(id.data) as any;
      if (!source) throw new Error("NOT_FOUND");
      await db.prepare("INSERT INTO quotations(id,quotation_number,client_id,title,description,currency,subtotal_minor,discount_type,discount_value,discount_minor,tax_minor,total_minor,status,issue_date,valid_until,terms,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(newId,ref("QT"),source.client_id,source.title,source.description,source.currency,source.subtotal_minor,source.discount_type,source.discount_value,source.discount_minor,source.tax_minor,source.total_minor,"draft",today(),source.valid_until,source.terms,source.notes,stamp,stamp);
      const items = await db.prepare("SELECT * FROM quotation_items WHERE quotation_id=? ORDER BY sort_order").all(id.data) as any[];
      const insert = db.prepare("INSERT INTO quotation_items(id,quotation_id,description,quantity,unit_price_minor,line_total_minor,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)");
      for (const item of items) await insert.run(randomUUID(),newId,item.description,item.quantity,item.unit_price_minor,item.line_total_minor,item.sort_order,stamp,stamp);
      await db.prepare("INSERT INTO quotation_status_history(id,quotation_id,previous_status,new_status,changed_at,metadata) VALUES(?,?,?,?,?,?)").run(randomUUID(),newId,null,"draft",stamp,JSON.stringify({ duplicated_from: id.data }));
    })();
  } catch (error) { return bad(res, error instanceof Error && error.message === "NOT_FOUND" ? "Quotation not found." : "Unable to duplicate quotation.", error instanceof Error && error.message === "NOT_FOUND" ? 404 : 500); }
  return res.status(201).json(await db.prepare("SELECT * FROM quotations WHERE id=?").get(newId));
});

router.get("/business-profile", async (_req,res) => res.json(await getDatabase().prepare("SELECT * FROM business_profile WHERE id=1").get()));
router.put("/business-profile", async (req,res) => {
  const input = businessProfileSchema.safeParse(req.body);
  if (!input.success) return bad(res,input.error.issues[0]?.message || "Invalid business profile.");
  const d = input.data;
  await getDatabase().prepare("UPDATE business_profile SET business_name=?,contact_person=?,email=?,phone=?,address=?,website=?,default_terms=?,default_validity_days=?,currency='INR',updated_at=? WHERE id=1").run(d.business_name,d.contact_person,d.email,d.phone,d.address,d.website,d.default_terms,d.default_validity_days,now());
  return res.json(await getDatabase().prepare("SELECT * FROM business_profile WHERE id=1").get());
});
router.post("/quotations/:id/convert", async (req, res) => {
  const db = getDatabase(),
    id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return bad(res, "Invalid quotation id.");
  const options = z
    .object({ confirm_unaccepted: z.boolean().optional() })
    .safeParse(req.body ?? {});
  if (!options.success)
    return bad(res, "Invalid quotation conversion options.");
  try {
    const order = await transaction(db, async () => {
      const q = await db
        .prepare("SELECT * FROM quotations WHERE id=?")
        .get(id.data) as any;
      if (!q) throw new Error("NOT_FOUND");
      const existing = await db
        .prepare("SELECT * FROM orders WHERE quotation_id=?")
        .get(id.data);
      if (existing) return existing;
      if (q.status !== "accepted" && options.data.confirm_unaccepted !== true)
        throw new Error("NOT_ACCEPTED");
      const stamp = now(),
        orderId = randomUUID();
      await db.prepare(
        `INSERT INTO orders(id,order_number,client_id,quotation_id,title,description,agreed_amount_minor,currency,order_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        orderId,
        ref("OR"),
        q.client_id,
        q.id,
        q.title,
        q.description,
        q.total_minor,
        q.currency,
        today(),
        stamp,
        stamp,
      );
      await db.prepare("INSERT INTO order_status_history(id,order_id,previous_status,new_status,changed_at,metadata) VALUES(?,?,NULL,'new',?,?)").run(randomUUID(),orderId,stamp,JSON.stringify({source:"quotation-conversion"}));
      return await db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
    })();
    res.status(201).json(order);
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    return bad(
      res,
      message === "NOT_FOUND"
        ? "Quotation not found."
        : message === "NOT_ACCEPTED"
          ? "Only accepted quotations can be converted."
          : "Unable to convert quotation.",
      message === "NOT_FOUND" ? 404 : message === "NOT_ACCEPTED" ? 409 : 500,
    );
  }
});

router.get("/orders", async (_req, res) => {
  const db=getDatabase();
  const rows=await db.prepare(`SELECT o.*,c.name client_name,COALESCE(p.paid,0) paid_minor,o.agreed_amount_minor-COALESCE(p.paid,0) outstanding_minor FROM orders o JOIN clients c ON c.id=o.client_id LEFT JOIN (SELECT p.order_id,SUM(p.amount_minor-COALESCE(r.amount_minor,0)) paid FROM payments p LEFT JOIN payment_reversals r ON r.order_payment_id=p.id GROUP BY p.order_id) p ON p.order_id=o.id ORDER BY o.created_at DESC`).all() as any[];
  res.json(await Promise.all(rows.map(async row=>({...row,status_history:await db.prepare("SELECT previous_status,new_status,changed_at,metadata FROM order_status_history WHERE order_id=? ORDER BY changed_at,id").all(row.id)}))));
});
router.post("/orders", async (req, res) => {
  const input = parsed(orderSchema, req.body);
  if (!input.success)
    return bad(res, input.error.issues[0]?.message || "Invalid order.");
  const d = input.data,
    db = getDatabase(),
    id = randomUUID(),
    stamp = now();
  if (
    !await db
      .prepare("SELECT 1 FROM clients WHERE id=? AND archived_at IS NULL")
      .get(d.client_id)
  )
    return bad(res, "Client not found.", 404);
  await transaction(db, async ()=>{
    await db.prepare(
      `INSERT INTO orders(id,order_number,client_id,title,description,requirements,agreed_amount_minor,priority,order_date,due_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      ref("OR"),
      d.client_id,
      d.title,
      d.description || null,
      d.requirements,
      d.agreed_amount_minor,
      d.priority,
      d.order_date || today(),
      d.due_date || null,
      stamp,
      stamp,
    );
    await db.prepare("INSERT INTO order_status_history(id,order_id,previous_status,new_status,changed_at,metadata) VALUES(?,?,NULL,'new',?,?)").run(randomUUID(),id,stamp,JSON.stringify({source:"order-creation"}));
  })();
  res.status(201).json(await db.prepare("SELECT * FROM orders WHERE id=?").get(id));
});
router.patch("/orders/:id/status", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id),
    input = parsed(orderStatusSchema, req.body);
  if (!id.success || !input.success)
    return bad(res, "Invalid order status request.");
  const db=getDatabase(),stamp=now(),delivered=input.data.status === "delivered" ? stamp : null;
  try {
    const changed=await transaction(db, async ()=>{
      const current=await db.prepare("SELECT status FROM orders WHERE id=?").get(id.data) as {status:string}|undefined;
      if(!current)return false;
      if(current.status===input.data.status)return true;
      await db.prepare("UPDATE orders SET status=?,delivered_at=COALESCE(?,delivered_at),updated_at=? WHERE id=?").run(input.data.status,delivered,stamp,id.data);
      await db.prepare("INSERT INTO order_status_history(id,order_id,previous_status,new_status,changed_at,metadata) VALUES(?,?,?,?,?,NULL)").run(randomUUID(),id.data,current.status,input.data.status,stamp);
      return true;
    })();
    return changed?res.json({ok:true}):bad(res,"Order not found.",404);
  } catch { return bad(res,"Unable to update order status.",500); }
});
router.post("/orders/:id/payments", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id),
    input = parsed(paymentSchema, req.body);
  if (!id.success || !input.success)
    return bad(
      res,
      input.success
        ? "Invalid order id."
        : input.error.issues[0]?.message || "Invalid payment.",
    );
  const db = getDatabase(),
    order = await db
      .prepare("SELECT agreed_amount_minor,currency FROM orders WHERE id=?")
      .get(id.data) as any;
  if (!order) return bad(res, "Order not found.", 404);
  const paid = (await db.prepare("SELECT COALESCE(SUM(p.amount_minor-COALESCE(r.amount_minor,0)),0) total FROM payments p LEFT JOIN payment_reversals r ON r.order_payment_id=p.id WHERE p.order_id=?").get(id.data) as any).total;
  if (paid + input.data.amount_minor > order.agreed_amount_minor) return bad(res, "Payment exceeds the outstanding balance.");
  const d = input.data,
    stamp = now(),
    pid = randomUUID();
  try {
    await transaction(db, async () => {
      const currentPaid=(await db.prepare("SELECT COALESCE(SUM(p.amount_minor-COALESCE(r.amount_minor,0)),0) total FROM payments p LEFT JOIN payment_reversals r ON r.order_payment_id=p.id WHERE p.order_id=?").get(id.data) as any).total;
      if (currentPaid + d.amount_minor > order.agreed_amount_minor) throw new Error("ORDER_EXCESS");
      const paymentDate=d.payment_date||today(), idempotencyKey=d.idempotency_key||randomUUID();
      if (await db.prepare("SELECT 1 FROM payments WHERE idempotency_key=?").get(idempotencyKey)) throw new Error("DUPLICATE");
      if (d.reference ? await db.prepare("SELECT 1 FROM payments WHERE order_id=? AND lower(trim(reference))=lower(trim(?))").get(id.data,d.reference) : await db.prepare("SELECT 1 FROM payments WHERE order_id=? AND amount_minor=? AND payment_date=? AND COALESCE(payment_method,'')=COALESCE(?,'')").get(id.data,d.amount_minor,paymentDate,d.payment_method||null)) throw new Error("DUPLICATE");
      const invoice = await db.prepare("SELECT id,status,total_minor FROM invoices WHERE source_order_id=? AND status<>'void' ORDER BY created_at DESC LIMIT 1").get(id.data) as any;
      if (invoice) {
        if (invoice.status !== "issued") throw new Error("INVOICE_NOT_ISSUED");
        const invoicePaid=(await db.prepare("SELECT COALESCE(SUM(ip.amount_minor-COALESCE(r.amount_minor,0)),0) total FROM invoice_payments ip LEFT JOIN payment_reversals r ON r.invoice_payment_id=ip.id WHERE ip.invoice_id=?").get(invoice.id) as any).total;
        if (invoicePaid + d.amount_minor > invoice.total_minor) throw new Error("INVOICE_EXCESS");
      }
      await db.prepare("INSERT INTO payments(id,order_id,amount_minor,currency,payment_date,payment_method,reference,notes,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(pid,id.data,d.amount_minor,order.currency,paymentDate,d.payment_method||null,d.reference||null,d.notes||null,idempotencyKey,stamp,stamp);
      if (invoice) await db.prepare("INSERT INTO invoice_payments(id,invoice_id,order_payment_id,amount_minor,payment_date,payment_method,reference,notes,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(randomUUID(),invoice.id,pid,d.amount_minor,paymentDate,d.payment_method||null,d.reference||null,d.notes||null,idempotencyKey,stamp);
    })();
  } catch (error) {
    const message=error instanceof Error?error.message:"";
    return bad(res,message==="DUPLICATE"?"A payment with this reference and amount already exists.":message==="INVOICE_NOT_ISSUED"?"Issue or void the linked invoice before recording order payments.":message==="INVOICE_EXCESS"?"Payment exceeds the linked invoice balance.":message==="ORDER_EXCESS"?"Payment exceeds the remaining order balance.":"Unable to record payment.",message==="DUPLICATE"||message==="INVOICE_NOT_ISSUED"||message==="INVOICE_EXCESS"||message==="ORDER_EXCESS"?409:500);
  }
  const finalPaid=(await db.prepare("SELECT COALESCE(SUM(p.amount_minor-COALESCE(r.amount_minor,0)),0) total FROM payments p LEFT JOIN payment_reversals r ON r.order_payment_id=p.id WHERE p.order_id=?").get(id.data) as any).total;
  res.status(201).json({id:pid,paid_minor:finalPaid,outstanding_minor:order.agreed_amount_minor-finalPaid});
});
router.get("/orders/:id/payments", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return bad(res, "Invalid order id.");
  return res.json(
    await getDatabase()
      .prepare(
        "SELECT p.*,r.reason reversal_reason,r.reversed_at FROM payments p LEFT JOIN payment_reversals r ON r.order_payment_id=p.id WHERE p.order_id=? ORDER BY p.payment_date DESC,p.created_at DESC",
      )
      .all(id.data),
  );
});
router.post("/orders/:id/payments/:paymentId/reverse", (req,res)=>reverseOrderPayment(req,res));
async function reverseOrderPayment(req:any,res:any){
  const id=z.string().uuid().safeParse(req.params.id),paymentId=z.string().uuid().safeParse(req.params.paymentId),input=paymentReversalSchema.safeParse(req.body);
  if(!id.success||!paymentId.success||!input.success)return bad(res,input.success?"Invalid payment reversal request.":input.error.issues[0]?.message||"Invalid payment reversal.");
  const db=getDatabase(),stamp=now();
  try{await transaction(db, async ()=>{
    const payment=await db.prepare("SELECT * FROM payments WHERE id=? AND order_id=?").get(paymentId.data,id.data) as any;
    if(!payment)throw new Error("NOT_FOUND");
    if(await db.prepare("SELECT 1 FROM payment_reversals WHERE order_payment_id=?").get(payment.id))throw new Error("REVERSED");
    const invoicePayment=await db.prepare("SELECT ip.id,ip.invoice_id,i.status FROM invoice_payments ip JOIN invoices i ON i.id=ip.invoice_id WHERE ip.order_payment_id=?").get(payment.id) as any;
    if(invoicePayment?.status==="void")throw new Error("VOID_INVOICE");
    await db.prepare("INSERT INTO payment_reversals(id,order_payment_id,invoice_payment_id,amount_minor,reason,reversed_at,created_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(),payment.id,invoicePayment?.id||null,payment.amount_minor,input.data.reason,stamp,stamp);
  })();return res.json({ok:true});}catch(error){const message=error instanceof Error?error.message:"";return bad(res,message==="NOT_FOUND"?"Payment not found.":message==="REVERSED"?"This payment has already been reversed.":message==="VOID_INVOICE"?"A payment allocated to a void invoice cannot be reversed here.":"Unable to reverse payment.",message==="NOT_FOUND"?404:message==="REVERSED"||message==="VOID_INVOICE"?409:500);}
}
router.get("/tasks", async (_req, res) => {
  const db=getDatabase();
  const rows=await db.prepare("SELECT t.*,o.order_number FROM tasks t LEFT JOIN orders o ON o.id=t.order_id ORDER BY t.due_date IS NULL,t.due_date,t.created_at DESC").all() as any[];
  res.json(await Promise.all(rows.map(async row=>({...row,status_history:await db.prepare("SELECT previous_status,new_status,changed_at,metadata FROM task_status_history WHERE task_id=? ORDER BY changed_at,id").all(row.id)}))));
});
router.post("/tasks", async (req, res) => {
  const input = parsed(taskSchema, req.body);
  if (!input.success)
    return bad(res, input.error.issues[0]?.message || "Invalid task.");
  const d = input.data,
    db = getDatabase();
  if (
    d.order_id &&
    !await db.prepare("SELECT 1 FROM orders WHERE id=?").get(d.order_id)
  )
    return bad(res, "Order not found.", 404);
  const id = randomUUID(),
    stamp = now();
  await transaction(db, async ()=>{
    await db.prepare(
      "INSERT INTO tasks(id,order_id,title,description,status,priority,due_date,completed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      d.order_id || null,
      d.title,
      d.description || null,
      d.status,
      d.priority,
      d.due_date || null,
      d.status === "completed" ? stamp : null,
      stamp,
      stamp,
    );
    await db.prepare("INSERT INTO task_status_history(id,task_id,previous_status,new_status,changed_at,metadata) VALUES(?,?,NULL,?,?,?)").run(randomUUID(),id,d.status,stamp,JSON.stringify({source:"task-creation"}));
  })();
  res.status(201).json(await db.prepare("SELECT * FROM tasks WHERE id=?").get(id));
});
router.patch("/tasks/:id/status", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id),
    input = parsed(taskStatusSchema, req.body);
  if (!id.success || !input.success)
    return bad(res, "Invalid task status request.");
  const db=getDatabase(),stamp=now(),completed=input.data.status === "completed" ? stamp : null;
  try{
    const changed=await transaction(db, async ()=>{
      const current=await db.prepare("SELECT status FROM tasks WHERE id=?").get(id.data) as {status:string}|undefined;
      if(!current)return false;
      if(current.status===input.data.status)return true;
      await db.prepare("UPDATE tasks SET status=?,completed_at=?,updated_at=? WHERE id=?").run(input.data.status,completed,stamp,id.data);
      await db.prepare("INSERT INTO task_status_history(id,task_id,previous_status,new_status,changed_at,metadata) VALUES(?,?,?,?,?,NULL)").run(randomUUID(),id.data,current.status,input.data.status,stamp);
      return true;
    })();return changed?res.json({ok:true}):bad(res,"Task not found.",404);
  }catch{return bad(res,"Unable to update task status.",500);}
});

router.get("/backup", async (_req, res) => {
  try {
    const db = getDatabase();
    if (db instanceof PostgresDatabase) {
      const snapshot = await db.exportSnapshot();
      const target = join(process.env.TMPDIR || process.env.TEMP || process.cwd(), `jsn-business-${Date.now()}.json`);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(target, JSON.stringify(snapshot), { mode: 0o600 });
      return res.download(target, "jsn-business-postgres.json", () => removeDatabaseFile(target));
    }
    const dir =
      process.env.BACKUP_DIR ||
      join(
        process.env.LOCALAPPDATA || process.env.APPDATA || process.cwd(),
        "JSN Designs Business Studio",
        "backups",
      );
    mkdirSync(dir, { recursive: true });
    const target = join(
      dir,
      `jsn-business-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`,
    );
    await db.backup(target);
    res.download(target);
  } catch {
    return bad(res, "Unable to create database backup.", 500);
  }
});
router.post("/restore", restoreUpload.single("backup"), async (req, res) => {
  if (!req.file) return bad(res, "Choose a SQLite backup file.");
  try {
    const db = getDatabase();
    if (db instanceof PostgresDatabase) {
      const { readFileSync } = await import("node:fs");
      await db.restoreSnapshot(JSON.parse(readFileSync(req.file.path, "utf8")));
    } else {
      restoreDatabase(req.file.path);
    }
    return res.json({ ok: true });
  } catch {
    return bad(
      res,
      "Backup validation failed or restore could not complete. The current database was preserved.",
      400,
    );
  } finally {
    if (req.file) removeDatabaseFile(req.file.path);
  }
});
export default router;
