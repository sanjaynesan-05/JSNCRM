ALTER TABLE invoice_payments ADD COLUMN gateway_payment_id TEXT;
ALTER TABLE invoice_payments ADD COLUMN gateway_payment_link_id TEXT;
CREATE UNIQUE INDEX uq_invoice_payments_gateway_payment ON invoice_payments(gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;
CREATE TABLE razorpay_payment_links (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  gateway_link_id TEXT UNIQUE,
  gateway_reference_id TEXT NOT NULL UNIQUE,
  payment_url TEXT,
  collection_mode TEXT NOT NULL CHECK(collection_mode IN ('advance','balance','flexible')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  gateway_amount_paid_minor INTEGER NOT NULL DEFAULT 0 CHECK(gateway_amount_paid_minor >= 0),
  minimum_partial_minor INTEGER CHECK(minimum_partial_minor IS NULL OR minimum_partial_minor >= 100),
  currency TEXT NOT NULL CHECK(currency='INR'),
  gateway_status TEXT NOT NULL,
  expiry_at TEXT,
  create_request_key TEXT NOT NULL UNIQUE,
  create_state TEXT NOT NULL DEFAULT 'creating' CHECK(create_state IN ('creating','created','uncertain','failed')),
  last_reconciled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_razorpay_links_invoice ON razorpay_payment_links(invoice_id,created_at);
CREATE TABLE razorpay_payment_attempts (
  gateway_payment_id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  payment_link_id TEXT NOT NULL REFERENCES razorpay_payment_links(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  currency TEXT NOT NULL CHECK(currency='INR'),
  payment_method TEXT,
  gateway_status TEXT NOT NULL,
  failure_summary TEXT,
  gateway_created_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_razorpay_attempts_invoice ON razorpay_payment_attempts(invoice_id,gateway_created_at);
CREATE TABLE razorpay_refunds (
  id TEXT PRIMARY KEY,
  gateway_refund_id TEXT NOT NULL UNIQUE,
  invoice_payment_id TEXT NOT NULL REFERENCES invoice_payments(id) ON DELETE RESTRICT,
  gateway_payment_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  currency TEXT NOT NULL CHECK(currency='INR'),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_razorpay_refunds_invoice ON razorpay_refunds(invoice_id,created_at);
CREATE TABLE razorpay_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  gateway_link_id TEXT,
  gateway_payment_id TEXT,
  received_at TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK(processing_status IN ('received','processed','ignored','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  processed_at TEXT
);
CREATE INDEX idx_razorpay_events_status ON razorpay_webhook_events(processing_status,received_at);
CREATE TABLE invoice_email_deliveries (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  recipient TEXT NOT NULL,
  email_type TEXT NOT NULL DEFAULT 'invoice_payment',
  payment_link_id TEXT REFERENCES razorpay_payment_links(id) ON DELETE SET NULL,
  pdf_filename TEXT NOT NULL,
  delivery_status TEXT NOT NULL CHECK(delivery_status IN ('sending','sent','failed','unknown')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  error_summary TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_invoice_email_deliveries_invoice ON invoice_email_deliveries(invoice_id,created_at);
