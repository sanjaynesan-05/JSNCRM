import test from "node:test";
import assert from "node:assert/strict";
import { createInvoicePdf } from "./services/invoice-pdf.ts";
import { extractPdfText } from "./quotation-pdf-test-utils.ts";

test("invoice PDF renders persisted snapshot, balances, terms, and paginated lines", async () => {
  const chunks:Buffer[]=[];
  const pdf=createInvoicePdf({invoice_number:"INV-2026-0001",title:"Identity services",currency:"INR",status:"partially_paid",issue_date:"2026-10-01",due_date:"2026-10-15",subtotal_minor:25000,discount_minor:2500,total_minor:22500,paid_minor:5000,balance_minor:17500,terms:"Payment due within 14 days.",client_name:"Snapshot client",company_name:"Snapshot company",client_email:"snapshot@example.test",client_phone:"+91 90000 00000",client_address:"Mumbai",business_name:"Snapshot business",contact_person:"Studio",business_email:"studio@example.test",business_phone:"+91 80000 00000",business_address:"Mumbai",business_website:"https://example.test"},[
    {description:"Logo design",quantity:2,unit_price_minor:10000,discount_minor:0,line_total_minor:20000},
    {description:"Brand guide",quantity:1,unit_price_minor:5000,discount_minor:0,line_total_minor:5000},
  ]);
  pdf.on("data",(chunk:Buffer)=>chunks.push(chunk));
  await new Promise<void>((resolve,reject)=>{pdf.on("end",resolve);pdf.on("error",reject);});
  const buffer=Buffer.concat(chunks);assert.equal(buffer.subarray(0,5).toString(),"%PDF-");
  const extracted=await extractPdfText(buffer);
  for(const text of ["INV-2026-0001","Snapshot company","Snapshot client","Logo design","INR 225.00","INR 50.00","INR 175.00","Payment due within 14 days.","Page 1"])assert.ok(extracted.text.includes(text),`Missing ${text}: ${extracted.text}`);
  const many=Array.from({length:90},(_,index)=>({description:`Invoice line ${index+1} ${"Detailed service description ".repeat(7)}`,quantity:1,unit_price_minor:1000,discount_minor:0,line_total_minor:1000}));
  const doc=createInvoicePdf({invoice_number:"INV-2026-0002",title:"Long invoice",currency:"INR",status:"issued",issue_date:"2026-10-01",due_date:null,subtotal_minor:90000,discount_minor:0,total_minor:90000,paid_minor:0,balance_minor:90000,terms:null},many);const pages:Buffer[]=[];doc.on("data",(c:Buffer)=>pages.push(c));await new Promise<void>((resolve,reject)=>{doc.on("end",resolve);doc.on("error",reject);});const longText=await extractPdfText(Buffer.concat(pages));assert.ok(longText.pageCount>1);assert.ok(longText.text.includes("Page 1"));assert.ok(longText.text.includes("Invoice line 90"));
});
