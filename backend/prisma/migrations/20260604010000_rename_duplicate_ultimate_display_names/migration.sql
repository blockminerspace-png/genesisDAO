-- Dois SKUs distintos partilhavam o nome de vitrine "ULTIMATE" (server_v1 vs server_v3).
UPDATE upgrades SET name = 'ULTIMATE Blade' WHERE id = 'server_v1' AND name = 'ULTIMATE';
UPDATE upgrades SET name = 'ULTIMATE Náutilos+' WHERE id = 'server_v3' AND name = 'ULTIMATE';
