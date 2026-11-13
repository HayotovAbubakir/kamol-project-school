-- Guruh oylik narxi tarixi: narx o‘zgarsa, o‘tgan oylar qarzi eski narxda hisoblanadi.
-- `valid_from` — 'YYYY-MM' (Toshkent vaqti). Narx shu oydan boshlab amal qiladi.
CREATE TABLE IF NOT EXISTS group_fee_history (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  monthly_fee REAL NOT NULL DEFAULT 0,
  valid_from TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (group_id, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_group_fee_history_group ON group_fee_history (group_id, valid_from);

-- Mavjud guruhlar: hozirgi narx barcha o‘tgan oylarga ham amal qiladi (avvalgi xatti-harakat saqlanadi).
INSERT OR IGNORE INTO group_fee_history (group_id, monthly_fee, valid_from)
SELECT id, COALESCE(monthly_fee, 0), '2000-01' FROM groups;

-- Yangi guruh: narx yaratilgan oydan boshlab.
CREATE TRIGGER IF NOT EXISTS trg_group_fee_history_insert
AFTER INSERT ON groups
BEGIN
  INSERT OR REPLACE INTO group_fee_history (group_id, monthly_fee, valid_from)
  VALUES (NEW.id, COALESCE(NEW.monthly_fee, 0), strftime('%Y-%m', 'now', '+5 hours'));
END;

-- Narx o‘zgarsa: joriy oydan boshlab yangi narx; bir oyda bir necha marta o‘zgarsa oxirgisi qoladi.
CREATE TRIGGER IF NOT EXISTS trg_group_fee_history_update
AFTER UPDATE OF monthly_fee ON groups
WHEN COALESCE(OLD.monthly_fee, 0) <> COALESCE(NEW.monthly_fee, 0)
BEGIN
  INSERT OR REPLACE INTO group_fee_history (group_id, monthly_fee, valid_from)
  VALUES (NEW.id, COALESCE(NEW.monthly_fee, 0), strftime('%Y-%m', 'now', '+5 hours'));
END;
