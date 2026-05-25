import { Prisma } from '@prisma/client';
import {
  appendUserWalletHistory,
  normalizeWalletCompareKey,
  tryNormalizeWallet,
  type WalletHistoryAction
} from '../modules/profile/profileWalletHistory.service.js';

const DEFAULT_REFERRAL_SENDER_REWARD_USDC = 1;   // quem indicou recebe 1 USDC
const DEFAULT_REFERRAL_RECEIVER_REWARD_USDC = 0; // indicado não recebe USDC (só a caixa inicial)

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

  async function upsertGameStateCredit(args: {
    userId: number;
    usdcIncrement?: number;
    claimedReferralsIncrement?: number;
    markReferralBonusClaimed?: boolean;
  }): Promise<void> {
    const usdcIncrement = Math.max(0, Number(args.usdcIncrement) || 0);
    const claimedReferralsIncrement = Math.max(0, Number(args.claimedReferralsIncrement) || 0);
    if (usdcIncrement <= 0 && claimedReferralsIncrement <= 0 && !args.markReferralBonusClaimed) return;
    await tx.game_states.upsert({
      where: { user_id: args.userId },
      update: {
        ...(usdcIncrement > 0 ? { usdc: { increment: usdcIncrement } } : {}),
        ...(claimedReferralsIncrement > 0 ? { claimed_referrals: { increment: claimedReferralsIncrement } } : {}),
        ...(args.markReferralBonusClaimed ? { referral_bonus_claimed: 1 } : {}),
        last_updated_at: now
      },
      create: {
        user_id: args.userId,
        usdc: usdcIncrement,
        start_time: now,
        last_updated_at: now,
        claimed_referrals: claimedReferralsIncrement,
        referral_bonus_claimed: args.markReferralBonusClaimed ? 1 : 0,
        black_market_balance: 0
      }
    });
  }

  async function adjustExistingGameState(args: {
    userId: number;
    claimedReferralsDecrement?: number;
    clearReferralBonusClaimed?: boolean;
  }): Promise<void> {
    const row = await tx.game_states.findUnique({
      where: { user_id: args.userId },
      select: { usdc: true, claimed_referrals: true, referral_bonus_claimed: true }
    });
    if (!row) return;

    const nextClaimedReferralsDecrement = Math.max(
      0,
      Math.min(Number(row.claimed_referrals || 0), Number(args.claimedReferralsDecrement || 0))
    );

    if (
      nextClaimedReferralsDecrement <= 0 &&
      !args.clearReferralBonusClaimed
    ) {
      return;
    }

    await tx.game_states.update({
      where: { user_id: args.userId },
      data: {
        ...(nextClaimedReferralsDecrement > 0
          ? { claimed_referrals: { decrement: nextClaimedReferralsDecrement } }
          : {}),
        ...(args.clearReferralBonusClaimed ? { referral_bonus_claimed: 0 } : {}),
        last_updated_at: now
      }
    });
  }

  async function resolveReferralModelRewards(accessLevelId: string | null | undefined): Promise<{
    senderUsdc: number;
    receiverUsdc: number;
  }> {
    const alId = accessLevelId || 'normal';
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
    }

    return {
      senderUsdc: model
        ? Number(model.sender_reward_usdc ?? 0)
        : DEFAULT_REFERRAL_SENDER_REWARD_USDC,
      receiverUsdc: model
        ? Number(model.receiver_reward_usdc ?? 0)
        : DEFAULT_REFERRAL_RECEIVER_REWARD_USDC
    };
  }

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

  // Lê o estado actual ANTES do update:
  //   - referred_by: para evitar contar o mesmo referral múltiplas vezes em updates de perfil
  //   - polygon_wallet: para registar histórico de alterações de carteira
  const userBeforeUpdate = await tx.users.findUnique({
    where: { id: uid },
    select: { referred_by: true, polygon_wallet: true, username: true }
  });
  const referredByAlreadyBound = !!userBeforeUpdate?.referred_by;

  if (polygonForUpdate !== undefined && walletAudit) {
    const prevRaw = userBeforeUpdate?.polygon_wallet != null ? String(userBeforeUpdate.polygon_wallet).trim() : '';
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

  const previousReferralCode = String(userBeforeUpdate?.referred_by || '').trim();
  const nextReferralCode = String(referredByForUpdate || '').trim();
  if (
    previousReferralCode &&
    previousReferralCode.toLowerCase() !== nextReferralCode.toLowerCase()
  ) {
    const previousReferrer = await tx.users.findFirst({
      where: {
        referral_code: { equals: previousReferralCode, mode: 'insensitive' }
      },
      select: { id: true, access_level_id: true }
    });

    const referredUsernames = Array.from(
      new Set(
        [String(userBeforeUpdate?.username || '').trim(), String(usernameForUpdate || '').trim()].filter(
          Boolean
        )
      )
    );

    let deletedReferralCount = 0;
    if (previousReferrer && referredUsernames.length > 0) {
      const deleted = await tx.referrals.deleteMany({
        where: {
          user_id: previousReferrer.id,
          referred_username: { in: referredUsernames }
        }
      });
      deletedReferralCount = Number(deleted.count || 0);
    }

    if (deletedReferralCount > 0 && previousReferrer) {
      await adjustExistingGameState({
        userId: previousReferrer.id,
        claimedReferralsDecrement: 1
      });

      const referredState = await tx.game_states.findUnique({
        where: { user_id: uid },
        select: { referral_bonus_claimed: true }
      });
      if (Number(referredState?.referral_bonus_claimed || 0) === 1) {
        await adjustExistingGameState({
          userId: uid,
          clearReferralBonusClaimed: true
        });
      }
    }
  }

  if (!referredByForUpdate) return;

  // Não criar referral se o utilizador já tinha referred_by antes deste update
  // (evita duplicações ao actualizar perfil com o mesmo código já vinculado)
  if (referredByAlreadyBound) return;

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

  await upsertGameStateCredit({
    userId: ref.id,
    claimedReferralsIncrement: 1
  });
  // O pagamento do indicador acontece apenas após verificação do email do indicado.
  // O indicado não recebe USDC por referral; só mantém a caixa inicial / caixa de indicado.
}
