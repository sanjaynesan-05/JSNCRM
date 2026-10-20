CREATE TABLE order_status_history (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  metadata TEXT
);
CREATE INDEX idx_order_status_history_order ON order_status_history(order_id, changed_at);

CREATE TABLE task_status_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  metadata TEXT
);
CREATE INDEX idx_task_status_history_task ON task_status_history(task_id, changed_at);

CREATE TABLE payment_reversals (
  id TEXT PRIMARY KEY,
  order_payment_id TEXT UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  invoice_payment_id TEXT UNIQUE REFERENCES invoice_payments(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  reason TEXT NOT NULL,
  reversed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(order_payment_id IS NOT NULL OR invoice_payment_id IS NOT NULL)
);
CREATE INDEX idx_payment_reversals_reversed_at ON payment_reversals(reversed_at);
CREATE TRIGGER payment_reversal_validate BEFORE INSERT ON payment_reversals
BEGIN
  SELECT CASE
    WHEN NEW.order_payment_id IS NOT NULL AND
      NEW.amount_minor <> (SELECT amount_minor FROM payments WHERE id=NEW.order_payment_id)
    THEN RAISE(ABORT, 'payment reversal amount must match the order payment')
  END;
  SELECT CASE
    WHEN NEW.invoice_payment_id IS NOT NULL AND
      NEW.amount_minor <> (SELECT amount_minor FROM invoice_payments WHERE id=NEW.invoice_payment_id)
    THEN RAISE(ABORT, 'payment reversal amount must match the invoice payment')
  END;
  SELECT CASE
    WHEN NEW.order_payment_id IS NOT NULL AND NEW.invoice_payment_id IS NOT NULL AND
      NOT EXISTS (SELECT 1 FROM invoice_payments WHERE id=NEW.invoice_payment_id AND order_payment_id=NEW.order_payment_id)
    THEN RAISE(ABORT, 'order and invoice payment references do not match')
  END;
END;

INSERT INTO order_status_history(id,order_id,previous_status,new_status,changed_at,metadata)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-a' || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),id,NULL,status,created_at,'{"source":"migration-baseline"}'
FROM orders;

INSERT INTO task_status_history(id,task_id,previous_status,new_status,changed_at,metadata)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-a' || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),id,NULL,status,created_at,'{"source":"migration-baseline"}'
FROM tasks;
