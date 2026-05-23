-- Append-only history of profile Polygon wallets (connect / change / remove).

CREATE TABLE IF NOT EXISTS "user_wallet_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL,
    "wallet_address" TEXT,
    "network" VARCHAR(32) NOT NULL DEFAULT 'polygon',
    "action" VARCHAR(32) NOT NULL,
    "previous_wallet_address" TEXT,
    "new_wallet_address" TEXT,
    "ip_address" VARCHAR(80),
    "user_agent" VARCHAR(500),
    "signature_address" VARCHAR(80),
    "signature_message" TEXT,
    "created_at" BIGINT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "user_wallet_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_wallet_history_user_id_idx" ON "user_wallet_history" ("user_id");
CREATE INDEX IF NOT EXISTS "user_wallet_history_created_at_idx" ON "user_wallet_history" ("created_at");
CREATE INDEX IF NOT EXISTS "user_wallet_history_wallet_address_idx" ON "user_wallet_history" ("wallet_address");
CREATE INDEX IF NOT EXISTS "user_wallet_history_action_idx" ON "user_wallet_history" ("action");

-- Optional backfill: one synthetic "connected" row per user who already has a wallet and zero history rows.
INSERT INTO "user_wallet_history" (
    "id",
    "user_id",
    "wallet_address",
    "network",
    "action",
    "previous_wallet_address",
    "new_wallet_address",
    "ip_address",
    "user_agent",
    "created_at",
    "metadata"
)
SELECT
    gen_random_uuid(),
    u.id,
    btrim(u.polygon_wallet::text),
    'polygon',
    'connected',
    NULL,
    btrim(u.polygon_wallet::text),
    NULL,
    NULL,
    (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint,
    NULL
FROM users u
WHERE u.polygon_wallet IS NOT NULL
  AND btrim(u.polygon_wallet::text) <> ''
  AND lower(btrim(u.polygon_wallet::text)) NOT IN ('0x', 'null')
  AND NOT EXISTS (SELECT 1 FROM "user_wallet_history" h WHERE h.user_id = u.id);
