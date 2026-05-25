import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Prisma } from '@prisma/client';
import { executeUserPutCoreTransaction, type UserPutCoreTxInput } from '../models/userPutCoreTransaction.js';

function baseInput(over: Partial<UserPutCoreTxInput> = {}): UserPutCoreTxInput {
  return {
    uid: 42,
    usernameForUpdate: 'alice',
    normalizedEmail: 'alice@example.com',
    passwordHash: null,
    accessLevelIdForUpdate: null,
    referredByForUpdate: null,
    allowAccessLevelFromBody: false,
    accessLevelIdsValidated: null,
    clientIpReferral: '127.0.0.1',
    ...over
  };
}

function makeTx() {
  const usersUpdate = vi.fn().mockResolvedValue(undefined);
  const usersFindFirst = vi.fn().mockResolvedValue(null);
  const usersFindUnique = vi.fn().mockResolvedValue(null);
  const referralsCreate = vi.fn().mockResolvedValue(undefined);
  const referralsDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const gameStatesUpsert = vi.fn().mockResolvedValue(undefined);
  const gameStatesFindUnique = vi.fn().mockResolvedValue(null);
  const gameStatesUpdate = vi.fn().mockResolvedValue(undefined);
  const accessLevelReferralModelsFindUnique = vi.fn().mockResolvedValue(null);
  const referralModelsFindFirst = vi.fn().mockResolvedValue(null);
  const tx = {
    users: { update: usersUpdate, findFirst: usersFindFirst, findUnique: usersFindUnique },
    referrals: { create: referralsCreate, deleteMany: referralsDeleteMany },
    game_states: { upsert: gameStatesUpsert, findUnique: gameStatesFindUnique, update: gameStatesUpdate },
    access_level_referral_models: { findUnique: accessLevelReferralModelsFindUnique },
    referral_models: { findFirst: referralModelsFindFirst }
  } as unknown as Prisma.TransactionClient;
  return {
    tx,
    usersUpdate,
    usersFindFirst,
    usersFindUnique,
    referralsCreate,
    referralsDeleteMany,
    gameStatesUpsert,
    gameStatesFindUnique,
    gameStatesUpdate,
    accessLevelReferralModelsFindUnique,
    referralModelsFindFirst
  };
}

describe('executeUserPutCoreTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('não inclui polygon_wallet no update quando polygonForUpdate é undefined', async () => {
    const { tx, usersUpdate } = makeTx();
    await executeUserPutCoreTransaction(tx, baseInput({ polygonForUpdate: undefined }));
    expect(usersUpdate).toHaveBeenCalledTimes(1);
    const arg = usersUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data).not.toHaveProperty('polygon_wallet');
    expect(arg.data.username).toBe('alice');
    expect(arg.data.email).toBe('alice@example.com');
  });

  it('define polygon_wallet quando polygonForUpdate é endereço válido', async () => {
    const { tx, usersUpdate } = makeTx();
    const addr = '0xabcdef0123456789abcdef0123456789abcdef01';
    await executeUserPutCoreTransaction(tx, baseInput({ polygonForUpdate: addr }));
    const arg = usersUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.polygon_wallet).toBe(addr);
  });

  it('grava polygon_wallet null quando polygonForUpdate é null', async () => {
    const { tx, usersUpdate } = makeTx();
    await executeUserPutCoreTransaction(tx, baseInput({ polygonForUpdate: null }));
    const arg = usersUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.polygon_wallet).toBeNull();
  });

  it('grava polygon_wallet null quando polygonForUpdate é string vazia', async () => {
    const { tx, usersUpdate } = makeTx();
    await executeUserPutCoreTransaction(tx, baseInput({ polygonForUpdate: '' }));
    const arg = usersUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.polygon_wallet).toBeNull();
  });

  it('com passwordHash inclui password e respeita polygon omitido', async () => {
    const { tx, usersUpdate } = makeTx();
    await executeUserPutCoreTransaction(
      tx,
      baseInput({ passwordHash: 'hashed', polygonForUpdate: undefined })
    );
    const arg = usersUpdate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.password).toBe('hashed');
    expect(arg.data).not.toHaveProperty('polygon_wallet');
  });

  it('incrementa referrals do indicador e não paga USDC no cadastro antes da verificação do email', async () => {
    const {
      tx,
      usersFindFirst,
      usersFindUnique,
      referralsCreate,
      gameStatesUpsert,
      accessLevelReferralModelsFindUnique
    } = makeTx();
    usersFindFirst.mockResolvedValue({ id: 7, access_level_id: 'normal', referral_code: 'REF-AAA' });
    usersFindUnique
      .mockResolvedValueOnce({ referred_by: null, polygon_wallet: null, username: 'new-player' })
      .mockResolvedValueOnce({ referral_code: 'SELF-REF' });
    accessLevelReferralModelsFindUnique.mockResolvedValue(null);

    await executeUserPutCoreTransaction(
      tx,
      baseInput({
        uid: 42,
        usernameForUpdate: 'new-player',
        referredByForUpdate: 'REF-AAA'
      })
    );

    expect(referralsCreate).toHaveBeenCalledWith({
      data: { user_id: 7, referred_username: 'new-player' }
    });
    expect(gameStatesUpsert).toHaveBeenCalledTimes(1);
    expect(gameStatesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 7 },
        update: expect.objectContaining({
          claimed_referrals: { increment: 1 }
        })
      })
    );
  });
});
