import type { Request } from 'express';

type TurnstileVerifyOk = { ok: true };
type TurnstileVerifyErr = { ok: false; status: number; error: string };

function getRemoteIp(req: Request): string | undefined {
  const cf = String(req.headers['cf-connecting-ip'] || '').trim();
  if (cf) return cf;
  const xr = String(req.headers['x-real-ip'] || '').trim();
  if (xr) return xr;
  return undefined;
}

export function getTurnstileSiteKey(): string {
  return String(process.env.CLOUDFLARE_TURNSTILE_SITE_KEY || '').trim();
}

export function isTurnstileEnabled(): boolean {
  return (
    String(process.env.CLOUDFLARE_TURNSTILE_ENABLED || '0').trim() === '1' &&
    getTurnstileSiteKey().length > 0 &&
    String(process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || '').trim().length > 0
  );
}

export async function verifyTurnstileToken(
  req: Request,
  token: unknown
): Promise<TurnstileVerifyOk | TurnstileVerifyErr> {
  if (!isTurnstileEnabled()) return { ok: true };
  const response = typeof token === 'string' ? token.trim() : '';
  if (!response) {
    return { ok: false, status: 400, error: 'Confirme o captcha antes de continuar.' };
  }

  const secret = String(process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || '').trim();
  try {
    const body = new URLSearchParams();
    body.set('secret', secret);
    body.set('response', response);
    const remoteip = getRemoteIp(req);
    if (remoteip) body.set('remoteip', remoteip);

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      'error-codes'?: string[];
    };
    if (!res.ok || data.success !== true) {
      return {
        ok: false,
        status: 400,
        error: 'Falha na validação do captcha. Atualize a página e tente novamente.'
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      status: 502,
      error: 'Não foi possível validar o captcha agora. Tente novamente em instantes.'
    };
  }
}
