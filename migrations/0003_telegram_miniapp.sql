CREATE TABLE telegram_invites (
  code_hash TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES profiles(id),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX telegram_invites_profile_id_idx ON telegram_invites(profile_id);
CREATE INDEX telegram_invites_expires_at_idx ON telegram_invites(expires_at);

CREATE UNIQUE INDEX profiles_telegram_id_unique_idx
  ON profiles(telegram_id)
  WHERE telegram_id IS NOT NULL;

CREATE TABLE bot_pending_homework (
  chat_id INTEGER PRIMARY KEY,
  homework_id TEXT NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TRIGGER homework_submissions_bot_event_insert
AFTER INSERT ON homework_submissions
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
