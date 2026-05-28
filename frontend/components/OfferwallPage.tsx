import React, { useState } from 'react';
import { ArrowLeft, Coins, ChevronRight, ExternalLink, Sparkles } from 'lucide-react';
import { ZeradsCard } from './ZeradsCard';

/**
 * Catálogo de providers de Offerwall disponíveis no site.
 *
 * Cada entrada tem:
 *   - id: usado pra seleção e como key
 *   - name: nome do provider
 *   - tagline + description: textos curtos para o card
 *   - status: 'live' | 'soon' — o badge muda; 'soon' não é clicável
 *   - render: o painel renderizado quando o user entra no provider (live only)
 *
 * Para adicionar outro provider depois (ex. AdGate, CPALead), basta
 * estender o array — a UI faz o resto.
 */
type ProviderStatus = 'live' | 'soon';

type Provider = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  status: ProviderStatus;
  accent: 'emerald' | 'sky' | 'amber' | 'violet';
  render?: () => React.ReactNode;
};

const PROVIDERS: Provider[] = [
  {
    id: 'zerads',
    name: 'ZERads',
    tagline: 'PTC ads — paga em ZER, creditado em USDC',
    description:
      'Vê anúncios PTC; o ZERads chama a nossa API a cada ~5 min e credita 80% do valor no teu saldo USDC.',
    status: 'live',
    accent: 'emerald',
    render: () => <ZeradsCard />
  },
  {
    id: 'adgate',
    name: 'AdGate Media',
    tagline: 'Em breve',
    description: 'Offerwall com surveys e ofertas mais altas — em avaliação.',
    status: 'soon',
    accent: 'sky'
  },
  {
    id: 'cpalead',
    name: 'CPALead',
    tagline: 'Em breve',
    description: 'Ofertas CPA, surveys e mini-games — em avaliação.',
    status: 'soon',
    accent: 'amber'
  }
];

type Accent = Provider['accent'];

const ACCENT_CLASSES: Record<Accent, { ring: string; chip: string; iconBg: string; gradient: string }> = {
  emerald: {
    ring: 'border-emerald-700/60 hover:border-emerald-500/70',
    chip: 'bg-emerald-900/40 text-emerald-300 border-emerald-700/60',
    iconBg: 'bg-emerald-600/90',
    gradient: 'from-slate-900/90 via-slate-900/70 to-emerald-950/30'
  },
  sky: {
    ring: 'border-sky-700/60 hover:border-sky-500/70',
    chip: 'bg-sky-900/40 text-sky-300 border-sky-700/60',
    iconBg: 'bg-sky-600/90',
    gradient: 'from-slate-900/90 via-slate-900/70 to-sky-950/30'
  },
  amber: {
    ring: 'border-amber-700/60 hover:border-amber-500/70',
    chip: 'bg-amber-900/40 text-amber-300 border-amber-700/60',
    iconBg: 'bg-amber-600/90',
    gradient: 'from-slate-900/90 via-slate-900/70 to-amber-950/30'
  },
  violet: {
    ring: 'border-violet-700/60 hover:border-violet-500/70',
    chip: 'bg-violet-900/40 text-violet-300 border-violet-700/60',
    iconBg: 'bg-violet-600/90',
    gradient: 'from-slate-900/90 via-slate-900/70 to-violet-950/30'
  }
};

export const OfferwallPage: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId ? PROVIDERS.find((p) => p.id === selectedId) ?? null : null;

  if (selected?.render) {
    return (
      <div className="w-full flex flex-col gap-4 text-slate-100 pb-8">
        <div className="max-w-4xl mx-auto w-full px-3 sm:px-4">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200 transition"
          >
            <ArrowLeft size={14} />
            Voltar à lista de offerwalls
          </button>
        </div>
        <div className="px-3 sm:px-4">{selected.render()}</div>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-8 text-slate-100 pb-8">
      <div className="max-w-7xl mx-auto w-full px-3 sm:px-4 space-y-6">
        {/* Cabeçalho */}
        <div className="rounded-2xl border border-slate-700/80 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-emerald-950/20 px-4 sm:px-6 py-5 sm:py-6 space-y-2">
          <div className="text-[11px] uppercase tracking-widest text-emerald-400/90 font-bold">
            Ganhos externos / Offerwall
          </div>
          <h1 className="text-2xl sm:text-4xl font-black tracking-tight flex flex-wrap items-center gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600/90 text-white shadow-lg shadow-emerald-900/30">
              <Sparkles className="shrink-0" size={24} />
            </span>
            <span className="bg-gradient-to-r from-white to-slate-300 bg-clip-text text-transparent">
              Offerwall
            </span>
          </h1>
          <p className="text-sm text-slate-400 max-w-3xl">
            Liste de parceiros externos que te pagam por ver anúncios, fazer surveys ou completar tarefas. Os ganhos são creditados automaticamente
            em USDC na tua carteira do jogo. Tu ficas com <span className="font-bold text-emerald-300">80%</span>; 20% ficam para a plataforma para
            cobrir taxas.
          </p>
        </div>

        {/* Lista de providers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {PROVIDERS.map((p) => {
            const a = ACCENT_CLASSES[p.accent];
            const isLive = p.status === 'live';
            const Wrapper: React.ElementType = isLive ? 'button' : 'div';
            return (
              <Wrapper
                key={p.id}
                type={isLive ? 'button' : undefined}
                onClick={isLive ? () => setSelectedId(p.id) : undefined}
                disabled={!isLive}
                className={`text-left rounded-2xl border ${a.ring} bg-gradient-to-br ${a.gradient} p-4 sm:p-5 transition group ${
                  isLive ? 'cursor-pointer hover:shadow-lg hover:shadow-black/30' : 'opacity-60'
                }`}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <span
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${a.iconBg} text-white shadow-lg shadow-black/30`}
                  >
                    <Coins size={20} />
                  </span>
                  <span
                    className={`text-[10px] uppercase font-bold tracking-widest px-2 py-1 rounded border ${a.chip}`}
                  >
                    {isLive ? 'Disponível' : 'Em breve'}
                  </span>
                </div>
                <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">{p.name}</h2>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mt-0.5">{p.tagline}</p>
                <p className="text-sm text-slate-300 mt-2 leading-snug">{p.description}</p>

                {isLive ? (
                  <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-300 group-hover:text-emerald-200 transition">
                    Abrir painel <ChevronRight size={14} />
                  </div>
                ) : (
                  <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">
                    Indisponível <ExternalLink size={14} />
                  </div>
                )}
              </Wrapper>
            );
          })}
        </div>

        <p className="text-[11px] text-slate-500 max-w-3xl">
          Dúvidas? Os pagamentos chegam por callback dos providers a cada ~5 min — pode haver atraso. O histórico fica visível dentro do painel
          de cada provider.
        </p>
      </div>
    </div>
  );
};

export default OfferwallPage;
