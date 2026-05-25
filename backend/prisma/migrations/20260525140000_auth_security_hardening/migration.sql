-- Auth security hardening: reset token persistido + lockout por conta
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_reset_token_hash" VARCHAR(64);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_reset_token_expires_at" BIGINT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "login_failure_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "login_locked_until" BIGINT;
