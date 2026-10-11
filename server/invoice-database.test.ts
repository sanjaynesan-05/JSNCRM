import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeDatabase, restoreDatabase, setDatabaseForTests } from "./db/database.ts";

test("invoice migration and backup restore preserve invoices and payment history", async (t) => {
  const localTemp=join(process.cwd(),"tmp");mkdirSync(localTemp,{recursive:true});
  const root=mkdtempSync(join(localTemp,"jsn-invoice-backup-")),path=join(root,"business.sqlite"),backup=join(root,"snapshot.sqlite");
  process.env.DATABASE_PATH=path;
  const db=initializeDatabase();
  t.after(()=>{setDatabaseForTests();delete process.env.DATABASE_PATH;rmSync(root,{recursive:true,force:true});});
  assert.equal((db.prepare("SELECT MAX(version) version FROM schema_migrations").get() as any).version,3);
  const client="e1c57022-b6b1-48c0-9c8a-f3a156c428e0",invoice="a1805f82-b184-453f-88c6-f876c3b37ed9",item="7e2fa54c-b82c-440e-bf07-9bb6979f93ee",payment="2880bd36-4472-42f9-8cf2-5aa3d4758250",stamp=new Date().toISOString();
  db.prepare("INSERT INTO clients(id,client_code,name,created_at,updated_at) VALUES(?,?,?,?,?)").run(client,"CL-INVOICE-1","Invoice Backup Client",stamp,stamp);
  db.prepare("INSERT INTO invoices(id,invoice_number,client_id,title,subtotal_minor,discount_minor,total_minor,issue_date,status,client_snapshot,business_snapshot,created_at,updated_at,issued_at) VALUES(?,?,?,?,?,0,?,?,'issued',?,?,?, ?,?)").run(invoice,"INV-2026-0001",client,"Backup invoice",12500,12500,"2026-10-01",JSON.stringify({name:"Invoice Backup Client"}),JSON.stringify({business_name:"JSN Designs"}),stamp,stamp,stamp);
  assert.throws(()=>db.prepare("INSERT INTO invoices(id,invoice_number,client_id,title,subtotal_minor,total_minor,issue_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run("bcb65ec7-3892-42f5-aaf4-111ba5e2ce88","INV-2026-0001",client,"Duplicate",100,100,"2026-10-01",stamp,stamp),/UNIQUE/i);
  db.prepare("INSERT INTO invoice_items(id,invoice_id,description,quantity,unit_price_minor,line_total_minor) VALUES(?,?,?,1,12500,12500)").run(item,invoice,"Persisted backup line");
  db.prepare("INSERT INTO invoice_payments(id,invoice_id,amount_minor,payment_date,reference,idempotency_key,created_at) VALUES(?,?,2500,?,?,?,?)").run(payment,invoice,"2026-10-02","BACKUP-REF","391a79bb-48c5-4d91-969c-28cd83d50b42",stamp);
  await db.backup(backup);
  restoreDatabase(backup);
  const restored=initializeDatabase();
  assert.equal((restored.prepare("SELECT invoice_number FROM invoices WHERE id=?").get(invoice) as any).invoice_number,"INV-2026-0001");
  assert.equal((restored.prepare("SELECT description FROM invoice_items WHERE id=?").get(item) as any).description,"Persisted backup line");
  assert.equal((restored.prepare("SELECT amount_minor FROM invoice_payments WHERE id=?").get(payment) as any).amount_minor,2500);
  assert.equal((restored.pragma("foreign_key_check") as unknown[]).length,0);
});
