import type { Express, Request, Response } from 'express';
import {
  createCampaign,
  updateCampaign,
  getCampaign,
  listCampaigns,
  deleteCampaign,
  activateCampaign,
  pauseCampaign,
  resumeCampaign,
  testSendCampaign,
  sendNextBatch,
  getCampaignStats
} from './emailCampaigns.service.js';

export function registerEmailCampaignRoutes(
  app: Express,
  isAdmin: (req: Request, res: Response, next: () => void) => void
): void {

  // Listar campanhas
  app.get('/api/admin/email-campaigns', isAdmin, async (_req: Request, res: Response) => {
    try {
      const campaigns = await listCampaigns();
      res.json(campaigns);
    } catch (e) {
      res.status(500).json({ error: 'Erro ao listar campanhas.' });
    }
  });

  // Obter campanha + stats
  app.get('/api/admin/email-campaigns/:id', isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const [campaign, stats] = await Promise.all([getCampaign(id), getCampaignStats(id)]);
      if (!campaign) return res.status(404).json({ error: 'Campanha não encontrada.' });
      res.json({ ...campaign, stats });
    } catch (e) {
      res.status(500).json({ error: 'Erro ao obter campanha.' });
    }
  });

  // Criar campanha
  app.post('/api/admin/email-campaigns', isAdmin, async (req: Request, res: Response) => {
    try {
      const { title, subject, body_html, image_url, daily_limit, notes } = req.body || {};
      if (!title || !subject || !body_html)
        return res.status(400).json({ error: 'Campos obrigatórios: title, subject, body_html.' });
      const campaign = await createCampaign({
        title,
        subject,
        body_html,
        image_url,
        daily_limit: Number(daily_limit) || 750,
        notes,
        created_by: (req as Request & { userId?: number }).userId ?? 0
      });
      res.status(201).json(campaign);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'Erro ao criar campanha.' });
    }
  });

  // Atualizar campanha (apenas draft)
  app.put('/api/admin/email-campaigns/:id', isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const { title, subject, body_html, image_url, daily_limit, notes } = req.body || {};
      const updated = await updateCampaign(id, { title, subject, body_html, image_url, daily_limit: Number(daily_limit), notes });
      res.json(updated);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Erro ao atualizar campanha.' });
    }
  });

  // Apagar campanha
  app.delete('/api/admin/email-campaigns/:id', isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      await deleteCampaign(id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Erro ao apagar campanha.' });
    }
  });

  // Ativar campanha (popula entregas e muda status para active)
  app.post('/api/admin/email-campaigns/:id/activate', isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const result = await activateCampaign(id);
      res.json({ ok: true, totalRecipients: result.totalRecipients });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Erro ao ativar campanha.' });
    }
  });

  // Pausar campanha
  app.post('/api/admin/email-campaigns/:id/pause', isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      await pauseCampaign(id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Erro ao pausar campanha.' });
    }
  });

  // Retomar campanha
  app.post('/api/admin/email-campaigns/:id/resume', isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      await resumeCampaign(id);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Erro ao retomar campanha.' });
    }
  });

  // Envio de teste (1-5 emails)
  app.post('/api/admin/email-campaigns/:id/test', isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const { emails } = req.body || {};
      if (!Array.isArray(emails) || emails.length === 0)
        return res.status(400).json({ error: 'Forneça um array de emails para teste.' });
      const result = await testSendCampaign(id, emails);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Erro no envio de teste.' });
    }
  });

  // Disparar lote manualmente (sem esperar pelo cron)
  app.post('/api/admin/email-campaigns/:id/send-batch', isAdmin, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id) return res.status(400).json({ error: 'ID inválido.' });
      const result = await sendNextBatch(id);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Erro ao enviar lote.' });
    }
  });
}
