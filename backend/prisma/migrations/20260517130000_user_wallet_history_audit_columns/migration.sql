-- Auditoria: origem da alteração de carteira (append-only; não remove linhas existentes).

ALTER TABLE "user_wallet_history" ADD COLUMN IF NOT EXISTS "actor_type" VARCHAR(24) NOT NULL DEFAULT 'user';
ALTER TABLE "user_wallet_history" ADD COLUMN IF NOT EXISTS "actor_user_id" INTEGER;
ALTER TABLE "user_wallet_history" ADD COLUMN IF NOT EXISTS "source" VARCHAR(80);
ALTER TABLE "user_wallet_history" ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE INDEX IF NOT EXISTS "user_wallet_history_actor_type_idx" ON "user_wallet_history" ("actor_type");
