import { isUsablePublicClientIp, normalizeClientIp } from './clientIp.js';

type SignupIpGuardOk = { ok: true };
type SignupIpGuardErr = {
  ok: false;
  status: number;
  error: string;
  code: 'SIGNUP_PROXY_VPN_BLOCKED' | 'SIGNUP_IP_INTEL_UNAVAILABLE';
  details?: Record<string, unknown>;
};

function envEnabled(name: string, fallback = '0'): boolean {
  return String(process.env[name] || fallback).trim() === '1';
}

function parseBoolish(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const s = String(value || '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

function parseNumeric(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isSignupProxyVpnGuardEnabled(): boolean {
  return (
    envEnabled('SIGNUP_ANTI_PROXY_VPN_ENABLED') &&
    String(process.env.PROXYCHECK_API_KEY || '').trim().length > 0
  );
}

export async function verifySignupIpNotProxyVpn(clientIpRaw: string): Promise<SignupIpGuardOk | SignupIpGuardErr> {
  if (!isSignupProxyVpnGuardEnabled()) return { ok: true };

  const clientIp = normalizeClientIp(clientIpRaw);
  if (!clientIp || !isUsablePublicClientIp(clientIp)) return { ok: true };

  const apiKey = String(process.env.PROXYCHECK_API_KEY || '').trim();
  const allowOnError = envEnabled('SIGNUP_ANTI_PROXY_VPN_ALLOW_ON_ERROR', '1');

  try {
    const qs = new URLSearchParams({
      key: apiKey,
      vpn: '3',
      asn: '1',
      risk: '1'
    });
    const res = await fetch(`https://proxycheck.io/v2/${encodeURIComponent(clientIp)}?${qs.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const row = (data?.[clientIp] && typeof data[clientIp] === 'object' ? data[clientIp] : {}) as Record<
      string,
      unknown
    >;
    const detections =
      row.detections && typeof row.detections === 'object' ? (row.detections as Record<string, unknown>) : {};

    const proxy = parseBoolish(row.proxy) || parseBoolish(detections.proxy);
    const vpn = parseBoolish(row.vpn) || parseBoolish(detections.vpn) || String(row.type || '').toLowerCase() === 'vpn';
    const tor = parseBoolish(row.tor) || parseBoolish(detections.tor) || String(row.type || '').toLowerCase() === 'tor';
    const hosting =
      parseBoolish(row.hosting) ||
      parseBoolish(detections.hosting) ||
      String(row.type || '').toLowerCase() === 'hosting';
    const risk = parseNumeric(row.risk) ?? parseNumeric(detections.risk) ?? 0;

    if (proxy || vpn || tor || hosting) {
      return {
        ok: false,
        status: 403,
        code: 'SIGNUP_PROXY_VPN_BLOCKED',
        error: 'Cadastro bloqueado: desative VPN, proxy ou rede anônima e tente novamente.',
        details: {
          clientIp,
          proxy,
          vpn,
          tor,
          hosting,
          risk,
          type: row.type ?? null,
          provider: row.provider ?? null
        }
      };
    }

    return { ok: true };
  } catch {
    if (allowOnError) return { ok: true };
    return {
      ok: false,
      status: 503,
      code: 'SIGNUP_IP_INTEL_UNAVAILABLE',
      error: 'Não foi possível validar a rede do cadastro agora. Tente novamente em instantes.'
    };
  }
}
