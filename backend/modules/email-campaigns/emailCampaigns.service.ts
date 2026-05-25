import crypto from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import transporter from '../../utils/mailer.js';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed';

export interface CreateCampaignInput {
  title: string;
  subject: string;
  body_html: string;
  image_url?: string;
  daily_limit?: number;
  notes?: string;
  created_by: number;
}

export interface CampaignBatchResult {
  sent: number;
  failed: number;
  remaining: number;
  campaignCompleted: boolean;
}

// ─── helpers ───────────────────────────────────────────────────────────────

function resolvePublicBaseUrl(): string {
  return (
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_URL ||
    process.env.SITE_URL ||
    'https://genesisdao.tech'
  )
    .trim()
    .replace(/\/+$/, '');
}

function buildCampaignHtml(campaign: {
  subject: string;
  body_html: string;
  image_url?: string | null;
  id: number;
}): string {
  const baseUrl = resolvePublicBaseUrl();
  const unsubLink = `${baseUrl}/unsubscribe`;

  const imageBlock = campaign.image_url
    ? `<div style="text-align:center;margin:20px 0;">
         <img src="${campaign.image_url}" alt="" style="max-width:100%;border-radius:8px;" />
       </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:sans-serif;">
  <div style="max-width:620px;margin:0 auto;background:#1e293b;border-radius:12px;overflow:hidden;border:1px solid #334155;">
    <!-- header -->
    <div style="background:linear-gradient(135deg,#1e3a5f,#0f172a);padding:28px 32px;text-align:center;">
      <h1 style="margin:0;font-size:22px;color:#f59e0b;letter-spacing:1px;">⛏ Genesis Miner</h1>
    </div>
    <!-- image -->
    ${imageBlock}
    <!-- body -->
    <div style="padding:28px 32px;color:#e2e8f0;line-height:1.7;font-size:15px;">
      ${campaign.body_html}
    </div>
    <!-- footer -->
    <div style="background:#0f172a;padding:16px 32px;text-align:center;border-top:1px solid #334155;">
      <p style="margin:0;font-size:12px;color:#64748b;">
        Genesis Miner &mdash; <a href="${baseUrl}" style="color:#f59e0b;text-decoration:none;">${baseUrl.replace('https://', '')}</a>
      </p>
      <p style="margin:6px 0 0;font-size:11px;color:#475569;">
        <a href="${unsubLink}" style="color:#64748b;">Cancelar subscrição</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ─── CRUD ──────────────────────────────────────────────────────────────────

export async function createCampaign(input: CreateCampaignInput) {
  const limit = input.daily_limit && input.daily_limit > 0 ? input.daily_limit : 750;
  return prisma.email_campaigns.create({
    data: {
      title: input.title.trim(),
      subject: input.subject.trim(),
      body_html: input.body_html,
      image_url: input.image_url || null,
      daily_limit: Math.min(limit, 1000),
      notes: input.notes || null,
      created_by: input.created_by,
      created_at: BigInt(Date.now()),
      status: 'draft'
    }
  });
}

export async function updateCampaign(
  id: number,
  input: Partial<CreateCampaignInput>
) {
  const campaign = await prisma.email_campaigns.findUnique({ where: { id } });
  if (!campaign) throw new Error('Campanha não encontrada.');
  if (campaign.status !== 'draft')
    throw new Error('Só é possível editar campanhas em rascunho (draft).');

  return prisma.email_campaigns.update({
    where: { id },
    data: {
      ...(input.title !== undefined && { title: input.title.trim() }),
      ...(input.subject !== undefined && { subject: input.subject.trim() }),
      ...(input.body_html !== undefined && { body_html: input.body_html }),
      ...(input.image_url !== undefined && { image_url: input.image_url || null }),
      ...(input.daily_limit !== undefined && {
        daily_limit: Math.min(Math.max(1, input.daily_limit), 1000)
      }),
      ...(input.notes !== undefined && { notes: input.notes || null })
    }
  });
}

export async function getCampaign(id: number) {
  return prisma.email_campaigns.findUnique({ where: { id } });
}

export async function listCampaigns() {
  return prisma.email_campaigns.findMany({
    orderBy: { created_at: 'desc' }
  });
}

export async function deleteCampaign(id: number) {
  const c = await prisma.email_campaigns.findUnique({ where: { id } });
  if (!c) throw new Error('Campanha não encontrada.');
  if (c.status === 'active') throw new Error('Pause a campanha antes de apagar.');
  await prisma.email_campaign_deliveries.deleteMany({ where: { campaign_id: id } });
  await prisma.email_campaigns.delete({ where: { id } });
}

// ─── Activate ──────────────────────────────────────────────────────────────

/**
 * Popula `email_campaign_deliveries` com todos os utilizadores com email
 * registados até este momento. Usa INSERT ... ON CONFLICT DO NOTHING para
 * ser re-entrante (se chamado novamente não duplica).
 */
export async function activateCampaign(id: number): Promise<{ totalRecipients: number }> {
  const c = await prisma.email_campaigns.findUnique({ where: { id } });
  if (!c) throw new Error('Campanha não encontrada.');
  if (c.status === 'completed') throw new Error('Campanha já concluída.');

  // Buscar todos os utilizadores com email válido e conta não bloqueada
  const users = await prisma.users.findMany({
    where: {
      email: { not: '' },
      is_blocked: { not: 1 }
    },
    select: { id: true, email: true }
  });

  // Inserir entradas pending em lotes (upsert seguro)
  const CHUNK = 500;
  for (let i = 0; i < users.length; i += CHUNK) {
    const chunk = users.slice(i, i + CHUNK);
    // raw insert para ON CONFLICT DO NOTHING eficiente
    const values = chunk
      .filter((u) => u.email)
      .map((u) => `(${id}, ${u.id}, '${(u.email as string).replace(/'/g, "''")}', 'pending')`);
    if (values.length === 0) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO email_campaign_deliveries (campaign_id, user_id, email, status)
       VALUES ${values.join(',')}
       ON CONFLICT (campaign_id, user_id) DO NOTHING`
    );
  }

  const totalRecipients = await prisma.email_campaign_deliveries.count({
    where: { campaign_id: id }
  });

  await prisma.email_campaigns.update({
    where: { id },
    data: {
      status: 'active',
      total_recipients: totalRecipients,
      activated_at: BigInt(Date.now())
    }
  });

  return { totalRecipients };
}

export async function pauseCampaign(id: number) {
  const c = await prisma.email_campaigns.findUnique({ where: { id } });
  if (!c) throw new Error('Campanha não encontrada.');
  if (c.status !== 'active') throw new Error('Campanha não está ativa.');
  await prisma.email_campaigns.update({ where: { id }, data: { status: 'paused' } });
}

export async function resumeCampaign(id: number) {
  const c = await prisma.email_campaigns.findUnique({ where: { id } });
  if (!c) throw new Error('Campanha não encontrada.');
  if (c.status !== 'paused') throw new Error('Campanha não está pausada.');
  await prisma.email_campaigns.update({ where: { id }, data: { status: 'active' } });
}

// ─── Test send ─────────────────────────────────────────────────────────────

export async function testSendCampaign(
  id: number,
  testEmails: string[]
): Promise<{ sent: string[]; failed: string[] }> {
  const c = await prisma.email_campaigns.findUnique({ where: { id } });
  if (!c) throw new Error('Campanha não encontrada.');

  const html = buildCampaignHtml(c);
  const from = process.env.MAIL_FROM || '"Genesis Miner" <no-reply@genesisdao.tech>';
  const sent: string[] = [];
  const failed: string[] = [];

  for (const email of testEmails.slice(0, 5)) {
    const e = email.trim().toLowerCase();
    if (!e) continue;
    try {
      await transporter.sendMail({ from, to: e, subject: `[TESTE] ${c.subject}`, html });
      sent.push(e);
    } catch (err) {
      failed.push(e);
      console.error('[EmailCampaign] test send error:', err instanceof Error ? err.message : err);
    }
  }

  return { sent, failed };
}

// ─── Batch send (used by cron + manual trigger) ────────────────────────────

export async function sendNextBatch(campaignId: number): Promise<CampaignBatchResult> {
  const c = await prisma.email_campaigns.findUnique({ where: { id: campaignId } });
  if (!c || c.status !== 'active') {
    return { sent: 0, failed: 0, remaining: 0, campaignCompleted: false };
  }

  const limit = c.daily_limit > 0 ? c.daily_limit : 750;

  // Buscar próximos pending
  const pending = await prisma.email_campaign_deliveries.findMany({
    where: { campaign_id: campaignId, status: 'pending' },
    take: limit,
    orderBy: { id: 'asc' }
  });

  if (pending.length === 0) {
    await prisma.email_campaigns.update({
      where: { id: campaignId },
      data: { status: 'completed', completed_at: BigInt(Date.now()) }
    });
    return { sent: 0, failed: 0, remaining: 0, campaignCompleted: true };
  }

  const html = buildCampaignHtml(c);
  const from = process.env.MAIL_FROM || '"Genesis Miner" <no-reply@genesisdao.tech>';

  let sentCount = 0;
  let failedCount = 0;

  for (const delivery of pending) {
    try {
      await transporter.sendMail({ from, to: delivery.email, subject: c.subject, html });
      await prisma.email_campaign_deliveries.update({
        where: { id: delivery.id },
        data: { status: 'sent', sent_at: BigInt(Date.now()), error_message: null }
      });
      sentCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 490) : 'Erro desconhecido';
      await prisma.email_campaign_deliveries.update({
        where: { id: delivery.id },
        data: { status: 'failed', sent_at: BigInt(Date.now()), error_message: msg }
      });
      failedCount++;
      console.error(`[EmailCampaign] send error uid=${delivery.user_id}:`, msg);
    }
  }

  // Atualizar contadores da campanha
  const newSent = c.total_sent + sentCount;
  const newFailed = c.total_failed + failedCount;
  const remaining = await prisma.email_campaign_deliveries.count({
    where: { campaign_id: campaignId, status: 'pending' }
  });

  const completed = remaining === 0;
  await prisma.email_campaigns.update({
    where: { id: campaignId },
    data: {
      total_sent: newSent,
      total_failed: newFailed,
      ...(completed ? { status: 'completed', completed_at: BigInt(Date.now()) } : {})
    }
  });

  return { sent: sentCount, failed: failedCount, remaining, campaignCompleted: completed };
}

/**
 * Executa o lote diário para TODAS as campanhas ativas.
 * Respeita o daily_limit global (soma de todos os lotes não excede DAILY_GLOBAL_LIMIT).
 */
export async function runDailyBatchForAllCampaigns(): Promise<void> {
  const DAILY_GLOBAL_LIMIT = parseInt(process.env.EMAIL_DAILY_GLOBAL_LIMIT || '950', 10);
  let totalSentToday = 0;

  const activeCampaigns = await prisma.email_campaigns.findMany({
    where: { status: 'active' },
    orderBy: { activated_at: 'asc' }
  });

  for (const campaign of activeCampaigns) {
    if (totalSentToday >= DAILY_GLOBAL_LIMIT) break;
    const remaining = DAILY_GLOBAL_LIMIT - totalSentToday;
    const effectiveLimit = Math.min(campaign.daily_limit, remaining);

    // Sobrescrever temporariamente o limit para este lote
    const original = campaign.daily_limit;
    await prisma.email_campaigns.update({
      where: { id: campaign.id },
      data: { daily_limit: effectiveLimit }
    });

    const result = await sendNextBatch(campaign.id);
    totalSentToday += result.sent + result.failed;

    // Restaurar limit original
    await prisma.email_campaigns.update({
      where: { id: campaign.id },
      data: { daily_limit: original }
    });

    console.log(
      `[EmailCampaignCron] campanha ${campaign.id} "${campaign.title}": ` +
        `sent=${result.sent} failed=${result.failed} remaining=${result.remaining} ` +
        `completed=${result.campaignCompleted}`
    );
  }

  console.log(`[EmailCampaignCron] lote diário concluído. total enviados hoje: ${totalSentToday}`);
}

// ─── Stats ─────────────────────────────────────────────────────────────────

export async function getCampaignStats(id: number) {
  const [pending, sent, failed] = await Promise.all([
    prisma.email_campaign_deliveries.count({ where: { campaign_id: id, status: 'pending' } }),
    prisma.email_campaign_deliveries.count({ where: { campaign_id: id, status: 'sent' } }),
    prisma.email_campaign_deliveries.count({ where: { campaign_id: id, status: 'failed' } })
  ]);
  return { pending, sent, failed, total: pending + sent + failed };
}
