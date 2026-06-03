-- In-app announcements: popup "read once" per user after login

CREATE TABLE IF NOT EXISTS "in_app_announcements" (
  "id"          TEXT    PRIMARY KEY,
  "title"       TEXT    NOT NULL,
  "message"     TEXT    NOT NULL,
  "link"        TEXT,
  "is_active"   INTEGER NOT NULL DEFAULT 1,
  "priority"    INTEGER NOT NULL DEFAULT 0,
  "starts_at"   BIGINT,
  "ends_at"     BIGINT,
  "created_at"  BIGINT  NOT NULL,
  "created_by"  INTEGER
);

CREATE TABLE IF NOT EXISTS "in_app_announcement_reads" (
  "user_id"          INTEGER NOT NULL,
  "announcement_id"  TEXT    NOT NULL REFERENCES "in_app_announcements"("id") ON DELETE CASCADE,
  "read_at"          BIGINT  NOT NULL,
  PRIMARY KEY ("user_id", "announcement_id")
);

CREATE INDEX IF NOT EXISTS "idx_in_app_announcements_active_created"
  ON "in_app_announcements" ("is_active", "created_at");

CREATE INDEX IF NOT EXISTS "idx_in_app_announcement_reads_user_id"
  ON "in_app_announcement_reads" ("user_id");
