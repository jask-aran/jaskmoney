PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_pending_reconciliations_status;
DROP INDEX IF EXISTS idx_transactions_merchant;
DROP INDEX IF EXISTS idx_transactions_category;
DROP INDEX IF EXISTS idx_transactions_status_date;
DROP INDEX IF EXISTS idx_transactions_account_date;
DROP INDEX IF EXISTS idx_transactions_external_id;
DROP INDEX IF EXISTS idx_transactions_source_hash;

DROP TABLE IF EXISTS pending_reconciliations;
DROP TABLE IF EXISTS merchant_rules;
DROP TABLE IF EXISTS transaction_tags;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS accounts;
