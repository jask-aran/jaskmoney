PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  institution TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('checking','savings','credit','investment')),
  created_at DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  external_id TEXT,
  date DATE NOT NULL,
  posted_date DATE,
  amount INTEGER NOT NULL,
  raw_description TEXT NOT NULL,
  merchant_name TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  comment TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','posted','reconciled')) DEFAULT 'posted',
  source_hash TEXT,
  created_at DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS transaction_tags (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (transaction_id, tag_id)
);

CREATE TABLE IF NOT EXISTS merchant_rules (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('exact','contains','regex')),
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  source TEXT NOT NULL CHECK (source IN ('user','llm')),
  created_at DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS pending_reconciliations (
  id TEXT PRIMARY KEY,
  transaction_a_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  transaction_b_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  similarity_score REAL NOT NULL CHECK (similarity_score >= 0.0 AND similarity_score <= 1.0),
  llm_confidence REAL CHECK (llm_confidence >= 0.0 AND llm_confidence <= 1.0),
  llm_reasoning TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','merged','dismissed')) DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_source_hash
  ON transactions(source_hash)
  WHERE source_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_external_id
  ON transactions(account_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_account_date
  ON transactions(account_id, date);

CREATE INDEX IF NOT EXISTS idx_transactions_status_date
  ON transactions(status, date);

CREATE INDEX IF NOT EXISTS idx_transactions_category
  ON transactions(category_id);

CREATE INDEX IF NOT EXISTS idx_transactions_merchant
  ON transactions(merchant_name);

CREATE INDEX IF NOT EXISTS idx_pending_reconciliations_status
  ON pending_reconciliations(status);
