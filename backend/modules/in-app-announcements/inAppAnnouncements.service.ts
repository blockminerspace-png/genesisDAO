import crypto from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import type {
  CreateInAppAnnouncementInput,
  InAppAnnouncementAdminDto,
  InAppAnnouncementDto,
  UpdateInAppAnnouncementInput
} from './inAppAnnouncements.types.js';

function nowMs(): number {
  return Date.now();
}

function isWithinSchedule(startsAt: bigint | null, endsAt: bigint | null, at: number): boolean {
  const start = startsAt != null ? Number(startsAt) : null;
  const end = endsAt != null ? Number(endsAt) : null;
  if (start != null && at < start) return false;
  if (end != null && at > end) return false;
  return true;
}

function toPlayerDto(row: {
  id: string;
  title: string;
  message: string;
  link: string | null;
  priority: number;
  created_at: bigint;
}): InAppAnnouncementDto {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    link: row.link && String(row.link).trim() ? String(row.link).trim() : null,
    priority: Number(row.priority) || 0,
    createdAt: Number(row.created_at) || nowMs()
  };
}

function toAdminDto(
  row: {
    id: string;
    title: string;
    message: string;
    link: string | null;
    is_active: number;
    priority: number;
    starts_at: bigint | null;
    ends_at: bigint | null;
    created_at: bigint;
    created_by: number | null;
  },
  readCount: number
): InAppAnnouncementAdminDto {
  return {
    ...toPlayerDto(row),
    isActive: Number(row.is_active) === 1,
    startsAt: row.starts_at != null ? Number(row.starts_at) : null,
    endsAt: row.ends_at != null ? Number(row.ends_at) : null,
    createdBy: row.created_by ?? null,
    readCount
  };
}

export async function listPendingAnnouncementsForUser(userId: number): Promise<InAppAnnouncementDto[]> {
  const at = nowMs();
  const readRows = await prisma.in_app_announcement_reads.findMany({
    where: { user_id: userId },
    select: { announcement_id: true }
  });
  const readIds = new Set(readRows.map((r) => r.announcement_id));

  const rows = await prisma.in_app_announcements.findMany({
    where: { is_active: 1 },
    orderBy: [{ priority: 'desc' }, { created_at: 'desc' }]
  });

  const pending = rows
    .filter((r) => !readIds.has(r.id) && isWithinSchedule(r.starts_at, r.ends_at, at))
    .map(toPlayerDto);

  return pending;
}

export async function dismissAnnouncementForUser(userId: number, announcementId: string): Promise<boolean> {
  const id = String(announcementId || '').trim();
  if (!id) return false;

  const exists = await prisma.in_app_announcements.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return false;

  await prisma.in_app_announcement_reads.upsert({
    where: {
      user_id_announcement_id: { user_id: userId, announcement_id: id }
    },
    create: {
      user_id: userId,
      announcement_id: id,
      read_at: BigInt(nowMs())
    },
    update: {
      read_at: BigInt(nowMs())
    }
  });

  return true;
}

export async function listAnnouncementsAdmin(): Promise<InAppAnnouncementAdminDto[]> {
  const rows = await prisma.in_app_announcements.findMany({
    orderBy: [{ priority: 'desc' }, { created_at: 'desc' }]
  });

  const counts = await prisma.in_app_announcement_reads.groupBy({
    by: ['announcement_id'],
    _count: { announcement_id: true }
  });
  const countById = new Map(counts.map((c) => [c.announcement_id, c._count.announcement_id]));

  return rows.map((r) => toAdminDto(r, countById.get(r.id) ?? 0));
}

export async function createAnnouncementAdmin(
  input: CreateInAppAnnouncementInput
): Promise<InAppAnnouncementAdminDto> {
  const title = String(input.title || '').trim();
  const message = String(input.message || '').trim();
  if (!title || !message) {
    throw new Error('TITLE_MESSAGE_REQUIRED');
  }

  const row = await prisma.in_app_announcements.create({
    data: {
      id: crypto.randomUUID(),
      title,
      message,
      link: input.link && String(input.link).trim() ? String(input.link).trim() : null,
      is_active: input.isActive === false ? 0 : 1,
      priority: Number(input.priority) || 0,
      starts_at: input.startsAt != null ? BigInt(input.startsAt) : null,
      ends_at: input.endsAt != null ? BigInt(input.endsAt) : null,
      created_at: BigInt(nowMs()),
      created_by: input.createdBy ?? null
    }
  });

  return toAdminDto(row, 0);
}

export async function updateAnnouncementAdmin(
  id: string,
  input: UpdateInAppAnnouncementInput
): Promise<InAppAnnouncementAdminDto | null> {
  const announcementId = String(id || '').trim();
  if (!announcementId) return null;

  const existing = await prisma.in_app_announcements.findUnique({ where: { id: announcementId } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const t = String(input.title).trim();
    if (!t) throw new Error('TITLE_MESSAGE_REQUIRED');
    data.title = t;
  }
  if (input.message !== undefined) {
    const m = String(input.message).trim();
    if (!m) throw new Error('TITLE_MESSAGE_REQUIRED');
    data.message = m;
  }
  if (input.link !== undefined) {
    data.link = input.link && String(input.link).trim() ? String(input.link).trim() : null;
  }
  if (input.priority !== undefined) data.priority = Number(input.priority) || 0;
  if (input.isActive !== undefined) data.is_active = input.isActive ? 1 : 0;
  if (input.startsAt !== undefined) data.starts_at = input.startsAt != null ? BigInt(input.startsAt) : null;
  if (input.endsAt !== undefined) data.ends_at = input.endsAt != null ? BigInt(input.endsAt) : null;

  const row = await prisma.in_app_announcements.update({
    where: { id: announcementId },
    data
  });

  const readCount = await prisma.in_app_announcement_reads.count({
    where: { announcement_id: announcementId }
  });

  return toAdminDto(row, readCount);
}

export async function deleteAnnouncementAdmin(id: string): Promise<boolean> {
  const announcementId = String(id || '').trim();
  if (!announcementId) return false;
  try {
    await prisma.in_app_announcements.delete({ where: { id: announcementId } });
    return true;
  } catch {
    return false;
  }
}
