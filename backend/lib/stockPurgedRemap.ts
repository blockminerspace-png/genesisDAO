import type { Pool, PoolClient } from 'pg';
import {
  CANONICAL_1000WH_BATTERY_ID,
  PURGED_LEGACY_STOCK_IDS,
  PURGED_LEGACY_STOCK_REMAP_TO_ESTELAR
} from '../modules/batteries/batteries.catalog.js';

type DbLike = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

function purgeIdsArray(): string[] {
  return [...PURGED_LEGACY_STOCK_IDS];
}

function estelarRemapIdsArray(): string[] {
  return [...PURGED_LEGACY_STOCK_REMAP_TO_ESTELAR];
}

/**
 * Funde stock com IDs expurgados (e placeholders temp cujo original foi expurgado)
 * em `battery_estelar`; apaga linhas de carregadores e IDs já fundidos.
 */
export async function remapPurgedAndTempLegacyStockToEstelar(db: DbLike): Promise<{
  estelarMergedRows: number;
  purgedDeletedRows: number;
  tempStockDeletedRows: number;
}> {
  const estelar = CANONICAL_1000WH_BATTERY_ID;
  const remapIds = estelarRemapIdsArray();
  const allPurge = purgeIdsArray();
  const chargerOnly = allPurge.filter((id) => !remapIds.includes(id));

  let estelarMergedRows = 0;
  let purgedDeletedRows = 0;
  let tempStockDeletedRows = 0;

  if (remapIds.length > 0) {
    const mergeDirect = await db.query(
      `
      WITH add AS (
        SELECT user_id, SUM(qty)::bigint AS add_qty
          FROM stock
         WHERE btrim(item_id::text) = ANY($1::text[])
         GROUP BY user_id
      ),
      upd AS (
        UPDATE stock s
           SET qty = s.qty + a.add_qty
          FROM add a
         WHERE s.user_id = a.user_id
           AND s.item_id = $2
        RETURNING s.user_id
      )
      INSERT INTO stock (user_id, item_id, qty)
      SELECT a.user_id, $2, a.add_qty::int
        FROM add a
       WHERE NOT EXISTS (
         SELECT 1 FROM stock x WHERE x.user_id = a.user_id AND x.item_id = $2
       )
      `,
      [remapIds, estelar]
    );
    estelarMergedRows += mergeDirect.rowCount ?? 0;

    const delDirect = await db.query(`DELETE FROM stock WHERE btrim(item_id::text) = ANY($1::text[])`, [
      remapIds
    ]);
    purgedDeletedRows += delDirect.rowCount ?? 0;

    const mergeTemp = await db.query(
      `
      WITH parsed AS (
        SELECT u.id AS temp_id,
               btrim(substring(u.description FROM 'original=([^ ]+) email=')) AS orig_id
          FROM upgrades u
         WHERE u.id LIKE 'temp_legacy\\_%' ESCAPE '\\'
           AND (u.category = 'legacy-temp' OR u.type = 'legacy-temp')
           AND u.description IS NOT NULL
           AND u.description LIKE '%original=%'
      ),
      temp_rows AS (
        SELECT s.user_id, s.item_id AS temp_id, s.qty
          FROM stock s
         INNER JOIN parsed p ON p.temp_id = s.item_id
         WHERE p.orig_id = ANY($1::text[])
      ),
      add AS (
        SELECT user_id, SUM(qty)::bigint AS add_qty FROM temp_rows GROUP BY user_id
      ),
      upd AS (
        UPDATE stock s
           SET qty = s.qty + a.add_qty
          FROM add a
         WHERE s.user_id = a.user_id AND s.item_id = $2
        RETURNING s.user_id
      )
      INSERT INTO stock (user_id, item_id, qty)
      SELECT a.user_id, $2, a.add_qty::int
        FROM add a
       WHERE NOT EXISTS (
         SELECT 1 FROM stock x WHERE x.user_id = a.user_id AND x.item_id = $2
       )
      `,
      [remapIds, estelar]
    );
    estelarMergedRows += mergeTemp.rowCount ?? 0;

    const delTempStock = await db.query(
      `
      WITH parsed AS (
        SELECT u.id AS temp_id,
               btrim(substring(u.description FROM 'original=([^ ]+) email=')) AS orig_id
          FROM upgrades u
         WHERE u.id LIKE 'temp_legacy\\_%' ESCAPE '\\'
           AND (u.category = 'legacy-temp' OR u.type = 'legacy-temp')
           AND u.description IS NOT NULL
           AND u.description LIKE '%original=%'
      )
      DELETE FROM stock s
       USING parsed p
       WHERE s.item_id = p.temp_id
         AND p.orig_id = ANY($1::text[])
      `,
      [remapIds]
    );
    tempStockDeletedRows += delTempStock.rowCount ?? 0;
  }

  if (chargerOnly.length > 0) {
    const delChargers = await db.query(`DELETE FROM stock WHERE btrim(item_id::text) = ANY($1::text[])`, [
      chargerOnly
    ]);
    purgedDeletedRows += delChargers.rowCount ?? 0;
  }

  return { estelarMergedRows, purgedDeletedRows, tempStockDeletedRows };
}
