import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { transaction, type Db } from "../db/database.ts";

const apiRoot = "https://api.razorpay.com/v1";
const stamp = () => new Date().toISOString();
const env = () => ({ keyId: process.env.RAZORPAY_KEY_ID?.trim(), keySecret: process.env.RAZORPAY_KEY_SECRET?.trim() });
export function razorpayConfiguration() {
  const { keyId, keySecret } = env();
  const mode = process.env.RAZORPAY_MODE?.trim().toLowerCase() || "test";
  if (mode !== "test" && mode !== "live") return { configured: false, mode: "invalid", problem: "RAZORPAY_MODE must be test or live." };
  if (!keyId || !keySecret) return { configured: false, mode, problem: "Razorpay API credentials are not configured." };
  if (!keyId.startsWith(mode === "live" ? "rzp_live_" : "rzp_test_")) return { configured: false, mode, problem: `The Razorpay key ID does not match configured ${mode} mode.` };
  return { configured: true, mode, problem: null };
}
export const razorpayConfigured = () => razorpayConfiguration().configured;

export class RazorpayError extends Error {
  constructor(message: string, public readonly status = 502, public readonly uncertain = false) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { keyId, keySecret } = env();
  const configuration = razorpayConfiguration();
  if (!configuration.configured) throw new RazorpayError(configuration.problem || "Razorpay configuration is unavailable.", 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${apiRoot}${path}`, {
      ...init, signal: controller.signal,
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`, "Content-Type": "application/json", ...init?.headers },
    });
    const body = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new RazorpayError(body?.error?.description || "Razorpay rejected the request.", response.status === 401 ? 502 : 502);
    return body as T;
  } catch (error) {
    if (error instanceof RazorpayError) throw error;
    const uncertain = init?.method === "POST";
    throw new RazorpayError(error instanceof Error && error.name === "AbortError" ? uncertain ? "Razorpay link creation timed out; creation status is uncertain. Refresh before retrying." : "Razorpay status refresh timed out; verified payment history is unchanged." : "Razorpay is temporarily unavailable.", 502, uncertain);
  } finally { clearTimeout(timer); }
}

type LinkRequest = { amount: number; currency: "INR"; accept_partial: boolean; first_min_partial_amount?: number; reference_id: string; description: string; customer: { name: string; email?: string; contact?: string }; notify: { email: false; sms: false }; reminder_enable: false; expire_by?: number; notes: { invoice_id: string; collection_mode: string } };
type GatewayLink = { id: string; short_url: string; status: string; amount: number; amount_paid: number; currency: string; expire_by?: number; payments?: GatewayLinkPayment[] | null };
type GatewayPayment = { id: string; payment_link_id?: string; amount: number; currency: string; status: string; method?: string; created_at?: number; error_description?: string };
type GatewayLinkPayment = { id?: string; payment_id?: string; amount?: number; status?: string; method?: string; created_at?: number };

