import crypto from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import {
  PENDING_MAX,
  parseAnnouncementId,
  parseOptionalHttpsLink,
  parseOptionalSelfImagePath,
  validateScheduleRange,
  type ValidatedCreateInAppAnnouncement,
  type ValidatedUpdateInAppAnnouncement
} from '../../validation/inAppAnnouncementValidation.js';
import type {
  InAppAnnouncementAdminDto,
  InAppAnnouncementDto
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
  image_url: string | null;
  priority: number;
  created_at: bigint;
}): InAppAnnouncementDto {
  let link: string | null = null;
  let imageUrl: string | null = null;
  try {
    link = parseOptionalHttpsLink(row.link);
  } catch {
    link = null;
  }
  try {
    imageUrl = parseOptionalSelfImagePath(row.image_url);
  } catch {
    imageUrl = null;
  }
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    link,
    imageUrl,
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
    image_url: string | null;
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
  const at = BigInt(nowMs());

  const rows = await prisma.in_app_announcements.findMany({
    where: {
      is_active: 1,
      reads: { none: { user_id: userId } },
      AND: [
        { OR: [{ starts_at: null }, { starts_at: { lte: at } }] },
        { OR: [{ ends_at: null }, { ends_at: { gte: at } }] }
      ]
    },
    orderBy: [{ priority: 'desc' }, { created_at: 'desc' }],
    take: PENDING_MAX
  });

  return rows.filter((r) => isWithinSchedule(r.starts_at, r.ends_at, Number(at))).map(toPlayerDto);
}

export async function dismissAnnouncementForUser(
  userId: number,
  announcementIdRaw: string
): Promise<'ok' | 'not_found' | 'invalid_id'> {
  let id: string;
  try {
    id = parseAnnouncementId(announcementIdRaw);
  } catch {
    return 'invalid_id';
  }

  const exists = await prisma.in_app_announcements.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return 'not_found';

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

  return 'ok';
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
  input: ValidatedCreateInAppAnnouncement,
  createdBy: number | null
): Promise<InAppAnnouncementAdminDto> {
  const row = await prisma.in_app_announcements.create({
    data: {
      id: crypto.randomUUID(),
      title: input.title,
      message: input.message,
      link: input.link,
      image_url: input.imageUrl,
      is_active: input.isActive ? 1 : 0,
      priority: input.priority,
      starts_at: input.startsAt != null ? BigInt(input.startsAt) : null,
      ends_at: input.endsAt != null ? BigInt(input.endsAt) : null,
      created_at: BigInt(nowMs()),
      created_by: createdBy
    }
  });

  return toAdminDto(row, 0);
}

export async function updateAnnouncementAdmin(
  idRaw: string,
  input: ValidatedUpdateInAppAnnouncement
): Promise<InAppAnnouncementAdminDto | null> {
  let announcementId: string;
  try {
    announcementId = parseAnnouncementId(idRaw);
  } catch {
    return null;
  }

  const existing = await prisma.in_app_announcements.findUnique({ where: { id: announcementId } });
  if (!existing) return null;

  const mergedStarts =
    input.startsAt !== undefined ? input.startsAt : existing.starts_at != null ? Number(existing.starts_at) : null;
  const mergedEnds =
    input.endsAt !== undefined ? input.endsAt : existing.ends_at != null ? Number(existing.ends_at) : null;
  if (input.startsAt !== undefined || input.endsAt !== undefined) {
    validateScheduleRange(mergedStarts, mergedEnds);
  }

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.message !== undefined) data.message = input.message;
  if (input.link !== undefined) data.link = input.link;
  if (input.imageUrl !== undefined) data.image_url = input.imageUrl;
  if (input.priority !== undefined) data.priority = input.priority;
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

export async function deleteAnnouncementAdmin(idRaw: string): Promise<boolean> {
  let announcementId: string;
  try {
    announcementId = parseAnnouncementId(idRaw);
  } catch {
    return false;
  }
  try {
    await prisma.in_app_announcements.delete({ where: { id: announcementId } });
    return true;
  } catch {
    return false;
  }
}
