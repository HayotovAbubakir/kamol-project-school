CREATE TABLE refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX refresh_tokens_account_id_idx ON refresh_tokens(account_id);
CREATE INDEX refresh_tokens_expires_at_idx ON refresh_tokens(expires_at);
