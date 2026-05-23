import React from 'react';
import { MessageCircle, Send } from 'lucide-react';
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
            <footer className="bg-slate-50 dark:bg-[#0f0c08] border-t border-slate-200 dark:border-amber-900/35 shrink-0 transition-colors duration-300">
                <div className="max-w-7xl mx-auto px-4 py-8">
                    <div className="grid gap-8 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] text-sm">
                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <img
                                    src="/img/favicon/genesis-miner-logo.png"
                                    alt="Genesis Miner"
                                    className="h-12 w-12 rounded-xl border border-amber-200/70 dark:border-amber-900/50 bg-white dark:bg-slate-900 p-1.5 shadow-sm"
                                />
                                <div>
                                    <p className="font-semibold bg-gradient-to-r from-amber-500 to-orange-600 dark:from-amber-300 dark:to-amber-500 bg-clip-text text-transparent tracking-widest text-xs uppercase">
                                        Genesis Miner
                                    </p>
                                    <p className="text-slate-900 dark:text-slate-100 font-semibold">
                                        Genesis DAO
                                    </p>
                                </div>
                            </div>
                            <p className="text-slate-600 dark:text-slate-400 leading-relaxed max-w-md">
                                Simulador Web3 de mineração digital com economia, estratégia e progressão no ecossistema Genesis.
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-500">
                                &copy; {new Date().getFullYear()} Genesis Miner. Todos os direitos reservados.
                            </p>
                        </div>

                        <div className="space-y-3">
                            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                                Plataformas do game
                            </h3>
                            <div className="flex flex-col gap-2 text-slate-600 dark:text-slate-300">
                                <a href="https://discord.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-amber-500 transition-colors">
                                    <MessageCircle size={16} /> Discord
                                </a>
                                <a href="https://t.me" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-amber-500 transition-colors">
                                    <Send size={16} /> Telegram
                                </a>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                                Legal
                            </h3>
                            <div className="flex flex-col gap-2 text-slate-600 dark:text-slate-300">
                                <button
                                    type="button"
                                    onClick={() => onNavigate?.('terms')}
                                    className="text-left hover:text-amber-500 transition-colors"
                                >
                                    Termos de Uso
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onNavigate?.('privacy')}
                                    className="text-left hover:text-amber-500 transition-colors"
                                >
                                    Política de Privacidade
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onNavigate?.('cookies')}
                                    className="text-left hover:text-amber-500 transition-colors"
                                >
                                    Política de Cookies
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onNavigate?.('community')}
                                    className="text-left hover:text-amber-500 transition-colors"
                                >
                                    Conteúdo e Comunidade
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
};
