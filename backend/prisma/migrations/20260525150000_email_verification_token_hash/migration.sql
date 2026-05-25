-- M1: hash do token de verificação de email persistido no banco (invalida link anterior ao reenviar)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verification_token_hash" VARCHAR(64);
