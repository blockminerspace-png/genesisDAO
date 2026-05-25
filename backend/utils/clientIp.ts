/**
 * Resolução do IP do cliente atrás de proxy / Cloudflare.
 * IPs privados, loopback ou "unknown" não entram no limite de 3 contas por IP.
 */

export type IpRequestLike = {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null };
};

/** Normaliza (trim, primeiro hop de XFF, IPv4 mapeado em IPv6). */
export function normalizeClientIp(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (s.includes(',')) s = s.split(',')[0].trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  return s || null;
}

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1, 5).map((p) => Number(p)) as [number, number, number, number];
  if (parts.some((p) => !Number.isFinite(p) || p > 255)) return null;
  return parts;
}

/** IP público utilizável para limite de registo (evita CGNAT interno / proxy mal configurado). */
export function isUsablePublicClientIp(ip: string): boolean {
  const n = normalizeClientIp(ip);
  if (!n || n === 'unknown') return false;
  if (n === '::1' || n === '127.0.0.1') return false;

  const v4 = parseIpv4Octets(n);
  if (v4) {
    const [a, b] = v4;
    if (a === 10) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 0) return false;
    return true;
  }

  const lower = n.toLowerCase();
  if (lower === '::1') return false;
  if (lower.startsWith('fe80:')) return false;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return false;
  return true;
}

/** IP a gravar em `registration_ip` / anti-abuso (null se não for público). */
export function resolveRegistrationIp(raw: string | null | undefined): string | null {
  const n = normalizeClientIp(raw);
  if (!n || !isUsablePublicClientIp(n)) return null;
  return n;
}

function headerFirst(req: IpRequestLike, name: string): string | null {
  const v = req.headers[name];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v.length > 0) return String(v[0]);
  return null;
}

/**
 * IP do cliente para rate-limit, registo e referral.
 * Prioriza cabeçalhos Cloudflare APENAS quando `TRUST_CF_CONNECTING_IP=1` (env var explícita).
 * Nunca infere confiança pelo header `cf-ray` — esse header é totalmente controlável pelo cliente
 * e seria um vetor trivial de bypass de todos os rate-limiters baseados em IP.
 * Se `req.ip` for privado (proxy mal configurado), tenta o primeiro IP público em XFF / X-Real-IP.
 */
export function getClientIpFromRequest(req: IpRequestLike): string {
  const behindCloudflare = String(process.env.TRUST_CF_CONNECTING_IP || '').trim() === '1';

  const candidates: string[] = [];
  const push = (raw: string | null | undefined) => {
    const n = normalizeClientIp(raw);
    if (n) candidates.push(n);
  };

  if (behindCloudflare) {
    push(headerFirst(req, 'cf-connecting-ip'));
    push(headerFirst(req, 'true-client-ip'));
  }

  push(req.ip);

  const xff = headerFirst(req, 'x-forwarded-for');
  if (xff) {
    for (const part of xff.split(',')) push(part);
  }

  push(headerFirst(req, 'x-real-ip'));
  push(req.socket?.remoteAddress ?? null);

  for (const c of candidates) {
    if (isUsablePublicClientIp(c)) return c;
  }

  return candidates[0] || 'unknown';
}
