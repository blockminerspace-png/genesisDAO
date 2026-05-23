import { Prisma } from '@prisma/client';
import {
  appendUserWalletHistory,
  normalizeWalletCompareKey,
  tryNormalizeWallet,
  type WalletHistoryAction
} from '../modules/profile/profileWalletHistory.service.js';

export type UserPutCoreWalletAudit =
  | { kind: 'admin'; actorUserId: number; clientIp: string | null; userAgent: string | null }
  | { kind: 'registration'; clientIp: string | null; userAgent: string | null };

export type UserPutCoreTxInput = {
  uid: number;
  usernameForUpdate: string;
  normalizedEmail: string;
  /** `null` = não alterar coluna `password`. */
  passwordHash: string | null;
  /** `undefined` = não alterar coluna `polygon_wallet`. */
  polygonForUpdate?: string | null;
  accessLevelIdForUpdate: string | null;
  referredByForUpdate: string | null;
  allowAccessLevelFromBody: boolean;
  accessLevelIdsValidated: string[] | null;
  clientIpReferral: string;
  /** Quando `polygonForUpdate` está definido, regista histórico append-only (admin ou registo). */
  walletAudit?: UserPutCoreWalletAudit;
};

/**
 * Núcleo transacional de `PUT /api/user`: atualização de utilizador, níveis de acesso e recompensas de referral.
 * Deve correr dentro de `prisma.$transaction`.
 */
