import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "../db/database.ts";
import { invoicePaymentSchema, invoiceSchema, invoiceStatusSchema, paymentReversalSchema } from "../schemas/business.ts";
import { createInvoicePdf } from "../services/invoice-pdf.ts";
import { localDate } from "../services/date.ts";

const router = Router();
const now = () => new Date().toISOString();
const today = () => localDate();
const invalid = (res: any, message: string, status = 400) => res.status(status).json({ error: message });
const idSchema = z.string().uuid();
const computedStatus = (invoice: any, paid: number) => {
  if (invoice.status === "draft" || invoice.status === "void") return invoice.status;
  if (paid >= invoice.total_minor) return "paid";
  if (invoice.due_date && invoice.due_date < today()) return "overdue";
  if (paid > 0) return "partially_paid";
  return "issued";
};
function detail(db: ReturnType<typeof getDatabase>, id: string) {
  const row = db.prepare(`SELECT i.*,c.name client_name,c.company_name,c.email client_email,c.phone client_phone,c.address client_address,
    (SELECT COALESCE(SUM(ip.amount_minor-COALESCE(r.amount_minor,0)),0) FROM invoice_payments ip LEFT JOIN payment_reversals r ON r.invoice_payment_id=ip.id WHERE ip.invoice_id=i.id) paid_minor,
    COALESCE(p.business_name,'') business_name,COALESCE(p.contact_person,'') contact_person,
    COALESCE(p.email,'') business_email,COALESCE(p.phone,'') business_phone,COALESCE(p.address,'') business_address,COALESCE(p.website,'') business_website
    FROM invoices i JOIN clients c ON c.id=i.client_id LEFT JOIN business_profile p ON p.id=1 WHERE i.id=?`).get(id) as any;
  if (!row) return null;
  const clientSnapshot = row.client_snapshot ? JSON.parse(row.client_snapshot) : null;
  if (clientSnapshot) {
    row.client_name = clientSnapshot.name;
    row.company_name = clientSnapshot.company_name;
    row.client_email = clientSnapshot.email;
    row.client_phone = clientSnapshot.phone;
    row.client_address = clientSnapshot.address;
  }
  const businessSnapshot = row.business_snapshot ? JSON.parse(row.business_snapshot) : null;
  if (businessSnapshot) {
    row.business_name = businessSnapshot.business_name;
    row.contact_person = businessSnapshot.contact_person;
    row.business_email = businessSnapshot.email;
    row.business_phone = businessSnapshot.phone;
    row.business_address = businessSnapshot.address;
    row.business_website = businessSnapshot.website;
  }
  const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY sort_order").all(id) as any[];
  const payments = db.prepare("SELECT ip.*,pr.reason reversal_reason,pr.reversed_at FROM invoice_payments ip LEFT JOIN payment_reversals pr ON pr.invoice_payment_id=ip.id WHERE ip.invoice_id=? ORDER BY ip.payment_date DESC,ip.created_at DESC").all(id) as any[];
  const history = db.prepare("SELECT previous_status,new_status,changed_at,metadata FROM invoice_status_history WHERE invoice_id=? ORDER BY changed_at").all(id);
  const status = computedStatus(row, row.paid_minor);
  return { ...row, items, payments, status, balance_minor: Math.max(0, row.total_minor - row.paid_minor), history };
}
function nextNumber(db: ReturnType<typeof getDatabase>, year: string) {
  db.prepare("INSERT INTO invoice_number_sequences(year,last_number) VALUES(?,0) ON CONFLICT(year) DO NOTHING").run(year);
  db.prepare("UPDATE invoice_number_sequences SET last_number=last_number+1 WHERE year=?").run(year);
  const n = (db.prepare("SELECT last_number FROM invoice_number_sequences WHERE year=?").get(year) as any).last_number;
  return `INV-${year}-${String(n).padStart(4, "0")}`;
}
function saveItems(db: ReturnType<typeof getDatabase>, invoiceId: string, items: any[]) {
  const totals = items.map((item) => Math.round(item.quantity * item.unit_price_minor) - item.discount_minor);
  if (totals.some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error("INVALID_TOTAL");
  const subtotal = totals.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(subtotal)) throw new Error("INVALID_TOTAL");
  const insert = db.prepare("INSERT INTO invoice_items(id,invoice_id,description,quantity,unit_price_minor,discount_minor,line_total_minor,sort_order) VALUES(?,?,?,?,?,?,?,?)");
  items.forEach((item, index) => insert.run(randomUUID(), invoiceId, item.description, item.quantity, item.unit_price_minor, item.discount_minor, totals[index], index));
  return subtotal;
}
function itemSubtotal(items: any[]) {
  const totals = items.map((item) => Math.round(item.quantity * item.unit_price_minor) - item.discount_minor);
  if (totals.some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error("INVALID_TOTAL");
  const subtotal = totals.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(subtotal)) throw new Error("INVALID_TOTAL");
  return subtotal;
}
router.get("/", (req, res) => {
  const filters = z.object({ search: z.string().trim().max(200).optional(), status: z.enum(["draft","issued","partially_paid","paid","overdue","void"]).optional(), date_field: z.enum(["issue","due"]).default("issue"), from: z.string().date().optional(), to: z.string().date().optional() }).safeParse(req.query);
  if (!filters.success) return invalid(res, "Invalid invoice filters.");
  const db = getDatabase();
  const dateField=filters.data.date_field==="due"?"i.due_date":"i.issue_date";
  const rows = db.prepare(`SELECT i.*,c.name client_name,
    (SELECT COALESCE(SUM(ip.amount_minor-COALESCE(r.amount_minor,0)),0) FROM invoice_payments ip LEFT JOIN payment_reversals r ON r.invoice_payment_id=ip.id WHERE ip.invoice_id=i.id) paid_minor
    FROM invoices i JOIN clients c ON c.id=i.client_id
    WHERE (?='' OR i.invoice_number LIKE ? OR c.name LIKE ? OR COALESCE(c.company_name,'') LIKE ?)
    AND (? IS NULL OR ${dateField}>=?) AND (? IS NULL OR ${dateField}<=?)
    ORDER BY i.created_at DESC`).all(filters.data.search || "", `%${filters.data.search || ""}%`, `%${filters.data.search || ""}%`, `%${filters.data.search || ""}%`, filters.data.from || null, filters.data.from || null, filters.data.to || null, filters.data.to || null) as any[];
  const result = rows.map((row) => ({ ...row, balance_minor: Math.max(0, row.total_minor - row.paid_minor), status: computedStatus(row, row.paid_minor) })).filter((row) => !filters.data.status || row.status === filters.data.status);
  res.json(result);
});
router.get("/:id", (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return invalid(res, "Invalid invoice id.");
  const row = detail(getDatabase(), id.data);
  return row ? res.json(row) : invalid(res, "Invoice not found.", 404);
});
router.post("/", (req, res) => {
  const input = invoiceSchema.safeParse(req.body);
  if (!input.success) return invalid(res, input.error.issues[0]?.message || "Invalid invoice.");
  const d = input.data, db = getDatabase(), id = randomUUID(), stamp = now();
  if(d.reissued_from_id) return invalid(res,"Use the reissue action for a void invoice.",409);
  if ((d.source_order_id || d.source_quotation_id) && req.body?.confirm_source !== true) return invalid(res, "Confirm creation from this business record.", 409);
  try {
    db.transaction(() => {
      let clientId = d.client_id, title = d.title, items = d.items, discount = d.discount_minor;
      let sourceOrderId=d.source_order_id||null;
      if (d.source_order_id) {
        const order = db.prepare("SELECT * FROM orders WHERE id=?").get(d.source_order_id) as any;
        if (!order) throw new Error("SOURCE_NOT_FOUND");
        clientId = order.client_id;
        title = order.title;
        items = [{ description: order.title, quantity: 1, unit_price_minor: order.agreed_amount_minor, discount_minor: 0 }];
        if (d.discount_minor !== 0) throw new Error("ORDER_TOTAL_MISMATCH");
        discount = 0;
        if (db.prepare("SELECT 1 FROM invoices WHERE source_order_id=?").get(order.id)) throw new Error("DUPLICATE_SOURCE");
        if (order.quotation_id && db.prepare("SELECT 1 FROM invoices WHERE source_quotation_id=?").get(order.quotation_id)) throw new Error("DUPLICATE_SOURCE");
        if (order.currency !== "INR") throw new Error("UNSUPPORTED_CURRENCY");
      }
      if (d.source_quotation_id) {
        const quote = db.prepare("SELECT * FROM quotations WHERE id=?").get(d.source_quotation_id) as any;
        if (!quote) throw new Error("SOURCE_NOT_FOUND");
        if (quote.status !== "accepted") throw new Error("SOURCE_NOT_ACCEPTED");
        clientId = quote.client_id;
        title = quote.title;
        discount = quote.discount_minor;
        items = (db.prepare("SELECT description,quantity,unit_price_minor FROM quotation_items WHERE quotation_id=? ORDER BY sort_order").all(quote.id) as any[]).map((item) => ({ ...item, discount_minor: 0 }));
        if (db.prepare("SELECT 1 FROM invoices WHERE source_quotation_id=?").get(quote.id)) throw new Error("DUPLICATE_SOURCE");
        if (db.prepare("SELECT 1 FROM invoices i JOIN orders o ON o.id=i.source_order_id WHERE o.quotation_id=?").get(quote.id)) throw new Error("DUPLICATE_SOURCE");
        const linkedOrder=db.prepare("SELECT id,currency FROM orders WHERE quotation_id=?").get(quote.id) as any;
        if(linkedOrder){if(linkedOrder.currency!=="INR")throw new Error("UNSUPPORTED_CURRENCY");sourceOrderId=linkedOrder.id;}
      }
      const client = db.prepare("SELECT * FROM clients WHERE id=?").get(clientId) as any;
      if (!client) throw new Error("CLIENT_NOT_FOUND");
      if (!d.source_order_id && !d.source_quotation_id && !db.prepare("SELECT 1 FROM clients WHERE id=? AND archived_at IS NULL").get(clientId)) throw new Error("CLIENT_ARCHIVED");
      const subtotal = itemSubtotal(items);
      if (discount > subtotal || subtotal - discount <= 0) throw new Error("INVALID_TOTAL");
      if (sourceOrderId) {
        const sourceOrder = db.prepare("SELECT agreed_amount_minor FROM orders WHERE id=?").get(sourceOrderId) as any;
        if (!sourceOrder || subtotal - discount !== sourceOrder.agreed_amount_minor) throw new Error("ORDER_TOTAL_MISMATCH");
      }
      const number = nextNumber(db, d.issue_date.slice(0, 4));
      db.prepare(`INSERT INTO invoices(id,invoice_number,client_id,source_order_id,source_quotation_id,reissued_from_id,title,subtotal_minor,discount_minor,total_minor,issue_date,due_date,terms,notes,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`).run(id, number, clientId, sourceOrderId, d.source_quotation_id || null, d.reissued_from_id || null, title, subtotal, discount, subtotal - discount, d.issue_date, d.due_date || null, d.terms || null, d.notes || null, stamp, stamp);
      saveItems(db, id, items);
      if (sourceOrderId) {
        const existingPayments = db.prepare("SELECT p.* FROM payments p LEFT JOIN payment_reversals r ON r.order_payment_id=p.id WHERE p.order_id=? AND r.id IS NULL ORDER BY p.payment_date,p.created_at").all(sourceOrderId) as any[];
        const existingTotal = existingPayments.reduce((sum, payment) => sum + payment.amount_minor, 0);
        if (existingTotal > subtotal - discount) throw new Error("ORDER_ALREADY_PAID");
        const allocate = db.prepare("INSERT INTO invoice_payments(id,invoice_id,order_payment_id,amount_minor,payment_date,payment_method,reference,notes,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)");
        for (const payment of existingPayments) allocate.run(randomUUID(),id,payment.id,payment.amount_minor,payment.payment_date,payment.payment_method,payment.reference,payment.notes,`order:${payment.id}`,stamp);
      }
      db.prepare("INSERT INTO invoice_status_history(id,invoice_id,previous_status,new_status,changed_at,metadata) VALUES(?,?,NULL,'draft',?,?)").run(randomUUID(), id, stamp, d.source_order_id || d.source_quotation_id ? JSON.stringify({ confirmed_source: true }) : null);
    })();
    res.status(201).json(detail(db, id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return invalid(res, message === "SOURCE_NOT_FOUND" ? "Source record not found." : message === "CLIENT_NOT_FOUND" ? "Client not found." : message === "CLIENT_ARCHIVED" ? "Restore the archived client before creating a direct invoice." : message === "SOURCE_NOT_ACCEPTED" ? "Only accepted quotations can be invoiced." : message === "DUPLICATE_SOURCE" ? "An invoice already exists for this source record." : message === "UNSUPPORTED_CURRENCY" ? "Only INR orders can be invoiced currently." : message === "ORDER_ALREADY_PAID" ? "Existing order payments exceed the invoice total and cannot be allocated safely." : message === "ORDER_TOTAL_MISMATCH" ? "An order-linked invoice must match the agreed order amount and cannot include a discount." : message === "INVALID_TOTAL" ? "Invoice total is invalid or exceeds the allowed amount." : "Unable to create invoice.", message === "SOURCE_NOT_FOUND" || message === "CLIENT_NOT_FOUND" ? 404 : message === "DUPLICATE_SOURCE" || message === "SOURCE_NOT_ACCEPTED" || message === "ORDER_ALREADY_PAID" || message === "ORDER_TOTAL_MISMATCH" ? 409 : 400);
  }
});
router.put("/:id", (req, res) => {
  const id = idSchema.safeParse(req.params.id), input = invoiceSchema.safeParse(req.body);
  if (!id.success || !input.success) return invalid(res, !input.success ? input.error.issues[0]?.message || "Invalid invoice." : "Invalid invoice id.");
  const db = getDatabase(), d = input.data, stamp = now();
  try {
    db.transaction(() => {
      const existing = db.prepare("SELECT * FROM invoices WHERE id=?").get(id.data) as any;
      if (!existing) throw new Error("NOT_FOUND");
      if (existing.status !== "draft") throw new Error("IMMUTABLE");
      if ((d.source_order_id && d.source_order_id !== existing.source_order_id) || (d.source_quotation_id && d.source_quotation_id !== existing.source_quotation_id)) throw new Error("SOURCE_IMMUTABLE");
      if (!db.prepare("SELECT 1 FROM clients WHERE id=? AND archived_at IS NULL").get(d.client_id)) throw new Error("CLIENT_NOT_FOUND");
      const rows = d.items.map((item) => Math.round(item.quantity * item.unit_price_minor) - item.discount_minor);
      if (rows.some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error("INVALID_TOTAL");
      const subtotal = rows.reduce((a,b)=>a+b,0);
      if (!Number.isSafeInteger(subtotal) || d.discount_minor > subtotal || subtotal-d.discount_minor<=0) throw new Error("INVALID_TOTAL");
      const paid=(db.prepare("SELECT COALESCE(SUM(ip.amount_minor-COALESCE(r.amount_minor,0)),0) total FROM invoice_payments ip LEFT JOIN payment_reversals r ON r.invoice_payment_id=ip.id WHERE ip.invoice_id=?").get(id.data) as any).total;
      if(subtotal-d.discount_minor<paid)throw new Error("PAID_EXCEEDS");
      if(existing.source_order_id){const order=db.prepare("SELECT agreed_amount_minor FROM orders WHERE id=?").get(existing.source_order_id) as any;if(subtotal-d.discount_minor!==order.agreed_amount_minor)throw new Error("ORDER_TOTAL_IMMUTABLE");}
      db.prepare("DELETE FROM invoice_items WHERE invoice_id=?").run(id.data);
      const finalSubtotal = saveItems(db, id.data, d.items);
      db.prepare("UPDATE invoices SET client_id=?,title=?,subtotal_minor=?,discount_minor=?,total_minor=?,issue_date=?,due_date=?,terms=?,notes=?,updated_at=? WHERE id=?").run(d.client_id,d.title,finalSubtotal,d.discount_minor,finalSubtotal-d.discount_minor,d.issue_date,d.due_date||null,d.terms||null,d.notes||null,stamp,id.data);
    })();
    return res.json(detail(db, id.data));
  } catch (error) { const m = error instanceof Error ? error.message : ""; return invalid(res, m === "NOT_FOUND" ? "Invoice not found." : m === "IMMUTABLE" ? "Issued and void invoices cannot be edited." : m === "SOURCE_IMMUTABLE" ? "The source relationship on this invoice cannot be changed." : m === "CLIENT_NOT_FOUND" ? "Restore the archived client before changing this invoice." : m === "PAID_EXCEEDS" ? "Invoice total cannot be reduced below its already allocated payments." : m === "ORDER_TOTAL_IMMUTABLE" ? "An order-linked invoice must preserve the agreed order amount." : "Invalid invoice total.", m === "NOT_FOUND" ? 404 : m === "IMMUTABLE" || m === "SOURCE_IMMUTABLE" || m === "PAID_EXCEEDS" || m === "ORDER_TOTAL_IMMUTABLE" ? 409 : 400); }
});
router.patch("/:id/status", (req, res) => {
  const id = idSchema.safeParse(req.params.id), input = invoiceStatusSchema.safeParse(req.body);
  if (!id.success || !input.success) return invalid(res, "Invalid invoice status request.");
  const db = getDatabase(), stamp = now();
  try {
    const next = db.transaction(() => {
      const invoice = db.prepare("SELECT * FROM invoices WHERE id=?").get(id.data) as any;
      if (!invoice) throw new Error("NOT_FOUND");
      if (input.data.action === "issue") {
        if (invoice.status !== "draft") throw new Error("TRANSITION");
        const paid = (db.prepare("SELECT COALESCE(SUM(ip.amount_minor-COALESCE(r.amount_minor,0)),0) n FROM invoice_payments ip LEFT JOIN payment_reversals r ON r.invoice_payment_id=ip.id WHERE ip.invoice_id=?").get(id.data) as any).n;
        if (paid > 0 && !invoice.source_order_id) throw new Error("PAYMENTS_EXIST");
        const client = db.prepare("SELECT name,company_name,email,phone,address FROM clients WHERE id=?").get(invoice.client_id);
        const business = db.prepare("SELECT business_name,contact_person,email,phone,address,website FROM business_profile WHERE id=1").get();
        db.prepare("UPDATE invoices SET status='issued',issued_at=?,client_snapshot=?,business_snapshot=?,updated_at=? WHERE id=?").run(stamp,JSON.stringify(client),JSON.stringify(business),stamp,id.data);
      } else {
        if (invoice.status !== "issued") throw new Error("TRANSITION");
        const paid = (db.prepare("SELECT COALESCE(SUM(ip.amount_minor-COALESCE(r.amount_minor,0)),0) n FROM invoice_payments ip LEFT JOIN payment_reversals r ON r.invoice_payment_id=ip.id WHERE ip.invoice_id=?").get(id.data) as any).n;
        if (paid > 0) throw new Error("PAYMENTS_EXIST");
        db.prepare("UPDATE invoices SET status='void',voided_at=?,updated_at=? WHERE id=?").run(stamp,stamp,id.data);
      }
      const status = input.data.action === "issue" ? "issued" : "void";
      db.prepare("INSERT INTO invoice_status_history(id,invoice_id,previous_status,new_status,changed_at,metadata) VALUES(?,?,?,?,?,?)").run(randomUUID(),id.data,invoice.status,status,stamp,null);
      return detail(db,id.data);
    })();
    return res.json(next);
  } catch (error) { const m = error instanceof Error ? error.message : ""; return invalid(res,m === "NOT_FOUND" ? "Invoice not found." : m === "PAYMENTS_EXIST" ? "An invoice with recorded payments cannot be voided or issued from a paid draft." : "That invoice status transition is not allowed.",m === "NOT_FOUND" ? 404 : 409); }
});
router.post("/:id/reissue", (req, res) => {
  const id = idSchema.safeParse(req.params.id); if (!id.success) return invalid(res,"Invalid invoice id.");
  const db = getDatabase(), newId = randomUUID(), stamp = now();
  try { db.transaction(() => {
    const original = db.prepare("SELECT * FROM invoices WHERE id=?").get(id.data) as any;
    if (!original) throw new Error("NOT_FOUND");
    if (original.status !== "void") throw new Error("NOT_VOID");
    const number = nextNumber(db, today().slice(0,4));
    db.prepare("INSERT INTO invoices(id,invoice_number,client_id,source_order_id,source_quotation_id,reissued_from_id,title,subtotal_minor,discount_minor,total_minor,issue_date,due_date,terms,notes,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)").run(newId,number,original.client_id,original.source_order_id,original.source_quotation_id,id.data,original.title,original.subtotal_minor,original.discount_minor,original.total_minor,today(),original.due_date,original.terms,original.notes,stamp,stamp);
    const items = db.prepare("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY sort_order").all(id.data) as any[];
    const add = db.prepare("INSERT INTO invoice_items(id,invoice_id,description,quantity,unit_price_minor,discount_minor,line_total_minor,sort_order) VALUES(?,?,?,?,?,?,?,?)");
    items.forEach((item)=>add.run(randomUUID(),newId,item.description,item.quantity,item.unit_price_minor,item.discount_minor,item.line_total_minor,item.sort_order));
    db.prepare("INSERT INTO invoice_status_history(id,invoice_id,previous_status,new_status,changed_at,metadata) VALUES(?,?,NULL,'draft',?,?)").run(randomUUID(),newId,stamp,JSON.stringify({ reissued_from: id.data }));
  })(); return res.status(201).json(detail(db,newId)); } catch(error) { const m=error instanceof Error?error.message:""; return invalid(res,m==="NOT_FOUND"?"Invoice not found.":"Only a void invoice can be reissued.",m==="NOT_FOUND"?404:409); }
});
router.post("/:id/payments", (req, res) => {
  const id=idSchema.safeParse(req.params.id), input=invoicePaymentSchema.safeParse(req.body);
  if(!id.success||!input.success) return invalid(res,!input.success?input.error.issues[0]?.message||"Invalid payment.":"Invalid invoice id.");
  const db=getDatabase(),d=input.data,stamp=now(), paymentId=randomUUID(), entryId=randomUUID();
  try {
    const result=db.transaction(()=>{
      const invoice=db.prepare("SELECT * FROM invoices WHERE id=?").get(id.data) as any;
      if(!invoice) throw new Error("NOT_FOUND");
      if(invoice.status!=="issued") throw new Error("NOT_ISSUED");
      if(db.prepare("SELECT 1 FROM invoice_payments WHERE idempotency_key=?").get(d.idempotency_key)) throw new Error("DUPLICATE");
      if(d.reference && db.prepare("SELECT 1 FROM invoice_payments WHERE invoice_id=? AND lower(trim(reference))=lower(trim(?))").get(id.data,d.reference)) throw new Error("DUPLICATE_REFERENCE");
      if(!d.reference && db.prepare("SELECT 1 FROM invoice_payments WHERE invoice_id=? AND amount_minor=? AND payment_date=? AND COALESCE(payment_method,'')=COALESCE(?,'')").get(id.data,d.amount_minor,d.payment_date,d.payment_method||null)) throw new Error("DUPLICATE");
      const paid=(db.prepare("SELECT COALESCE(SUM(ip.amount_minor-COALESCE(r.amount_minor,0)),0) n FROM invoice_payments ip LEFT JOIN payment_reversals r ON r.invoice_payment_id=ip.id WHERE ip.invoice_id=?").get(id.data) as any).n;
      if(d.amount_minor>invoice.total_minor-paid) throw new Error("EXCESS");
      let orderPaymentId:string|null=null;
      if(invoice.source_order_id){
        const order=db.prepare("SELECT agreed_amount_minor,currency FROM orders WHERE id=?").get(invoice.source_order_id) as any;
        const orderPaid=(db.prepare("SELECT COALESCE(SUM(p.amount_minor-COALESCE(r.amount_minor,0)),0) n FROM payments p LEFT JOIN payment_reversals r ON r.order_payment_id=p.id WHERE p.order_id=?").get(invoice.source_order_id) as any).n;
        if(d.amount_minor>order.agreed_amount_minor-orderPaid) throw new Error("ORDER_EXCESS");
        if(d.reference && db.prepare("SELECT 1 FROM payments WHERE order_id=? AND lower(trim(reference))=lower(trim(?)) AND amount_minor=?").get(invoice.source_order_id,d.reference,d.amount_minor)) throw new Error("DUPLICATE_REFERENCE");
        orderPaymentId=paymentId;
        db.prepare("INSERT INTO payments(id,order_id,amount_minor,currency,payment_date,payment_method,reference,notes,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(paymentId,invoice.source_order_id,d.amount_minor,order.currency,d.payment_date,d.payment_method||null,d.reference||null,d.notes||null,d.idempotency_key,stamp,stamp);
      }
      db.prepare("INSERT INTO invoice_payments(id,invoice_id,order_payment_id,amount_minor,payment_date,payment_method,reference,notes,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(entryId,id.data,orderPaymentId,d.amount_minor,d.payment_date,d.payment_method||null,d.reference||null,d.notes||null,d.idempotency_key,stamp);
      return detail(db,id.data);
    })(); return res.status(201).json(result);
  } catch(error){ const m=error instanceof Error?error.message:""; return invalid(res,m==="NOT_FOUND"?"Invoice not found.":m==="NOT_ISSUED"?"Payments can only be recorded on issued invoices.":m==="DUPLICATE"?"This payment submission was already recorded.":m==="EXCESS"?"Payment exceeds the invoice balance.":m==="ORDER_EXCESS"?"Payment exceeds the remaining order balance.":m==="DUPLICATE_REFERENCE"?"A payment with this reference is already recorded for the invoice.":"Unable to record payment.",m==="NOT_FOUND"?404:m==="NOT_ISSUED"||m==="DUPLICATE"||m==="EXCESS"||m==="ORDER_EXCESS"||m==="DUPLICATE_REFERENCE"?409:500); }
});
router.post("/:id/payments/:paymentId/reverse", (req,res)=>{
  const id=idSchema.safeParse(req.params.id),paymentId=idSchema.safeParse(req.params.paymentId),input=paymentReversalSchema.safeParse(req.body);
  if(!id.success||!paymentId.success||!input.success)return invalid(res,!input.success?input.error.issues[0]?.message||"Invalid payment reversal.":"Invalid payment reversal request.");
  const db=getDatabase(),stamp=now();
  try{
    db.transaction(()=>{
      const invoice=db.prepare("SELECT status FROM invoices WHERE id=?").get(id.data) as any;
      if(!invoice)throw new Error("NOT_FOUND");
      if(invoice.status==="void")throw new Error("VOID_INVOICE");
      const payment=db.prepare("SELECT * FROM invoice_payments WHERE id=? AND invoice_id=?").get(paymentId.data,id.data) as any;
      if(!payment)throw new Error("PAYMENT_NOT_FOUND");
      if(db.prepare("SELECT 1 FROM payment_reversals WHERE invoice_payment_id=?").get(payment.id))throw new Error("REVERSED");
      if(payment.order_payment_id){
        const linked=db.prepare("SELECT id FROM payments WHERE id=?").get(payment.order_payment_id) as any;
        if(!linked)throw new Error("LINK_MISSING");
        db.prepare("INSERT INTO payment_reversals(id,order_payment_id,invoice_payment_id,amount_minor,reason,reversed_at,created_at) VALUES(?,?,?,?,?,?,?)").run(randomUUID(),payment.order_payment_id,payment.id,payment.amount_minor,input.data.reason,stamp,stamp);
      }else{
        db.prepare("INSERT INTO payment_reversals(id,order_payment_id,invoice_payment_id,amount_minor,reason,reversed_at,created_at) VALUES(?,NULL,?,?,?,?,?)").run(randomUUID(),payment.id,payment.amount_minor,input.data.reason,stamp,stamp);
      }
    })();
    return res.json(detail(db,id.data));
  }catch(error){
    const message=error instanceof Error?error.message:"";
    return invalid(res,message==="NOT_FOUND"?"Invoice not found.":message==="PAYMENT_NOT_FOUND"?"Payment not found.":message==="VOID_INVOICE"?"Payments allocated to a void invoice cannot be reversed here.":message==="REVERSED"?"This payment has already been reversed.":"Unable to reverse payment.",message==="NOT_FOUND"||message==="PAYMENT_NOT_FOUND"?404:message==="VOID_INVOICE"||message==="REVERSED"?409:500);
  }
});
router.get("/:id/pdf", (req,res)=>{
  const id=idSchema.safeParse(req.params.id); if(!id.success)return invalid(res,"Invalid invoice id.");
  const invoice=detail(getDatabase(),id.data); if(!invoice)return invalid(res,"Invoice not found.",404);
  if(invoice.status==="draft")return invalid(res,"Issue the invoice before downloading its PDF.",409);
  const client=invoice.client_snapshot?JSON.parse(invoice.client_snapshot):{};
  const business=invoice.business_snapshot?JSON.parse(invoice.business_snapshot):{};
  const items=invoice.items.map((i:any)=>({description:i.description,quantity:i.quantity,unit_price_minor:i.unit_price_minor,discount_minor:i.discount_minor,line_total_minor:i.line_total_minor}));
  res.status(200); res.setHeader("Content-Type","application/pdf"); res.setHeader("Content-Disposition",`attachment; filename="${invoice.invoice_number}.pdf"`); res.setHeader("Cache-Control","private, no-store");
  try{createInvoicePdf({...invoice,client_name:client.name,company_name:client.company_name,client_email:client.email,client_phone:client.phone,client_address:client.address,business_name:business.business_name,contact_person:business.contact_person,business_email:business.email,business_phone:business.phone,business_address:business.address,business_website:business.website,paid_minor:invoice.paid_minor,balance_minor:invoice.balance_minor},items,res,(error)=>{if(!res.headersSent)invalid(res,"Unable to generate invoice PDF.",500);else res.destroy(error);});}catch{return invalid(res,"Unable to generate invoice PDF.",500);}
});
export default router;
