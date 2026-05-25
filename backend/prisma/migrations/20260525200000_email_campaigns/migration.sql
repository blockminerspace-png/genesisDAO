-- Email Marketing Campaign System
-- Campanhas de email: conteúdo, status, limites diários
CREATE TABLE IF NOT EXISTS "email_campaigns" (
  "id"                SERIAL PRIMARY KEY,
  "title"             VARCHAR(255)  NOT NULL,
  "subject"           VARCHAR(255)  NOT NULL,
  "body_html"         TEXT          NOT NULL,
  "image_url"         VARCHAR(500),
  "status"            VARCHAR(50)   NOT NULL DEFAULT 'draft',
  "daily_limit"       INTEGER       NOT NULL DEFAULT 750,
  "total_recipients"  INTEGER       NOT NULL DEFAULT 0,
  "total_sent"        INTEGER       NOT NULL DEFAULT 0,
  "total_failed"      INTEGER       NOT NULL DEFAULT 0,
  "created_by"        INTEGER,
  "created_at"        BIGINT        NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  "activated_at"      BIGINT,
  "completed_at"      BIGINT,
  "notes"             TEXT
);

-- Entregas por utilizador: garante que cada user recebe cada campanha uma única vez
CREATE TABLE IF NOT EXISTS "email_campaign_deliveries" (
  "id"            SERIAL    PRIMARY KEY,
  "campaign_id"   INTEGER   NOT NULL REFERENCES "email_campaigns"("id") ON DELETE CASCADE,
  "user_id"       INTEGER   NOT NULL,
  "email"         VARCHAR(255) NOT NULL,
  "status"        VARCHAR(50)  NOT NULL DEFAULT 'pending',
  "sent_at"       BIGINT,
  "error_message" VARCHAR(500),
  UNIQUE ("campaign_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "idx_ecd_campaign_status"
  ON "email_campaign_deliveries" ("campaign_id", "status");

CREATE INDEX IF NOT EXISTS "idx_ecd_status_pending"
  ON "email_campaign_deliveries" ("status")
  WHERE "status" = 'pending';
