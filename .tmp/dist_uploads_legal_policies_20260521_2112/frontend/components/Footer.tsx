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
};

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
    return (
        <div className="shrink-0 flex flex-col">
        <MarketNews />
        <footer className="py-6 text-center text-slate-500 dark:text-slate-500 text-xs bg-slate-50 dark:bg-[#0f0c08] border-t border-slate-200 dark:border-amber-900/35 shrink-0 transition-colors duration-300">
            <div className="max-w-7xl mx-auto px-4">
                <p className="font-semibold bg-gradient-to-r from-amber-500 to-orange-600 dark:from-amber-300 dark:to-amber-500 bg-clip-text text-transparent tracking-widest">Ecossistema online V0.5 — Genesis DAO</p>
                <p className="mt-2 text-slate-600 dark:text-slate-400">&copy; {new Date().getFullYear()} Genesis Miner. Todos os direitos reservados.</p>
                <p className="mt-1 opacity-80">Camada principal: Polygon PoS.</p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[11px]">
                    <button
                        type="button"
                        onClick={() => onNavigate?.('terms')}
                        className="text-amber-700 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 transition-colors"
                    >
                        Termos de Uso
                    </button>
                    <span className="opacity-40">|</span>
                    <button
                        type="button"
                        onClick={() => onNavigate?.('privacy')}
                        className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-300 transition-colors"
                    >
                        Política de Privacidade
                    </button>
                    <span className="opacity-40">|</span>
                    <button
                        type="button"
                        onClick={() => onNavigate?.('cookies')}
                        className="text-orange-700 dark:text-orange-400 hover:text-orange-600 dark:hover:text-orange-300 transition-colors"
                    >
                        Política de Cookies
                    </button>
                    <span className="opacity-40">|</span>
                    <button
                        type="button"
                        onClick={() => onNavigate?.('aml')}
                        className="text-red-700 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
                    >
                        AML / Antifraude / KYC
                    </button>
                    <span className="opacity-40">|</span>
                    <button
                        type="button"
                        onClick={() => onNavigate?.('web3_risk')}
                        className="text-yellow-700 dark:text-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-300 transition-colors"
                    >
                        Aviso de Risco Web3 / Cripto
                    </button>
                    <span className="opacity-40">|</span>
                    <button
                        type="button"
                        onClick={() => onNavigate?.('refunds')}
                        className="text-cyan-700 dark:text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors"
                    >
                        Política de Reembolsos
                    </button>
                    <span className="opacity-40">|</span>
                    <button
                        type="button"
                        onClick={() => onNavigate?.('community')}
                        className="text-violet-700 dark:text-violet-400 hover:text-violet-600 dark:hover:text-violet-300 transition-colors"
                    >
                        Política de Conteúdo e Comunidade
                    </button>
                </div>
            </div>
        </footer>
        </div>
    );
};
