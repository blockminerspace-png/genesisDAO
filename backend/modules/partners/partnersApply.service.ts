import {
  getPartnerYoutubeApplicationById,
  updatePartnerYoutubeApplicationApprove,
  updatePartnerYoutubeApplicationReject,
  upsertPartnerYoutubeCreatorProfile,
  addPartnerYoutubeManualAllowlist,
  grantPartnerNftRoomAccess,
  ensurePartnerAccessLevel
} from '../../models/partnerYoutubeModel.js';
import {
  sanitizePartnerChannelDescription,
  sanitizePartnerChannelName,
  sanitizePartnerCreatorAvatarUrl,
  sanitizePartnerCreatorChannelUrl,
  userAccessSetHasPartnerLevel
} from '../../utils/partnerYoutubeHelpers.js';
import { NFT_AUTO_ROOM_ID } from '../../lib/nftRoomMining.js';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  getPartnerAccessLevelIdsLower,
  getPartnerYoutubePendingApplicationForUser,
  insertPartnerYoutubeApplication,
  isPartnerYoutubeManualAllowlisted
} from '../../models/partnerYoutubeModel.js';

export class PartnerYoutubeApplyError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'PartnerYoutubeApplyError';
  }
}

export async function assertUserCanApplyForPartner(userId: number): Promise<void> {
  const idSet = await getPartnerAccessLevelIdsLower(userId);
  const manualListed = await isPartnerYoutubeManualAllowlisted(userId);
  if (userAccessSetHasPartnerLevel(idSet) || manualListed) {
    throw new PartnerYoutubeApplyError('Já és parceiro YouTube.', 409, 'ALREADY_PARTNER');
  }
  const pending = await getPartnerYoutubePendingApplicationForUser(userId);
  if (pending) {
    throw new PartnerYoutubeApplyError('Já tens uma candidatura pendente.', 409, 'PENDING_APPLICATION');
  }
}

export async function runPartnerYoutubeApplicationSubmit(params: {
  userId: number;
  channelNameRaw: unknown;
  channelUrlRaw: unknown;
  avatarUrlRaw: unknown;
  descriptionRaw: unknown;
}): Promise<{ id: string }> {
  await assertUserCanApplyForPartner(params.userId);

  const channelName = sanitizePartnerChannelName(params.channelNameRaw);
  if (channelName.length < 2) {
    throw new PartnerYoutubeApplyError('Nome do canal inválido (mín. 2 caracteres).', 400, 'VALIDATION');
  }

  const channelUrl = sanitizePartnerCreatorChannelUrl(String(params.channelUrlRaw ?? ''));
  if (!channelUrl) {
    throw new PartnerYoutubeApplyError(
      'URL do canal inválida. Usa um link https:// do YouTube (ex.: /@teucanal ou /channel/...).',
      422,
      'INVALID_CHANNEL_URL'
    );
  }

  const avatarUrl = sanitizePartnerCreatorAvatarUrl(String(params.avatarUrlRaw ?? ''));
  if (!avatarUrl) {
    throw new PartnerYoutubeApplyError('Envia uma foto/capa do canal (PNG, JPG ou WEBP).', 400, 'AVATAR_REQUIRED');
  }

  const description = sanitizePartnerChannelDescription(params.descriptionRaw);
  const id = crypto.randomUUID();
  const now = Date.now();

  try {
    await insertPartnerYoutubeApplication({
      id,
      userId: params.userId,
      channelName,
      channelUrl,
      avatarUrl,
      description,
      createdAt: now
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new PartnerYoutubeApplyError('Já existe candidatura pendente.', 409, 'PENDING_APPLICATION');
    }
    throw e;
  }

  return { id };
}

export async function runPartnerYoutubeApplicationApprove(params: {
  applicationId: string;
  adminUserId: number;
}): Promise<{ userId: number }> {
  const id = String(params.applicationId || '').trim();
  if (!id) throw new PartnerYoutubeApplyError('ID inválido.', 400, 'VALIDATION');

  const app = await getPartnerYoutubeApplicationById(id);
  if (!app || app.status !== 'pending') {
    throw new PartnerYoutubeApplyError('Candidatura não encontrada ou já processada.', 404, 'NOT_FOUND');
  }

  const n = await updatePartnerYoutubeApplicationApprove(id, params.adminUserId, Date.now());
  if (!n) {
    throw new PartnerYoutubeApplyError('Candidatura não encontrada ou já processada.', 404, 'NOT_FOUND');
  }

  const userId = app.user_id;
  const now = Date.now();

  await addPartnerYoutubeManualAllowlist(userId, params.adminUserId, now);
  await ensurePartnerAccessLevel(userId);
  await upsertPartnerYoutubeCreatorProfile({
    userId,
    channelName: app.channel_name,
    channelUrl: app.channel_url,
    avatarUrl: app.avatar_url,
    description: app.description,
    updatedAt: now,
    updatedBy: params.adminUserId
  });
  await grantPartnerNftRoomAccess(userId, NFT_AUTO_ROOM_ID);

  return { userId };
}

export async function runPartnerYoutubeApplicationReject(params: {
  applicationId: string;
  adminUserId: number;
  reasonRaw: unknown;
}): Promise<void> {
  const id = String(params.applicationId || '').trim();
  if (!id) throw new PartnerYoutubeApplyError('ID inválido.', 400, 'VALIDATION');
  const reason =
    typeof params.reasonRaw === 'string' ? params.reasonRaw.trim().slice(0, 500) : '';
  const n = await updatePartnerYoutubeApplicationReject(id, params.adminUserId, reason || null, Date.now());
  if (!n) {
    throw new PartnerYoutubeApplyError('Candidatura não encontrada ou já processada.', 404, 'NOT_FOUND');
  }
}
