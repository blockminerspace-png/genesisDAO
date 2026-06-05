/**
 * Validação server-side de avisos in-app (popup).
 * Fonte de verdade — nunca confiar no frontend nem no body cru.
 */

import fs from 'node:fs';

const CTRL_AND_C1 = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g;
const ZW_AND_BIDI = /[\u200B-\u200D\uFEFF\u202A-\u202E]/g;
const DANGEROUS_SCHEME = /^(javascript|data|vbscript)\s*:/i;
const DANGEROUS_TAG = /<script/i;

export const TITLE_MAX = 120;
export const MESSAGE_MAX = 4000;
export const LINK_MAX = 2048;
export const PRIORITY_MIN = 0;
export const PRIORITY_MAX = 1000;
export const PENDING_MAX = 20;
export const SCHEDULE_MAX_MS = 2 * 365 * 24 * 60 * 60 * 1000;

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Paths relativos seguros para imagens de avisos (só upload interno em /img/uploads/ ou /img/ad-*). */
export const SAFE_IN_APP_IMAGE_PATH_RE =
  /^\/img\/(?:uploads\/[a-zA-Z0-9._-]+|ad-[0-9]+-[0-9a-zA-Z]+)\.(png|jpe?g|gif)$/i;

export class InAppAnnouncementValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'VALIDATION'
  ) {
    super(message);
    this.name = 'InAppAnnouncementValidationError';
  }
}

function stripPlainText(raw: unknown, maxLen: number): string {
  if (raw == null) return '';
  if (typeof raw !== 'string') throw new InAppAnnouncementValidationError('Campo de texto inválido.');
  let s = raw.replace(ZW_AND_BIDI, '').replace(CTRL_AND_C1, ' ').trim();
  if (DANGEROUS_SCHEME.test(s) || DANGEROUS_TAG.test(s)) {
    throw new InAppAnnouncementValidationError('Conteúdo de texto não permitido.');
  }
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

export function parsePlainTitle(raw: unknown): string {
  const s = stripPlainText(raw, TITLE_MAX);
  if (!s) throw new InAppAnnouncementValidationError('Título é obrigatório.');
  return s;
}

export function parsePlainMessage(raw: unknown): string {
  const s = stripPlainText(raw, MESSAGE_MAX);
  if (!s) throw new InAppAnnouncementValidationError('Mensagem é obrigatória.');
  return s;
}

export function parseOptionalHttpsLink(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') throw new InAppAnnouncementValidationError('Link inválido.');
  const t = raw.trim();
  if (!t) return null;
  if (t.length > LINK_MAX) throw new InAppAnnouncementValidationError('Link demasiado longo.');
  if (DANGEROUS_SCHEME.test(t)) throw new InAppAnnouncementValidationError('Link não permitido.');
  let u: URL;
  try {
    const withProto = /^https:\/\//i.test(t) ? t : null;
    if (!withProto) throw new InAppAnnouncementValidationError('Link deve usar HTTPS.');
    u = new URL(withProto);
  } catch (e) {
    if (e instanceof InAppAnnouncementValidationError) throw e;
    throw new InAppAnnouncementValidationError('Link inválido.');
  }
  if (u.protocol !== 'https:') throw new InAppAnnouncementValidationError('Link deve usar HTTPS.');
  if (u.username || u.password) throw new InAppAnnouncementValidationError('Link não permitido.');
  if (!u.hostname) throw new InAppAnnouncementValidationError('Link inválido.');
  return u.href.slice(0, LINK_MAX);
}

export function parseOptionalSelfImagePath(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string') throw new InAppAnnouncementValidationError('Imagem inválida.');
  const t = raw.trim();
  if (!t) return null;
  if (t.includes('..') || t.includes('//') || /^https?:/i.test(t) || /^data:/i.test(t) || /^\/\//.test(t)) {
    throw new InAppAnnouncementValidationError('URL de imagem não permitida.', 'INVALID_IMAGE_URL');
  }
  const normalized = t.startsWith('/img/') ? t : t.startsWith('img/') ? `/${t}` : null;
  if (!normalized || !SAFE_IN_APP_IMAGE_PATH_RE.test(normalized)) {
    throw new InAppAnnouncementValidationError(
      'Imagem deve ser um ficheiro em /img/ (upload interno).',
      'INVALID_IMAGE_URL'
    );
  }
  return normalized;
}

export function parsePriority(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, Math.trunc(n)));
}

export function parseOptionalScheduleMs(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 9_000_000_000_000) {
    throw new InAppAnnouncementValidationError('Data de agendamento inválida.');
  }
  return Math.trunc(n);
}

