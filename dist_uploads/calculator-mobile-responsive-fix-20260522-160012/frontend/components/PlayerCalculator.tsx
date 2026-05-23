import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, TrendingUp, Box, Server } from 'lucide-react';
import { getPlayerCalculatorMe, type PlayerCalculatorMeOk } from '../services/api';
import { AdminEconomy } from './AdminEconomy';

interface PlayerCalculatorProps {
    onBack: () => void;
    isAdmin?: boolean;
}

function formatDateTime(valueMs: number): string {
    if (!Number.isFinite(valueMs) || valueMs <= 0) return '—';
    return new Date(valueMs).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatHashrate(hps: number): string {
    const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
    let value = Number(hps) || 0;
    let idx = 0;
    while (value >= 1000 && idx < units.length - 1) {
        value /= 1000;
        idx += 1;
    }
    return `${value.toLocaleString('pt-BR', {
        minimumFractionDigits: value < 10 && idx > 0 ? 2 : 0,
        maximumFractionDigits: value < 10 && idx > 0 ? 2 : 0
    })} ${units[idx]}`;
}

export const PlayerCalculator: React.FC<PlayerCalculatorProps> = ({ onBack, isAdmin }) => {
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

    return (
        <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-hidden bg-slate-950 text-slate-200 xl:flex-row">
            <div className="flex w-full shrink-0 flex-col border-b border-slate-800 bg-slate-900 p-3 xl:w-72 xl:border-b-0 xl:border-r xl:p-4">
                <button
                    type="button"
                    onClick={onBack}
                    className="mb-4 flex items-center gap-2 rounded p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white lg:mb-6"
                >
                    <ArrowLeft size={18} />
                    <span className="font-bold text-sm">Voltar</span>
                </button>

                <div className="mb-3 px-2 text-xs font-bold uppercase tracking-widest text-slate-500">Escopo de Análise</div>

                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-1">
                    {scopesUi.map((opt) => (
                        <button
                            key={opt.id}
                            type="button"
                            disabled={loading}
                            onClick={() => setScope(opt.id)}
                            className={`flex w-full items-center justify-between rounded-lg p-3 text-left text-sm font-medium transition-all ${
                                scope === opt.id
                                    ? 'bg-amber-600/10 text-amber-400 border border-amber-500/50'
                                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                            } ${loading ? 'opacity-60 cursor-wait' : ''}`}
                        >
                            <span className="flex items-center gap-2">
                                {opt.id === 'total' ? <Box size={16} /> : <Server size={16} />}
                                {opt.name}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4 xl:mt-auto">
                    <div className="text-xs text-slate-500 mb-1">Hashrate Selecionado</div>
                    <div className="break-words text-lg font-mono font-bold text-white sm:text-xl">
                        {selectedCoin
                            ? `${selectedCoin.userPowerHps.toLocaleString('en-US', { maximumFractionDigits: 0 })} H/s`
                            : '—'}
                    </div>
                </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col items-center overflow-x-hidden overflow-y-auto custom-scrollbar p-3 sm:p-4 xl:p-6">
                <div className="flex w-full max-w-full flex-col gap-4 sm:gap-5 xl:max-w-5xl xl:gap-6">
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
                            <div className="flex w-full items-center justify-center overflow-x-hidden">
                                <div className="flex w-full flex-wrap justify-center gap-1 rounded-lg border border-slate-800 bg-slate-900/50 p-1 sm:w-auto">
                                    {payload.coins.map((c) => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            onClick={() => setSelectedCoinId(c.id)}
                                            className={`min-w-0 flex-[1_1_calc(50%-0.25rem)] rounded-md px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all sm:min-w-[88px] sm:flex-1 sm:text-sm md:min-w-0 md:flex-none md:px-6 ${
                                                selectedCoinId === c.id
                                                    ? 'bg-amber-600 text-white shadow-lg shadow-amber-900/50'
                                                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                                            }`}
                                        >
                                            {c.symbol || c.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {selectedCoin && (
                                <>
                                    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2 2xl:gap-6">
                                        <div className="group relative flex min-h-[190px] min-w-0 flex-col justify-between overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6 xl:h-48 xl:p-8">
                                            <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-amber-400 to-orange-500 rounded-sm"></div>
                                            <div className="z-10">
                                                <div className="text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-1">
                                                    Ganhos 24h ({selectedCoin.symbol})
                                                </div>
                                                <div className="flex min-w-0 items-end gap-2 break-all text-[clamp(1.85rem,8vw,2.8rem)] font-black tracking-tight text-white">
                                                    $
                                                    {selectedCoin.dailyUsd.toLocaleString('en-US', {
                                                        minimumFractionDigits: 6,
                                                        maximumFractionDigits: 6
                                                    })}
                                                </div>
                                                <div className="mt-2 break-words font-mono text-sm font-bold text-amber-400">
                                                    {selectedCoin.dailyCoins.toFixed(8)} {selectedCoin.symbol}
                                                </div>
                                            </div>
                                            <div className="pointer-events-none absolute right-[-12px] top-[12px] rotate-12 opacity-5 sm:right-[-20px] sm:top-[20px]">
                                                <TrendingUp size={140} />
                                            </div>
                                        </div>

                                        <div className="group relative flex min-h-[190px] min-w-0 flex-col justify-between overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-5 sm:p-6 xl:h-48 xl:p-8">
                                            <div className="absolute top-0 left-0 w-2 h-full bg-gradient-to-b from-amber-400 to-orange-600 rounded-sm"></div>
                                            <div className="z-10">
                                                <div className="text-[10px] font-bold uppercase text-slate-400 tracking-widest mb-1">Projeção 30 Dias</div>
                                                <div className="break-all text-[clamp(1.85rem,8vw,2.8rem)] font-black tracking-tight text-white">
                                                    $
                                                    {selectedCoin.projection30Usd.toLocaleString('en-US', {
                                                        minimumFractionDigits: 6,
                                                        maximumFractionDigits: 6
                                                    })}
                                                </div>
                                                <div className="mt-3 break-words font-mono text-xs italic text-orange-400">
                                                    Câmbio: 1 {selectedCoin.symbol} = $
                                                    {(selectedCoin.priceUSD || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC
                                                </div>
                                            </div>
                                            <div className="absolute right-5 top-5 text-orange-500 opacity-20 sm:right-8 sm:top-8">
                                                <ArrowUpRight size={48} />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-6 lg:p-8">
                                        <h3 className="flex items-center gap-2 text-slate-300 font-bold mb-6">
                                            <TrendingUp size={18} className="text-amber-400" />
                                            Detalhamento Financeiro (Projeções)
                                        </h3>

                                        <div className="hidden w-full lg:block">
                                            <div className="grid grid-cols-3 items-center border-b border-slate-800 px-4 pb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                                <div>Período</div>
                                                <div>Moeda ({selectedCoin.symbol})</div>
                                                <div className="text-right">Equivalente em USDC</div>
                                            </div>
                                            <div className="flex flex-col">
                                                {selectedCoin.rows.map((period) => (
                                                    <div
                                                        key={period.label}
                                                        className="grid grid-cols-3 py-4 border-b border-slate-800/50 hover:bg-white/5 transition-colors px-4 items-center"
                                                    >
                                                        <div className="text-sm font-medium text-slate-300">{period.label}</div>
                                                        <div className="text-sm font-mono text-slate-300">{period.coins.toFixed(8)}</div>
                                                        <div className="text-right font-mono font-bold text-green-400">
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

                                        <div className="space-y-3 lg:hidden">
                                            {selectedCoin.rows.map((period) => (
                                                <div
                                                    key={period.label}
                                                    className="rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3"
                                                >
                                                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                                        {period.label}
                                                    </div>
                                                    <div className="mt-3 text-xs text-slate-500">Moeda ({selectedCoin.symbol})</div>
                                                    <div className="mt-1 break-words font-mono text-sm text-slate-200">
                                                        {period.coins.toFixed(8)}
                                                    </div>
                                                    <div className="mt-3 text-xs text-slate-500">Equivalente em USDC</div>
                                                    <div className="mt-1 break-words font-mono text-sm font-bold text-green-400">
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

                                    <div className="rounded-3xl border border-slate-800 bg-slate-900 p-4 sm:p-6 lg:p-8">
                                        <div className="flex flex-col gap-2 mb-6 sm:flex-row sm:items-center sm:justify-between">
                                            <div>
                                                <h3 className="flex items-center gap-2 text-slate-300 font-bold">
                                                    <Box size={18} className="text-amber-400" />
                                                    Histórico de Blocos Minerados
                                                </h3>
                                                <p className="text-xs text-slate-500 mt-1">
                                                    Últimos créditos processados para {selectedCoin.symbol}.
                                                </p>
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                {selectedCoin.blockHistory.length} registros
                                            </div>
                                        </div>

                                        {selectedCoin.blockHistory.length === 0 ? (
                                            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-8 text-center text-sm text-slate-500">
                                                Ainda não há blocos creditados neste escopo para esta moeda.
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {selectedCoin.blockHistory.map((entry) => (
                                                    <div
                                                        key={entry.id}
                                                        className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-4"
                                                    >
                                                        <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                                            <div className="min-w-0">
                                                                <div className="text-sm font-bold text-white">
                                                                    {entry.creditedBlocks.toLocaleString('pt-BR')} bloco(s) creditado(s)
                                                                </div>
                                                                <div className="mt-1 break-words text-xs text-slate-500">
                                                                    Janela: {formatDateTime(entry.windowStartMs)} até {formatDateTime(entry.windowEndMs)}
                                                                </div>
                                                                <div className="mt-1 break-words text-xs text-slate-500">
                                                                    Sala: {entry.roomId || 'Poder total / múltiplas salas'}
                                                                </div>
                                                            </div>

                                                            <div className="min-w-0 text-left xl:text-right">
                                                                <div className="break-words text-sm font-mono font-bold text-amber-400">
                                                                    {entry.amountCoins.toFixed(8)} {selectedCoin.symbol}
                                                                </div>
                                                                <div className="mt-1 break-words text-xs font-mono text-green-400">
                                                                    $
                                                                    {entry.amountUsd.toLocaleString('en-US', {
                                                                        minimumFractionDigits: 6,
                                                                        maximumFractionDigits: 6
                                                                    })}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
                                                            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
                                                                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                                                    Seu Hashrate
                                                                </div>
                                                                <div className="mt-1 text-sm font-mono text-slate-200">
                                                                    {formatHashrate(entry.userHashHps)}
                                                                </div>
                                                            </div>

                                                            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
                                                                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                                                    Rede
                                                                </div>
                                                                <div className="mt-1 text-sm font-mono text-slate-200">
                                                                    {formatHashrate(entry.networkHashrate)}
                                                                </div>
                                                            </div>

                                                            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
                                                                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                                                    Recompensa
                                                                </div>
                                                                <div className="mt-1 text-sm font-mono text-slate-200">
                                                                    {entry.blockReward.toFixed(8)} {selectedCoin.symbol}
                                                                </div>
                                                            </div>

                                                            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
                                                                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                                                    Tempo de Bloco
                                                                </div>
                                                                <div className="mt-1 text-sm font-mono text-slate-200">
                                                                    {entry.blockTime.toLocaleString('pt-BR', {
                                                                        maximumFractionDigits: 2
                                                                    })}s
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {isAdmin && (
                        <div className="mt-12 pt-8 border-t border-slate-800 animate-in slide-in-from-bottom-5 fade-in duration-500">
                            <div className="min-w-0 overflow-x-hidden rounded-3xl border border-slate-700/50 bg-slate-900 p-4 shadow-2xl sm:p-6">
                                <AdminEconomy />
                            </div>
                        </div>
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
