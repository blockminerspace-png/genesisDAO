

import React, { useState, useEffect } from 'react';
import { AccessLevel, User } from '../types';
import { updateUser, login, requestPasswordReset, resetPasswordSecure, requestEmailVerification, verifyEmailToken } from '../services/api';
import { collectDeviceFingerprint } from '../utils/deviceFingerprint';
import {
    AUTH_LOGIN_RECOVERY_EMAIL_MAX,
    AUTH_PASSWORD_MAX,
    AUTH_REFERRAL_MAX,
    AUTH_SIGNUP_EMAIL_MAX,
    AUTH_USERNAME_MAX,
    AUTH_USERNAME_MIN
} from '../constants/authLimits';
import { Lock, Mail, User as UserIcon, ArrowRight, AlertCircle, CheckCircle2, CreditCard, Wallet, Share2, ShieldCheck, Key, Eye, EyeOff, ArrowLeft } from 'lucide-react';

declare global {
    interface Window {
        turnstile?: {
            render: (container: HTMLElement, options: Record<string, unknown>) => string;
            remove?: (widgetId: string) => void;
            reset?: (widgetId?: string) => void;
        };
    }
}

interface AuthPageProps {
    onLogin: (user: User) => void;
    accessLevels?: AccessLevel[];
    initialMode?: 'login' | 'register';
}