export async function executeUserPutCoreTransaction(
  tx: Prisma.TransactionClient,
  input: UserPutCoreTxInput
): Promise<void> {
  const {
    uid,
    usernameForUpdate,
    normalizedEmail,
    passwordHash,
    polygonForUpdate,
    accessLevelIdForUpdate,
    referredByForUpdate,
    allowAccessLevelFromBody,
    accessLevelIdsValidated,
    walletAudit
  } = input;

  const now = BigInt(Date.now());

  let walletChange:
    | {
        prevDisp: string | null;
        nextDisp: string | null;
        action: WalletHistoryAction;
        walletAddress: string | null;
        actorType: 'admin' | 'user';
        actorUserId: number | null;
        source: string;
      }
    | null = null;

  if (polygonForUpdate !== undefined && walletAudit) {
    const cur = await tx.users.findUnique({
      where: { id: uid },
      select: { polygon_wallet: true }
    });
    const prevRaw = cur?.polygon_wallet != null ? String(cur.polygon_wallet).trim() : '';
    const nextRaw =
      polygonForUpdate == null || polygonForUpdate === '' ? '' : String(polygonForUpdate).trim();
    const prevKey = normalizeWalletCompareKey(prevRaw || null);
    const nextKey = normalizeWalletCompareKey(nextRaw || null);
    if (prevKey !== nextKey) {
      const prevDisp = tryNormalizeWallet(prevRaw || null);
      const nextDisp = tryNormalizeWallet(nextRaw || null);
      if (walletAudit.kind === 'admin') {
        walletChange = {
          prevDisp,
          nextDisp,
          action: 'admin_changed',
          walletAddress: nextDisp ?? prevDisp,
          actorType: 'admin',
          actorUserId: walletAudit.actorUserId,
          source: 'admin_panel'
        };
      } else {
        let action: WalletHistoryAction = 'changed';
        if (!prevDisp && nextDisp) action = 'connected';
        else if (prevDisp && !nextDisp) action = 'removed';
        walletChange = {
          prevDisp,
          nextDisp,
          action,
          walletAddress:
            action === 'removed' ? prevDisp : nextDisp ?? prevDisp,
          actorType: 'user',
          actorUserId: null,
          source: 'registration'
        };
      }
    }
  }

  const userUpdateBase: Prisma.usersUpdateInput = {
    username: usernameForUpdate,
    email: normalizedEmail,
    access_level_id: accessLevelIdForUpdate,
    referred_by: referredByForUpdate
  };
  if (polygonForUpdate !== undefined) {
    userUpdateBase.polygon_wallet =
      polygonForUpdate == null || polygonForUpdate === '' ? null : String(polygonForUpdate);
  }

  if (passwordHash != null) {
    await tx.users.update({
      where: { id: uid },
      data: { ...userUpdateBase, password: passwordHash }
    });
  } else {
    await tx.users.update({
      where: { id: uid },
      data: userUpdateBase
    });
  }

  if (walletChange && walletAudit) {
    await appendUserWalletHistory(tx, {
      userId: uid,
      action: walletChange.action,
      network: 'polygon',
      walletAddress: walletChange.walletAddress,
      previousWalletAddress: walletChange.prevDisp,
      newWalletAddress: walletChange.nextDisp,
      ipAddress: walletAudit.clientIp,
      userAgent: walletAudit.userAgent,
      actorType: walletChange.actorType,
      actorUserId: walletChange.actorUserId,
      source: walletChange.source,
      notes: null
    });
  }

  if (allowAccessLevelFromBody && accessLevelIdForUpdate) {
    await tx.user_access_levels.createMany({
      data: [{ user_id: uid, access_level_id: accessLevelIdForUpdate, granted_at: now }],
      skipDuplicates: true
    });
  }

  if (allowAccessLevelFromBody && accessLevelIdsValidated) {
    await tx.user_access_levels.deleteMany({ where: { user_id: uid } });
    if (accessLevelIdsValidated.length > 0) {
      await tx.user_access_levels.createMany({
        data: accessLevelIdsValidated.map((alid) => ({
          user_id: uid,
          access_level_id: alid,
          granted_at: now
        })),
        skipDuplicates: true
      });
    }
    if (accessLevelIdForUpdate) {
      await tx.user_access_levels.createMany({
        data: [{ user_id: uid, access_level_id: accessLevelIdForUpdate, granted_at: now }],
        skipDuplicates: true
      });
    }
  }

  if (!referredByForUpdate) return;

  const ref = await tx.users.findFirst({
    where: {
      referral_code: { equals: referredByForUpdate, mode: 'insensitive' }
    },
    select: { id: true, access_level_id: true, referral_code: true }
  });

  const referredUsername = usernameForUpdate;
  if (!ref || !referredUsername) return;

  if (ref.id === uid) {
    throw new Error('Você não pode usar seu próprio código de indicação.');
  }

  const newUserRow = await tx.users.findUnique({
    where: { id: uid },
    select: { referral_code: true }
  });
  const ownCode = newUserRow?.referral_code?.trim();
  if (
    ownCode &&
    ownCode.toLowerCase() === String(referredByForUpdate).trim().toLowerCase()
  ) {
    throw new Error('Você não pode usar seu próprio código de indicação.');
  }

  let insertedReferral = false;
  try {
    await tx.referrals.create({
      data: { user_id: ref.id, referred_username: referredUsername }
    });
    insertedReferral = true;
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      insertedReferral = false;
    } else {
      throw e;
    }
  }

  if (!insertedReferral) return;

  const alId = ref.access_level_id || 'normal';
  const link = await tx.access_level_referral_models.findUnique({
    where: { access_level_id: alId }
  });
  const model =
    link?.referral_model_id != null
      ? await tx.referral_models.findFirst({
          where: { id: link.referral_model_id, is_active: 1 }
        })
      : null;

  if (model) {
    console.log(`[Referral] Using Advanced Model: ${model.name} for Access Level: ${alId}`);

    const senderUsdc = model.sender_reward_usdc ?? 0;
    if (senderUsdc > 0) {
      await tx.game_states.update({
        where: { user_id: ref.id },
        data: { usdc: { increment: senderUsdc } }
      });
    }

    const receiverUsdc = model.receiver_reward_usdc ?? 0;
    if (receiverUsdc > 0) {
      await tx.game_states.update({
        where: { user_id: uid },
        data: { usdc: { increment: receiverUsdc } }
      });
    }
  }
  // Comissão sobre depósitos do indicado: ver `creditDepositReferralCommissionPg` no crédito on-chain.
}