export async function createPaymentLink(db: Db, invoiceId: string, input: { mode: "advance" | "balance" | "flexible"; amount_minor?: number; minimum_partial_minor?: number; expire_by?: number }) {
  const uncertainLinks = await db.prepare("SELECT id FROM razorpay_payment_links WHERE invoice_id=? AND create_state='uncertain'").all(invoiceId) as { id: string }[];
  for (const link of uncertainLinks) await reconcileLink(db, link.id);
  const priorLinks = await db.prepare("SELECT id FROM razorpay_payment_links WHERE invoice_id=? AND create_state='created' AND gateway_status IN ('created','partially_paid')").all(invoiceId) as { id: string }[];
  for (const prior of priorLinks) await reconcileLink(db, prior.id);
  const invoice = await db.prepare(`SELECT i.*, c.name client_name,c.email client_email,c.phone client_phone,
    (SELECT COALESCE(SUM(ip.amount_minor-COALESCE(r.amount_minor,0)),0) FROM invoice_payments ip LEFT JOIN payment_reversals r ON r.invoice_payment_id=ip.id WHERE ip.invoice_id=i.id)
    - (SELECT COALESCE(SUM(rf.amount_minor),0) FROM razorpay_refunds rf WHERE rf.invoice_id=i.id AND rf.status='processed') paid_net
    FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.id=?`).get(invoiceId) as any;
  if (!invoice) throw new RazorpayError("Invoice not found.", 404);
  if (invoice.status !== "issued") throw new RazorpayError("Only issued, non-void invoices can accept payments.", 409);
  const outstanding = Math.max(0, invoice.total_minor - invoice.paid_net);
  if (!Number.isSafeInteger(outstanding) || outstanding <= 0) throw new RazorpayError("This invoice has no outstanding balance.", 409);
  const amount = input.mode === "advance" ? input.amount_minor : outstanding;
  if (!Number.isSafeInteger(amount) || !amount || amount < 1 || amount > outstanding) throw new RazorpayError("Payment amount must be a positive amount within the outstanding balance.", 400);
  const flexible = input.mode === "flexible";
  if (flexible && (!Number.isSafeInteger(input.minimum_partial_minor) || (input.minimum_partial_minor as number) < 100 || (input.minimum_partial_minor as number) > amount)) throw new RazorpayError("Set a minimum partial payment from ₹1.00 up to the link amount.", 400);
  if (input.expire_by && input.expire_by < Math.floor(Date.now()/1000) + 900) throw new RazorpayError("Expiry must be at least 15 minutes in the future.", 400);
  const openLinks = await db.prepare("SELECT * FROM razorpay_payment_links WHERE invoice_id=? AND create_state='created' AND gateway_status IN ('created','partially_paid') ORDER BY created_at DESC").all(invoiceId) as any[];
  const unsafeLink = openLinks.find((link) => link.amount_minor-link.gateway_amount_paid_minor > outstanding);
  if (unsafeLink) throw new RazorpayError("An existing Razorpay link can collect more than the current invoice balance. Cancel it in Razorpay, then refresh status before creating another link.", 409);
  const active = openLinks.find((link) => link.collection_mode===input.mode && (!link.expiry_at || Date.parse(link.expiry_at)>Date.now()) && (input.mode==="advance" || input.mode==="flexible" ? link.amount_minor-link.gateway_amount_paid_minor<=outstanding : link.amount_minor-link.gateway_amount_paid_minor===outstanding));
  if (active) return { ...active, reused: true };
  const openCapacity = openLinks.reduce((total, link) => total + link.amount_minor - link.gateway_amount_paid_minor, 0);
  if (openCapacity + amount > outstanding) throw new RazorpayError("Existing active payment links already cover this invoice balance. Reconcile or cancel a link before creating another.", 409);
  if (await db.prepare("SELECT 1 FROM razorpay_payment_links WHERE invoice_id=? AND create_state IN ('creating','uncertain')").get(invoiceId)) throw new RazorpayError("A payment-link request may still be processing. Refresh payment status before creating another link.", 409, true);

  const localId = randomUUID(), requestKey = randomUUID(), now = stamp();
  const referenceId = `INV${invoice.invoice_number.replace(/[^A-Za-z0-9]/g, "").slice(-32)}${localId.replace(/-/g, "").slice(0,4)}`.slice(0,40);
  await db.prepare("INSERT INTO razorpay_payment_links(id,invoice_id,gateway_reference_id,collection_mode,amount_minor,minimum_partial_minor,currency,gateway_status,expiry_at,create_request_key,create_state,created_at,updated_at) VALUES(?,?,?, ?,?,?,'INR','creating',?,?, 'creating',?,?)").run(localId, invoiceId, referenceId, input.mode, amount, flexible ? input.minimum_partial_minor : null, input.expire_by ? new Date(input.expire_by*1000).toISOString() : null, requestKey, now, now);
  const payload: LinkRequest = { amount, currency: "INR", accept_partial: flexible, ...(flexible ? { first_min_partial_amount: input.minimum_partial_minor } : {}), reference_id: referenceId, description: `${invoice.invoice_number} - ${invoice.title}`.slice(0,255), customer: { name: invoice.client_name, ...(invoice.client_email ? { email: invoice.client_email } : {}), ...(invoice.client_phone ? { contact: invoice.client_phone } : {}) }, notify: { email: false, sms: false }, reminder_enable: false, ...(input.expire_by ? { expire_by: input.expire_by } : {}), notes: { invoice_id: invoice.id, collection_mode: input.mode } };
  try {
    const gateway = await request<GatewayLink>("/payment_links/", { method: "POST", body: JSON.stringify(payload) });
    let safePaymentUrl = false;
    try { safePaymentUrl = new URL(gateway.short_url).protocol === "https:"; } catch { /* invalid provider URL */ }
    if (!gateway.id || !safePaymentUrl || gateway.currency !== "INR" || gateway.amount !== amount) throw new RazorpayError("Razorpay returned a link that did not match the requested amount, currency, or secure URL requirements.", 502, true);
    const updated = stamp();
    await db.prepare("UPDATE razorpay_payment_links SET gateway_link_id=?,payment_url=?,gateway_status=?,expiry_at=?,create_state='created',updated_at=? WHERE id=?").run(gateway.id, gateway.short_url, gateway.status, gateway.expire_by ? new Date(gateway.expire_by*1000).toISOString() : null, updated, localId);
    return await db.prepare("SELECT * FROM razorpay_payment_links WHERE id=?").get(localId);
  } catch (error) {
    await db.prepare("UPDATE razorpay_payment_links SET create_state=?,gateway_status=?,updated_at=? WHERE id=?").run(error instanceof RazorpayError && error.uncertain ? "uncertain" : "failed", error instanceof RazorpayError && error.uncertain ? "unknown" : "failed", stamp(), localId);
    throw error;
  }
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function gatewayPayments(link: GatewayLink): GatewayPayment[] {
  return Array.isArray(link.payments) ? link.payments.map((payment) => ({ ...payment, id: payment.payment_id || payment.id || "" })).filter((payment) => payment.id) as GatewayPayment[] : [];
}

export async function reconcileLink(db: Db, localLinkId: string) {
  let stored = await db.prepare("SELECT * FROM razorpay_payment_links WHERE id=? AND create_state IN ('created','uncertain')").get(localLinkId) as any;
  if (!stored) throw new RazorpayError("Payment link was not found.", 404);
  if (stored.create_state === "uncertain" && !stored.gateway_link_id) {
    const collection = await request<{ payment_links?: GatewayLink[] }>(`/payment_links?reference_id=${encodeURIComponent(stored.gateway_reference_id)}`);
    const matches = (collection.payment_links || []).filter((item: any) => item.reference_id === stored.gateway_reference_id);
    if (!matches.length) throw new RazorpayError("Razorpay has not returned the uncertain link yet. Wait briefly and refresh again; do not create another link.", 503, true);
    if (matches.length !== 1) throw new RazorpayError("More than one Razorpay link matched the recovery reference. Review the links in Razorpay before continuing.", 409, true);
    const recovered = matches[0];
    if (!recovered.id || !recovered.short_url || recovered.amount !== stored.amount_minor || recovered.currency !== stored.currency || !recovered.short_url.startsWith("https://")) throw new RazorpayError("The recovered Razorpay link did not match the expected invoice amount and currency.", 502, true);
    await db.prepare("UPDATE razorpay_payment_links SET gateway_link_id=?,payment_url=?,gateway_status=?,gateway_amount_paid_minor=?,expiry_at=?,create_state='created',updated_at=? WHERE id=?").run(recovered.id, recovered.short_url, recovered.status, recovered.amount_paid || 0, recovered.expire_by ? new Date(recovered.expire_by*1000).toISOString() : null, stamp(), localLinkId);
    stored = await db.prepare("SELECT * FROM razorpay_payment_links WHERE id=?").get(localLinkId) as any;
  }
  if (!stored.gateway_link_id) throw new RazorpayError("Payment link has no recoverable Razorpay ID.", 409);
  const gateway = await request<GatewayLink>(`/payment_links/${encodeURIComponent(stored.gateway_link_id)}`);
  if (gateway.id !== stored.gateway_link_id || gateway.currency !== stored.currency || gateway.amount !== stored.amount_minor) throw new RazorpayError("Gateway link details do not match the stored invoice link.", 502);
  const rows = gatewayPayments(gateway);
  for (const item of rows) {
    const payment = await request<GatewayPayment>(`/payments/${encodeURIComponent(item.id)}`);
    recordGatewayPayment(db, stored, payment);
  }
  if (!Number.isSafeInteger(gateway.amount_paid) || gateway.amount_paid < 0 || gateway.amount_paid > gateway.amount) throw new RazorpayError("Gateway link reports an invalid paid amount.", 502);
  await db.prepare("UPDATE razorpay_payment_links SET gateway_status=?,gateway_amount_paid_minor=?,last_reconciled_at=?,updated_at=? WHERE id=?").run(gateway.status, gateway.amount_paid, stamp(), stamp(), localLinkId);
  return gateway;
}

export async function cancelPaymentLink(db: Db, invoiceId: string, localLinkId: string) {
  const link = await db.prepare("SELECT * FROM razorpay_payment_links WHERE id=? AND invoice_id=? AND create_state='created'").get(localLinkId, invoiceId) as any;
  if (!link?.gateway_link_id) throw new RazorpayError("Payment link was not found for this invoice.", 404);
  if (["paid", "cancelled", "expired"].includes(link.gateway_status)) throw new RazorpayError("This payment link is already closed.", 409);
  const gateway = await request<GatewayLink>(`/payment_links/${encodeURIComponent(link.gateway_link_id)}/cancel`, { method: "POST", body: "{}" });
  if (gateway.id !== link.gateway_link_id || gateway.currency !== link.currency || gateway.amount !== link.amount_minor) throw new RazorpayError("Gateway cancellation response did not match this invoice link.", 502);
  await db.prepare("UPDATE razorpay_payment_links SET gateway_status=?,gateway_amount_paid_minor=?,last_reconciled_at=?,updated_at=? WHERE id=?").run(gateway.status, gateway.amount_paid, stamp(), stamp(), localLinkId);
  return await db.prepare("SELECT * FROM razorpay_payment_links WHERE id=?").get(localLinkId);
}

export async function recordGatewayPayment(db: Db, link: any, payment: GatewayPayment) {
  if (!payment?.id || payment.payment_link_id !== link.gateway_link_id) throw new RazorpayError("Payment is not associated with this invoice payment link.", 409);
  if (payment.currency !== link.currency || !Number.isSafeInteger(payment.amount) || payment.amount <= 0 || payment.amount > link.amount_minor) throw new RazorpayError("Gateway payment amount or currency does not match the stored payment link.", 409);
  const status = payment.status;
  if (!(["captured", "failed", "authorized", "created"] as string[]).includes(status)) return;
  const date = new Date((payment.created_at || Math.floor(Date.now()/1000))*1000).toISOString().slice(0,10);
  await transaction(db, async () => {
    await db.prepare("INSERT INTO razorpay_payment_attempts(gateway_payment_id,invoice_id,payment_link_id,amount_minor,currency,payment_method,gateway_status,failure_summary,gateway_created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(gateway_payment_id) DO UPDATE SET gateway_status=excluded.gateway_status,failure_summary=excluded.failure_summary,payment_method=excluded.payment_method,updated_at=excluded.updated_at")
      .run(payment.id, link.invoice_id, link.id, payment.amount, payment.currency, payment.method || null, status, payment.error_description?.slice(0,500) || null, new Date((payment.created_at || Math.floor(Date.now()/1000))*1000).toISOString(), stamp());
    if (status !== "captured" || await db.prepare("SELECT 1 FROM invoice_payments WHERE gateway_payment_id=?").get(payment.id)) return;
    const paymentId = randomUUID(), key = `razorpay:${payment.id}`;
    await db.prepare("INSERT INTO invoice_payments(id,invoice_id,amount_minor,payment_date,payment_method,reference,notes,idempotency_key,created_at,gateway_payment_id,gateway_payment_link_id) VALUES(?,?,?,?,?,?,?, ?,?,?,?)")
      .run(paymentId, link.invoice_id, payment.amount, date, payment.method || null, payment.id, "Verified Razorpay payment", key, stamp(), payment.id, link.gateway_link_id);
  })();
}

export async function processWebhook(db: Db, rawBody: Buffer, signature: string | undefined, eventHeader?: string) {
  if (!verifyWebhookSignature(rawBody, signature)) throw new RazorpayError("Invalid Razorpay webhook signature.", 401);
  let payload: any;
  try { payload = JSON.parse(rawBody.toString("utf8")); } catch { throw new RazorpayError("Malformed Razorpay webhook payload.", 400); }
  if (!payload || typeof payload.event !== "string" || !payload.payload) throw new RazorpayError("Malformed Razorpay webhook payload.", 400);
  const eventId = eventHeader?.trim() || createHmac("sha256", "dedupe").update(rawBody).digest("hex");
  const linkEntity = payload.payload.payment_link?.entity;
  const paymentEntity = payload.payload.payment?.entity;
  const refundEntity = payload.payload.refund?.entity;
  const linkId = linkEntity?.id || paymentEntity?.payment_link_id || null;
  const paymentId = paymentEntity?.id || refundEntity?.payment_id || null;
  const now = stamp();
  const inserted = await db.prepare("INSERT INTO razorpay_webhook_events(event_id,event_type,gateway_link_id,gateway_payment_id,received_at,processing_status,attempts) VALUES(?,?,?,?,?,'received',1) ON CONFLICT(event_id) DO NOTHING").run(eventId, payload.event, linkId, paymentId, now).changes;
  if (!inserted) {
    const previous = await db.prepare("SELECT processing_status FROM razorpay_webhook_events WHERE event_id=?").get(eventId) as any;
    if (!previous || previous.processing_status !== "failed") return { duplicate: true };
    await db.prepare("UPDATE razorpay_webhook_events SET processing_status='received',attempts=attempts+1,error_summary=NULL WHERE event_id=?").run(eventId);
  }
  try {
    const knownLink = linkId ? await db.prepare("SELECT * FROM razorpay_payment_links WHERE gateway_link_id=?").get(linkId) as any : null;
    if (knownLink && paymentId) {
      const payment = await request<GatewayPayment>(`/payments/${encodeURIComponent(paymentId)}`);
      recordGatewayPayment(db, knownLink, payment);
    }
    if (knownLink && (payload.event.startsWith("payment_link.") || payload.event.startsWith("payment."))) await reconcileLink(db, knownLink.id);
    if (refundEntity?.id && paymentId) {
      const paymentRow = await db.prepare("SELECT id,invoice_id,amount_minor FROM invoice_payments WHERE gateway_payment_id=?").get(paymentId) as any;
      const priorRefunds = paymentRow ? (await db.prepare("SELECT COALESCE(SUM(amount_minor),0) total FROM razorpay_refunds WHERE invoice_payment_id=? AND status='processed' AND gateway_refund_id<>?").get(paymentRow.id, refundEntity.id) as any).total : 0;
      if (!paymentRow || !Number.isSafeInteger(refundEntity.amount) || refundEntity.amount <= 0 || refundEntity.amount > paymentRow.amount_minor-priorRefunds || refundEntity.currency !== "INR" || !["created", "processed", "failed"].includes(refundEntity.status)) throw new RazorpayError("Refund does not match a verified payment or exceeds its refundable balance.", 409);
      await db.prepare("INSERT INTO razorpay_refunds(id,gateway_refund_id,invoice_payment_id,gateway_payment_id,invoice_id,amount_minor,currency,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(gateway_refund_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at")
        .run(randomUUID(), refundEntity.id, paymentRow.id, paymentId, paymentRow.invoice_id, refundEntity.amount, refundEntity.currency, refundEntity.status, now, now);
    }
    await db.prepare("UPDATE razorpay_webhook_events SET processing_status=?,processed_at=? WHERE event_id=?").run(linkId || refundEntity ? "processed" : "ignored", stamp(), eventId);
    return { duplicate: false };
  } catch (error) {
    await db.prepare("UPDATE razorpay_webhook_events SET processing_status='failed',attempts=attempts+1,error_summary=? WHERE event_id=?").run(error instanceof Error ? error.message.slice(0,500) : "Processing failed", eventId);
    throw error;
  }
}

export async function invoicePaymentSummary(db: Db, invoiceId: string) {
  const row = await db.prepare(`SELECT i.total_minor,
    COALESCE((SELECT SUM(ip.amount_minor) FROM invoice_payments ip WHERE ip.invoice_id=i.id),0) paid_gross,
    COALESCE((SELECT SUM(pr.amount_minor) FROM payment_reversals pr JOIN invoice_payments ip ON ip.id=pr.invoice_payment_id WHERE ip.invoice_id=i.id),0) reversed_minor,
    COALESCE((SELECT SUM(rf.amount_minor) FROM razorpay_refunds rf WHERE rf.invoice_id=i.id AND rf.status='processed'),0) refunded_minor,
    (SELECT MAX(last_reconciled_at) FROM razorpay_payment_links WHERE invoice_id=i.id) last_reconciled_at FROM invoices i WHERE i.id=?`).get(invoiceId) as any;
  if (!row) return null;
  const netPaid = Math.max(0, row.paid_gross - row.reversed_minor - row.refunded_minor);
  const payment_status = row.refunded_minor ? netPaid ? "partially_refunded" : "refunded" : netPaid >= row.total_minor ? "paid" : netPaid ? "partially_paid" : "unpaid";
  return { total_minor: row.total_minor, paid_minor: netPaid, refunded_minor: row.refunded_minor, balance_minor: Math.max(0, row.total_minor - netPaid), payment_status, last_reconciled_at: row.last_reconciled_at };
}
