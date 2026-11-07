PRAGMA foreign_keys = OFF;

UPDATE profiles SET role = 'reception' WHERE role = 'admin';

CREATE TABLE profiles_new (
  id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'reception', 'teacher', 'student')),
  teacher_id TEXT,
  student_id TEXT,
  telegram_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO profiles_new (id, username, name, role, teacher_id, student_id, telegram_id, created_at)
SELECT id, username, name, role, teacher_id, student_id, telegram_id, created_at FROM profiles;
DROP TABLE profiles;
ALTER TABLE profiles_new RENAME TO profiles;
CREATE INDEX profiles_teacher_id_idx ON profiles(teacher_id);
CREATE INDEX profiles_student_id_idx ON profiles(student_id);
CREATE UNIQUE INDEX profiles_telegram_id_unique_idx
  ON profiles(telegram_id) WHERE telegram_id IS NOT NULL;

ALTER TABLE accounts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

DROP TRIGGER IF EXISTS homework_submissions_bot_event_insert;
DROP TRIGGER IF EXISTS homework_submissions_bot_event_update;
ALTER TABLE homework_submissions RENAME TO homework_submissions_legacy;
CREATE TABLE homework_submissions (
  id TEXT PRIMARY KEY,
  homework_id TEXT NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  file_url TEXT,
  text_answer TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted', 'checked', 'expired')),
  student_result TEXT CHECK (student_result IN ('done', 'not_done')),
  student_reason TEXT NOT NULL DEFAULT '',
  teacher_result TEXT CHECK (teacher_result IN ('done', 'not_done')),
  review_note TEXT NOT NULL DEFAULT '',
  feedback TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  submitted_at TEXT,
  expires_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (homework_id, student_id, attempt_number)
);
INSERT INTO homework_submissions (
  id, homework_id, student_id, attempt_number, file_url, text_answer, content_text,
  status, state, review_note, feedback, reviewed_by, reviewed_at, submitted_at, created_at
)
SELECT id, homework_id, student_id, 1, file_url, text_answer, content_text, status,
  CASE WHEN status IN ('approved', 'rejected') THEN 'checked' ELSE 'submitted' END,
  review_note, feedback, reviewed_by, reviewed_at, submitted_at, created_at
FROM homework_submissions_legacy;
DROP TABLE homework_submissions_legacy;
CREATE INDEX homework_submissions_student_id_idx ON homework_submissions(student_id);
CREATE INDEX homework_submissions_homework_id_idx ON homework_submissions(homework_id);
CREATE UNIQUE INDEX homework_submissions_one_active_draft_idx
  ON homework_submissions(homework_id, student_id) WHERE state = 'draft';

CREATE TABLE homework_submission_files (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES homework_submissions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('attachment', 'voice', 'video_note')),
  r2_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  duration_seconds REAL,
  telegram_chat_id INTEGER,
  telegram_message_id INTEGER,
  telegram_file_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX homework_submission_files_submission_id_idx ON homework_submission_files(submission_id);
CREATE UNIQUE INDEX homework_submission_single_proof_idx
  ON homework_submission_files(submission_id) WHERE kind IN ('voice', 'video_note');

CREATE TABLE homework_events (
  id TEXT PRIMARY KEY,
  homework_id TEXT NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  submission_id TEXT REFERENCES homework_submissions(id) ON DELETE SET NULL,
  student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
  actor_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'draft_created', 'file_added', 'proof_added', 'submitted', 'student_done',
    'student_not_done', 'teacher_done', 'teacher_not_done', 'comment',
    'resubmitted', 'expired'
  )),
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX homework_events_homework_id_idx ON homework_events(homework_id, created_at);
CREATE INDEX homework_events_student_id_idx ON homework_events(student_id, created_at);
CREATE TRIGGER homework_events_no_update
BEFORE UPDATE ON homework_events BEGIN SELECT RAISE(ABORT, 'Homework history is append-only'); END;
CREATE TRIGGER homework_events_no_delete
BEFORE DELETE ON homework_events BEGIN SELECT RAISE(ABORT, 'Homework history is append-only'); END;

