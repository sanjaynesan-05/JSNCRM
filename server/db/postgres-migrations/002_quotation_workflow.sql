CREATE TABLE quotation_status_history (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL CHECK(new_status IN ('draft','sent','accepted','rejected','expired','cancelled')),
  changed_at TEXT NOT NULL,
  metadata TEXT
);
CREATE INDEX idx_quotation_history_quote ON quotation_status_history(quotation_id,changed_at);
CREATE TABLE business_profile (
  id INTEGER PRIMARY KEY CHECK(id=1),
  business_name TEXT NOT NULL DEFAULT '',
  contact_person TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  default_terms TEXT NOT NULL DEFAULT '',
  default_validity_days INTEGER NOT NULL DEFAULT 30 CHECK(default_validity_days BETWEEN 1 AND 365),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
  updated_at TEXT NOT NULL
);
INSERT INTO business_profile(id,updated_at) VALUES(1,CURRENT_TIMESTAMP);
