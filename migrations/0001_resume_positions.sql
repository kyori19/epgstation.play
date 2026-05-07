CREATE TABLE IF NOT EXISTS resume_positions (
  recording_id TEXT PRIMARY KEY,
  position_sec REAL NOT NULL DEFAULT 0,
  duration_sec REAL NOT NULL DEFAULT 0,
  watched_ratio REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resume_positions_watched_ratio
  ON resume_positions (watched_ratio);

CREATE INDEX IF NOT EXISTS idx_resume_positions_updated_at
  ON resume_positions (updated_at DESC);
