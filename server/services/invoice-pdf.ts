import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Writable } from "node:stream";

const logoPath = fileURLToPath(new URL("../../src/assets/JSN DESIGN.png", import.meta.url));
const money = (minor: number, currency = "INR") => new Intl.NumberFormat("en-IN", { style: "currency", currency, currencyDisplay: "code" }).format(minor / 100).replace(/\u00a0/g, " ");
type Item = { description: string; quantity: number; unit_price_minor: number; discount_minor: number; line_total_minor: number };
type Invoice = {
  invoice_number: string; title: string; currency: string; status: string; issue_date: string; due_date: string | null;
  subtotal_minor: number; discount_minor: number; total_minor: number; paid_minor: number; balance_minor: number; terms: string | null;
  client_name?: string; company_name?: string | null; client_email?: string | null; client_phone?: string | null; client_address?: string | null;
  business_name?: string; contact_person?: string; business_email?: string; business_phone?: string; business_address?: string; business_website?: string;
};
export function createInvoicePdf(data: Invoice, items: Item[], destination?: Writable, onError?: (error: Error) => void) {
  const safe = (v: unknown) => String(v ?? "").replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,"-").replace(/\u2026/g,"...").replace(/[^\x20-\x7e\x80-\xff\n\t]/g,"?");
  const d = Object.fromEntries(Object.entries(data).map(([k,v])=>[k,typeof v==="string"?safe(v):v])) as Invoice;
  const rows = items.map((i)=>({...i,description:safe(i.description)}));
  const doc = new PDFDocument({size:"A4",margin:46,info:{Title:`Invoice ${d.invoice_number}`,Author:d.business_name||"Business"}});
  if(onError)doc.on("error",onError); if(destination)doc.pipe(destination);
  const margin=46,width=doc.page.width-margin*2,muted="#66736f",green="#20594f";
  let page=1;
  const footer=()=>{const bottom=doc.page.margins.bottom;doc.page.margins.bottom=10;doc.y=doc.page.height-28;doc.font("Helvetica").fontSize(8).fillColor(muted).text(`${d.invoice_number}  |  Page ${page}`,margin,doc.page.height-28,{width,align:"right",lineBreak:false});doc.page.margins.bottom=bottom;doc.y=margin;};
  doc.on("pageAdded",()=>{page++;footer();}); footer();
  if(existsSync(logoPath))doc.image(logoPath,margin,40,{fit:[58,58]});
  const businessX=existsSync(logoPath)?margin+72:margin;
  doc.font("Helvetica-Bold").fontSize(18).fillColor(green).text(d.business_name||"Business",businessX,44,{width:width-72});
  const contact=[d.contact_person,d.business_email,d.business_phone,d.business_address,d.business_website].filter(Boolean).join("  |  ");
  if(contact)doc.font("Helvetica").fontSize(8.5).text(contact,businessX,67,{width:width-72,lineGap:2});
  doc.moveTo(margin,106).lineTo(doc.page.width-margin,106).strokeColor("#d9e2de").stroke();
  doc.font("Helvetica-Bold").fontSize(22).fillColor(green).text("INVOICE",margin,122);
  doc.font("Helvetica").fontSize(10).fillColor("#18211e").text(`Invoice number  ${d.invoice_number}`,margin,153).text(`Status  ${d.status.replace("_"," ")}`,margin,169).text(`Issue date  ${d.issue_date}`,margin,185).text(`Due date  ${d.due_date||"Not set"}`,margin,201);
  const cx=doc.page.width/2+5;doc.font("Helvetica-Bold").fontSize(8).fillColor(muted).text("BILLED TO",cx,127);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#18211e").text(d.client_name||"Client",cx,142,{width:doc.page.width/2-margin-5});
  const client=[d.company_name,d.client_email,d.client_phone,d.client_address].filter(Boolean).join("\n");
  if(client)doc.font("Helvetica").fontSize(9).text(client,cx,158,{width:doc.page.width/2-margin-5,lineGap:2});
  let y=Math.max(doc.y,220)+12;
  doc.font("Helvetica-Bold").fontSize(14).fillColor(green).text(d.title,margin,y,{width}); y=doc.y+10;
  const col={description:margin+8,qty:margin+287,unit:margin+336,amount:margin+424};
  const tableHeader=()=>{doc.rect(margin,y,width,25).fill(green);doc.font("Helvetica-Bold").fontSize(8.5).fillColor("white").text("DESCRIPTION",col.description,y+8,{width:267}).text("QTY",col.qty,y+8,{width:43,align:"right"}).text("UNIT PRICE",col.unit,y+8,{width:82,align:"right"}).text("LINE TOTAL",col.amount,y+8,{width:76,align:"right"});y+=25;};
  tableHeader();
  rows.forEach((item,index)=>{doc.font("Helvetica").fontSize(9);const h=Math.max(26,doc.heightOfString(item.description,{width:267,lineGap:2})+14);if(y+h>doc.page.height-margin-70){doc.addPage();y=margin;tableHeader();}if(index%2)doc.rect(margin,y,width,h).fill("#f4f7f5");doc.font("Helvetica").fontSize(9).fillColor("#25312c").text(item.description,col.description,y+7,{width:267,lineGap:2}).text(String(item.quantity),col.qty,y+7,{width:43,align:"right"}).text(money(item.unit_price_minor,d.currency),col.unit,y+7,{width:82,align:"right"}).text(money(item.line_total_minor,d.currency),col.amount,y+7,{width:76,align:"right"});y+=h;doc.moveTo(margin,y).lineTo(doc.page.width-margin,y).strokeColor("#e0e7e3").stroke();});
  if(y+130>doc.page.height-margin-30){doc.addPage();y=margin;} y+=12;
  const labelX=doc.page.width-margin-202,valueX=doc.page.width-margin-104;
  const row=(label:string,value:string,bold=false)=>{doc.font(bold?"Helvetica-Bold":"Helvetica").fontSize(bold?12:9.5).fillColor(bold?green:muted).text(label,labelX,y,{width:115}).text(value,valueX,y,{width:104,align:"right"});y+=bold?23:18;};
  row("Subtotal",money(d.subtotal_minor,d.currency)); if(d.discount_minor)row("Discount",`- ${money(d.discount_minor,d.currency)}`);doc.moveTo(labelX,y-3).lineTo(doc.page.width-margin,y-3).strokeColor(green).stroke();row("TOTAL",money(d.total_minor,d.currency),true);row("Amount paid",money(d.paid_minor,d.currency));row("Balance due",money(d.balance_minor,d.currency),true);
  if(d.terms){if(y+60>doc.page.height-margin-30){doc.addPage();y=margin;}y+=12;doc.font("Helvetica-Bold").fontSize(10).fillColor(green).text("Payment terms",margin,y);y=doc.y+5;doc.font("Helvetica").fontSize(8.5).fillColor("#34413c").text(safe(d.terms),margin,y,{width,lineGap:3});}
  doc.end();return doc;
}
