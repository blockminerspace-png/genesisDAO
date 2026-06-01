import React, { useEffect, useState, useCallback } from 'react';
import { Coins, Copy, ExternalLink, Loader2, RefreshCw, MousePointerClick, TrendingUp } from 'lucide-react';
import {
  getZeradsToken,
  getZeradsStats,
  type ZeradsTokenResponse,
  type ZeradsStatsResponse
} from '../services/api';

function fmtUsdc(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function fmtZer(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function fmtTs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  try {
    return new Date(ms).toLocaleString('pt-PT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

/**
 * Painel ZERads do utilizador: link PTC personalizado + estatísticas
 * (ganhos em USDC creditados, clicks contabilizados, últimos callbacks).
 *
 * Dados vêm de:
 *   GET /api/zerads/me/token  (gera/retorna token opaco)
 *   GET /api/zerads/me/stats  (totais + 30 últimas linhas do ledger)
 */
export const ZeradsCard: React.FC = () => {
  const [token, setToken] = useState<ZeradsTokenResponse>(null);
  const [stats, setStats] = useState<ZeradsStatsResponse>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial = false) => {
    if (!initial) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [t, s] = await Promise.all([getZeradsToken(), getZeradsStats()]);
      if (!t) {
        setError('Não foi possível obter o teu link ZERads. Tenta novamente.');
      }
      setToken(t);
      setStats(s);
    } finally {
      if (!initial) setRefreshing(false); else setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    // refresh leve a cada 60s para apanhar callbacks recentes do ZERads (~5 min)
    const id = window.setInterval(() => void load(false), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  async function copyLink(): Promise<void> {
    if (!token?.ptc_url) return;
    try {
      await navigator.clipboard.writeText(token.ptc_url);
      setCopyHint('Link copiado!');
      window.setTimeout(() => setCopyHint(null), 2000);
    } catch {
      setCopyHint('Não consegui copiar — copia manualmente.');
      window.setTimeout(() => setCopyHint(null), 3000);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-700/80 bg-slate-900/60 p-6 flex items-center gap-3 text-slate-300">
        <Loader2 className="animate-spin" size={18} /> A carregar ZERads…
      </div>
    );
  }

  const t = stats?.totals;

  return (
    <section className="w-full max-w-4xl mx-auto space-y-4">
      <div className="rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-emerald-950/20 px-4 sm:px-6 py-5 sm:py-6 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-600/90 text-white shadow-lg shadow-emerald-900/30">
              <Coins className="shrink-0" size={22} />
            </span>
            <div>
              <div className="text-[11px] uppercase tracking-widest text-emerald-400/90 font-bold">Ganhos externos</div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
                ZERads PTC
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load(false)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-2 rounded-lg border border-slate-700 bg-slate-950 hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>

        <p className="text-sm text-slate-400 max-w-2xl">
          Vê anúncios PTC no ZERads — o teu saldo é creditado automaticamente cá em USDC a cada ~5 minutos.
          Recebes <span className="font-bold text-emerald-300">80% do valor</span>; 20% ficam para a plataforma.
        </p>

        {error && (
          <div className="text-xs text-rose-300 bg-rose-950/30 border border-rose-900/40 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Link PTC */}
        {token?.ptc_url && (
          <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3 sm:p-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={token.ptc_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex flex-1 min-w-[200px] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 px-5 py-3.5 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-emerald-900/40 border border-emerald-500/30 transition"
              >
                <ExternalLink size={18} />
                O teu link PTC pessoal
              </a>
              <button
                type="button"
                onClick={() => void copyLink()}
                title="Copiar link"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-900 hover:bg-slate-800 px-4 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-300"
              >
                <Copy size={16} />
                Copiar
              </button>
            </div>
            {copyHint && <div className="text-[11px] text-emerald-300">{copyHint}</div>}
          </div>
        )}

        {/* Cards de estatísticas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 pt-1">
          <StatBlock
            label="USDC ganho"
            value={fmtUsdc(t?.user_amount_usdc ?? 0)}
            icon={<TrendingUp size={16} />}
            tone="emerald"
          />
          <StatBlock
            label="ZER recebido"
            value={fmtZer(t?.amount_zer ?? 0)}
            icon={<Coins size={16} />}
            tone="amber"
          />
          <StatBlock
            label="Clicks"
            value={String(t?.clicks ?? 0)}
            icon={<MousePointerClick size={16} />}
            tone="sky"
          />
          <StatBlock
            label="Callbacks"
            value={String(t?.callbacks ?? 0)}
            icon={<RefreshCw size={16} />}
            tone="slate"
          />
        </div>
      </div>

      {/* Histórico */}
      <div className="rounded-2xl border border-slate-700/80 bg-slate-900/50 overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-slate-800 text-[11px] uppercase tracking-widest text-slate-400 font-bold">
          Últimos pagamentos (até 30)
        </div>
        {!stats || stats.recent.length === 0 ? (
          <div className="px-4 py-8 text-sm text-slate-500 text-center">
            Ainda sem callbacks. Abre o teu link PTC, vê alguns anúncios, e em ~5 min o ZERads envia o crédito.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-950/70 text-[10px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="text-left px-3 py-2 font-bold">Data</th>
                  <th className="text-right px-3 py-2 font-bold">ZER</th>
                  <th className="text-right px-3 py-2 font-bold">USDC creditado</th>
                  <th className="text-right px-3 py-2 font-bold">Clicks</th>
                  <th className="text-right px-3 py-2 font-bold">Taxa</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent.map((r, i) => (
                  <tr key={i} className="border-t border-slate-800/70">
                    <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{fmtTs(r.created_at)}</td>
                    <td className="px-3 py-2 text-right text-amber-200 font-mono">{fmtZer(r.amount_zer)}</td>
                    <td className="px-3 py-2 text-right text-emerald-200 font-mono">{fmtUsdc(r.user_amount_usdc)}</td>
                    <td className="px-3 py-2 text-right text-sky-200 font-mono">{r.clicks}</td>
                    <td className="px-3 py-2 text-right text-slate-400 font-mono">{r.zer_to_usdc_rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};

type Tone = 'emerald' | 'amber' | 'sky' | 'slate';

const TONE_CLASSES: Record<Tone, { wrap: string; label: string; value: string; icon: string }> = {
  emerald: {
    wrap: 'border-emerald-800/60 bg-emerald-950/30',
    label: 'text-emerald-400/90',
    value: 'text-emerald-100',
    icon: 'text-emerald-300'
  },
  amber: {
    wrap: 'border-amber-800/60 bg-amber-950/30',
    label: 'text-amber-400/90',
    value: 'text-amber-100',
    icon: 'text-amber-300'
  },
  sky: {
    wrap: 'border-sky-800/60 bg-sky-950/30',
    label: 'text-sky-400/90',
    value: 'text-sky-100',
    icon: 'text-sky-300'
  },
  slate: {
    wrap: 'border-slate-700/70 bg-slate-950/50',
    label: 'text-slate-400/90',
    value: 'text-slate-100',
    icon: 'text-slate-300'
  }
};

const StatBlock: React.FC<{
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: Tone;
}> = ({ label, value, icon, tone }) => {
  const t = TONE_CLASSES[tone];
  return (
    <div className={`rounded-xl border ${t.wrap} p-3 flex items-center gap-3 min-w-0`}>
      <span className={`shrink-0 ${t.icon}`}>{icon}</span>
      <div className="min-w-0">
        <div className={`text-[10px] uppercase tracking-widest font-bold ${t.label} truncate`}>{label}</div>
        <div className={`text-lg sm:text-xl font-black leading-tight ${t.value} truncate font-mono`}>{value}</div>
      </div>
    </div>
  );
};

export default ZeradsCard;
