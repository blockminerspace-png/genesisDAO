import {
  getPartnerAccessLevelIdsLower,
  getPartnerYoutubeCreatorProfile,
  getPartnerLastApprovedVideoAt,
  countPartnerApprovedVideosSince,
  isPartnerYoutubeManualAllowlisted,
  updatePartnerYoutubeCreatorProfileEditable,
  userHasNftRoomAccess
} from '../../models/partnerYoutubeModel.js';
import {
  sanitizePartnerChannelName,
  sanitizePartnerCreatorAvatarUrl,
  userAccessSetHasPartnerLevel
} from '../../utils/partnerYoutubeHelpers.js';
import { NFT_AUTO_ROOM_ID } from '../../lib/nftRoomMining.js';

export class PartnerYoutubeProfileError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'PartnerYoutubeProfileError';
  }
}

export async function assertUserIsPartner(userId: number): Promise<void> {
  const idSet = await getPartnerAccessLevelIdsLower(userId);
  const manualListed = await isPartnerYoutubeManualAllowlisted(userId);
  if (!userAccessSetHasPartnerLevel(idSet) && !manualListed) {
    throw new PartnerYoutubeProfileError('Apenas parceiros YouTube podem editar o perfil.', 403, 'NOT_PARTNER');
  }
}

export async function runPartnerYoutubeProfileUpdate(params: {
  userId: number;
  channelNameRaw: unknown;
  avatarUrlRaw: unknown;
}): Promise<{ channelName: string; avatarUrl: string; channelUrl: string }> {
  await assertUserIsPartner(params.userId);

  const existing = await getPartnerYoutubeCreatorProfile(params.userId);
  if (!existing) {
    throw new PartnerYoutubeProfileError('Perfil de parceiro não encontrado.', 404, 'NOT_FOUND');
  }

  const channelName = sanitizePartnerChannelName(params.channelNameRaw);
  if (channelName.length < 2) {
    throw new PartnerYoutubeProfileError('Nome do canal inválido (mín. 2 caracteres).', 400, 'VALIDATION');
  }

  const avatarUrl = sanitizePartnerCreatorAvatarUrl(String(params.avatarUrlRaw ?? ''));
  if (!avatarUrl) {
    throw new PartnerYoutubeProfileError('Capa/foto inválida.', 400, 'AVATAR_REQUIRED');
  }

  await updatePartnerYoutubeCreatorProfileEditable({
    userId: params.userId,
    channelName,
    avatarUrl,
    updatedAt: Date.now()
  });

  return {
    channelName,
    avatarUrl,
    channelUrl: existing.channel_url
  };
}

export async function buildPartnerNftRoomStatus(userId: number): Promise<{
  active: boolean;
  compliant: boolean;
  overdue: boolean;
  requiredIntervalDays: number;
  lastApprovedAt: number | null;
  nextDeadlineAt: number | null;
  approvedLast60d: number;
}> {
  const REQUIRED_DAYS = 60;
  const windowMs = REQUIRED_DAYS * 24 * 60 * 60 * 1000;
  const active = await userHasNftRoomAccess(userId, NFT_AUTO_ROOM_ID);
  const lastApprovedAt = await getPartnerLastApprovedVideoAt(userId);
  const since60 = Date.now() - windowMs;
  const approvedLast60d = await countPartnerApprovedVideosSince(userId, since60);
  const lastMs = lastApprovedAt ?? 0;
  const nextDeadlineAt = lastMs > 0 ? lastMs + windowMs : null;
  const overdue = active && approvedLast60d === 0;
  const compliant = !active || !overdue;

  return {
    active,
    compliant,
    overdue,
    requiredIntervalDays: REQUIRED_DAYS,
    lastApprovedAt,
    nextDeadlineAt,
    approvedLast60d
  };
}
