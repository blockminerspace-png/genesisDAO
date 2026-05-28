-- Integração ZERads PTC (Site ID 11294) — callback externo a cada ~5 min com
-- `amount` em ZER e `clicks` por utilizador. Convertemos ZER→USDC (taxa fixa
-- via .env), split 80/20, creditamos só os 80% do user em `game_states.usdc`.

-- Token opaco por utilizador entregue ao ZERads na URL ?user=<token>
CREATE TABLE IF NOT EXISTS "zerads_user_tokens" (
  "user_id"    INTEGER       PRIMARY KEY,
  "token"      VARCHAR(64)   NOT NULL UNIQUE,
  "created_at" BIGINT        NOT NULL
);

-- Ledger append-only de ganhos ZERads (idempotência por bucket de 5 min).
CREATE TABLE IF NOT EXISTS "zerads_earnings_ledger" (
  "id"                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  "idempotency_key"      VARCHAR(240)  NOT NULL UNIQUE,
  "user_id"              INTEGER       NOT NULL,
  "amount_zer"           DOUBLE PRECISION NOT NULL,
  "amount_usdc_total"    DOUBLE PRECISION NOT NULL,
  "user_amount_usdc"     DOUBLE PRECISION NOT NULL,
  "platform_amount_usdc" DOUBLE PRECISION NOT NULL,
  "clicks"               INTEGER       NOT NULL,
  "zer_to_usdc_rate"     DOUBLE PRECISION NOT NULL,
  "created_at"           BIGINT        NOT NULL
);

CREATE INDEX IF NOT EXISTS "zerads_earnings_ledger_user_id_created_at_idx"
  ON "zerads_earnings_ledger" ("user_id", "created_at");

-- Log de todos os callbacks ZERads (sucesso e falha) — auditoria + anti-abuso.
CREATE TABLE IF NOT EXISTS "zerads_callback_log" (
  "id"         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"    INTEGER,
  "raw_user"   VARCHAR(120),
  "amount_zer" DOUBLE PRECISION,
  "clicks"     INTEGER,
  "cf_ip"      VARCHAR(80),
  "req_ip"     VARCHAR(80),
  "status"     VARCHAR(40)  NOT NULL,
  "message"    TEXT,
  "created_at" BIGINT       NOT NULL
);

CREATE INDEX IF NOT EXISTS "zerads_callback_log_user_id_created_at_idx"
  ON "zerads_callback_log" ("user_id", "created_at");

CREATE INDEX IF NOT EXISTS "zerads_callback_log_status_created_at_idx"
  ON "zerads_callback_log" ("status", "created_at");
