import React, { useCallback, useEffect, useState } from 'react';
import { CalendarCheck, Loader2, Snowflake, Trophy } from 'lucide-react';
import { getCheckinStatus, postCheckin, type CheckinStatusPayload } from '../services/api';

type Props = {
  /** Evita pedidos antes do save estar pronto (sessão + estado mínimo). */
  saveLoaded: boolean;
  /** Quando o servidor concede uma Estelar (7 dias), recarregar inventário. */
  onRewardGranted?: () => void;
};

function formatResetCountdown(nextResetMs: number): string {
  const left = Math.max(0, nextResetMs - Date.now());
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h <= 0) {
    if (m <= 0) return 'menos de 1m';
    return `${m}m`;
  }
  return `${h}h ${m}m`;
}

function checkinButtonDisabled(status: CheckinStatusPayload | null): boolean {
  if (!status) return true;
  if (status.premiumWeeklyCheckin) {
    return !status.canCheckinNow;
  }
  return status.todayCheckedIn && !status.canEarlyCheckin && !status.frozen;
}

export function DailyCheckinBanner({ saveLoaded, onRewardGranted }: Props) {
  const [status, setStatus] = useState<CheckinStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Tick por minuto: garante que o countdown ("~Xh Ym") rola sem depender de
  // um novo fetch ao servidor. `Date.now()` em `formatResetCountdown` lê o
  // tempo actual a cada render disparado por este state.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((v) => (v + 1) % 1_000_000), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const out = await getCheckinStatus();
      if ('data' in out && out.ok) {
        setStatus(out.data);
      } else if ('error' in out) {
        setError(out.error);
        setStatus(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!saveLoaded) return;
    void load();
  }, [saveLoaded, load]);

  const handleCheckin = async () => {
    setSubmitting(true);
    setToast(null);
    try {
      const out = await postCheckin();
      if ('data' in out && out.ok) {
        setStatus(out.data);
        if (out.data.rewardGranted > 0) {
          setToast('Ganhou 1 bateria Estelar pela sequência de 7 dias!');
          onRewardGranted?.();
        } else if (out.data.performed) {
          if (out.data.premiumWeeklyCheckin) {
            setToast(
              `Check-in premium registado. Mineração activa por ~${out.data.premiumIntervalDays} dias até ao próximo check-in.`
            );
          } else {
            const earlyPerformed =
              out.data.lastCheckinAtMs != null && out.data.lastCheckinAtMs > Date.now();
            setToast(
              earlyPerformed
                ? 'Check-in antecipado registado — a mineração segue sem pausa até ao próximo ciclo (21:00 Brasília).'
                : 'Check-in registado. A mineração volta a contar a partir deste momento.'
            );
          }
        } else {
          const alreadyEarly =
            out.data.lastCheckinAtMs != null && out.data.lastCheckinAtMs > Date.now();
          setToast(
            alreadyEarly
              ? 'Já tinha feito check-in antecipado para o próximo ciclo.'
              : 'Já tinha feito check-in neste ciclo (desde as 21:00 BRT).'
          );
        }
      } else if ('error' in out) {
        setToast(out.error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!saveLoaded) return null;

  return (
    <div className="shrink-0 border-b border-amber-500/25 bg-slate-950/80 dark:bg-black/40 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs sm:text-sm">
        <div className="flex items-start gap-2 min-w-0">
          {status?.frozen ? (
            <Snowflake className="shrink-0 text-sky-400 mt-0.5" size={18} aria-hidden />
          ) : (
            <CalendarCheck className="shrink-0 text-emerald-400 mt-0.5" size={18} aria-hidden />
          )}
          <div className="min-w-0 space-y-0.5">
            {loading && !status ? (
              <p className="text-slate-400 flex items-center gap-2">
                <Loader2 className="animate-spin" size={14} /> A carregar check-in…
              </p>
            ) : error ? (
              <p className="text-red-300">{error}</p>
            ) : status ? (
              <>
                <p className="font-bold text-slate-100">
                  {status.premiumWeeklyCheckin
                    ? status.frozen
                      ? `Mineração congelada — check-in premium a cada ${status.premiumIntervalDays} dias (passe ≥ ${status.premiumMinUsdc} USDC).`
                      : `Check-in premium activo — mineração até ~${formatResetCountdown(status.nextResetMs)}.`
                    : status.frozen
                      ? 'Mineração congelada — faça o check-in para voltar a farmar (ciclo diário: 21:00→21:00 Brasília).'
                      : `Check-in activo — mineração corre até ~${formatResetCountdown(status.nextResetMs)} (próximo 21:00 Brasília).`}
                </p>
                <p className="text-slate-400">
                  Sequência: <span className="text-amber-300 font-mono">{status.streak}</span> dia(s) ·{' '}
                  {status.premiumWeeklyCheckin ? (
                    <>
                      {status.frozen
                        ? 'Janela premium expirada.'
                        : `Próximo check-in obrigatório em ~${formatResetCountdown(status.nextResetMs)}.`}{' '}
                      {!status.canCheckinNow && status.nextCheckinAllowedMs != null && !status.frozen ? (
                        <>· Novo check-in disponível em ~{formatResetCountdown(status.nextCheckinAllowedMs)}.</>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {status.frozen
                        ? 'Janela actual expirada.'
                        : `Próxima janela em ~${formatResetCountdown(status.nextResetMs)}.`}{' '}
                      {status.canEarlyCheckin ? (
                        <>· Pode fazer check-in antecipado (últimas 4h antes das 21:00 Brasília).</>
                      ) : null}
                    </>
                  )}{' '}
                  · Ciclo prémio:{' '}
                  <span className="text-amber-200/90">
                    {status.rewardCycleProgress}/{status.rewardCycleSize}
                  </span>{' '}
                  <Trophy className="inline align-text-bottom text-amber-500/90" size={14} aria-hidden />{' '}
                  {status.premiumWeeklyCheckin
                    ? 'a cada check-in premium ganha 1 Estelar.'
                    : 'a cada 7 check-ins seguidos ganha 1 Estelar.'}
                </p>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-1 shrink-0">
          {toast && (
            <p className="text-[11px] sm:text-xs text-emerald-300/95 max-w-md text-right">{toast}</p>
          )}
          <button
            type="button"
            onClick={() => void handleCheckin()}
            disabled={submitting || loading || checkinButtonDisabled(status)}
            className="rounded-lg border border-amber-500/50 bg-amber-600/25 px-3 py-1.5 text-xs sm:text-sm font-bold text-amber-100 hover:bg-amber-600/35 disabled:opacity-50 disabled:cursor-not-allowed transition whitespace-nowrap"
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="animate-spin" size={14} /> A registar…
              </span>
            ) : status?.premiumWeeklyCheckin && !status.canCheckinNow && (status.todayCheckedIn || status.frozen) ? (
              status.nextCheckinAllowedMs != null
                ? `Aguardar · ${formatResetCountdown(status.nextCheckinAllowedMs)}`
                : 'Aguardar intervalo premium'
            ) : status?.canEarlyCheckin ? (
              `Check-in antecipado · ${formatResetCountdown(status.nextResetMs)}`
            ) : status?.todayCheckedIn && !status.frozen ? (
              `Check-in activo · ${formatResetCountdown(status.nextResetMs)}`
            ) : (
              'Fazer check-in'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
