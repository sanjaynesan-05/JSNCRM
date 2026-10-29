CREATE TABLE IF NOT EXISTS invoice_number_sequences (
  year TEXT PRIMARY KEY CHECK(length(year)=4),
  last_number INTEGER NOT NULL CHECK(last_number >= 0)
);
