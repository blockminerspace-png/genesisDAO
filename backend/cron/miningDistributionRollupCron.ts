/**
 * Cron diário UTC: materializa rollups em mining_distribution_daily.
 */
import type { Pool } from 'pg';
import { rebuildMiningDistributionRollupsRecent } from '../services/adminMiningDistribution.service.js';

const LOG_PREFIX = '[MiningDistributionRollupCron]';

let cronTimer: ReturnType<typeof setTimeout> | null = null;

function msUntilNextRun(hourUtc: number): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 5, 0, 0));
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function runAndReschedule(pool: Pool): Promise<void> {
  const hourUtc = parseInt(process.env.MINING_DISTRIBUTION_ROLLUP_CRON_HOUR || '3', 10);
  const daysBack = parseInt(process.env.MINING_DISTRIBUTION_ROLLUP_DAYS_BACK || '45', 10);
  console.log(`${LOG_PREFIX} Rebuild rollups (últimos ${daysBack} dias UTC)...`);
  try {
    const r = await rebuildMiningDistributionRollupsRecent(pool, daysBack);
    console.log(
      `${LOG_PREFIX} Concluído: ~${r.daysProcessed} dias, ${r.rowsUpserted} linhas upserted`
    );
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Erro:`,
      err instanceof Error ? err.message : err
    );
  }
  const ms = msUntilNextRun(hourUtc);
  cronTimer = setTimeout(() => {
    void runAndReschedule(pool);
  }, ms);
  console.log(`${LOG_PREFIX} Próxima execução em ${new Date(Date.now() + ms).toISOString()}`);
}

export function startMiningDistributionRollupCron(pool: Pool): void {
  const hourUtc = parseInt(process.env.MINING_DISTRIBUTION_ROLLUP_CRON_HOUR || '3', 10);
  const ms = msUntilNextRun(hourUtc);
  cronTimer = setTimeout(() => {
    void runAndReschedule(pool);
  }, ms);
  console.log(
    `${LOG_PREFIX} Agendado (UTC ${hourUtc}:05) — primeira execução ${new Date(Date.now() + ms).toISOString()}`
  );
}

export function stopMiningDistributionRollupCron(): void {
  if (cronTimer) {
    clearTimeout(cronTimer);
    cronTimer = null;
  }
}
