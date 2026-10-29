import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createAsyncRouter } from "../async-router.ts";
import { getDatabase } from "../db/database.ts";
import { createInvoicePdf } from "../services/invoice-pdf.ts";
import { generateEmailHtml } from "../services/html.service.ts";
import { sendMail } from "../services/mail.service.ts";
import type { EmailDraft, TypographyStyle, TypographyTarget } from "../../src/types/email.ts";
import { cancelPaymentLink, createPaymentLink, createStandardOrder, invoicePaymentSummary, processWebhook, razorpayConfigured, reconcileLink, RazorpayError, verifyStandardPaymentSignature } from "../services/razorpay.service.ts";

const router = createAsyncRouter();
const standardRouter = createAsyncRouter();
const webhookRouter = createAsyncRouter();
const uuid = z.string().uuid();
const invalid = (res: any, message: string, status = 400) => res.status(status).json({ error: message });
const clean = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount / 100);
const logoBuffer = readFileSync(fileURLToPath(new URL("../../src/assets/JSN DESIGN.png", import.meta.url)));
const emailTypography = Object.fromEntries(([
  ["title", 28], ["heading", 18], ["body", 15], ["list", 15], ["table", 15], ["button", 13], ["signature", 14],
] as [TypographyTarget, number][]).map(([target, fontSize]) => [target, { fontFamily: "Arial, Helvetica, sans-serif", fontSize, fontWeight: target === "title" || target === "heading" || target === "button" ? 700 : 400, lineHeight: 1.6, letterSpacing: 0, textAlign: target === "button" ? "center" : "left", color: target === "button" ? "#000000" : "#1a1a1a", backgroundColor: target === "button" ? "#d4af37" : "transparent" }])) as Record<TypographyTarget, TypographyStyle>;

standardRouter.post("/create-order", async (req, res) => {
  const input = z.object({
    amount: z.number().int().min(100, "Amount must be at least 100 paise."),
    currency: z.string().regex(/^[A-Z]{3}$/, "Currency must be a three-letter uppercase code.").default("INR"),
    receipt: z.string().trim().min(1).max(40).optional(),
  }).safeParse(req.body);
  if (!input.success) return invalid(res, input.error.issues[0]?.message || "Invalid order request.");
  try {
    return res.status(201).json(await createStandardOrder(input.data));
  } catch (error) {
    return invalid(res, error instanceof Error ? error.message : "Unable to create Razorpay order.", error instanceof RazorpayError ? error.status : 502);
  }
});

standardRouter.post("/verify-payment", async (req, res) => {
  const input = z.object({
    razorpay_order_id: z.string().trim().min(1),
    razorpay_payment_id: z.string().trim().min(1),
    razorpay_signature: z.string().regex(/^[a-f\d]{64}$/i, "Invalid payment signature."),
  }).safeParse(req.body);
  if (!input.success) return invalid(res, input.error.issues[0]?.message || "Payment verification fields are required.");
  if (!verifyStandardPaymentSignature(input.data.razorpay_order_id, input.data.razorpay_payment_id, input.data.razorpay_signature))
    return invalid(res, "Payment signature verification failed.", 400);
  return res.json({ ok: true, payment_id: input.data.razorpay_payment_id, order_id: input.data.razorpay_order_id });
});

