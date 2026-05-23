import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    ArrowUpRight,
    AreaChart,
    Box,
    Clock3,
    Coins,
    Cpu,
    Layers3,
    Pickaxe,
    Server,
    Sparkles,
    TrendingUp
} from 'lucide-react';
import { getPlayerCalculatorMe, type PlayerCalculatorMeOk } from '../services/api';

interface PlayerCalculatorProps {
    onBack: () => void;
}

export const PlayerCalculator: React.FC<PlayerCalculatorProps> = ({ onBack }) => {
    const [scope, setScope] = useState<string>('total');
    const [payload, setPayload] = useState<PlayerCalculatorMeOk | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedCoinId, setSelectedCoinId] = useState<string | null>(null);
    const fetchGenRef = useRef(0);

    useEffect(() => {
        const ac = new AbortController();
        const gen = ++fetchGenRef.current;
        setLoading(true);
        setLoadError(null);
        void (async () => {
            const r = await getPlayerCalculatorMe(scope, ac.signal);
            if (gen !== fetchGenRef.current) return;
            if (r.ok !== true) {
                if (r.status === 0 && r.code === 'ABORTED') return;
                setPayload(null);
                setLoadError(r.error || `Erro ${r.status}`);
                setLoading(false);
                return;
            }
            setPayload(r);
            setSelectedCoinId((prev) => {
                if (prev && r.coins.some((c) => c.id === prev)) return prev;
                return r.coins[0]?.id ?? null;
            });
            setLoading(false);
        })();
        return () => ac.abort();
    }, [scope]);

    const selectedCoin = payload?.coins.find((c) => c.id === selectedCoinId) ?? null;
    const scopesUi = payload?.scopesUi ?? [{ id: 'total', name: 'Poder Total' }];
    const selectedBlockHistory = selectedCoin?.blockHistory ?? [];

    const summaryCards = useMemo(() => {
        if (!selectedCoin) return [];
        return [
            {
                id: 'daily',
                label: 'Ganhos em 24h',
                value: `$${selectedCoin.dailyUsd.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}`,
                detail: `${selectedCoin.dailyCoins.toFixed(8)} ${selectedCoin.symbol}`,
                icon: TrendingUp,
                accent: 'from-amber-400/30 via-orange-500/10 to-transparent'
            },
            {
                id: 'monthly',
                label: 'Projeção 30 dias',
                value: `$${selectedCoin.projection30Usd.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}`,
                detail: `1 ${selectedCoin.symbol} = $${(selectedCoin.priceUSD || 0).toLocaleString('en-US', { maximumFractionDigits: 6 })}`,
                icon: AreaChart,
                accent: 'from-cyan-400/30 via-sky-500/10 to-transparent'
            },
            {
                id: 'hash',
                label: 'Hashrate ativo',
                value: `${selectedCoin.userPowerHps.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s`,
                detail: `Rede: ${selectedCoin.networkHashrate.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s`,
                icon: Cpu,
                accent: 'from-violet-400/30 via-fuchsia-500/10 to-transparent'
            },
            {
                id: 'block',
                label: 'Bloco / janela',
                value: `${selectedCoin.blockReward.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${selectedCoin.symbol}`,
                detail: `Tempo alvo: ${selectedCoin.blockTime.toLocaleString('en-US', { maximumFractionDigits: 2 })} s`,
                icon: Pickaxe,
                accent: 'from-emerald-400/30 via-green-500/10 to-transparent'
            }
        ];
    }, [selectedCoin]);

    const totalHistoryCoins = selectedBlockHistory.reduce((acc, item) => acc + item.amountCoins, 0);
    const totalHistoryUsd = selectedBlockHistory.reduce((acc, item) => acc + item.amountUsd, 0);

    const formatWindow = (startMs: number, endMs: number) => {
        try {
            const start = new Date(startMs).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            const end = new Date(endMs).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit'
            });
            return `${start} -> ${end}`;
        } catch {
            return 'Janela indisponível';
        }
    };

    return (
        <div className="flex-1 overflow-hidden bg-[radial-gradient(circle_at_top,#1e293b_0%,#020617_45%,#020617_100%)] text-slate-200 flex">
            <div className="w-72 bg-slate-950/75 border-r border-white/10 flex flex-col p-5 shrink-0 backdrop-blur-xl">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 p-3 rounded-2xl hover:bg-white/5 transition-colors"
                >
                    <ArrowLeft size={18} />
                    <span className="font-bold text-sm">Voltar</span>
                </button>

                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 mb-6 shadow-[0_20px_80px_-45px_rgba(251,191,36,0.45)]">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 grid place-items-center shadow-lg shadow-amber-900/40">
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <div className="text-xs font-bold uppercase tracking-[0.24em] text-amber-300/80">Mining Lab</div>
                            <div className="text-lg font-black text-white">Calculadora Premium</div>
                        </div>
                    </div>
                    <p className="text-xs leading-5 text-slate-400">
                        Projeções por moeda, potência real do teu setup e histórico recente dos blocos/janelas creditados.
                    </p>
                </div>

                <div className="text-[11px] font-bold uppercase text-slate-500 tracking-[0.22em] mb-3 px-2">Escopo de Análise</div>

                <div className="space-y-1">
                    {scopesUi.map((opt) => (
                        <button
                            key={opt.id}
                            type="button"
                            disabled={loading}
                            onClick={() => setScope(opt.id)}
                            className={`w-full flex items-center justify-between p-3.5 rounded-2xl text-sm font-medium transition-all border ${
                                scope === opt.id
                                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/40 shadow-[0_16px_36px_-24px_rgba(245,158,11,0.8)]'
                                    : 'text-slate-400 border-transparent hover:bg-white/5 hover:text-slate-200'
                            } ${loading ? 'opacity-60 cursor-wait' : ''}`}
                        >
                            <span className="flex items-center gap-2">
                                {opt.id === 'total' ? <Box size={16} /> : <Server size={16} />}
                                {opt.name}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="mt-6 grid gap-3">
                    <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-cyan-300/80 mb-2">
                            <Layers3 size={14} />
                            Hashrate selecionado
                        </div>
                        <div className="text-xl font-mono font-black text-white">
                            {selectedCoin
                                ? `${selectedCoin.userPowerHps.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s`
                                : '—'}
                        </div>
                    </div>
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-emerald-300/80 mb-2">
                            <Coins size={14} />
                            Histórico recente
                        </div>
                        <div className="text-lg font-black text-white">
                            ${totalHistoryUsd.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                            {totalHistoryCoins.toFixed(8)} {selectedCoin?.symbol || ''}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-8 flex flex-col items-center">
                <div className="max-w-7xl w-full flex flex-col gap-6">
                    {loadError && (
                        <div className="rounded-2xl border border-red-800/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                            {loadError}
                        </div>
                    )}

                    {loading && !payload && (
                        <div className="text-center text-slate-500 text-sm py-16">A carregar calculadora…</div>
                    )}

                    {!loading && payload && payload.coins.length === 0 && (
                        <div className="text-center text-slate-500 text-sm py-16">Nenhuma moeda ativa na economia.</div>
                    )}

                    {payload && payload.coins.length > 0 && (
                        <>
                            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 md:p-6 overflow-hidden relative">
                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.18),transparent_35%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.16),transparent_30%)] pointer-events-none" />
                                <div className="relative flex flex-col gap-5">
                                    <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                                        <div>
                                            <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-amber-300/80 mb-2">
                                                Centro de Projeção
                                            </div>
                                            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">
                                                Calculadora de mineração
                                            </h1>
                                            <p className="text-sm text-slate-400 mt-2 max-w-3xl">
                                                Consulta visual da tua produção prevista, com leitura de hashrate efetivo e histórico recente dos blocos creditados no servidor.
                                            </p>
                                        </div>
                                        {selectedCoin && (
                                            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                                                <div className="text-[10px] uppercase tracking-[0.22em] text-amber-200/80 mb-1">Moeda em foco</div>
                                                <div className="text-xl font-black text-white">{selectedCoin.symbol}</div>
                                                <div className="text-xs text-slate-300">{selectedCoin.name}</div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                    {payload.coins.map((c) => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => setSelectedCoinId(c.id)}
                                            className={`px-4 py-2.5 rounded-2xl text-sm font-bold uppercase tracking-wider transition-all border sm:px-6 ${
                                                selectedCoinId === c.id
                                                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 border-amber-300/70 shadow-lg shadow-amber-900/40'
                                                    : 'text-slate-400 border-white/10 hover:text-slate-200 hover:bg-white/5'
                                            }`}
                                        >
                                            {c.symbol || c.name}
                                        </button>
                                    ))}
                                    </div>
                                </div>
                            </div>

                            {selectedCoin && (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
                                        {summaryCards.map((card) => {
                                            const Icon = card.icon;
                                            return (
                                                <div
                                                    key={card.id}
                                                    className="relative overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/65 p-6 shadow-[0_30px_90px_-60px_rgba(15,23,42,1)]"
                                                >
                                                    <div className={`absolute inset-0 bg-gradient-to-br ${card.accent}`} />
                                                    <div className="relative">
                                                        <div className="flex items-center justify-between mb-6">
                                                            <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">
                                                                {card.label}
                                                            </div>
                                                            <div className="h-11 w-11 rounded-2xl border border-white/10 bg-white/5 grid place-items-center text-amber-300">
                                                                <Icon size={18} />
                                                            </div>
                                                        </div>
                                                        <div className="text-2xl font-black text-white break-words">{card.value}</div>
                                                        <div className="text-xs text-slate-400 mt-3 leading-5">{card.detail}</div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="grid grid-cols-1 2xl:grid-cols-[1.25fr_0.95fr] gap-6">
                                        <div className="bg-slate-950/70 rounded-[30px] border border-white/10 p-6 md:p-8">
                                            <h3 className="flex items-center gap-2 text-slate-100 font-bold mb-6">
                                                <TrendingUp size={18} className="text-amber-400" />
                                                Detalhamento financeiro e projeções
                                            </h3>

                                            <div className="w-full overflow-hidden rounded-2xl border border-white/5">
                                                <div className="grid grid-cols-3 pb-3 pt-4 border-b border-white/5 text-[10px] items-center font-bold text-slate-500 uppercase tracking-[0.22em] px-4">
                                                    <div>Período</div>
                                                    <div>Moeda ({selectedCoin.symbol})</div>
                                                    <div className="text-right">Equivalente em USDC</div>
                                                </div>
                                                <div className="flex flex-col">
                                                    {selectedCoin.rows.map((period, index) => (
                                                        <div
                                                            key={period.label}
                                                            className={`grid grid-cols-3 py-4 px-4 items-center transition-colors ${
                                                                index !== selectedCoin.rows.length - 1 ? 'border-b border-white/5' : ''
                                                            } hover:bg-white/[0.03]`}
                                                        >
                                                            <div className="text-sm font-medium text-slate-200">{period.label}</div>
                                                            <div className="text-sm font-mono text-slate-300">{period.coins.toFixed(8)}</div>
                                                            <div className="text-right font-mono font-bold text-emerald-400">
                                                                $
                                                                {period.usd.toLocaleString('en-US', {
                                                                    minimumFractionDigits: 6,
                                                                    maximumFractionDigits: 6
                                                                })}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
                                                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                                    <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">Preço atual</div>
                                                    <div className="text-lg font-black text-white">
                                                        ${selectedCoin.priceUSD.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                                                    </div>
                                                </div>
                                                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                                    <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">Hashrate da rede</div>
                                                    <div className="text-lg font-black text-white">
                                                        {selectedCoin.networkHashrate.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s
                                                    </div>
                                                </div>
                                                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                                    <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">Recompensa de bloco</div>
                                                    <div className="text-lg font-black text-white">
                                                        {selectedCoin.blockReward.toLocaleString('en-US', { maximumFractionDigits: 6 })} {selectedCoin.symbol}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-slate-950/70 rounded-[30px] border border-white/10 p-6 md:p-8">
                                            <div className="flex items-start justify-between gap-4 mb-6">
                                                <div>
                                                    <h3 className="flex items-center gap-2 text-slate-100 font-bold">
                                                        <Clock3 size={18} className="text-cyan-400" />
                                                        Histórico de blocos minerados
                                                    </h3>
                                                    <p className="text-xs text-slate-400 mt-2">
                                                        Últimas janelas creditadas pelo servidor para {selectedCoin.symbol}.
                                                    </p>
                                                </div>
                                                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-right">
                                                    <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/80">Total recente</div>
                                                    <div className="text-sm font-black text-white">
                                                        ${totalHistoryUsd.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                                                    </div>
                                                </div>
                                            </div>

                                            {selectedBlockHistory.length === 0 ? (
                                                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-10 text-center text-sm text-slate-500">
                                                    Ainda não há blocos creditados para esta moeda neste histórico recente.
                                                </div>
                                            ) : (
                                                <div className="space-y-3 max-h-[38rem] overflow-y-auto custom-scrollbar pr-1">
                                                    {selectedBlockHistory.map((item) => (
                                                        <div
                                                            key={item.id}
                                                            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.05] transition-colors"
                                                        >
                                                            <div className="flex items-start justify-between gap-4">
                                                                <div>
                                                                    <div className="text-sm font-bold text-white flex items-center gap-2">
                                                                        <Pickaxe size={14} className="text-amber-400" />
                                                                        {formatWindow(item.windowStartMs, item.windowEndMs)}
                                                                    </div>
                                                                    <div className="text-xs text-slate-400 mt-1">
                                                                        {item.roomId ? `Sala: ${item.roomId}` : 'Escopo total'} · {item.creditedBlocks} bloco(s) creditado(s)
                                                                    </div>
                                                                </div>
                                                                <div className="text-right">
                                                                    <div className="text-sm font-black text-emerald-400">
                                                                        ${item.amountUsd.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}
                                                                    </div>
                                                                    <div className="text-xs font-mono text-amber-300">
                                                                        {item.amountCoins.toFixed(8)} {selectedCoin.symbol}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                                                                <div className="rounded-xl bg-slate-900/70 border border-white/5 p-3">
                                                                    <div className="text-slate-500 uppercase tracking-[0.18em] mb-1">Hashrate</div>
                                                                    <div className="text-slate-100 font-semibold">
                                                                        {item.userHashHps.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s
                                                                    </div>
                                                                </div>
                                                                <div className="rounded-xl bg-slate-900/70 border border-white/5 p-3">
                                                                    <div className="text-slate-500 uppercase tracking-[0.18em] mb-1">Rede</div>
                                                                    <div className="text-slate-100 font-semibold">
                                                                        {item.networkHashrate.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    <div className="text-center text-[10px] text-slate-600 mt-4 max-w-2xl mx-auto">
                        * Estimativas calculadas no servidor com base na dificuldade de rede e no teu hashrate. Valores reais podem
                        variar.
                    </div>
                </div>
            </div>
        </div>
    );
};
