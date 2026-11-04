CREATE TABLE IF NOT EXISTS mirror_rooms (
  code TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mirror_rooms_expires ON mirror_rooms (expires);
