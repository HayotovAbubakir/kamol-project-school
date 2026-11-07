PRAGMA foreign_keys = ON;

-- Homework: the student only submits content; the teacher decides the result.
ALTER TABLE homework_submissions ADD COLUMN video_note_url TEXT;
ALTER TABLE homework_submissions ADD COLUMN voice_url TEXT;

CREATE TABLE IF NOT EXISTS homework_review_history (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  homework_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  reviewer_id TEXT,
  reviewer_name TEXT NOT NULL DEFAULT '',
  old_status TEXT,
  new_status TEXT NOT NULL,
  old_comment TEXT NOT NULL DEFAULT '',
  new_comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS homework_review_history_submission_idx ON homework_review_history(submission_id);

-- Payments: corrections and voids are append-only audit records.
ALTER TABLE payments ADD COLUMN method TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE payments ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN voided_at TEXT;
ALTER TABLE payments ADD COLUMN voided_by TEXT;
ALTER TABLE payments ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE payments ADD COLUMN updated_at TEXT;
ALTER TABLE payments ADD COLUMN updated_by TEXT;

-- A failed earlier attempt left an empty legacy payment_audit table behind.
DROP TABLE IF EXISTS payment_audit;

CREATE TABLE payment_audit (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('corrected', 'voided')),
  actor_id TEXT,
  actor_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  old_data TEXT NOT NULL DEFAULT '{}',
  new_data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS payment_audit_payment_idx ON payment_audit(payment_id);

-- The monthly report must use only the teacher's result.
DROP VIEW IF EXISTS monthly_homework_report;

CREATE VIEW monthly_homework_report AS
SELECT
  s.id AS student_id,
  s.name AS student_name,
  date(substr(hs.submitted_at, 1, 7) || '-01') AS month_start,
  count(hs.id) AS total_submissions,
  sum(CASE WHEN hs.status = 'approved' THEN 1 ELSE 0 END) AS approved_count,
  sum(CASE WHEN hs.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
  sum(CASE WHEN hs.status = 'pending' THEN 1 ELSE 0 END) AS pending_count
FROM students s
LEFT JOIN homework_submissions hs ON hs.student_id = s.id
GROUP BY s.id, s.name, substr(hs.submitted_at, 1, 7);
