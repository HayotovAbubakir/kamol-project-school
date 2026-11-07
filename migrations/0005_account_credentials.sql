ALTER TABLE profiles ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN password_ciphertext TEXT;
ALTER TABLE students ADD COLUMN password_iv TEXT;

CREATE TABLE student_credential_audit (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL CHECK (action IN ('reveal', 'change')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX student_credential_audit_rate_idx
  ON student_credential_audit(actor_id, student_id, action, created_at);

CREATE TABLE auth_failure_events (
  id TEXT PRIMARY KEY,
  identifier_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX auth_failure_events_created_at_idx ON auth_failure_events(created_at);

DELETE FROM telegram_links
WHERE rowid NOT IN (
  SELECT MAX(rowid) FROM telegram_links GROUP BY student_id
);
CREATE UNIQUE INDEX telegram_links_student_id_unique_idx ON telegram_links(student_id);
