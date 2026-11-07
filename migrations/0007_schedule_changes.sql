CREATE TABLE schedule_versions (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  schedule TEXT NOT NULL,
  change_id TEXT,
  created_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX schedule_versions_group_dates_idx
  ON schedule_versions(group_id, valid_from, valid_to);

CREATE TRIGGER schedule_versions_history_no_delete
BEFORE DELETE ON schedule_versions
BEGIN
  SELECT RAISE(ABORT, 'Schedule versions cannot be deleted');
END;

CREATE TRIGGER schedule_versions_history_immutable
BEFORE UPDATE ON schedule_versions
WHEN NEW.group_id != OLD.group_id
  OR NEW.valid_from != OLD.valid_from
  OR NEW.schedule != OLD.schedule
  OR NEW.change_id IS NOT OLD.change_id
  OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_at != OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'Schedule version history is immutable');
END;

INSERT INTO schedule_versions (id, group_id, valid_from, schedule, created_at)
SELECT 'initial-' || id, id, '0001-01-01', schedule, CURRENT_TIMESTAMP
FROM groups;

CREATE TRIGGER groups_schedule_seed_version
AFTER INSERT ON groups
WHEN NOT EXISTS (SELECT 1 FROM schedule_versions WHERE group_id = NEW.id)
BEGIN
  INSERT INTO schedule_versions (id, group_id, valid_from, schedule, created_at)
  VALUES ('initial-' || NEW.id, NEW.id, '0001-01-01', NEW.schedule, CURRENT_TIMESTAMP);
END;

CREATE TRIGGER groups_schedule_requires_version
BEFORE UPDATE OF schedule ON groups
WHEN NEW.schedule IS NOT OLD.schedule
BEGIN
  SELECT RAISE(ABORT, 'Use schedule version endpoints to change a group schedule');
END;

CREATE TABLE schedule_changes (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL UNIQUE,
  change_type TEXT NOT NULL CHECK (change_type IN ('single', 'permanent', 'replace')),
  actor_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL DEFAULT '',
  old_data TEXT NOT NULL,
  new_data TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reverted')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reverted_at TEXT
);

CREATE INDEX schedule_changes_group_created_idx ON schedule_changes(group_id, created_at DESC);

CREATE TABLE schedule_overrides (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL,
  original_date TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('change', 'cancel')),
  original_start_time TEXT NOT NULL,
  original_end_time TEXT NOT NULL,
  new_start_time TEXT,
  new_end_time TEXT,
  new_date TEXT,
  new_teacher_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  change_id TEXT NOT NULL REFERENCES schedule_changes(id) ON DELETE RESTRICT,
  changed_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reverted_at TEXT
);

CREATE UNIQUE INDEX schedule_overrides_one_active_idx
  ON schedule_overrides(group_id, slot_id, original_date)
  WHERE reverted_at IS NULL;

CREATE INDEX schedule_overrides_dates_idx
  ON schedule_overrides(group_id, original_date, new_date);

CREATE TABLE schedule_change_events (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES schedule_changes(id) ON DELETE RESTRICT,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  request_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'reverted')),
  actor_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX schedule_change_events_request_idx
  ON schedule_change_events(request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX schedule_change_events_group_idx
  ON schedule_change_events(group_id, created_at DESC);

CREATE TRIGGER schedule_change_events_no_update
BEFORE UPDATE ON schedule_change_events
BEGIN
  SELECT RAISE(ABORT, 'Schedule change history is append-only');
END;

CREATE TRIGGER schedule_change_events_no_delete
BEFORE DELETE ON schedule_change_events
BEGIN
  SELECT RAISE(ABORT, 'Schedule change history is append-only');
END;

CREATE TABLE schedule_notification_outbox (
  id TEXT PRIMARY KEY,
  change_id TEXT NOT NULL REFERENCES schedule_changes(id) ON DELETE RESTRICT,
  recipient_id TEXT NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'in_app')),
  notification_kind TEXT NOT NULL CHECK (notification_kind IN ('change', 'reminder', 'undo')),
  telegram_id INTEGER,
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'not_linked')),
  scheduled_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (change_id, recipient_id, channel, notification_kind)
);

CREATE INDEX schedule_notification_outbox_due_idx
  ON schedule_notification_outbox(status, scheduled_at, next_attempt_at);

CREATE INDEX schedule_notification_recipient_idx
  ON schedule_notification_outbox(recipient_id, channel, scheduled_at DESC);