CREATE TABLE payment_audit (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX payment_audit_payment_id_idx ON payment_audit(payment_id, created_at);
CREATE TRIGGER payment_audit_no_update
BEFORE UPDATE ON payment_audit BEGIN SELECT RAISE(ABORT, 'Payment audit is append-only'); END;
CREATE TRIGGER payment_audit_no_delete
BEFORE DELETE ON payment_audit BEGIN SELECT RAISE(ABORT, 'Payment audit is append-only'); END;

CREATE TABLE question_tickets (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  tagged_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE question_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES question_tickets(id) ON DELETE CASCADE,
  actor_id TEXT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('student', 'reception', 'owner', 'teacher')),
  body TEXT NOT NULL DEFAULT '',
  file_key TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX question_tickets_status_idx ON question_tickets(status, last_message_at);
CREATE INDEX question_messages_ticket_idx ON question_messages(ticket_id, created_at);

CREATE TRIGGER homework_submissions_bot_event_insert
AFTER INSERT ON homework_submissions
WHEN NEW.state = 'submitted'
BEGIN
  INSERT INTO bot_events (table_name, row_data)
  VALUES ('homework_submissions', json_object(
    'id', NEW.id, 'homework_id', NEW.homework_id, 'student_id', NEW.student_id,
    'status', NEW.status, 'title', (SELECT title FROM homework WHERE id = NEW.homework_id)
  ));
END;
CREATE TRIGGER homework_submissions_bot_event_update
AFTER UPDATE OF status, feedback, review_note ON homework_submissions
WHEN OLD.status != NEW.status OR OLD.feedback != NEW.feedback OR OLD.review_note != NEW.review_note
BEGIN
  INSERT INTO bot_events (table_name, row_data)
  VALUES ('homework_submissions', json_object(
    'id', NEW.id, 'homework_id', NEW.homework_id, 'student_id', NEW.student_id,
    'status', NEW.status, 'feedback', NEW.feedback, 'review_note', NEW.review_note,
    'title', (SELECT title FROM homework WHERE id = NEW.homework_id)
  ));
END;

DROP VIEW IF EXISTS monthly_homework_report;
CREATE VIEW monthly_homework_report AS
SELECT
  st.id AS student_id,
  st.name AS student_name,
  date(substr(COALESCE(h.due_at, h.created_at), 1, 7) || '-01') AS month_start,
  COUNT(h.id) AS assigned_count,
  SUM(CASE WHEN hs.submitted_at IS NOT NULL AND (
    h.due_at IS NULL OR julianday(hs.submitted_at) <= julianday(h.due_at)
  ) THEN 1 ELSE 0 END) AS submitted_on_time_count,
  SUM(CASE WHEN hs.submitted_at IS NOT NULL AND h.due_at IS NOT NULL
    AND julianday(hs.submitted_at) > julianday(h.due_at) THEN 1 ELSE 0 END) AS late_count,
  SUM(CASE WHEN hs.student_result = 'not_done'
    OR hs.teacher_result = 'not_done'
    OR (hs.submitted_at IS NULL AND h.due_at IS NOT NULL AND julianday(h.due_at) < julianday('now'))
    THEN 1 ELSE 0 END) AS not_done_count,
  SUM(CASE WHEN hs.teacher_result = 'done' THEN 1 ELSE 0 END) AS bajardi_count,
  SUM(CASE WHEN hs.teacher_result = 'not_done' THEN 1 ELSE 0 END) AS bajarmadi_count
FROM homework h
JOIN group_students gs ON gs.group_id = h.group_id
JOIN students st ON st.id = gs.student_id
LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = st.id
  AND hs.attempt_number = (
    SELECT MAX(latest.attempt_number) FROM homework_submissions latest
    WHERE latest.homework_id = h.id AND latest.student_id = st.id
  )
GROUP BY st.id, st.name, substr(COALESCE(h.due_at, h.created_at), 1, 7);

PRAGMA foreign_keys = ON;
