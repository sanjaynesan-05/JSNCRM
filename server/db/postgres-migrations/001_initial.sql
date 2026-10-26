CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  client_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  company_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE quotations (
  id TEXT PRIMARY KEY,
  quotation_number TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  currency TEXT NOT NULL DEFAULT 'INR',
  subtotal_minor INTEGER NOT NULL DEFAULT 0 CHECK(subtotal_minor >= 0),
  discount_type TEXT NOT NULL DEFAULT 'none' CHECK(discount_type IN ('none','fixed','percentage')),
  discount_value DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(discount_value >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0),
  tax_minor INTEGER NOT NULL DEFAULT 0 CHECK(tax_minor >= 0),
  total_minor INTEGER NOT NULL DEFAULT 0 CHECK(total_minor >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','accepted','rejected','expired','cancelled')),
  issue_date TEXT NOT NULL,
  valid_until TEXT,
  terms TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE quotation_items (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL CHECK(quantity > 0),
  unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor >= 0),
  line_total_minor INTEGER NOT NULL CHECK(line_total_minor >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  quotation_id TEXT UNIQUE REFERENCES quotations(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  requirements TEXT NOT NULL DEFAULT '',
  agreed_amount_minor INTEGER NOT NULL CHECK(agreed_amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','confirmed','in_progress','client_review','revisions','ready_for_delivery','delivered','on_hold','cancelled','closed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  order_date TEXT NOT NULL,
  start_date TEXT,
  due_date TEXT,
  delivered_at TEXT,
  internal_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_date TEXT NOT NULL,
  payment_method TEXT,
  reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  due_date TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_quotations_client ON quotations(client_id);
CREATE INDEX idx_quotations_status ON quotations(status);
CREATE INDEX idx_quotation_items_quote ON quotation_items(quotation_id);
CREATE INDEX idx_orders_client ON orders(client_id);
CREATE INDEX idx_orders_status_due ON orders(status,due_date);
CREATE INDEX idx_payments_order ON payments(order_id);
CREATE INDEX idx_tasks_order_status_due ON tasks(order_id,status,due_date);
