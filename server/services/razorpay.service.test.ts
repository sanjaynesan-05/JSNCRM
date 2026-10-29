import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { openDatabase } from "../db/database.ts";
import { createPaymentLink, invoicePaymentSummary, processWebhook, reconcileLink, razorpayConfiguration, RazorpayError } from "./razorpay.service.ts";

test("Razorpay links, server verified payments, webhook signatures and deduplication", async (t) => {
  const db = openDatabase(":memory:");
  const savedFetch = globalThis.fetch;
  const old = { key: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET, webhook: process.env.RAZORPAY_WEBHOOK_SECRET, mode: process.env.RAZORPAY_MODE };
  process.env.RAZORPAY_KEY_ID = "rzp_test_mock";
  process.env.RAZORPAY_KEY_SECRET = "test-secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "webhook-secret";
  process.env.RAZORPAY_MODE = "test";
  const stamp = new Date().toISOString();
  const clientId = "10000000-0000-4000-8000-000000000001", invoiceId = "10000000-0000-4000-8000-000000000002";
  db.prepare("INSERT INTO clients(id,client_code,name,email,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(clientId,"CL-TEST","Test Client","client@example.com",stamp,stamp);
  db.prepare("INSERT INTO invoices(id,invoice_number,client_id,title,subtotal_minor,total_minor,issue_date,status,created_at,updated_at,issued_at) VALUES(?,?,?,?,?,?,?,'issued',?,?,?)").run(invoiceId,"INV-2026-0001",clientId,"Design work",200000,200000,"2026-10-20",stamp,stamp,stamp);
  t.after(() => { globalThis.fetch = savedFetch; for (const [k,v] of Object.entries({ RAZORPAY_KEY_ID:old.key, RAZORPAY_KEY_SECRET:old.secret, RAZORPAY_WEBHOOK_SECRET:old.webhook, RAZORPAY_MODE:old.mode })) if (v === undefined) delete process.env[k]; else process.env[k] = v; db.close(); });

  assert.equal(razorpayConfiguration().configured, true);
  let simulateUncertainCreate = false, createCalls = 0;
  const createdLinkAmounts = new Map<string, number>();
  const recoveryInvoice="10000000-0000-4000-8000-000000000003";
  db.prepare("INSERT INTO invoices(id,invoice_number,client_id,title,subtotal_minor,total_minor,issue_date,status,created_at,updated_at,issued_at) VALUES(?,?,?,?,?,?,?,'issued',?,?,?)").run(recoveryInvoice,"INV-2026-0002",clientId,"Recovery work",50000,50000,"2026-10-20",stamp,stamp,stamp);
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url=String(input);
    if (init?.method === "POST") { createCalls++; if (simulateUncertainCreate) throw Object.assign(new Error("aborted"),{name:"AbortError"}); const id=`plink_test_${createCalls}`, payload=JSON.parse(String(init.body)); createdLinkAmounts.set(id,payload.amount); return new Response(JSON.stringify({ id,short_url:`https://rzp.io/i/${id}`,status:"created",amount:payload.amount,currency:payload.currency,expire_by:0 }), {status:200}); }
    if (url.includes("/payment_links?reference_id=")) { const reference=new URL(url).searchParams.get("reference_id"); return new Response(JSON.stringify({payment_links:[{id:"plink_recovered",reference_id:reference,short_url:"https://rzp.io/i/recovered",status:"created",amount:50000,amount_paid:0,currency:"INR",payments:[]}]}),{status:200}); }
    const createdLink = url.match(/\/payment_links\/(plink_test_\d+)$/)?.[1];
    if (createdLink === "plink_test_1") return new Response(JSON.stringify({ id:createdLink,amount:createdLinkAmounts.get(createdLink),amount_paid:150000,currency:"INR",status:"partially_paid",payments:[{payment_id:"pay_test_1"}] }),{status:200});
    if (createdLink) return new Response(JSON.stringify({id:createdLink,amount:createdLinkAmounts.get(createdLink),amount_paid:0,currency:"INR",status:"created",payments:[]}),{status:200});
    if (url.endsWith("/payment_links/plink_recovered")) return new Response(JSON.stringify({id:"plink_recovered",short_url:"https://rzp.io/i/recovered",amount:50000,amount_paid:0,currency:"INR",status:"created",payments:[]}),{status:200});
    if (url.endsWith("/payments/pay_test_1")) return new Response(JSON.stringify({ id:"pay_test_1",payment_link_id:"plink_test_1",amount:150000,currency:"INR",status:"captured",method:"upi",created_at:1792454400 }),{status:200});
    return new Response(JSON.stringify({ error:{description:"unknown mock request"} }),{status:404});
  }) as typeof fetch;

  const link = await createPaymentLink(db,invoiceId,{mode:"flexible",minimum_partial_minor:100});
  assert.equal((link as any).amount_minor,200000);
  assert.equal((await createPaymentLink(db,invoiceId,{mode:"flexible",minimum_partial_minor:100}) as any).reused,true);
  await assert.rejects(() => createPaymentLink(db,invoiceId,{mode:"flexible",minimum_partial_minor:200}), (error:any) => error instanceof RazorpayError && error.status===409);
  await assert.rejects(() => createPaymentLink(db,invoiceId,{mode:"advance",amount_minor:200001}), (error:any) => error instanceof RazorpayError && error.status===400);
  await reconcileLink(db,(link as any).id);
  await reconcileLink(db,(link as any).id);
  assert.equal((await invoicePaymentSummary(db,invoiceId))?.paid_minor,150000);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM invoice_payments WHERE gateway_payment_id='pay_test_1'").get() && (db.prepare("SELECT COUNT(*) count FROM invoice_payments WHERE gateway_payment_id='pay_test_1'").get() as any).count,1);

  const advanceInvoice="10000000-0000-4000-8000-000000000004";
  db.prepare("INSERT INTO invoices(id,invoice_number,client_id,title,subtotal_minor,total_minor,issue_date,status,created_at,updated_at,issued_at) VALUES(?,?,?,?,?,?,?,'issued',?,?,?)").run(advanceInvoice,"INV-2026-0003",clientId,"Advance work",200000,200000,"2026-10-20",stamp,stamp,stamp);
  const advance = await createPaymentLink(db,advanceInvoice,{mode:"advance",amount_minor:50000});
  const differentAdvance = await createPaymentLink(db,advanceInvoice,{mode:"advance",amount_minor:100000});
  assert.equal((differentAdvance as any).amount_minor,100000,"an advance link with a different amount must not be reused");
  assert.notEqual((differentAdvance as any).id,(advance as any).id);

  const beforeUncertainCreate = createCalls;
  simulateUncertainCreate=true;
  await assert.rejects(() => createPaymentLink(db,recoveryInvoice,{mode:"balance"}), (error:any) => error instanceof RazorpayError && error.uncertain);
  const uncertain = db.prepare("SELECT id,create_state FROM razorpay_payment_links WHERE invoice_id=?").get(recoveryInvoice) as any;
  assert.equal(uncertain.create_state,"uncertain");
  simulateUncertainCreate=false;
  await reconcileLink(db,uncertain.id);
  assert.equal((db.prepare("SELECT gateway_link_id,create_state FROM razorpay_payment_links WHERE id=?").get(uncertain.id) as any).gateway_link_id,"plink_recovered");
  assert.equal(createCalls,beforeUncertainCreate+1,"recovery must not submit a second link creation request");

  const payload=Buffer.from(JSON.stringify({event:"unknown.event",payload:{}}));
  const signature=createHmac("sha256","webhook-secret").update(payload).digest("hex");
  await assert.rejects(() => processWebhook(db,payload,"0".repeat(64),"evt_bad"), (error:any) => error instanceof RazorpayError && error.status===401);
  assert.deepEqual(await processWebhook(db,payload,signature,"evt_test_1"),{duplicate:false});
  assert.deepEqual(await processWebhook(db,payload,signature,"evt_test_1"),{duplicate:true});
  assert.equal((db.prepare("SELECT processing_status FROM razorpay_webhook_events WHERE event_id='evt_test_1'").get() as any).processing_status,"ignored");
});

test("Razorpay configuration stays disabled when live credentials conflict with test mode", () => {
  const oldKey=process.env.RAZORPAY_KEY_ID,oldSecret=process.env.RAZORPAY_KEY_SECRET,oldMode=process.env.RAZORPAY_MODE;
  try { process.env.RAZORPAY_KEY_ID="rzp_live_fake";process.env.RAZORPAY_KEY_SECRET="not-a-real-secret";process.env.RAZORPAY_MODE="test";assert.equal(razorpayConfiguration().configured,false); }
  finally { if(oldKey===undefined)delete process.env.RAZORPAY_KEY_ID;else process.env.RAZORPAY_KEY_ID=oldKey;if(oldSecret===undefined)delete process.env.RAZORPAY_KEY_SECRET;else process.env.RAZORPAY_KEY_SECRET=oldSecret;if(oldMode===undefined)delete process.env.RAZORPAY_MODE;else process.env.RAZORPAY_MODE=oldMode; }
});
