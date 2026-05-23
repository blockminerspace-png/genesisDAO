import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft,
    ArrowUpRight,
    Box,
    Clock3,
    Coins,
    Cpu,
    Layers3,
    Pickaxe,
    Server,
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
                accent: 'bg-[#24180a]'
            },
            {
                id: 'monthly',
                label: 'Projeção 30 dias',
                value: `$${selectedCoin.projection30Usd.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}`,
                detail: `1 ${selectedCoin.symbol} = $${(selectedCoin.priceUSD || 0).toLocaleString('en-US', { maximumFractionDigits: 6 })}`,
                icon: ArrowUpRight,
                accent: 'bg-[#22160b]'
            },
            {
                id: 'hash',
                label: 'Hashrate ativo',
                value: `${selectedCoin.userPowerHps.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s`,
                detail: `Rede: ${selectedCoin.networkHashrate.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s`,
                icon: Cpu,
                accent: 'bg-[#21160a]'
            },
            {
                id: 'block',
                label: 'Bloco / janela',
                value: `${selectedCoin.blockReward.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${selectedCoin.symbol}`,
                detail: `Tempo alvo: ${selectedCoin.blockTime.toLocaleString('en-US', { maximumFractionDigits: 2 })} s`,
                icon: Pickaxe,
                accent: 'bg-[#25190a]'
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

    const shellPanel = 'border border-slate-800 bg-[#080604]';
    const mutedPanel = 'border border-slate-800 bg-[#0d0906]';

    return (
        <div className="flex-1 overflow-hidden bg-[#050403] text-white flex">
            <div className="w-72 bg-[#070605] border-r border-slate-800 flex flex-col p-5 shrink-0">
                <button
                    type="button"
                    onClick={onBack}
                    className="flex items-center gap-2 text-slate-300 hover:text-white mb-6 p-3 rounded-2xl hover:bg-[#11100e] transition-colors"
                >
                    <ArrowLeft size={18} />
                    <span className="font-bold text-sm">Voltar</span>
                </button>

                <div className={`rounded-3xl p-4 mb-6 ${shellPanel}`}>
                    <div className="flex items-center gap-3 mb-3">
                        <div className="h-11 w-11 rounded-2xl border border-slate-700 bg-[#11100e] text-white grid place-items-center">
                            <Pickaxe size={18} />
                        </div>
                        <div>
                            <div className="text-xs font-bold uppercase tracking-[0.24em] text-slate-300">Calculadora</div>
                            <div className="text-lg font-black text-white">Projeção de mineração</div>
                        </div>
                    </div>
                    <p className="text-xs leading-5 text-slate-400">
                        Ganhos estimados por moeda, hashrate real do setup e histórico recente das janelas creditadas.
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
                                    ? 'bg-[#15120f] text-white border-slate-700'
                                    : 'text-slate-300 border-transparent hover:bg-[#11100e] hover:text-white'
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
                    <div className={`rounded-2xl p-4 ${mutedPanel}`}>
                        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-300 mb-2">
                            <Layers3 size={14} />
                            Hashrate selecionado
                        </div>
                        <div className="text-xl font-mono font-black text-white">
                            {selectedCoin
                                ? `${selectedCoin.userPowerHps.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s`
                                : '—'}
                        </div>
                    </div>
                    <div className={`rounded-2xl p-4 ${mutedPanel}`}>
                        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-300 mb-2">
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
                            <div className={`rounded-[28px] p-5 md:p-6 ${shellPanel}`}>
                                <div className="flex flex-col gap-5">
                                    <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                                        <div>
                                            <div className="text-[11px] font-bold uppercase tracking-[0.28em] text-slate-300 mb-2">
                                                Painel de análise
                                            </div>
                                            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">
                                                Calculadora de mineração
                                            </h1>
                                            <p className="text-sm text-slate-400 mt-2 max-w-3xl">
                                                Consulta direta da tua produção prevista, com leitura de hashrate efetivo e histórico recente dos blocos creditados no servidor.
                                            </p>
                                        </div>
                                        {selectedCoin && (
                                            <div className="rounded-2xl border border-slate-800 bg-[#11100e] px-4 py-3">
                                                <div className="text-[10px] uppercase tracking-[0.22em] text-slate-300 mb-1">Moeda em foco</div>
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
                                                    ? 'bg-[#181512] text-white border-slate-600'
                                                    : 'text-slate-300 border-slate-800 hover:text-white hover:bg-[#11100e]'
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
                                                    className={`rounded-[28px] p-6 ${mutedPanel}`}
                                                >
                                                    <div className={`rounded-[22px] ${card.accent} p-5`}>
                                                        <div className="flex items-center justify-between mb-6">
                                                            <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">
                                                                {card.label}
                                                            </div>
                                                            <div className="h-11 w-11 rounded-2xl border border-slate-700 bg-[#11100e] grid place-items-center text-white">
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
                                        <div className={`rounded-[30px] p-6 md:p-8 ${shellPanel}`}>
                                            <h3 className="flex items-center gap-2 text-slate-100 font-bold mb-6">
                                                <TrendingUp size={18} className="text-white" />
                                                Detalhamento financeiro e projeções
                                            </h3>

                                            <div className="w-full overflow-hidden rounded-2xl border border-slate-800 bg-[#060504]">
                                                <div className="grid grid-cols-3 pb-3 pt-4 border-b border-slate-800 text-[10px] items-center font-bold text-slate-400 uppercase tracking-[0.22em] px-4">
                                                    <div>Período</div>
                                                    <div>Moeda ({selectedCoin.symbol})</div>
                                                    <div className="text-right">Equivalente em USDC</div>
                                                </div>
                                                <div className="flex flex-col">
                                                    {selectedCoin.rows.map((period, index) => (
                                                        <div
                                                            key={period.label}
                                                            className={`grid grid-cols-3 py-4 px-4 items-center transition-colors ${
                                                                index !== selectedCoin.rows.length - 1 ? 'border-b border-slate-800' : ''
                                                            } hover:bg-[#0f0d0b]`}
                                                        >
                                                            <div className="text-sm font-medium text-slate-200">{period.label}</div>
                                                            <div className="text-sm font-mono text-slate-300">{period.coins.toFixed(8)}</div>
                                                            <div className="text-right font-mono font-bold text-white">
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
                                                <div className={`rounded-2xl p-4 ${mutedPanel}`}>
                                                    <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-2">Preço atual</div>
                                                    <div className="text-lg font-black text-white">
                                                        ${selectedCoin.priceUSD.toLocaleString('en-US', { maximumFractionDigits: 6 })}
                                                    </div>
                                                </div>
                                                <div className={`rounded-2xl p-4 ${mutedPanel}`}>
                                                    <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-2">Hashrate da rede</div>
                                                    <div className="text-lg font-black text-white">
                                                        {selectedCoin.networkHashrate.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s
                                                    </div>
                                                </div>
                                                <div className={`rounded-2xl p-4 ${mutedPanel}`}>
                                                    <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 mb-2">Recompensa de bloco</div>
                                                    <div className="text-lg font-black text-white">
                                                        {selectedCoin.blockReward.toLocaleString('en-US', { maximumFractionDigits: 6 })} {selectedCoin.symbol}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className={`rounded-[30px] p-6 md:p-8 ${shellPanel}`}>
                                            <div className="flex items-start justify-between gap-4 mb-6">
                                                <div>
                                                    <h3 className="flex items-center gap-2 text-slate-100 font-bold">
                                                        <Clock3 size={18} className="text-white" />
                                                        Histórico de blocos minerados
                                                    </h3>
                                                    <p className="text-xs text-slate-400 mt-2">
                                                        Últimas janelas creditadas pelo servidor para {selectedCoin.symbol}.
                                                    </p>
                                                </div>
                                                <div className="rounded-2xl border border-slate-800 bg-[#11100e] px-3 py-2 text-right">
                                                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-300">Total recente</div>
                                                    <div className="text-sm font-black text-white">
                                                        ${totalHistoryUsd.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                                                    </div>
                                                </div>
                                            </div>

                                            {selectedBlockHistory.length === 0 ? (
                                                <div className="rounded-2xl border border-dashed border-slate-800 bg-[#060504] px-4 py-10 text-center text-sm text-slate-500">
                                                    Ainda não há blocos creditados para esta moeda neste histórico recente.
                                                </div>
                                            ) : (
                                                <div className="space-y-3 max-h-[38rem] overflow-y-auto custom-scrollbar pr-1">
                                                    {selectedBlockHistory.map((item) => (
                                                        <div
                                                            key={item.id}
                                                            className="rounded-2xl border border-slate-800 bg-[#060504] p-4 hover:bg-[#0f0d0b] transition-colors"
                                                        >
                                                            <div className="flex items-start justify-between gap-4">
                                                                <div>
                                                                    <div className="text-sm font-bold text-white flex items-center gap-2">
                                                                        <Pickaxe size={14} className="text-white" />
                                                                        {formatWindow(item.windowStartMs, item.windowEndMs)}
                                                                    </div>
                                                                    <div className="text-xs text-slate-400 mt-1">
                                                                        {item.roomId ? `Sala: ${item.roomId}` : 'Escopo total'} · {item.creditedBlocks} bloco(s) creditado(s)
                                                                    </div>
                                                                </div>
                                                                <div className="text-right">
                                                                    <div className="text-sm font-black text-white">
                                                                        ${item.amountUsd.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}
                                                                    </div>
                                                                    <div className="text-xs font-mono text-white">
                                                                        {item.amountCoins.toFixed(8)} {selectedCoin.symbol}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                                                                <div className="rounded-xl bg-[#0d0906] border border-slate-800 p-3">
                                                                    <div className="text-slate-400 uppercase tracking-[0.18em] mb-1">Hashrate</div>
                                                                    <div className="text-slate-100 font-semibold">
                                                                        {item.userHashHps.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s
                                                                    </div>
                                                                </div>
                                                                <div className="rounded-xl bg-[#0d0906] border border-slate-800 p-3">
                                                                    <div className="text-slate-400 uppercase tracking-[0.18em] mb-1">Rede</div>
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
