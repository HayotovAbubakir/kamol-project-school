-- Face ID (Hikvision DS-K1T terminal) — o‘quvchi rasmlari, qurilmalar, sinxronizatsiya va kirish hodisalari.

-- O‘quvchi yuz rasmlari (R2 da saqlanadi). Har bir burchakdan bittadan: jami 3 ta.
CREATE TABLE IF NOT EXISTS student_faces (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  angle TEXT NOT NULL CHECK (angle IN ('front', 'left', 'right')),
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, angle)
);

-- Qurilmadagi employeeNo: UUID 32 belgidan uzun, shuning uchun barqaror qisqa raqam beriladi.
CREATE TABLE IF NOT EXISTS face_people (
  student_id TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  employee_no INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS face_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  serial TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  last_event_at TEXT,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- O‘quvchi × qurilma sinxronizatsiya holati. O‘quvchi o‘chirilsa ham qator qoladi (action = 'delete'),
-- shunda bridge foydalanuvchini qurilmadan ham o‘chira oladi.
CREATE TABLE IF NOT EXISTS face_sync (
  student_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES face_devices(id) ON DELETE CASCADE,
  employee_no INTEGER NOT NULL,
  person_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT 'upsert' CHECK (action IN ('upsert', 'delete')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'error')),
  version INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  synced_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (student_id, device_id)
);

CREATE INDEX IF NOT EXISTS face_sync_device_status_idx ON face_sync(device_id, status);

CREATE TABLE IF NOT EXISTS face_events (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES face_devices(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL UNIQUE,
  employee_no TEXT,
  student_id TEXT,
  event_time TEXT NOT NULL,
  major INTEGER,
  minor INTEGER,
  raw TEXT NOT NULL DEFAULT '{}',
  processed INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS face_events_student_time_idx ON face_events(student_id, event_time);

-- Dars tugagach "kelmadi" belgilangan darslar (cron qayta ishlamasligi uchun).
CREATE TABLE IF NOT EXISTS face_lesson_closures (
  group_id TEXT NOT NULL,
  date TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  absent_count INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, date, slot_id)
);

ALTER TABLE attendance ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'face'));
ALTER TABLE attendance ADD COLUMN checked_in_at TEXT;
ALTER TABLE attendance ADD COLUMN late_minutes INTEGER;

-- Bot xabarlari uchun manba va kechikish daqiqalari ham uzatiladi.
DROP TRIGGER IF EXISTS attendance_bot_event_insert;
DROP TRIGGER IF EXISTS attendance_bot_event_update;

CREATE TRIGGER attendance_bot_event_insert
AFTER INSERT ON attendance
BEGIN
  INSERT INTO bot_events (table_name, row_data)
  VALUES ('attendance', json_object(
    'student_id', NEW.student_id, 'group_id', NEW.group_id, 'date', NEW.date,
    'status', NEW.status, 'note', NEW.note, 'source', NEW.source,
    'late_minutes', NEW.late_minutes, 'checked_in_at', NEW.checked_in_at
  ));
END;

CREATE TRIGGER attendance_bot_event_update
AFTER UPDATE ON attendance
WHEN NEW.status IS NOT OLD.status
  OR NEW.note IS NOT OLD.note
  OR NEW.late_minutes IS NOT OLD.late_minutes
BEGIN
  INSERT INTO bot_events (table_name, row_data)
  VALUES ('attendance', json_object(
    'student_id', NEW.student_id, 'group_id', NEW.group_id, 'date', NEW.date,
    'status', NEW.status, 'note', NEW.note, 'source', NEW.source,
    'late_minutes', NEW.late_minutes, 'checked_in_at', NEW.checked_in_at
  ));
END;