router.get("/:invoiceId/payments", async (req, res) => {
  const id = uuid.safeParse(req.params.invoiceId); if (!id.success) return invalid(res, "Invalid invoice id.");
  const db = getDatabase(), summary = await invoicePaymentSummary(db, id.data);
  if (!summary) return invalid(res, "Invoice not found.", 404);
  const payments = await db.prepare("SELECT ip.*, pr.reason reversal_reason,pr.reversed_at,COALESCE((SELECT SUM(rf.amount_minor) FROM razorpay_refunds rf WHERE rf.invoice_payment_id=ip.id AND rf.status='processed'),0) refunded_minor FROM invoice_payments ip LEFT JOIN payment_reversals pr ON pr.invoice_payment_id=ip.id WHERE ip.invoice_id=? ORDER BY ip.payment_date DESC,ip.created_at DESC").all(id.data);
  const attempts = await db.prepare("SELECT * FROM razorpay_payment_attempts WHERE invoice_id=? ORDER BY gateway_created_at DESC").all(id.data);
  const refunds = await db.prepare("SELECT gateway_refund_id,gateway_payment_id,invoice_payment_id,amount_minor,currency,status,created_at FROM razorpay_refunds WHERE invoice_id=? ORDER BY created_at DESC").all(id.data);
  const links = await db.prepare("SELECT id,invoice_id,gateway_link_id,payment_url,collection_mode,amount_minor,gateway_amount_paid_minor,minimum_partial_minor,currency,gateway_status,expiry_at,create_state,last_reconciled_at,created_at,updated_at FROM razorpay_payment_links WHERE invoice_id=? ORDER BY created_at DESC").all(id.data);
  const deliveries = await db.prepare("SELECT id,recipient,email_type,payment_link_id,pdf_filename,delivery_status,attempt_count,error_summary,sent_at,created_at FROM invoice_email_deliveries WHERE invoice_id=? ORDER BY created_at DESC").all(id.data);
  res.json({ ...summary, payments, attempts, refunds, links, deliveries, configured: razorpayConfigured() });
});

router.post("/:invoiceId/payment-links", async (req, res) => {
  const id = uuid.safeParse(req.params.invoiceId);
  const input = z.object({ mode: z.enum(["advance", "balance", "flexible"]), amount_minor: z.number().int().positive().optional(), minimum_partial_minor: z.number().int().positive().optional(), expiry_at: z.string().datetime().optional() }).safeParse(req.body);
  if (!id.success || !input.success) return invalid(res, input.success ? "Invalid invoice id." : input.error.issues[0]?.message || "Invalid payment-link request.");
  if (!razorpayConfigured()) return invalid(res, "Razorpay is not configured. Add test credentials to the server environment.", 503);
  try {
    const result = await createPaymentLink(getDatabase(), id.data, { mode: input.data.mode, amount_minor: input.data.amount_minor, minimum_partial_minor: input.data.minimum_partial_minor, expire_by: input.data.expiry_at ? Math.floor(Date.parse(input.data.expiry_at)/1000) : undefined }) as any;
    const { create_request_key: _requestKey, gateway_reference_id: _referenceId, ...safe } = result;
    return res.status(201).json(safe);
  } catch (error) { return invalid(res, error instanceof Error ? error.message : "Unable to create payment link.", error instanceof RazorpayError ? error.status : 502); }
});

router.post("/:invoiceId/payment-status/refresh", async (req, res) => {
  const id = uuid.safeParse(req.params.invoiceId); if (!id.success) return invalid(res, "Invalid invoice id.");
  if (!razorpayConfigured()) return invalid(res, "Razorpay is not configured; payment status could not be refreshed.", 503);
  const db = getDatabase();
  if (!await db.prepare("SELECT 1 FROM invoices WHERE id=?").get(id.data)) return invalid(res, "Invoice not found.", 404);
  const links = await db.prepare("SELECT id FROM razorpay_payment_links WHERE invoice_id=? AND create_state IN ('created','uncertain')").all(id.data) as { id: string }[];
  try {
    for (const link of links) await reconcileLink(db, link.id);
    return res.json({ ...await invoicePaymentSummary(db, id.data), stale: false });
  } catch (error) { return res.status(error instanceof RazorpayError ? error.status : 502).json({ error: error instanceof Error ? error.message : "Payment reconciliation failed.", stale: true, ...await invoicePaymentSummary(db, id.data) }); }
});

