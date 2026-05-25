import React, { useState, useEffect, useCallback, useRef } from 'react';

interface Campaign {
  id: number;
  title: string;
  subject: string;
  body_html: string;
  image_url?: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  daily_limit: number;
  total_recipients: number;
  total_sent: number;
  total_failed: number;
  created_at: number;
  activated_at?: number;
  completed_at?: number;
  notes?: string;
  stats?: { pending: number; sent: number; failed: number; total: number };
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft:     { label: 'Rascunho',   color: 'bg-slate-600 text-slate-200' },
  active:    { label: 'Ativa',      color: 'bg-green-700 text-green-100' },
  paused:    { label: 'Pausada',    color: 'bg-yellow-700 text-yellow-100' },
  completed: { label: 'Concluída',  color: 'bg-blue-700 text-blue-100' }
};

const API = (path: string) => `/api/admin/email-campaigns${path}`;

async function apiFetch(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

function ProgressBar({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="w-full bg-slate-700 rounded-full h-2">
      <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function estimateDaysRemaining(pending: number, dailyLimit: number) {
  if (dailyLimit <= 0 || pending <= 0) return 0;
  return Math.ceil(pending / dailyLimit);
}

// ─── Form ───────────────────────────────────────────────────────────────────

interface FormState {
  title: string;
  subject: string;
  body_html: string;
  image_url: string;
  daily_limit: number;
  notes: string;
}

const EMPTY_FORM: FormState = {
  title: '',
  subject: '',
  body_html: '',
  image_url: '',
  daily_limit: 750,
  notes: ''
};

function CampaignForm({
  initial,
  onSave,
  onCancel
}: {
  initial?: Partial<FormState>;
  onSave: (data: FormState) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, ...initial });
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: key === 'daily_limit' ? Number(e.target.value) : e.target.value }));

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setUploadError('Formato inválido. Use PNG, JPG, GIF ou WebP.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Ficheiro demasiado grande (máx. 10 MB).');
      return;
    }
    setUploadError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/admin/upload-image', { method: 'POST', body: fd, credentials: 'include' });
      const json = await res.json().catch(() => ({})) as { ok?: boolean; imageUrl?: string; error?: string };
      if (json.ok && json.imageUrl) {
        setForm((f) => ({ ...f, image_url: json.imageUrl as string }));
      } else {
        setUploadError(json.error || 'Erro no upload.');
      }
    } catch {
      setUploadError('Erro de rede ao enviar imagem.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.subject.trim() || !form.body_html.trim()) {
      alert('Preencha: Título, Assunto e Corpo do email.');
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Título interno *</label>
          <input
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            placeholder="Ex: Newsletter Maio 2026"
            value={form.title}
            onChange={set('title')}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Assunto do email *</label>
          <input
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            placeholder="Ex: Novidades do Genesis Miner"
            value={form.subject}
            onChange={set('subject')}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Imagem do email (opcional)</label>
          {/* Upload button */}
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 rounded-lg border border-dashed border-amber-500/60 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-400 hover:bg-amber-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M12 12V4m0 0L8 8m4-4l4 4" />
                </svg>
              )}
              {uploading ? 'Enviando…' : 'Enviar do PC'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/gif,image/webp"
              className="hidden"
              onChange={handleImageUpload}
            />
          </div>
          {/* URL field (auto-filled after upload or manual) */}
          <input
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            placeholder="https://... ou envie do PC acima"
            value={form.image_url}
            onChange={set('image_url')}
          />
          {uploadError && <p className="mt-1 text-xs text-red-400">{uploadError}</p>}
          {/* Preview thumbnail */}
          {form.image_url && (
            <div className="mt-2 flex items-center gap-2">
              <img
                src={form.image_url}
                alt="preview"
                className="h-16 w-auto rounded-md border border-slate-600 object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, image_url: '' }))}
                className="text-xs text-red-400 hover:text-red-300 underline"
              >
                Remover
              </button>
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">Limite diário de envios</label>
          <input
            type="number"
            min={1}
            max={1000}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            value={form.daily_limit}
            onChange={set('daily_limit')}
          />
          <p className="text-xs text-slate-400 mt-1">Máx. recomendado: 750 (limite Hostinger: 1000/dia)</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-slate-300">Corpo do email (HTML) *</label>
          <button
            onClick={() => setPreview(!preview)}
            className="text-xs text-amber-400 hover:text-amber-300 underline"
          >
            {preview ? 'Editar' : 'Pré-visualizar'}
          </button>
        </div>
        {preview ? (
          <div
            className="w-full min-h-[240px] bg-white rounded-lg p-4 overflow-auto"
            dangerouslySetInnerHTML={{ __html: form.body_html }}
          />
        ) : (
          <textarea
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 min-h-[240px] resize-y"
            placeholder="<p>Olá! Temos novidades para você...</p>"
            value={form.body_html}
            onChange={set('body_html')}
          />
        )}
        <p className="text-xs text-slate-400 mt-1">
          HTML livre. A imagem (se fornecida) aparece automaticamente acima do corpo.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-300 mb-1">Notas internas</label>
        <input
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          placeholder="Notas para a equipa (não são enviadas)"
          value={form.notes}
          onChange={set('notes')}
        />
      </div>

      <div className="flex gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold px-5 py-2 rounded-lg text-sm transition"
        >
          {saving ? 'A guardar...' : 'Guardar rascunho'}
        </button>
        <button
          onClick={onCancel}
          className="bg-slate-600 hover:bg-slate-500 text-white px-5 py-2 rounded-lg text-sm transition"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function AdminEmailCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [testEmails, setTestEmails] = useState('');
  const [testResult, setTestResult] = useState<{ sent: string[]; failed: string[] } | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(false);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(API(''));
      setCampaigns(data);
    } catch {
      flash('err', 'Erro ao carregar campanhas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadDetail = async (id: number) => {
    try {
      const data = await apiFetch(API(`/${id}`));
      setSelected(data);
    } catch {
      flash('err', 'Erro ao carregar detalhes.');
    }
  };

  const handleCreate = async (form: FormState) => {
    try {
      await apiFetch(API(''), { method: 'POST', body: JSON.stringify(form) });
      setShowForm(false);
      flash('ok', 'Campanha criada com sucesso.');
      void load();
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'Erro ao criar.');
    }
  };

  const handleUpdate = async (form: FormState) => {
    if (!editingId) return;
    try {
      await apiFetch(API(`/${editingId}`), { method: 'PUT', body: JSON.stringify(form) });
      setEditingId(null);
      flash('ok', 'Campanha atualizada.');
      void load();
      if (selected?.id === editingId) void loadDetail(editingId);
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'Erro ao atualizar.');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Apagar esta campanha e todas as entregas?')) return;
    try {
      await apiFetch(API(`/${id}`), { method: 'DELETE' });
      flash('ok', 'Campanha apagada.');
      if (selected?.id === id) setSelected(null);
      void load();
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'Erro ao apagar.');
    }
  };

  const handleActivate = async (id: number) => {
    setConfirmActivate(false);
    try {
      const r = await apiFetch(API(`/${id}/activate`), { method: 'POST' });
      flash('ok', `Campanha ativada! ${r.totalRecipients} destinatários enfileirados.`);
      void load();
      void loadDetail(id);
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'Erro ao ativar.');
    }
  };

  const handlePause = async (id: number) => {
    try {
      await apiFetch(API(`/${id}/pause`), { method: 'POST' });
      flash('ok', 'Campanha pausada.');
      void load();
      void loadDetail(id);
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'Erro ao pausar.');
    }
  };

  const handleResume = async (id: number) => {
    try {
      await apiFetch(API(`/${id}/resume`), { method: 'POST' });
      flash('ok', 'Campanha retomada.');
      void load();
      void loadDetail(id);
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'Erro ao retomar.');
    }
  };

  const handleTestSend = async (id: number) => {
    const emails = testEmails.split(/[\n,;]/).map((e) => e.trim()).filter(Boolean);
    if (emails.length === 0) { flash('err', 'Insira pelo menos um email.'); return; }
    setTestLoading(true);
    setTestResult(null);
    try {
      const r = await apiFetch(API(`/${id}/test`), { method: 'POST', body: JSON.stringify({ emails }) });
      setTestResult(r);
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'Erro no teste.');
    } finally {
      setTestLoading(false);
    }
  };

  const handleSendBatch = async (id: number) => {
    if (!confirm('Disparar lote agora (fora do horário do cron)?')) return;
    setBatchLoading(true);
    try {
      const r = await apiFetch(API(`/${id}/send-batch`), { method: 'POST' });
      flash(
        'ok',
        `Lote enviado: ${r.sent} enviados, ${r.failed} falhas, ${r.remaining} restantes.` +
          (r.campaignCompleted ? ' Campanha concluída!' : '')
      );
      void load();
      void loadDetail(id);
    } catch (e) {
      flash('err', e instanceof Error ? e.message : 'Erro ao enviar lote.');
    } finally {
      setBatchLoading(false);
    }
  };

  const editingCampaign = campaigns.find((c) => c.id === editingId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Email Marketing</h2>
          <p className="text-slate-400 text-sm mt-1">
            Campanhas globais · limite diário configurável · envio automático às 09:00 UTC
          </p>
        </div>
        <button
          onClick={() => { setShowForm(true); setEditingId(null); }}
          className="bg-amber-600 hover:bg-amber-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition flex items-center gap-2"
        >
          <span>+ Nova campanha</span>
        </button>
      </div>

      {/* Flash */}
      {msg && (
        <div className={`rounded-lg px-4 py-3 text-sm font-medium ${msg.type === 'ok' ? 'bg-green-800 text-green-100' : 'bg-red-800 text-red-100'}`}>
          {msg.text}
        </div>
      )}

      {/* Form criar */}
      {showForm && !editingId && (
        <CampaignForm
          onSave={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Form editar */}
      {editingId && editingCampaign && (
        <CampaignForm
          initial={{
            title: editingCampaign.title,
            subject: editingCampaign.subject,
            body_html: editingCampaign.body_html,
            image_url: editingCampaign.image_url || '',
            daily_limit: editingCampaign.daily_limit,
            notes: editingCampaign.notes || ''
          }}
          onSave={handleUpdate}
          onCancel={() => setEditingId(null)}
        />
      )}

      {/* Lista de campanhas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {loading ? (
          <p className="text-slate-400 col-span-2">A carregar...</p>
        ) : campaigns.length === 0 ? (
          <p className="text-slate-400 col-span-2">Nenhuma campanha ainda. Cria a primeira!</p>
        ) : (
          campaigns.map((c) => {
            const s = STATUS_LABEL[c.status] || STATUS_LABEL.draft;
            const sentPct = c.total_recipients > 0
              ? Math.round((c.total_sent / c.total_recipients) * 100)
              : 0;
            const daysLeft = estimateDaysRemaining(
              c.total_recipients - c.total_sent - c.total_failed,
              c.daily_limit
            );

            return (
              <div
                key={c.id}
                className={`bg-slate-800 border rounded-xl p-4 cursor-pointer transition hover:border-amber-500 ${
                  selected?.id === c.id ? 'border-amber-500' : 'border-slate-600'
                }`}
                onClick={() => { void loadDetail(c.id); }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold truncate">{c.title}</p>
                    <p className="text-slate-400 text-xs truncate">{c.subject}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${s.color}`}>
                    {s.label}
                  </span>
                </div>

                {c.total_recipients > 0 && (
                  <div className="mt-3 space-y-1">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>{c.total_sent.toLocaleString()} / {c.total_recipients.toLocaleString()} enviados ({sentPct}%)</span>
                      {c.status === 'active' && daysLeft > 0 && (
                        <span className="text-amber-400">~{daysLeft} dia{daysLeft !== 1 ? 's' : ''} restantes</span>
                      )}
                    </div>
                    <ProgressBar value={c.total_sent} total={c.total_recipients} color="bg-green-500" />
                    {c.total_failed > 0 && (
                      <p className="text-xs text-red-400">{c.total_failed} falha{c.total_failed !== 1 ? 's' : ''}</p>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3 text-xs text-slate-500">
                  <span>Limite: {c.daily_limit}/dia</span>
                  <span>·</span>
                  <span>Criado: {new Date(Number(c.created_at)).toLocaleDateString('pt-BR')}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Detalhe da campanha selecionada */}
      {selected && (
        <div className="bg-slate-800 border border-amber-500/50 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">{selected.title}</h3>
            <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-white text-sm">✕ Fechar</button>
          </div>

          {/* Stats */}
          {selected.stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total', value: selected.stats.total, color: 'text-white' },
                { label: 'Pendentes', value: selected.stats.pending, color: 'text-amber-400' },
                { label: 'Enviados', value: selected.stats.sent, color: 'text-green-400' },
                { label: 'Falhas', value: selected.stats.failed, color: 'text-red-400' }
              ].map((s) => (
                <div key={s.label} className="bg-slate-700 rounded-lg p-3 text-center">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value.toLocaleString()}</p>
                  <p className="text-slate-400 text-xs">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {selected.stats && selected.stats.total > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Progresso de entrega</span>
                <span>
                  {Math.round((selected.stats.sent / selected.stats.total) * 100)}%
                  {selected.status === 'active' && selected.stats.pending > 0 && (
                    <span className="text-amber-400 ml-2">
                      · ~{estimateDaysRemaining(selected.stats.pending, selected.daily_limit)} dia(s) para concluir
                    </span>
                  )}
                </span>
              </div>
              <ProgressBar value={selected.stats.sent} total={selected.stats.total} color="bg-green-500" />
            </div>
          )}

          {/* Ações */}
          <div className="flex flex-wrap gap-2">
            {selected.status === 'draft' && (
              <>
                <button
                  onClick={() => setEditingId(selected.id)}
                  className="bg-slate-600 hover:bg-slate-500 text-white px-4 py-2 rounded-lg text-sm transition"
                >
                  ✏ Editar
                </button>
                <button
                  onClick={() => setConfirmActivate(true)}
                  className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
                >
                  ▶ Ativar campanha
                </button>
              </>
            )}
            {selected.status === 'active' && (
              <button
                onClick={() => handlePause(selected.id)}
                className="bg-yellow-700 hover:bg-yellow-600 text-white px-4 py-2 rounded-lg text-sm transition"
              >
                ⏸ Pausar
              </button>
            )}
            {selected.status === 'paused' && (
              <button
                onClick={() => handleResume(selected.id)}
                className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm transition"
              >
                ▶ Retomar
              </button>
            )}
            {(selected.status === 'active' || selected.status === 'paused') && (
              <button
                onClick={() => handleSendBatch(selected.id)}
                disabled={batchLoading}
                className="bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm transition"
              >
                {batchLoading ? 'A enviar...' : '⚡ Enviar lote agora'}
              </button>
            )}
            {selected.status !== 'active' && (
              <button
                onClick={() => handleDelete(selected.id)}
                className="bg-red-800 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm transition"
              >
                🗑 Apagar
              </button>
            )}
          </div>

          {/* Confirmar ativação */}
          {confirmActivate && (
            <div className="bg-amber-900/40 border border-amber-600 rounded-lg p-4">
              <p className="text-amber-200 text-sm font-medium mb-3">
                Ao ativar, o sistema vai buscar todos os utilizadores registados e enfileirar os envios.
                O cron enviará {selected.daily_limit} emails/dia automaticamente às 09:00 UTC.
                Confirmar?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleActivate(selected.id)}
                  className="bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
                >
                  Sim, ativar
                </button>
                <button
                  onClick={() => setConfirmActivate(false)}
                  className="bg-slate-600 hover:bg-slate-500 text-white px-4 py-2 rounded-lg text-sm transition"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Envio de teste */}
          <div className="border-t border-slate-700 pt-4 space-y-3">
            <h4 className="text-white font-semibold text-sm">Envio de teste</h4>
            <p className="text-slate-400 text-xs">
              Envia uma cópia com prefixo [TESTE] para os emails abaixo (não afeta a campanha).
              Separa por vírgula, ponto-e-vírgula ou nova linha. Máx. 5 emails.
            </p>
            <textarea
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 min-h-[80px]"
              placeholder="email1@exemplo.com, email2@exemplo.com"
              value={testEmails}
              onChange={(e) => setTestEmails(e.target.value)}
            />
            <button
              onClick={() => handleTestSend(selected.id)}
              disabled={testLoading}
              className="bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm transition"
            >
              {testLoading ? 'A enviar...' : '📧 Enviar teste'}
            </button>
            {testResult && (
              <div className="text-xs mt-2 space-y-1">
                {testResult.sent.length > 0 && (
                  <p className="text-green-400">✓ Enviado para: {testResult.sent.join(', ')}</p>
                )}
                {testResult.failed.length > 0 && (
                  <p className="text-red-400">✗ Falhou: {testResult.failed.join(', ')}</p>
                )}
              </div>
            )}
          </div>

          {/* Preview HTML */}
          <div className="border-t border-slate-700 pt-4">
            <h4 className="text-white font-semibold text-sm mb-2">Corpo do email</h4>
            {selected.image_url && (
              <div className="mb-2">
                <img src={selected.image_url} alt="banner" className="max-h-48 rounded-lg object-cover" />
              </div>
            )}
            <div
              className="bg-white rounded-lg p-4 text-sm overflow-auto max-h-64"
              dangerouslySetInnerHTML={{ __html: selected.body_html }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
