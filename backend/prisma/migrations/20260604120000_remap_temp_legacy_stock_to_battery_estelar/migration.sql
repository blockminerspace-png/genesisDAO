-- Funde stock com IDs expurgados / placeholders temp_legacy (baterias legadas) em battery_estelar.
-- Remove upgrades legacy-temp órfãos. Idempotente.

BEGIN;

CREATE TEMP TABLE _purge_remap (id text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _purge_remap (id) VALUES
  ('battery_aa'),
  ('battery_car'),
  ('battery_diesel'),
  ('battery_fusion'),
  ('battery_nebula'),
  ('battery_protostar'),
  ('battery_ups'),
  ('battery_wall'),
  ('nebula'),
  ('small_battery'),
  ('supernova')
ON CONFLICT DO NOTHING;

WITH add AS (
  SELECT user_id, SUM(qty)::bigint AS add_qty
    FROM stock
   WHERE btrim(item_id::text) IN (SELECT id FROM _purge_remap)
   GROUP BY user_id
)
UPDATE stock s
   SET qty = s.qty + a.add_qty
  FROM add a
 WHERE s.user_id = a.user_id
   AND s.item_id = 'battery_estelar';

INSERT INTO stock (user_id, item_id, qty)
SELECT a.user_id, 'battery_estelar', a.add_qty::int
  FROM (
    SELECT user_id, SUM(qty)::bigint AS add_qty
      FROM stock
     WHERE btrim(item_id::text) IN (SELECT id FROM _purge_remap)
     GROUP BY user_id
  ) a
 WHERE NOT EXISTS (
   SELECT 1 FROM stock x WHERE x.user_id = a.user_id AND x.item_id = 'battery_estelar'
 );

DELETE FROM stock WHERE btrim(item_id::text) IN (SELECT id FROM _purge_remap);

WITH parsed AS (
  SELECT u.id AS temp_id,
         btrim(substring(u.description FROM 'original=([^ ]+) email=')) AS orig_id
    FROM upgrades u
   WHERE u.id LIKE 'temp_legacy\_%' ESCAPE '\'
     AND (u.category = 'legacy-temp' OR u.type = 'legacy-temp')
     AND u.description IS NOT NULL
     AND u.description LIKE '%original=%'
),
temp_rows AS (
  SELECT s.user_id, s.item_id AS temp_id, s.qty
    FROM stock s
   INNER JOIN parsed p ON p.temp_id = s.item_id
   WHERE p.orig_id IN (SELECT id FROM _purge_remap)
),
add AS (
  SELECT user_id, SUM(qty)::bigint AS add_qty FROM temp_rows GROUP BY user_id
)
UPDATE stock s
   SET qty = s.qty + a.add_qty
  FROM add a
 WHERE s.user_id = a.user_id
   AND s.item_id = 'battery_estelar';

WITH parsed AS (
  SELECT u.id AS temp_id,
         btrim(substring(u.description FROM 'original=([^ ]+) email=')) AS orig_id
    FROM upgrades u
   WHERE u.id LIKE 'temp_legacy\_%' ESCAPE '\'
     AND (u.category = 'legacy-temp' OR u.type = 'legacy-temp')
     AND u.description IS NOT NULL
     AND u.description LIKE '%original=%'
),
temp_rows AS (
  SELECT s.user_id, SUM(s.qty)::bigint AS add_qty
    FROM stock s
   INNER JOIN parsed p ON p.temp_id = s.item_id
   WHERE p.orig_id IN (SELECT id FROM _purge_remap)
   GROUP BY s.user_id
)
INSERT INTO stock (user_id, item_id, qty)
SELECT a.user_id, 'battery_estelar', a.add_qty::int
  FROM temp_rows a
 WHERE NOT EXISTS (
   SELECT 1 FROM stock x WHERE x.user_id = a.user_id AND x.item_id = 'battery_estelar'
 );

WITH parsed AS (
  SELECT u.id AS temp_id,
         btrim(substring(u.description FROM 'original=([^ ]+) email=')) AS orig_id
    FROM upgrades u
   WHERE u.id LIKE 'temp_legacy\_%' ESCAPE '\'
     AND (u.category = 'legacy-temp' OR u.type = 'legacy-temp')
     AND u.description IS NOT NULL
     AND u.description LIKE '%original=%'
)
DELETE FROM stock s
 USING parsed p
 WHERE s.item_id = p.temp_id
   AND p.orig_id IN (SELECT id FROM _purge_remap);

DELETE FROM stock WHERE btrim(item_id::text) IN ('charger_a1', 'charger_a2');

DELETE FROM upgrades u
 WHERE (u.category = 'legacy-temp' OR u.type = 'legacy-temp')
   AND u.id LIKE 'temp_legacy\_%' ESCAPE '\'
   AND NOT EXISTS (SELECT 1 FROM stock s WHERE s.item_id = u.id);

COMMIT;