function sanitizeAuthTextInput(value: string): string {
    // Decodificar URL-encoding antes de checar (evita %3Cscript%3E etc.)
    let v = value;
    try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch { /* manter original se inválido */ }
    // Remover caracteres de controle e zero-width invisíveis
    v = v.replace(/[\u0000-\u001F\u007F\u200B-\u200D\uFEFF\u2060]/g, '');
    // Remover chars perigosos para XSS/injection
    v = v.replace(/[<>'"`\\;{}()[\]]/g, '');
    return v;
}

function passwordFieldBorder(hasValue: boolean, matches: boolean | null): string {
    if (!hasValue) return 'border-slate-200 dark:border-slate-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500';
    if (matches === null) return 'border-slate-200 dark:border-slate-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500';
    return matches
        ? 'border-emerald-500/70 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500'
        : 'border-red-500/70 focus:border-red-500 focus:ring-1 focus:ring-red-500';
}

export const AuthPage: React.FC<AuthPageProps> = ({ onLogin, accessLevels = [], initialMode = 'login' }) => {
    const [activeTab, setActiveTab] = useState<'login' | 'register' | 'special' | 'recovery' | 'verify'>('login');

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [referralInput, setReferralInput] = useState('');
    const [acceptedTerms, setAcceptedTerms] = useState(false);

    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Web3 & Selection State
    const [selectedLevelId, setSelectedLevelId] = useState<string>('');
    const [isWeb3Processing, setIsWeb3Processing] = useState(false);

    // Recovery State (link por email; token no path /redefinir-senha/:token)
    const [recoveryStep, setRecoveryStep] = useState<'email' | 'sent' | 'reset'>('email');
    const [recoveryToken, setRecoveryToken] = useState<string>('');
    const [verificationToken, setVerificationToken] = useState<string>('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [showRecoveryPassword, setShowRecoveryPassword] = useState(false);
    const [showRecoveryConfirmPassword, setShowRecoveryConfirmPassword] = useState(false);
    const [showResendActivationCta, setShowResendActivationCta] = useState(false);
    const [turnstileSiteKey, setTurnstileSiteKey] = useState('');
    const [turnstileToken, setTurnstileToken] = useState('');

    const navigateAuthMode = (mode: 'login' | 'register') => {
        try {
            window.history.replaceState({}, '', mode === 'register' ? '/registro' : '/login');
        } catch {
            /* ignore */
        }
        setActiveTab(mode);
    };

    useEffect(() => {
        let cancelled = false;
        void fetch('/api/security/turnstile-config', { credentials: 'include' })
            .then((res) => res.json().catch(() => ({})))
            .then((data: { enabled?: boolean; siteKey?: string }) => {
                if (cancelled) return;
                if (data.enabled && typeof data.siteKey === 'string') {
                    setTurnstileSiteKey(data.siteKey.trim());
                } else {
                    setTurnstileSiteKey('');
                }
            })
            .catch(() => {
                if (!cancelled) setTurnstileSiteKey('');
            });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const pathname = window.location.pathname || '';
        const path = pathname.toLowerCase();
        const pathParts = pathname.split('/').filter(Boolean);
        const tokenFromPath = pathParts.length >= 2 && (path.includes('verificar-email') || path.includes('redefinir-senha'))
            ? pathParts[pathParts.length - 1]
            : null;
        const token = tokenFromPath || params.get('token');
        if (token && path.includes('verificar-email')) {
            try {
                setVerificationToken(decodeURIComponent(token));
            } catch {
                setVerificationToken(token);
            }
            if (tokenFromPath) {
                try {
                    window.history.replaceState({}, '', '/verificar-email');
                } catch {
                    /* ignore */
                }
            }
            setActiveTab('verify');
            setError(null);
            setSuccessMessage(null);
            return;
        }
        if (token && path.includes('redefinir-senha')) {
            try {
                setRecoveryToken(decodeURIComponent(token));
            } catch {
                setRecoveryToken(token);
            }
            if (tokenFromPath) {
                try {
                    window.history.replaceState({}, '', '/redefinir-senha');
                } catch {
                    /* ignore */
                }
            }
            setActiveTab('recovery');
            setRecoveryStep('reset');
            setError(null);
            setSuccessMessage(null);
            return;
        }
        const ref = params.get('ref');
        if (ref) {
            setReferralInput(ref.slice(0, AUTH_REFERRAL_MAX));
            setActiveTab('register');
            return;
        }
        const authMode = params.get('auth');
        if (window.location.pathname.toLowerCase().includes('/registro') || authMode === 'register' || initialMode === 'register') {
            setActiveTab('register');
            return;
        }
        if (window.location.pathname.toLowerCase().includes('/login') || initialMode === 'login') {
            setActiveTab('login');
        }
    }, [initialMode]);

    useEffect(() => {
        const turnstileEnabled = activeTab === 'login' || activeTab === 'register' || (activeTab === 'special' && !!selectedLevelId);
        if (!turnstileSiteKey || !turnstileEnabled) return;
        if (document.querySelector('script[data-cf-turnstile-script="1"]')) return;
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.setAttribute('data-cf-turnstile-script', '1');
        document.head.appendChild(script);
    }, [activeTab, selectedLevelId, turnstileSiteKey]);

    useEffect(() => {
        const turnstileEnabled = activeTab === 'login' || activeTab === 'register' || (activeTab === 'special' && !!selectedLevelId);
        if (!turnstileSiteKey || !turnstileEnabled) return;
        let cancelled = false;
        let widgetId: string | null = null;
        const containerId = activeTab === 'login' ? 'cf-turnstile-login' : 'cf-turnstile-register';

        const renderWidget = () => {
            if (cancelled) return;
            const container = document.getElementById(containerId);
            if (!container || !window.turnstile) return;
            container.innerHTML = '';
            setTurnstileToken('');
            widgetId = window.turnstile.render(container, {
                sitekey: turnstileSiteKey,
                theme: 'dark',
                callback: (token: string) => setTurnstileToken(token),
                'expired-callback': () => setTurnstileToken(''),
                'error-callback': () => setTurnstileToken('')
            });
        };

        const tryRender = () => {
            if (cancelled) return;
            if (window.turnstile) {
                renderWidget();
                return;
            }
            window.setTimeout(tryRender, 200);
        };

        tryRender();
        return () => {
            cancelled = true;
            setTurnstileToken('');
            if (widgetId && window.turnstile?.remove) {
                try {
                    window.turnstile.remove(widgetId);
                } catch {
                    /* ignore */
                }
            }
        };
    }, [activeTab, selectedLevelId, turnstileSiteKey]);

    const resetForm = (opts?: { keepSuccess?: boolean }) => {
        setEmail(''); setPassword(''); setUsername(''); setConfirmPassword(''); setError(null);
        setAcceptedTerms(false);
        setRecoveryStep('email'); setRecoveryToken('');
        setShowResendActivationCta(false);
        setShowPassword(false);
        setShowConfirmPassword(false);
        setShowRecoveryPassword(false);
        setShowRecoveryConfirmPassword(false);
        setTurnstileToken('');
        try {
            window.turnstile?.reset?.();
        } catch {
            /* ignore */
        }
        if (!opts?.keepSuccess) setSuccessMessage(null);
    };

    const registerPasswordsMatch = confirmPassword.length === 0 ? null : password === confirmPassword;
    const recoveryPasswordsMatch = confirmPassword.length === 0 ? null : password === confirmPassword;

    const handleRequestPasswordResetEmail = async () => {
        const em = email.trim();
        if (!em || em.length > AUTH_LOGIN_RECOVERY_EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
            setError('Indique um email válido.');
            return;
        }
        setError(null);
        setSuccessMessage(null);
        setIsWeb3Processing(true);
        const res = await requestPasswordReset(em);
        setIsWeb3Processing(false);
        if (res.ok) {
            setRecoveryStep('sent');
        } else {
            setError(res.error || 'Não foi possível enviar o email.');
        }
    };

    const handleRecoveryReset = async (e: React.FormEvent) => {
        e.preventDefault();
        setSuccessMessage(null);
        if (password.length > AUTH_PASSWORD_MAX) {
            setError(`A senha pode ter no máximo ${AUTH_PASSWORD_MAX} caracteres.`);
            return;
        }
        if (password !== confirmPassword) {
            setError("Senhas não coincidem.");
            return;
        }

        setIsWeb3Processing(true);
        const res = await resetPasswordSecure(recoveryToken, password);
        setIsWeb3Processing(false);

        if (res.ok) {
            navigateAuthMode('login');
            setSuccessMessage('Senha redefinida com sucesso. Faça login agora.');
            resetForm({ keepSuccess: true });
        } else {
            setError(res.error || 'Falha ao redefinir senha.');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccessMessage(null);
        setShowResendActivationCta(false);

        let deviceFingerprint: Awaited<ReturnType<typeof collectDeviceFingerprint>> | undefined;
        try {
            deviceFingerprint = await collectDeviceFingerprint();
        } catch {
            deviceFingerprint = undefined;
        }

        if (activeTab === 'register' || activeTab === 'special') {
            // 1. VALIDATION
            if (!email || !password || !username) {
                setError("Todos os campos são obrigatórios.");
                return;
            }
            const em = email.trim();
            if (em.length > AUTH_SIGNUP_EMAIL_MAX) {
                setError(`O email pode ter no máximo ${AUTH_SIGNUP_EMAIL_MAX} caracteres.`);
                return;
            }
            const u = username.trim();
            if (u.length < AUTH_USERNAME_MIN || u.length > AUTH_USERNAME_MAX) {
                setError(`O nome de utilizador deve ter entre ${AUTH_USERNAME_MIN} e ${AUTH_USERNAME_MAX} caracteres.`);
                return;
            }
            if (password.length > AUTH_PASSWORD_MAX) {
                setError(`A senha pode ter no máximo ${AUTH_PASSWORD_MAX} caracteres.`);
                return;
            }
            if (referralInput.trim().length > AUTH_REFERRAL_MAX) {
                setError(`O código de indicação pode ter no máximo ${AUTH_REFERRAL_MAX} caracteres.`);
                return;
            }
            if (password !== confirmPassword) {
                setError("As senhas não coincidem.");
                return;
            }
            if (turnstileSiteKey && !turnstileToken) {
                setError('Confirme o captcha antes de continuar.');
                return;
            }
            if (activeTab === 'register' && !acceptedTerms) {
                setError('Você precisa concordar com os Termos de Uso e a Política de Privacidade para concluir o cadastro.');
                return;
            }

            // 2. DETERMINE ACCESS LEVEL & PAYMENT
            if (activeTab === 'special') {
                if (!selectedLevelId) {
                    setError("Selecione um plano.");
                    return;
                }

                const level = accessLevels.find(l => l.id === selectedLevelId);
                if (!level) return;

                // --- WEB3 PAYMENT SIMULATION ---
                setIsWeb3Processing(true);

                // Simulate Network Delay
                await new Promise(resolve => setTimeout(resolve, 2000));

                const confirmed = window.confirm(
                    `METAMASK (SIMULATION)\n\n` +
                    `Rede: Polygon Mainnet\n` +
                    `Contrato: ${level.contractAddress || '0x...'}\n` +
                    `Valor: ${level.priceUsdc} USDC\n\n` +
                    `Aprovar transação para acesso '${level.name}'?`
                );

                setIsWeb3Processing(false);

                if (!confirmed) {
                    setError("Pagamento rejeitado. O cadastro não foi concluído.");
                    return;
                }

            }

            // 3. GENERATE REFERRAL CODE
            const newReferralCode = `${u.toLowerCase().replace(/\s/g, '')}-${crypto.randomUUID().slice(0, 4)}`;

            // 5. CREATE USER
            const newUser: User = {
                email: em,
                password,
                username: u,
                isBlocked: false,
                referralCode: newReferralCode,
                referredBy: referralInput || undefined, // Send raw input, let server validate
                referrals: []
            };

            const result = await updateUser({
                ...newUser,
                newReferralFor: u,
                ...(deviceFingerprint ? { deviceFingerprint } : {}),
                ...(turnstileToken ? { turnstileToken } : {})
            });

            if (!result.ok) {
                setTurnstileToken('');
                try {
                    window.turnstile?.reset?.();
                } catch {
                    /* ignore */
                }
                setError(result.error || "Falha ao processar cadastro.");
                return;
            }

            setSuccessMessage(result.message || 'Cadastro concluído. Verifique o email para ativar a sua conta.');
            navigateAuthMode('login');
            setPassword('');
            setConfirmPassword('');
            return;

        } else {
            // LOGIN LOGIC
            const em = email.trim();
            const pwd = password;
            if (!em && !pwd) {
                setError('Indique o email e a palavra-passe.');
                return;
            }
            if (!em) {
                setError('Indique o email.');
                return;
            }
            if (!pwd) {
                setError('Indique a palavra-passe.');
                return;
            }
            if (em.length > AUTH_LOGIN_RECOVERY_EMAIL_MAX) {
                setError(`O email pode ter no máximo ${AUTH_LOGIN_RECOVERY_EMAIL_MAX} caracteres.`);
                return;
            }
            if (pwd.length > AUTH_PASSWORD_MAX) {
                setError(`Palavra-passe demasiado longa (máximo ${AUTH_PASSWORD_MAX} caracteres).`);
                return;
            }
            if (turnstileSiteKey && !turnstileToken) {
                setError('Confirme o captcha antes de continuar.');
                return;
            }
            const sessionUser = await login(em, pwd, deviceFingerprint, turnstileToken);
            if (sessionUser && !sessionUser.error) {
                if (sessionUser.isBlocked) {
                    setError("Esta conta foi bloqueada pela administração.");
                    return;
                }

                // Check if Access Level is Active
                const level = accessLevels.find(l => l.id === sessionUser.accessLevelId);
                if (level && !level.isActive) {
                    setError(level.inactiveMessage || `O nível de acesso '${level.name}' está temporariamente desativado para login.`);
                    return;
                }

                onLogin(sessionUser);
            } else {
                setTurnstileToken('');
                try {
                    window.turnstile?.reset?.();
                } catch {
                    /* ignore */
                }
                const needsVerification =
                    sessionUser?.code === 'EMAIL_NOT_VERIFIED' ||
                    sessionUser?.emailVerificationRequired === true;
                setShowResendActivationCta(needsVerification);
                setError(sessionUser?.error || 'E-mail ou palavra-passe incorretos.');
            }
        }
    };

    const handleResendVerification = async () => {
        const em = email.trim();
        if (!em || em.length > AUTH_LOGIN_RECOVERY_EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
            setError('Indique um email válido.');
            return;
        }
        setIsWeb3Processing(true);
        setError(null);
        setShowResendActivationCta(false);
        const result = await requestEmailVerification(em);
        setIsWeb3Processing(false);
        if (result.ok) {
            setSuccessMessage(result.message || 'Se a conta estiver pendente, reenviámos o link de confirmação.');
        } else {
            setError(result.error || 'Não foi possível reenviar o email de confirmação.');
        }
    };

    useEffect(() => {
        if (activeTab !== 'verify' || !verificationToken) return;
        let cancelled = false;
        setIsWeb3Processing(true);
        setError(null);
        setSuccessMessage(null);
        void verifyEmailToken(verificationToken).then((result) => {
            if (cancelled) return;
            setIsWeb3Processing(false);
            if (result.ok) {
                setSuccessMessage(result.message || 'Email confirmado com sucesso. Já pode iniciar sessão.');
                navigateAuthMode('login');
            } else {
                setError(result.error || 'Não foi possível confirmar o email.');
            }
        });
        return () => {
            cancelled = true;
        };
    }, [activeTab, verificationToken]);

    const paidLevels = accessLevels.filter(l => l.priceUsdc && l.priceUsdc > 0 && l.isActive);
    const selectedLevel = accessLevels.find(l => l.id === selectedLevelId);

    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 py-10 animate-in fade-in zoom-in-95 duration-300">

            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden relative transition-colors">
                <div className="p-8">
                    <div className="mb-6">
                        <a
                            href="/"
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:border-amber-500/50 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                        >
                            <ArrowLeft size={16} />
                            Voltar para o início
                        </a>
                    </div>

                    <div className="text-center mb-8">
                        <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                            {activeTab === 'register' ? 'Criar conta' : activeTab === 'special' ? 'Planos premium' : activeTab === 'recovery' ? 'Recuperar senha' : activeTab === 'verify' ? 'Confirmar email' : 'Entrar'}
                        </h2>
                        <p className="text-slate-500 text-sm">
                            {activeTab === 'register' ? 'Abra a sua conta e comece a montar a operação na Polygon.' : activeTab === 'special' ? 'Desbloqueie níveis pagos com USDC na simulação Web3.' : activeTab === 'recovery' ? 'Receba um link seguro no email para criar uma nova senha.' : activeTab === 'verify' ? 'Estamos validando o link de confirmação da sua conta.' : 'Use email e senha para voltar ao painel.'}
                        </p>
                    </div>

                    {/* TABS (Hidden in recovery mode to focus) */}
                    {activeTab !== 'recovery' && activeTab !== 'verify' && (
                        <div className="flex mb-6 bg-slate-100 dark:bg-slate-950 p-1 rounded-lg">
                            <button onClick={() => { navigateAuthMode('login'); resetForm(); }} className={`flex-1 py-2 text-xs font-bold uppercase rounded ${activeTab === 'login' ? 'bg-white dark:bg-slate-800 shadow text-amber-600' : 'text-slate-500'}`}>Login</button>
                            <button onClick={() => { navigateAuthMode('register'); resetForm(); }} className={`flex-1 py-2 text-xs font-bold uppercase rounded ${activeTab === 'register' ? 'bg-white dark:bg-slate-800 shadow text-amber-600' : 'text-slate-500'}`}>Cadastro</button>
                        </div>
                    )}

                    {successMessage && !error && (
                        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900/50 text-green-700 dark:text-green-400 p-3 rounded-lg mb-6 flex items-center gap-2 text-sm">
                            <CheckCircle2 size={16} /> {successMessage}
                        </div>
                    )}
                    {error && (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 p-3 rounded-lg mb-6 flex items-center gap-2 text-sm">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}
                    {showResendActivationCta && activeTab === 'login' && (
                        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
                            <div className="font-semibold text-amber-600 dark:text-amber-300">
                                A conta ainda não foi ativada.
                            </div>
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                Se o email de ativação não chegou, você pode reenviar agora.
                            </p>
                            <button
                                type="button"
                                onClick={handleResendVerification}
                                disabled={isWeb3Processing}
                                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-stone-950 hover:bg-amber-400 disabled:opacity-60"
                            >
                                {isWeb3Processing ? 'REENVIANDO...' : 'REENVIAR EMAIL DE ATIVAÇÃO'}
                            </button>
                        </div>
                    )}

                    {/* RECOVERY MODE */}
                    {activeTab === 'recovery' && (
                        <div className="space-y-6">
                            {recoveryStep === 'email' && (
                                <div className="space-y-4 font-normal">
                                    <div className="flex justify-center mb-2">
                                        <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-400">
                                            <ShieldCheck size={32} />
                                        </div>
                                    </div>
                                    <p className="text-center text-xs text-slate-500 mb-4">
                                        Indique o email da sua conta. Se existir registo, enviaremos um link para redefinir a senha (verifique spam).
                                    </p>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Email cadastrado</label>
                                        <div className="relative">
                                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                            <input
                                                type="email"
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                maxLength={AUTH_LOGIN_RECOVERY_EMAIL_MAX}
                                                autoComplete="email"
                                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white outline-none"
                                                placeholder="usuario@exemplo.com"
                                            />
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleRequestPasswordResetEmail}
                                        disabled={isWeb3Processing}
                                        className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 disabled:opacity-60"
                                    >
                                        {isWeb3Processing ? 'A ENVIAR...' : 'ENVIAR LINK POR EMAIL'} <Mail size={16} />
                                    </button>
                                    <button type="button" onClick={() => navigateAuthMode('login')} className="w-full text-center text-xs text-slate-500 hover:text-amber-500 mt-2">
                                        Voltar para login
                                    </button>
                                </div>
                            )}

                            {recoveryStep === 'sent' && (
                                <div className="space-y-4 text-center">
                                    <div className="flex justify-center mb-2">
                                        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center text-green-600">
                                            <Mail size={32} />
                                        </div>
                                    </div>
                                    <p className="text-sm text-slate-600 dark:text-slate-300">
                                        Se existir uma conta com <strong className="text-slate-900 dark:text-white">{email}</strong>, acabámos de enviar um email com o link para redefinir a senha.
                                    </p>
                                    <p className="text-xs text-slate-500">O link expira em cerca de 1 hora.</p>
                                    <button
                                        type="button"
                                        onClick={() => { navigateAuthMode('login'); resetForm(); }}
                                        className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-lg"
                                    >
                                        Voltar para login
                                    </button>
                                </div>
                            )}

                            {recoveryStep === 'reset' && (
                                <form onSubmit={handleRecoveryReset} className="space-y-4">
                                    <div className="text-center mb-4">
                                        <div className="inline-flex items-center gap-2 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-3 py-1 rounded-full text-xs font-bold">
                                            <ShieldCheck size={14} /> LINK VÁLIDO
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Nova Senha</label>
                                        <div className="relative">
                                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                            <input
                                                type={showRecoveryPassword ? 'text' : 'password'}
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                maxLength={AUTH_PASSWORD_MAX}
                                                autoComplete="new-password"
                                                className={`w-full bg-slate-50 dark:bg-slate-950 border rounded-lg py-3 pl-10 pr-12 text-slate-900 dark:text-white outline-none ${passwordFieldBorder(password.length > 0, recoveryPasswordsMatch)}`}
                                                placeholder="••••••••"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowRecoveryPassword((prev) => !prev)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors"
                                                aria-label={showRecoveryPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                            >
                                                {showRecoveryPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Confirmar Senha</label>
                                        <div className="relative">
                                            <Key className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                            <input
                                                type={showRecoveryConfirmPassword ? 'text' : 'password'}
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                maxLength={AUTH_PASSWORD_MAX}
                                                autoComplete="new-password"
                                                className={`w-full bg-slate-50 dark:bg-slate-950 border rounded-lg py-3 pl-10 pr-12 text-slate-900 dark:text-white outline-none ${passwordFieldBorder(confirmPassword.length > 0, recoveryPasswordsMatch)}`}
                                                placeholder="••••••••"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowRecoveryConfirmPassword((prev) => !prev)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors"
                                                aria-label={showRecoveryConfirmPassword ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}
                                            >
                                                {showRecoveryConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                        {confirmPassword.length > 0 && (
                                            <p className={`text-[11px] ${recoveryPasswordsMatch ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {recoveryPasswordsMatch ? 'As senhas coincidem.' : 'As senhas não coincidem.'}
                                            </p>
                                        )}
                                    </div>
                                    <button
                                        type="submit"
                                        disabled={isWeb3Processing}
                                        className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2"
                                    >
                                        {isWeb3Processing ? 'SALVANDO...' : 'REDEFINIR SENHA'}
                                    </button>
                                </form>
                            )}
                        </div>
                    )}

                    {activeTab === 'verify' && (
                        <div className="space-y-4 text-center">
                            <div className="flex justify-center mb-2">
                                <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center text-amber-600">
                                    <Mail size={32} />
                                </div>
                            </div>
                            <p className="text-sm text-slate-600 dark:text-slate-300">
                                {isWeb3Processing
                                    ? 'Validando o link de confirmação...'
                                    : 'Se o link for válido, a sua conta será ativada e poderá entrar normalmente.'}
                            </p>
                            <button
                                type="button"
                                onClick={() => { navigateAuthMode('login'); setVerificationToken(''); }}
                                className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3 rounded-lg"
                            >
                                Ir para login
                            </button>
                        </div>
                    )}

                    {/* SPECIAL: PLAN SELECTION */}
                    {activeTab === 'special' && !selectedLevelId && (
                        <div className="space-y-4">
                            <div className="bg-slate-50 dark:bg-slate-950/50 p-4 rounded-lg border border-slate-200 dark:border-slate-800">
                                <h4 className="font-bold text-slate-800 dark:text-white mb-3 text-sm flex items-center gap-2">
                                    <Wallet size={16} className="text-orange-500" /> Escolha seu Plano
                                </h4>
                                <div className="space-y-2">
                                    {paidLevels.map(level => (
                                        <div
                                            key={level.id}
                                            onClick={() => setSelectedLevelId(level.id)}
                                            className={`p-3 rounded border cursor-pointer transition-all bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-orange-500/50 hover:shadow-md`}
                                        >
                                            <div className="flex justify-between items-center">
                                                <span className="font-bold text-slate-700 dark:text-slate-200 text-sm">{level.name}</span>
                                                <span className="font-mono text-green-600 dark:text-green-400 font-bold">${level.priceUsdc} USDC</span>
                                            </div>
                                            <p className="text-xs text-slate-500 mt-1">{level.description}</p>
                                        </div>
                                    ))}
                                    {paidLevels.length === 0 && <p className="text-xs text-slate-500 italic text-center">Nenhum plano especial disponível no momento.</p>}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* FORM (Login, Register, or Special Selected) */}
                    {(activeTab === 'login' || activeTab === 'register' || (activeTab === 'special' && selectedLevelId)) && (
                        <form onSubmit={handleSubmit} className="space-y-4 animate-in fade-in">

                            {/* Selected Plan Header */}
                            {activeTab === 'special' && selectedLevel && (
                                <div className="bg-orange-100 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/50 p-3 rounded-lg flex justify-between items-center mb-4">
                                    <div>
                                        <div className="text-xs text-orange-600 dark:text-orange-400 font-bold uppercase">Plano Selecionado</div>
                                        <div className="font-bold text-slate-800 dark:text-white">{selectedLevel.name} <span className="font-mono text-green-600 dark:text-green-400">(${selectedLevel.priceUsdc})</span></div>
                                    </div>
                                    <button type="button" onClick={() => setSelectedLevelId('')} className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-white underline">
                                        Alterar
                                    </button>
                                </div>
                            )}

                            {activeTab !== 'login' && (
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Nome de Usuário</label>
                                    <div className="relative">
                                        <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                        <input
                                            type="text"
                                            value={username}
                                                onChange={(e) => setUsername(sanitizeAuthTextInput(e.target.value))}
                                            maxLength={AUTH_USERNAME_MAX}
                                            autoComplete="username"
                                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all"
                                            placeholder="Minerador_X"
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Email</label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value.replace(/[<>'"`\\\s]/g, ''))}
                                        maxLength={
                                            activeTab === 'login'
                                                ? AUTH_LOGIN_RECOVERY_EMAIL_MAX
                                                : AUTH_SIGNUP_EMAIL_MAX
                                        }
                                        autoComplete="email"
                                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all"
                                        placeholder="usuario@exemplo.com"
                                    />
                                </div>
                                {activeTab === 'login' && (
                                    <button
                                        type="button"
                                        onClick={handleResendVerification}
                                        className="text-[10px] text-slate-500 hover:text-amber-500 block text-right mt-1"
                                    >
                                        Reenviar email de confirmação
                                    </button>
                                )}
                            </div>

                            <div className="space-y-1">
                                <label className="text-xs font-bold text-slate-500 uppercase ml-1">Senha</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        maxLength={AUTH_PASSWORD_MAX}
                                        autoComplete={activeTab === 'login' ? 'current-password' : 'new-password'}
                                        className={`w-full bg-slate-50 dark:bg-slate-950 border rounded-lg py-3 pl-10 pr-12 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 outline-none transition-all ${
                                            activeTab === 'login'
                                                ? 'border-slate-200 dark:border-slate-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500'
                                                : passwordFieldBorder(password.length > 0, registerPasswordsMatch)
                                        }`}
                                        placeholder="••••••••"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((prev) => !prev)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors"
                                        aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                    >
                                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                                {activeTab === 'login' && (
                                    <button
                                        type="button"
                                        onClick={() => { setActiveTab('recovery'); resetForm(); }}
                                        className="text-[10px] text-slate-500 hover:text-amber-500 block text-right mt-1"
                                    >
                                        Esqueceu a senha?
                                    </button>
                                )}
                            </div>

                            {activeTab !== 'login' && (
                                <>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Confirmar Senha</label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                            <input
                                                type={showConfirmPassword ? 'text' : 'password'}
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                maxLength={AUTH_PASSWORD_MAX}
                                                autoComplete="new-password"
                                                className={`w-full bg-slate-50 dark:bg-slate-950 border rounded-lg py-3 pl-10 pr-12 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 outline-none transition-all ${passwordFieldBorder(confirmPassword.length > 0, registerPasswordsMatch)}`}
                                                placeholder="••••••••"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowConfirmPassword((prev) => !prev)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors"
                                                aria-label={showConfirmPassword ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}
                                            >
                                                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                            </button>
                                        </div>
                                        {confirmPassword.length > 0 && (
                                            <p className={`text-[11px] ${registerPasswordsMatch ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {registerPasswordsMatch ? 'As senhas coincidem.' : 'As senhas não coincidem.'}
                                            </p>
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-500 uppercase ml-1">Código de Indicação (Opcional)</label>
                                        <div className="relative">
                                            <Share2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                            <input
                                                type="text"
                                                value={referralInput}
                                                onChange={(e) => setReferralInput(sanitizeAuthTextInput(e.target.value))}
                                                maxLength={AUTH_REFERRAL_MAX}
                                                autoComplete="off"
                                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg py-3 pl-10 pr-4 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none transition-all"
                                                placeholder="código-de-amigo"
                                            />
                                        </div>
                                    </div>
                                    {activeTab === 'register' && (
                                        <label className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-3 text-xs text-slate-600 dark:text-slate-300">
                                            <input
                                                type="checkbox"
                                                checked={acceptedTerms}
                                                onChange={(e) => setAcceptedTerms(e.target.checked)}
                                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                                            />
                                            <span className="leading-relaxed">
                                                Li e concordo com os{' '}
                                                <a
                                                    href="/termos"
                                                    className="font-semibold text-amber-600 hover:text-amber-500"
                                                >
                                                    Termos de Uso
                                                </a>
                                                {' '}e com a{' '}
                                                <a
                                                    href="/privacidade"
                                                    className="font-semibold text-emerald-600 hover:text-emerald-500"
                                                >
                                                    Política de Privacidade
                                                </a>
                                                .
                                            </span>
                                        </label>
                                    )}
                                </>
                            )}

                            {turnstileSiteKey && (activeTab === 'login' || activeTab === 'register' || (activeTab === 'special' && !!selectedLevelId)) && (
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase ml-1">Verificação</label>
                                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-3 overflow-hidden">
                                        <div
                                            id={activeTab === 'login' ? 'cf-turnstile-login' : 'cf-turnstile-register'}
                                            className="min-h-[65px]"
                                        />
                                    </div>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isWeb3Processing || (turnstileSiteKey.length > 0 && !turnstileToken)}
                                className={`w-full font-bold py-3 rounded-lg shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 mt-6 ${activeTab === 'special' ? 'bg-orange-600 hover:bg-orange-500 text-white' : 'bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white'}`}
                            >
                                {isWeb3Processing ? (
                                    <span className="animate-pulse">PROCESSANDO...</span>
                                ) : (
                                    <>
                                        {activeTab === 'login' && 'ENTRAR'}
                                        {activeTab === 'register' && 'FINALIZAR CADASTRO'}
                                        {activeTab === 'special' && (
                                            <>PAGAR E FINALIZAR <CreditCard size={18} /></>
                                        )}
                                        {activeTab !== 'special' && <ArrowRight size={18} />}
                                    </>
                                )}
                            </button>
                        </form>
                    )}
                </div>

                {/* IP LIMIT MODAL */}
            </div>
        </div>
    );
};

