import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeDatabase, setDatabaseForTests } from "./db/database.ts";
import { createApp } from "./app.ts";
import { extractPdfText } from "./quotation-pdf-test-utils.ts";

test("invoice lifecycle, immutable PDF snapshots, and shared order-payment allocation", async (t) => {
  const root=mkdtempSync(join(tmpdir(),"jsn-invoice-test-")),dbPath=join(root,"business.sqlite");
  process.env.DATABASE_PATH=dbPath;process.env.BACKUP_DIR=join(root,"backups");process.env.GMAIL_USER="";process.env.GMAIL_APP_PASSWORD="";
  const db=initializeDatabase(),server=createServer(createApp());
  try {
    await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  } catch(error) {
    const cause=error as NodeJS.ErrnoException;
    if(cause.code!=="EACCES") throw error;
    setDatabaseForTests();delete process.env.DATABASE_PATH;delete process.env.BACKUP_DIR;rmSync(root,{recursive:true,force:true});
    t.diagnostic("This runtime blocks loopback TCP; invoice API integration checks are skipped here.");
    t.skip("Invoice API integration requires local TCP access.");
    return;
  }
  const address=server.address();assert(address&&typeof address!=="string");const base=`http://127.0.0.1:${address.port}/api`;
  const call=async(path:string,method="GET",body?:unknown)=>{const response=await fetch(`${base}${path}`,{method,headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});const data:any= response.headers.get("content-type")?.includes("application/json")?await response.json():Buffer.from(await response.arrayBuffer());return {status:response.status,data,headers:response.headers};};
  try { await fetch(`${base}/health`); } catch(error) {
    const cause=(error as TypeError & {cause?:NodeJS.ErrnoException}).cause;
    if(cause?.code!=="EACCES") throw error;
    await new Promise<void>(resolve=>server.close(()=>resolve()));setDatabaseForTests();delete process.env.DATABASE_PATH;delete process.env.BACKUP_DIR;rmSync(root,{recursive:true,force:true});
    t.diagnostic("This runtime blocks loopback TCP; invoice API integration checks are skipped here.");
    t.skip("Invoice API integration requires local TCP access.");
    return;
  }
  t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));setDatabaseForTests();delete process.env.DATABASE_PATH;delete process.env.BACKUP_DIR;rmSync(root,{recursive:true,force:true});});
  const clientResponse=await call("/clients","POST",{name:"Invoice snapshot client",company_name:"Original Company",email:"invoice@example.com",phone:"+91 9000000000",address:"Original address"});
  assert.equal(clientResponse.status,201);const client=clientResponse.data as any;
  const direct=await call("/invoices","POST",{client_id:client.id,title:"Independent design work",items:[{description:"Design work",quantity:2,unit_price_minor:10000,discount_minor:0}],discount_minor:0,issue_date:"2020-01-01",due_date:"2020-01-02",terms:"Payment due on receipt.",notes:"Internal note"});
  assert.equal(direct.status,201);const invoice=direct.data as any;assert.equal(invoice.invoice_number,"INV-2020-0001");assert.equal(invoice.total_minor,20000);assert.equal(invoice.status,"draft");
  const issued=await call(`/invoices/${invoice.id}/status`,`PATCH`,{action:"issue"});assert.equal(issued.status,200);assert.equal(issued.data.status,"overdue");
  const updateClient=await call(`/clients/${client.id}`,"PUT",{name:"Changed Client",company_name:"Changed Company",email:"changed@example.com",phone:"+91 8111111111",address:"Changed address",notes:""});assert.equal(updateClient.status,200);
  const pdf=await call(`/invoices/${invoice.id}/pdf`);assert.equal(pdf.status,200);assert.equal((pdf.data as Buffer).subarray(0,5).toString(),"%PDF-");const text=await extractPdfText(pdf.data as Buffer);assert.ok(text.text.includes("Original Company"));assert.ok(text.text.includes("Original address"));assert.ok(text.text.includes("INR 200.00"));assert.ok(text.text.includes("Balance due"));
  const key="9eceec4c-3373-4eae-86a3-688bc85882d0";
  const payment=await call(`/invoices/${invoice.id}/payments`,"POST",{amount_minor:5000,payment_date:"2020-01-03",payment_method:"Bank transfer",reference:"INV-DIRECT-1",notes:"Part payment",idempotency_key:key});assert.equal(payment.status,201);assert.equal(payment.data.paid_minor,5000);assert.equal(payment.data.balance_minor,15000);assert.equal(payment.data.status,"partially_paid");
  const duplicated=await call(`/invoices/${invoice.id}/payments`,"POST",{amount_minor:5000,payment_date:"2020-01-03",payment_method:"Bank transfer",reference:"INV-DIRECT-1",idempotency_key:key});assert.equal(duplicated.status,409);
  const overpay=await call(`/invoices/${invoice.id}/payments`,"POST",{amount_minor:15001,payment_date:"2020-01-03",idempotency_key:"1d695e47-d381-4f4b-9a5d-c5bd2d649c27"});assert.equal(overpay.status,409);
  const immutable=await call(`/invoices/${invoice.id}`,"PUT",{client_id:client.id,title:"Changed",items:[{description:"Changed",quantity:1,unit_price_minor:1,discount_minor:0}],discount_minor:0,issue_date:"2020-01-01"});assert.equal(immutable.status,409);
  const paid=await call(`/invoices/${invoice.id}/payments`,"POST",{amount_minor:15000,payment_date:"2020-01-04",idempotency_key:"a9e8d1a9-e8c4-4166-90ae-36f60ec863e2"});assert.equal(paid.status,201);assert.equal(paid.data.status,"paid");assert.equal(paid.data.balance_minor,0);

  const orderResponse=await call("/orders","POST",{client_id:client.id,title:"Order backed work",agreed_amount_minor:30000,priority:"normal",order_date:"2020-02-01"});assert.equal(orderResponse.status,201);const order=orderResponse.data as any;
  const existing=await call(`/orders/${order.id}/payments`,"POST",{amount_minor:5000,payment_date:"2020-02-02",payment_method:"UPI",reference:"ORDER-1"});assert.equal(existing.status,201);
  const linked=await call("/invoices","POST",{client_id:client.id,source_order_id:order.id,title:"ignored",items:[{description:"ignored",quantity:1,unit_price_minor:1,discount_minor:0}],discount_minor:0,issue_date:"2020-02-01",confirm_source:true});assert.equal(linked.status,201);assert.equal(linked.data.total_minor,30000);assert.equal(linked.data.paid_minor,5000);
  const linkedIssued=await call(`/invoices/${linked.data.id}/status`,`PATCH`,{action:"issue"});assert.equal(linkedIssued.status,200);assert.equal(linkedIssued.data.status,"partially_paid");
  const sameReceipt=await call(`/invoices/${linked.data.id}/payments`,"POST",{amount_minor:5000,payment_date:"2020-02-02",payment_method:"UPI",reference:"ORDER-1",idempotency_key:"5ec0cc66-f3bd-4267-9f4d-e41a395d3ac5"});assert.equal(sameReceipt.status,409);
  const allocated=await call(`/invoices/${linked.data.id}/payments`,"POST",{amount_minor:10000,payment_date:"2020-02-04",payment_method:"Bank transfer",reference:"ORDER-2",idempotency_key:"7bb73fd5-c880-4bd5-b8c8-80cf4408fba2"});assert.equal(allocated.status,201);assert.equal(allocated.data.paid_minor,15000);
  const orderPayments=await call(`/orders/${order.id}/payments`);assert.equal((orderPayments.data as any[]).length,2);assert.equal((orderPayments.data as any[]).reduce((n,p)=>n+p.amount_minor,0),15000);assert.equal(allocated.data.paid_minor,(orderPayments.data as any[]).reduce((n,p)=>n+p.amount_minor,0));
  const duplicateOrderPayment=await call(`/orders/${order.id}/payments`,"POST",{amount_minor:10000,payment_date:"2020-02-04",payment_method:"Bank transfer",reference:"ORDER-2"});assert.equal(duplicateOrderPayment.status,409);
  const repeatedSource=await call("/invoices","POST",{client_id:client.id,source_order_id:order.id,title:"again",items:[{description:"x",quantity:1,unit_price_minor:1,discount_minor:0}],issue_date:"2020-02-01",confirm_source:true});assert.equal(repeatedSource.status,409);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM invoice_payments WHERE order_payment_id IS NOT NULL").get() as any).count,2);
  assert.equal((db.prepare("SELECT COUNT(*) count FROM payments WHERE order_id=?").get(order.id) as any).count,2);
});
