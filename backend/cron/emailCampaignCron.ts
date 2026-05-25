/**
 * Cron de email marketing — dispara lote diário para campanhas ativas.
 * Por padrão executa às 09:00 UTC todos os dias.
 * Configurável via env: EMAIL_CAMPAIGN_CRON_HOUR (0-23 UTC, default 9)
 */
import { runDailyBatchForAllCampaigns } from '../modules/email-campaigns/emailCampaigns.service.js';

let cronTimer: ReturnType<typeof setTimeout> | null = null;

function msUntilNextRun(hourUtc: number): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc, 0, 0, 0));
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function runAndReschedule(): Promise<void> {
  const hourUtc = parseInt(process.env.EMAIL_CAMPAIGN_CRON_HOUR || '9', 10);
  console.log('[EmailCampaignCron] Iniciando lote diário...');
  try {
    await runDailyBatchForAllCampaigns();
  } catch (err) {
    console.error('[EmailCampaignCron] Erro no lote diário:', err instanceof Error ? err.message : err);
  }
  // Agendar próxima execução
  const ms = msUntilNextRun(hourUtc);
  cronTimer = setTimeout(() => { void runAndReschedule(); }, ms);
  const nextDate = new Date(Date.now() + ms);
  console.log(`[EmailCampaignCron] Próximo lote agendado para ${nextDate.toISOString()}`);
}

export function startEmailCampaignCron(): void {
  const hourUtc = parseInt(process.env.EMAIL_CAMPAIGN_CRON_HOUR || '9', 10);
  const ms = msUntilNextRun(hourUtc);
  const nextDate = new Date(Date.now() + ms);
  cronTimer = setTimeout(() => { void runAndReschedule(); }, ms);
  console.log(`[EmailCampaignCron] Agendado — primeiro lote em ${nextDate.toISOString()}`);
}

export function stopEmailCampaignCron(): void {
  if (cronTimer) { clearTimeout(cronTimer); cronTimer = null; }
}