router.post("/:invoiceId/payment-links/:linkId/cancel", async (req, res) => {
  const id = uuid.safeParse(req.params.invoiceId), linkId = uuid.safeParse(req.params.linkId);
  if (!id.success || !linkId.success) return invalid(res, "Invalid payment-link request.");
  if (!razorpayConfigured()) return invalid(res, "Razorpay is not configured; payment link could not be cancelled.", 503);
  try { return res.json(await cancelPaymentLink(getDatabase(), id.data, linkId.data)); }
  catch (error) { return invalid(res, error instanceof Error ? error.message : "Unable to cancel payment link.", error instanceof RazorpayError ? error.status : 502); }
});

router.post("/:invoiceId/send", async (req, res) => {
  const id = uuid.safeParse(req.params.invoiceId); if (!id.success) return invalid(res, "Invalid invoice id.");
  const input = z.object({ payment_link_id: uuid.optional(), create_link: z.boolean().default(true), mode: z.enum(["balance", "flexible"]).default("balance"), minimum_partial_minor: z.number().int().positive().optional() }).safeParse(req.body || {});
  if (!input.success) return invalid(res, input.error.issues[0]?.message || "Invalid invoice email request.");
  const db = getDatabase();
  let invoice = await db.prepare(`SELECT i.*,c.name client_name,c.email client_email FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=?`).get(id.data) as any;
  if (!invoice) return invalid(res, "Invoice not found.", 404);
  if (invoice.status !== "issued") return invalid(res, "Only issued invoices can be emailed for payment.", 409);
  const savedClient = invoice.client_snapshot ? JSON.parse(invoice.client_snapshot) : null;
  const recipient = savedClient?.email || invoice.client_email;
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return invalid(res, "The invoice client needs a valid email address.", 400);
  let paid = await invoicePaymentSummary(db, id.data);
  if (!paid) return invalid(res, "Invoice not found.", 404);
  let link: any = null;
  try {
    if (input.data.payment_link_id) {
      link = await db.prepare("SELECT * FROM razorpay_payment_links WHERE id=? AND invoice_id=? AND create_state='created'").get(input.data.payment_link_id, id.data);
      if (!link) return invalid(res, "Payment link was not found for this invoice.", 404);
      if (!razorpayConfigured()) return invalid(res, "Razorpay credentials are required to verify the payment link before sending.", 503);
      await reconcileLink(db, input.data.payment_link_id);
      link = await db.prepare("SELECT * FROM razorpay_payment_links WHERE id=? AND invoice_id=?").get(input.data.payment_link_id, id.data);
      paid = await invoicePaymentSummary(db, id.data);
      if (!paid) return invalid(res, "Invoice not found.", 404);
      if (link.amount_minor-link.gateway_amount_paid_minor > paid.balance_minor) return invalid(res, "This active link can collect more than the current invoice balance. Cancel it and choose a current link before sending.", 409);
    } else if (input.data.create_link) {
      if (!razorpayConfigured()) return invalid(res, "Razorpay credentials are required to create a payment link.", 503);
      link = await createPaymentLink(db, id.data, { mode: input.data.mode, minimum_partial_minor: input.data.minimum_partial_minor });
      paid = await invoicePaymentSummary(db, id.data);
      if (!paid) return invalid(res, "Invoice not found.", 404);
    }
    const business = invoice.business_snapshot ? JSON.parse(invoice.business_snapshot) : (await db.prepare("SELECT * FROM business_profile WHERE id=1").get() as any || {});
    const client = savedClient || { name: invoice.client_name, email: recipient };
    const items = await db.prepare("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY sort_order").all(id.data) as any[];
    const stream = new PassThrough();
    const pdf = new Promise<Buffer>((resolve, reject) => { const chunks: Buffer[] = []; stream.on("data", (chunk) => chunks.push(Buffer.from(chunk))); stream.on("end", () => resolve(Buffer.concat(chunks))); stream.on("error", reject); });
    createInvoicePdf({ ...invoice, ...business, client_name: client.name, company_name: client.company_name, client_email: client.email, client_phone: client.phone, client_address: client.address, paid_minor: paid.paid_minor, balance_minor: paid.balance_minor }, items.map((i) => ({ description: i.description, quantity: i.quantity, unit_price_minor: i.unit_price_minor, discount_minor: i.discount_minor, line_total_minor: i.line_total_minor })), stream);
    const filename = `${invoice.invoice_number.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
    const deliveryId = randomUUID(), now = new Date().toISOString();
    await db.prepare("INSERT INTO invoice_email_deliveries(id,invoice_id,recipient,email_type,payment_link_id,pdf_filename,delivery_status,attempt_count,created_at,updated_at) VALUES(?,?,?,'invoice_payment',?,?,'sending',1,?,?)").run(deliveryId, id.data, recipient, link?.id || null, filename, now, now);
    try {
      const attachment = await pdf;
      const amountDue = link ? Math.max(0, link.amount_minor-link.gateway_amount_paid_minor) : paid.balance_minor;
      const subject = `Invoice ${invoice.invoice_number} from ${business.business_name || "JSN DESIGNS"}`;
      const draft: EmailDraft = { from: business.email || "", to: recipient, cc: "", bcc: "", subject, greeting: `Hello ${client.name || ""},`, title: `Invoice ${invoice.invoice_number}`, body: `<p>Please find the attached invoice for ${clean(invoice.title)}.</p><p>Invoice total: <strong>${money(invoice.total_minor)}</strong><br>Paid so far: ${money(paid.paid_minor)}<br>Balance due: <strong>${money(paid.balance_minor)}</strong><br>Payment requested now: <strong>${money(amountDue)}</strong><br>Due date: ${clean(invoice.due_date || "Not set")}</p>`, sections: [], closing: "Regards,", signature: business.business_name || "JSN DESIGNS", ctaLabel: link?.payment_url ? "Pay securely online" : "", ctaUrl: link?.payment_url || "", template: "professional", typography: emailTypography };
      const html = generateEmailHtml(draft, "cid:jsn-logo");
      await sendMail({ to: recipient, subject, html, attachments: [{ filename, content: attachment, contentType: "application/pdf" }, { filename: "JSN-DESIGN.png", content: logoBuffer, contentType: "image/png", cid: "jsn-logo" }] });
      await db.prepare("UPDATE invoice_email_deliveries SET delivery_status='sent',sent_at=?,updated_at=? WHERE id=?").run(new Date().toISOString(), new Date().toISOString(), deliveryId);
      return res.json({ ok: true, delivery_status: "sent", recipient, filename, payment_link: link ? { id: link.id, payment_url: link.payment_url } : null, note: "SMTP accepted the message; inbox delivery is not confirmed." });
    } catch (error) {
      const code = (error as any)?.code;
      const uncertain = ["ETIMEDOUT", "ECONNECTION", "ESOCKET"].includes(code) && !(error as any)?.responseCode;
      const message = uncertain ? "SMTP outcome is unknown after a network failure; check the recipient mailbox before resending." : error instanceof Error ? error.message : "SMTP delivery failed";
      await db.prepare("UPDATE invoice_email_deliveries SET delivery_status=?,error_summary=?,updated_at=? WHERE id=?").run(uncertain ? "unknown" : "failed", message.slice(0,500), new Date().toISOString(), deliveryId);
      throw error;
    }
  } catch (error) { return res.status(error instanceof RazorpayError ? error.status : 502).json({ error: error instanceof Error ? error.message : "Invoice email failed." }); }
});

webhookRouter.post("/", async (req: any, res) => {
  if (!Buffer.isBuffer(req.body)) return invalid(res, "Raw webhook body is required.", 400);
  try { return res.json(await processWebhook(getDatabase(), req.body, req.get("x-razorpay-signature"), req.get("x-razorpay-event-id"))); }
  catch (error) { return invalid(res, error instanceof Error ? error.message : "Webhook processing failed.", error instanceof RazorpayError ? error.status : 500); }
});

export { standardRouter, webhookRouter };
export default router;