export function parseIsActive(raw: unknown, defaultActive = true): boolean {
  if (raw === undefined || raw === null) return defaultActive;
  if (typeof raw === 'boolean') return raw;
  if (raw === 0 || raw === '0' || raw === false) return false;
  if (raw === 1 || raw === '1' || raw === true) return true;
  return defaultActive;
}

export function validateScheduleRange(startsAt: number | null, endsAt: number | null): void {
  if (startsAt != null && endsAt != null && endsAt < startsAt) {
    throw new InAppAnnouncementValidationError('Data de fim deve ser posterior ao início.');
  }
  const now = Date.now();
  if (startsAt != null && endsAt != null && endsAt - startsAt > SCHEDULE_MAX_MS) {
    throw new InAppAnnouncementValidationError('Intervalo de agendamento demasiado longo.');
  }
  if (endsAt != null && endsAt < now - SCHEDULE_MAX_MS) {
    throw new InAppAnnouncementValidationError('Data de fim inválida.');
  }
}

export function parseAnnouncementId(raw: unknown): string {
  const id = String(raw || '').trim();
  if (!id || !UUID_V4_RE.test(id)) {
    throw new InAppAnnouncementValidationError('Identificador de aviso inválido.');
  }
  return id.toLowerCase();
}

export type ValidatedCreateInAppAnnouncement = {
  title: string;
  message: string;
  link: string | null;
  imageUrl: string | null;
  priority: number;
  isActive: boolean;
  startsAt: number | null;
  endsAt: number | null;
};

export type ValidatedUpdateInAppAnnouncement = Partial<ValidatedCreateInAppAnnouncement>;

export function parseCreateInput(body: Record<string, unknown>): ValidatedCreateInAppAnnouncement {
  const title = parsePlainTitle(body.title);
  const message = parsePlainMessage(body.message);
  const link = parseOptionalHttpsLink(body.link);
  const imageUrl = parseOptionalSelfImagePath(body.imageUrl ?? body.image_url);
  const priority = parsePriority(body.priority);
  const isActive = parseIsActive(body.isActive ?? body.is_active, true);
  const startsAt = parseOptionalScheduleMs(body.startsAt ?? body.starts_at);
  const endsAt = parseOptionalScheduleMs(body.endsAt ?? body.ends_at);
  validateScheduleRange(startsAt, endsAt);
  return { title, message, link, imageUrl, priority, isActive, startsAt, endsAt };
}

export function parseUpdateInput(body: Record<string, unknown>): ValidatedUpdateInAppAnnouncement {
  const out: ValidatedUpdateInAppAnnouncement = {};
  if (body.title !== undefined) out.title = parsePlainTitle(body.title);
  if (body.message !== undefined) out.message = parsePlainMessage(body.message);
  if (body.link !== undefined) out.link = parseOptionalHttpsLink(body.link);
  if (body.imageUrl !== undefined || body.image_url !== undefined) {
    out.imageUrl = parseOptionalSelfImagePath(body.imageUrl ?? body.image_url);
  }
  if (body.priority !== undefined) out.priority = parsePriority(body.priority);
  if (body.isActive !== undefined || body.is_active !== undefined) {
    out.isActive = parseIsActive(body.isActive ?? body.is_active, true);
  }
  let startsAt: number | null | undefined;
  let endsAt: number | null | undefined;
  if (body.startsAt !== undefined || body.starts_at !== undefined) {
    startsAt = parseOptionalScheduleMs(body.startsAt ?? body.starts_at);
    out.startsAt = startsAt;
  }
  if (body.endsAt !== undefined || body.ends_at !== undefined) {
    endsAt = parseOptionalScheduleMs(body.endsAt ?? body.ends_at);
    out.endsAt = endsAt;
  }
  if (startsAt !== undefined || endsAt !== undefined) {
    validateScheduleRange(startsAt ?? null, endsAt ?? null);
  }
  return out;
}

/** Magic bytes para PNG / JPEG / GIF após upload em disco. */
export function assertImageFileMagicBytes(filePath: string, ext: string): boolean {
  let head: Buffer;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      head = Buffer.alloc(12);
      fs.readSync(fd, head, 0, 12, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
  const e = ext.toLowerCase();
  if (e === '.png') {
    return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  }
  if (e === '.jpg' || e === '.jpeg') {
    return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  }
  if (e === '.gif') {
    const sig = head.slice(0, 6).toString('ascii');
    return sig === 'GIF87a' || sig === 'GIF89a';
  }
  return false;
}
