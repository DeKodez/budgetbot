-- Migration number: 0001 	 2025-11-29T03:49:42.122Z
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts_utc TEXT NOT NULL,
  ts_sg_date TEXT NOT NULL,
  ts_sg_month TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_sg_date   ON expenses (ts_sg_date);
CREATE INDEX IF NOT EXISTS idx_expenses_sg_month  ON expenses (ts_sg_month);
CREATE INDEX IF NOT EXISTS idx_expenses_category  ON expenses (category);

CREATE TABLE IF NOT EXISTS user_state (
  user_id INTEGER PRIMARY KEY,
  step TEXT NOT NULL,
  category TEXT
);
