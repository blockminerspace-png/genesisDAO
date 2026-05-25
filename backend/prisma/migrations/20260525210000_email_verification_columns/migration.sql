-- Colunas de verificação de email no registo de utilizadores
-- Existem em produção desde a implementação do módulo de email-verification,
-- mas não constavam em nenhum ficheiro de migração — adicionadas aqui para
-- garantir que novas instalações (DB limpo + migrate deploy) ficam correctas.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verification_required" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" INTEGER NOT NULL DEFAULT 0;
