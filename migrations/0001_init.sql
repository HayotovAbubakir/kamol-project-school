PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER NOT NULL DEFAULT 100000,
  password_reset_required INTEGER NOT NULL DEFAULT 1,
  session_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE login_attempts (
  identifier TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE profiles (
  id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'teacher', 'student', 'reception')),
  teacher_id TEXT,
  student_id TEXT,
  telegram_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  monthly_salary REAL NOT NULL DEFAULT 0,
  telegram_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  teacher_id TEXT,
  monthly_fee REAL NOT NULL DEFAULT 0,
  schedule TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE students (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  parent_phone TEXT NOT NULL DEFAULT '',
  monthly_fee REAL NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL DEFAULT (date('now')),
  public_code TEXT UNIQUE,
  login TEXT UNIQUE COLLATE NOCASE,
  auth_user_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  telegram_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE telegram_links (
  chat_id INTEGER PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE group_students (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, student_id)
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
  student_name TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL CHECK (amount > 0),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL CHECK (year >= 2000),
  paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE salary_payments (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL DEFAULT 'Operatsion',
  date TEXT NOT NULL DEFAULT (date('now')),
  recorded_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE attendance (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  date TEXT NOT NULL DEFAULT (date('now')),
  status TEXT NOT NULL CHECK (status IN ('present', 'late', 'absent')),
  note TEXT NOT NULL DEFAULT '',
  marked_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, group_id, date)
);

CREATE TABLE staff_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('reception', 'owner', 'teacher')),
  user_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  created_by TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE homework (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  teacher_id TEXT REFERENCES teachers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  deadline TEXT,
  file_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE homework_submissions (
  id TEXT PRIMARY KEY,
  homework_id TEXT NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  file_url TEXT,
  text_answer TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  feedback TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (homework_id, student_id)
);

CREATE TABLE bot_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bot_event_cursors (
  name TEXT PRIMARY KEY,
  last_event_id INTEGER NOT NULL DEFAULT 0
);

CREATE TRIGGER attendance_bot_event_insert
AFTER INSERT ON attendance
BEGIN
  INSERT INTO bot_events (table_name, row_data)
  VALUES ('attendance', json_object(
    'student_id', NEW.student_id, 'group_id', NEW.group_id, 'date', NEW.date,
    'status', NEW.status, 'note', NEW.note
  ));
END;

CREATE TRIGGER attendance_bot_event_update
AFTER UPDATE ON attendance
BEGIN
  INSERT INTO bot_events (table_name, row_data)
  VALUES ('attendance', json_object(
    'student_id', NEW.student_id, 'group_id', NEW.group_id, 'date', NEW.date,
    'status', NEW.status, 'note', NEW.note
  ));
END;

CREATE TRIGGER payments_bot_event_insert
AFTER INSERT ON payments
BEGIN
  INSERT INTO bot_events (table_name, row_data)
  VALUES ('payments', json_object(
    'student_id', NEW.student_id, 'student_name', NEW.student_name,
    'amount', NEW.amount, 'month', NEW.month, 'year', NEW.year
  ));
END;

CREATE INDEX profiles_teacher_id_idx ON profiles(teacher_id);
CREATE INDEX profiles_student_id_idx ON profiles(student_id);
CREATE INDEX group_students_student_id_idx ON group_students(student_id);
CREATE INDEX homework_group_id_idx ON homework(group_id);
CREATE INDEX homework_submissions_student_id_idx ON homework_submissions(student_id);
CREATE INDEX payments_paid_at_idx ON payments(paid_at);
CREATE INDEX attendance_date_idx ON attendance(date);

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
