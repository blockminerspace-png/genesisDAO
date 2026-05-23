import React from 'react';
import { MarketNews } from './MarketNews';

type FooterProps = {
    onNavigate?: (
        view:
            | 'home'
            | 'docs'
            | 'terms'
            | 'privacy'
            | 'cookies'
            | 'aml'
            | 'web3_risk'
            | 'refunds'
            | 'community'
            | 'auth'
            | 'game'
            | 'admin'
    ) => void;
    showMarketNews?: boolean;
};

export const Footer: React.FC<FooterProps> = ({ onNavigate, showMarketNews = true }) => {
    return (
        <div className="shrink-0 flex flex-col">
        {showMarketNews ? <MarketNews /> : null}
        <footer className="py-6 text-center text-slate-500 dark:text-slate-500 text-xs bg-slate-50 dark:bg-[#0f0c08] border-t border-slate-200 dark:border-amber-900/35 shrink-0 transition-colors duration-300">
            <div className="max-w-7xl mx-auto px-4">
                <p className="font-semibold bg-gradient-to-r from-amber-500 to-orange-600 dark:from-amber-300 dark:to-amber-500 bg-clip-text text-transparent tracking-widest">Ecossistema online V0.5 — Genesis DAO</p>
                <p className="mt-2 text-slate-600 dark:text-slate-400">&copy; {new Date().getFullYear()} Genesis Miner. Todos os direitos reservados.</p>
                <p className="mt-1 opacity-80">Camada principal: Polygon PoS.</p>
                <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-200/70 bg-amber-50 px-4 py-2 text-[11px] font-semibold text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                    Central legal:
                    <button
                        type="button"
                        onClick={() => onNavigate?.('terms')}
                        className="underline underline-offset-2 hover:text-amber-600 dark:hover:text-amber-200 transition-colors"
                    >
                        ler termos
                    </button>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[11px]">
                    <button
                        type="button"
                        onClick={() => onNavigate?.('terms')}
                        className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-amber-700 dark:border-amber-900/50 dark:bg-slate-900 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 transition-colors"
                    >
                        Termos de Uso
                    </button>
                    <span className="opacity-40">|</span>
                    <button
                        type="button"
                        onClick={() => onNavigate?.('privacy')}
                        className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-emerald-700 dark:border-emerald-900/50 dark:bg-slate-900 dark:text-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-300 transition-colors"
                    >
                        Política de Privacidade
                    </button>
                    <span className="opacity-40">|</span>
                    <button
                        type="button"
                        onClick={() => onNavigate?.('cookies')}
                        className="rounded-full border border-orange-200 bg-white px-3 py-1.5 text-orange-700 dark:border-orange-900/50 dark:bg-slate-900 dark:text-orange-400 hover:text-orange-600 dark:hover:text-orange-300 transition-colors"
                    >
                        Política de Cookies
                    </button>
                    <span className="opacity-40">|</span>
                    <button
                        type="button"
                        onClick={() => onNavigate?.('aml')}
                        className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-red-700 dark:border-red-900/50 dark:bg-slate-900 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
                    >
                        AML / Antifraude / KYC
                    </button>
                    <span className="opacity-40">|</span>
                    <button
                        type="button"
                        onClick={() => onNavigate?.('web3_risk')}
                        className="rounded-full border border-yellow-200 bg-white px-3 py-1.5 text-yellow-700 dark:border-yellow-900/50 dark:bg-slate-900 dark:text-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-300 transition-colors"
                    >
                        Aviso de Risco Web3 / Cripto
                    </button>
                    <span className="opacity-40">|</span>
                    <button
                        type="button"
                        onClick={() => onNavigate?.('refunds')}
                        className="rounded-full border border-cyan-200 bg-white px-3 py-1.5 text-cyan-700 dark:border-cyan-900/50 dark:bg-slate-900 dark:text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors"
                    >
                        Política de Reembolsos
                    </button>
                    <span className="opacity-40">|</span>
                    <button
                        type="button"
                        onClick={() => onNavigate?.('community')}
                        className="rounded-full border border-violet-200 bg-white px-3 py-1.5 text-violet-700 dark:border-violet-900/50 dark:bg-slate-900 dark:text-violet-400 hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
                    >
                        Política de Conteúdo e Comunidade
                    </button>
                </div>
            </div>
        </footer>
        </div>
    );
};
