ALTER TABLE payments ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX uq_payments_idempotency_key ON payments(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  source_order_id TEXT REFERENCES orders(id) ON DELETE RESTRICT,
  source_quotation_id TEXT REFERENCES quotations(id) ON DELETE RESTRICT,
  reissued_from_id TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency = 'INR'),
  subtotal_minor INTEGER NOT NULL CHECK(subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0),
  total_minor INTEGER NOT NULL CHECK(total_minor >= 0),
  issue_date TEXT NOT NULL,
  due_date TEXT,
  terms TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','void')),
  client_snapshot TEXT,
  business_snapshot TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  issued_at TEXT,
  voided_at TEXT
);
CREATE TABLE invoice_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK(line_total_minor >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE invoice_payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  order_payment_id TEXT UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  payment_date TEXT NOT NULL,
  payment_method TEXT,
  reference TEXT,
  notes TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE invoice_status_history (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  metadata TEXT
);
CREATE TABLE invoice_number_sequences (
  year TEXT PRIMARY KEY CHECK(length(year)=4),
  last_number INTEGER NOT NULL CHECK(last_number >= 0)
);
CREATE INDEX idx_invoices_client ON invoices(client_id, created_at);
CREATE INDEX idx_invoices_status_date ON invoices(status, issue_date, due_date);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id, sort_order);
CREATE INDEX idx_invoice_payments_invoice ON invoice_payments(invoice_id, payment_date);
CREATE UNIQUE INDEX uq_invoice_payment_reference ON invoice_payments(invoice_id, lower(trim(reference))) WHERE reference IS NOT NULL AND trim(reference) <> '';
CREATE INDEX idx_invoice_history_invoice ON invoice_status_history(invoice_id, changed_at);
CREATE UNIQUE INDEX uq_active_invoice_order ON invoices(source_order_id) WHERE source_order_id IS NOT NULL AND status <> 'void';
CREATE UNIQUE INDEX uq_active_invoice_quotation ON invoices(source_quotation_id) WHERE source_quotation_id IS NOT NULL AND status <> 'void';
