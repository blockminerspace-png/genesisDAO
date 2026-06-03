import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Edit, PlusCircle, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import {
  createAdminInAppAnnouncement,
  deleteAdminInAppAnnouncement,
  getAdminInAppAnnouncements,
  updateAdminInAppAnnouncement,
  type InAppAnnouncementAdminPayload
} from '../services/api';

const emptyForm = () => ({
  title: '',
  message: '',
  link: '',
  priority: 0,
  isActive: true,
  startsAt: '',
  endsAt: ''
});

export const AdminInAppAnnouncements: React.FC = () => {
  const [list, setList] = useState<InAppAnnouncementAdminPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getAdminInAppAnnouncements();
      setList(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
  };

  const startEdit = (row: InAppAnnouncementAdminPayload) => {
    setEditingId(row.id);
    setForm({
      title: row.title,
      message: row.message,
      link: row.link || '',
      priority: row.priority ?? 0,
      isActive: row.isActive,
      startsAt: row.startsAt != null ? String(row.startsAt) : '',
      endsAt: row.endsAt != null ? String(row.endsAt) : ''
    });
  };

  const parseOptionalMs = (v: string): number | null => {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.message.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        message: form.message.trim(),
        link: form.link.trim() || undefined,
        priority: Number(form.priority) || 0,
        isActive: form.isActive,
        startsAt: parseOptionalMs(form.startsAt),
        endsAt: parseOptionalMs(form.endsAt)
      };
      if (editingId) {
        await updateAdminInAppAnnouncement(editingId, payload);
      } else {
        await createAdminInAppAnnouncement(payload);
      }
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (row: InAppAnnouncementAdminPayload) => {
    await updateAdminInAppAnnouncement(row.id, { isActive: !row.isActive });
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Apagar este aviso popup? Quem já leu mantém o registo; novos utilizadores deixam de ver.')) return;
    await deleteAdminInAppAnnouncement(id);
    if (editingId === id) resetForm();
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-slate-700 pb-4">
        <Bell className="text-amber-400" size={22} />
        <div>
          <h2 className="text-lg font-bold text-white">Avisos popup (ler uma vez)</h2>
          <p className="text-xs text-slate-400">
            Aparecem após login para jogadores que ainda não marcaram como lidos. Banners News continuam separados.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
          {editingId ? 'Editar aviso' : 'Novo aviso'}
        </h3>
        <input
          className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
          placeholder="Título"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        />
        <textarea
          className="w-full min-h-[100px] rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
          placeholder="Mensagem"
          value={form.message}
          onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
        />
        <input
          className="w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
          placeholder="Link opcional (https://...)"
          value={form.link}
          onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-xs text-slate-400">
            Prioridade
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) || 0 }))}
            />
          </label>
          <label className="text-xs text-slate-400">
            Início (ms epoch, opcional)
            <input
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
              value={form.startsAt}
              onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
            />
          </label>
          <label className="text-xs text-slate-400">
            Fim (ms epoch, opcional)
            <input
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white"
              value={form.endsAt}
              onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
          Ativo
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !form.title.trim() || !form.message.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-xs font-bold uppercase text-white hover:bg-amber-500 disabled:opacity-50"
          >
            <PlusCircle size={16} />
            {editingId ? 'Guardar' : 'Criar'}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-slate-600 px-4 py-2 text-xs font-bold text-slate-300 hover:text-white"
            >
              Cancelar
            </button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Publicados</h3>
        {loading ? (
          <p className="text-sm text-slate-500">A carregar…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum aviso popup.</p>
        ) : (
          list.map((row) => (
            <div
              key={row.id}
              className="flex flex-col sm:flex-row sm:items-start gap-3 rounded-xl border border-slate-700 bg-slate-900/40 p-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-white">{row.title}</span>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                      row.isActive ? 'bg-emerald-900/50 text-emerald-400' : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {row.isActive ? 'Ativo' : 'Inativo'}
                  </span>
                  <span className="text-[10px] text-slate-500">Prioridade {row.priority ?? 0}</span>
                  <span className="text-[10px] text-slate-500">{row.readCount} leituras</span>
                </div>
                <p className="mt-1 text-sm text-slate-400 line-clamp-3 whitespace-pre-wrap">{row.message}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void handleToggleActive(row)}
                  className="p-2 rounded border border-slate-600 text-slate-400 hover:text-white"
                  title={row.isActive ? 'Desativar' : 'Ativar'}
                >
                  {row.isActive ? <ToggleRight className="text-emerald-400" size={18} /> : <ToggleLeft size={18} />}
                </button>
                <button
                  type="button"
                  onClick={() => startEdit(row)}
                  className="p-2 rounded border border-slate-600 text-slate-400 hover:text-white"
                  title="Editar"
                >
                  <Edit size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(row.id)}
                  className="p-2 rounded border border-red-900/50 text-red-400 hover:bg-red-950/30"
                  title="Apagar"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
