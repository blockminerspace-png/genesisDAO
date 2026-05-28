import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { RequestHandler } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Mocks Prisma.
 *
 * O controller faz `findUnique`, `create` (com possível P2002), `aggregate`,
 * `findMany` em diferentes models. O `$transaction(cb)` chama `cb(tx)` onde `tx`
 * tem `zerads_earnings_ledger.create` e `$executeRaw`. Para simular cada cenário
 * (sucesso, idempotência, falha) deixamos o mock configurável por teste.
 */
const prismaMock = vi.hoisted(() => {
  const txLedgerCreate = vi.fn();
  const txExecuteRaw = vi.fn().mockResolvedValue(1);
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      zerads_earnings_ledger: { create: txLedgerCreate },
      $executeRaw: txExecuteRaw
    };
    return cb(tx);
  });
  return {
    zerads_user_tokens: {
      findUnique: vi.fn(),
      create: vi.fn()
    },
    zerads_earnings_ledger: {
      aggregate: vi.fn(),
      findMany: vi.fn()
    },
    zerads_callback_log: {
      create: vi.fn().mockResolvedValue({})
    },
    $transaction: transaction,
    __tx: { txLedgerCreate, txExecuteRaw, transaction }
  };
});

vi.mock('../config/prisma.js', () => ({
  prisma: {
    zerads_user_tokens: prismaMock.zerads_user_tokens,
    zerads_earnings_ledger: prismaMock.zerads_earnings_ledger,
    zerads_callback_log: prismaMock.zerads_callback_log,
    $transaction: prismaMock.$transaction
  }
}));

// `rateLimit` retorna middleware passthrough no ambiente de testes: queremos
// exercitar o pipeline sem dependermos de in-memory limiter resetando entre
// `it()`s (que partilham o mesmo processo Node).
vi.mock('express-rate-limit', () => ({
  rateLimit: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
}));

import { registerZeradsCallbackRoutes } from '../controllers/zeradsCallbackController.js';

const VALID_TOKEN = 'a'.repeat(64); // hex 64 chars satisfaz o regex do controller
const KNOWN_USER_ID = 42;
const CORRECT_PWD = 'shared-secret-from-zerads';

function makeApp(opts?: {
  authenticated?: boolean;
  userId?: number;
  reqIp?: string;
}): { app: express.Express; appendGameActivityLog: ReturnType<typeof vi.fn> } {
  const authenticated = opts?.authenticated ?? false;
  const userId = opts?.userId ?? KNOWN_USER_ID;

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  // Para podermos simular o IP que o `trust proxy` resolveria, sobrescrevemos req.ip
  // através de uma propriedade getter (Express expõe req.ip como getter sobre socket).
  if (opts?.reqIp) {
    app.use((req, _res, next) => {
      Object.defineProperty(req, 'ip', { get: () => opts.reqIp, configurable: true });
      next();
    });
  }

  const authenticateToken: RequestHandler = (req, res, next) => {
    if (!authenticated) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    (req as unknown as { userId: number }).userId = userId;
    next();
  };

  const appendGameActivityLog = vi.fn().mockResolvedValue(undefined);

  registerZeradsCallbackRoutes(app, {
    authenticateToken,
    appendGameActivityLog,
    db: {} as never
  });

  return { app, appendGameActivityLog };
}

async function withServer<T>(
  app: express.Express,
  fn: (baseUrl: string) => Promise<T>
): Promise<T> {
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const ENV_KEYS = [
  'ZERADS_CALLBACK_PASSWORD',
  'ZERADS_ALLOWED_IPS',
  'ZERADS_REQUIRE_CF',
  'ZERADS_ZER_TO_USDC',
  'ZERADS_USER_SPLIT',
  'ZERADS_REF_ID'
] as const;

let envBackup: Record<string, string | undefined>;

beforeEach(() => {
  envBackup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<string, string | undefined>;
  // Valores estáveis por defeito; cada teste muda só o que precisa.
  process.env.ZERADS_CALLBACK_PASSWORD = CORRECT_PWD;
  process.env.ZERADS_ALLOWED_IPS = '162.0.208.108';
  process.env.ZERADS_REQUIRE_CF = '0'; // testes locais sem CF header por defeito
  process.env.ZERADS_ZER_TO_USDC = '0.013';
  process.env.ZERADS_USER_SPLIT = '0.8';
  process.env.ZERADS_REF_ID = '11294';

  prismaMock.zerads_user_tokens.findUnique.mockReset();
  prismaMock.zerads_user_tokens.create.mockReset();
  prismaMock.zerads_earnings_ledger.aggregate.mockReset();
  prismaMock.zerads_earnings_ledger.findMany.mockReset();
  prismaMock.zerads_callback_log.create.mockClear();
  prismaMock.zerads_callback_log.create.mockResolvedValue({} as never);
  prismaMock.__tx.txLedgerCreate.mockReset();
  prismaMock.__tx.txLedgerCreate.mockResolvedValue({} as never);
  prismaMock.__tx.txExecuteRaw.mockReset();
  prismaMock.__tx.txExecuteRaw.mockResolvedValue(1 as never);
  prismaMock.__tx.transaction.mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envBackup[k] === undefined) delete process.env[k];
    else process.env[k] = envBackup[k];
  }
  vi.useRealTimers();
});

// --------------------------------------------------------------------------
// /zeradsptc.php — segurança
// --------------------------------------------------------------------------

describe('/zeradsptc.php — pwd validation', () => {
  it('responde 403 + log bad_pwd quando senha está errada', async () => {
    const { app } = makeApp();
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=wrong&user=${VALID_TOKEN}&amount=0.05&clicks=1`
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body).toEqual({ ok: false, error: 'forbidden' });
    });
    expect(prismaMock.zerads_callback_log.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.zerads_callback_log.create.mock.calls[0]?.[0].data.status).toBe('bad_pwd');
    expect(prismaMock.__tx.transaction).not.toHaveBeenCalled();
  });

  it('responde 403 quando ZERADS_CALLBACK_PASSWORD não está definida', async () => {
    delete process.env.ZERADS_CALLBACK_PASSWORD;
    const { app } = makeApp();
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=anything&user=${VALID_TOKEN}&amount=0.05&clicks=1`
      );
      expect(res.status).toBe(403);
    });
    expect(prismaMock.zerads_callback_log.create.mock.calls[0]?.[0].data.status).toBe('bad_pwd');
  });

  it('compara em tempo constante (senhas de tamanhos diferentes ainda dão 403, sem throw)', async () => {
    const { app } = makeApp();
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=short&user=${VALID_TOKEN}&amount=0.05&clicks=1`
      );
      expect(res.status).toBe(403);
    });
  });
});

describe('/zeradsptc.php — IP whitelist', () => {
  it('rejeita callback de IP fora da whitelist', async () => {
    const { app } = makeApp({ reqIp: '203.0.113.99' });
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=0.05&clicks=1`,
        { headers: { 'CF-Connecting-IP': '198.51.100.1' } }
      );
      expect(res.status).toBe(403);
    });
    expect(prismaMock.zerads_callback_log.create.mock.calls[0]?.[0].data.status).toBe('bad_ip');
  });

  it('aceita quando CF-Connecting-IP está na whitelist (mesmo com req.ip diferente)', async () => {
    prismaMock.zerads_user_tokens.findUnique.mockResolvedValue({
      user_id: KNOWN_USER_ID,
      token: VALID_TOKEN
    } as never);

    const { app } = makeApp({ reqIp: '10.0.0.5' });
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=0.05&clicks=1`,
        { headers: { 'CF-Connecting-IP': '162.0.208.108' } }
      );
      expect(res.status).toBe(200);
    });
    expect(prismaMock.__tx.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejeita quando ZERADS_REQUIRE_CF=1 e CF-Connecting-IP em falta', async () => {
    process.env.ZERADS_REQUIRE_CF = '1';
    const { app } = makeApp({ reqIp: '162.0.208.108' });
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=0.05&clicks=1`
      );
      expect(res.status).toBe(403);
    });
    expect(prismaMock.zerads_callback_log.create.mock.calls[0]?.[0].data.status).toBe('bad_ip');
  });

  it('sem ZERADS_ALLOWED_IPS configurado, IP não é checado', async () => {
    delete process.env.ZERADS_ALLOWED_IPS;
    prismaMock.zerads_user_tokens.findUnique.mockResolvedValue({
      user_id: KNOWN_USER_ID,
      token: VALID_TOKEN
    } as never);

    const { app } = makeApp({ reqIp: '198.51.100.99' });
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=0.05&clicks=1`
      );
      expect(res.status).toBe(200);
    });
  });
});

// --------------------------------------------------------------------------
// /zeradsptc.php — validação de payload
// --------------------------------------------------------------------------

describe('/zeradsptc.php — payload validation', () => {
  it('400 quando user não bate o regex de token hex', async () => {
    const { app } = makeApp({ reqIp: '162.0.208.108' });
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=not-a-hex-token!!&amount=0.05&clicks=1`
      );
      expect(res.status).toBe(400);
    });
    expect(prismaMock.zerads_callback_log.create.mock.calls[0]?.[0].data.status).toBe('bad_payload');
  });

  it('400 quando amount é NaN', async () => {
    const { app } = makeApp({ reqIp: '162.0.208.108' });
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=abc&clicks=1`
      );
      expect(res.status).toBe(400);
    });
    expect(prismaMock.zerads_callback_log.create.mock.calls[0]?.[0].data.status).toBe('bad_payload');
  });

  it('400 quando amount é negativo', async () => {
    const { app } = makeApp({ reqIp: '162.0.208.108' });
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=-1&clicks=1`
      );
      expect(res.status).toBe(400);
    });
  });

  it('200 unknown_user quando token não resolve para nenhum user', async () => {
    prismaMock.zerads_user_tokens.findUnique.mockResolvedValue(null);
    const { app } = makeApp({ reqIp: '162.0.208.108' });
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=0.05&clicks=1`
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; error?: string };
      expect(body).toEqual({ ok: false, error: 'unknown_user' });
    });
    expect(prismaMock.zerads_callback_log.create.mock.calls[0]?.[0].data.status).toBe('unknown_user');
    expect(prismaMock.__tx.transaction).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// /zeradsptc.php — credit path
// --------------------------------------------------------------------------

describe('/zeradsptc.php — credit path (happy + split 80/20)', () => {
  beforeEach(() => {
    prismaMock.zerads_user_tokens.findUnique.mockResolvedValue({
      user_id: KNOWN_USER_ID,
      token: VALID_TOKEN
    } as never);
  });

  it('caminho feliz: credita user 80% em USDC e retorna OK', async () => {
    const { app, appendGameActivityLog } = makeApp({ reqIp: '162.0.208.108' });
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=0.05&clicks=3`
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; credited_usdc: number; clicks: number };
      // amount 0.05 ZER * rate 0.013 * userSplit 0.8 = 0.00052 USDC
      expect(body.ok).toBe(true);
      expect(body.credited_usdc).toBeCloseTo(0.00052, 10);
      expect(body.clicks).toBe(3);
    });

    expect(prismaMock.__tx.txLedgerCreate).toHaveBeenCalledTimes(1);
    const ledgerArg = prismaMock.__tx.txLedgerCreate.mock.calls[0]?.[0].data;
    expect(ledgerArg.user_id).toBe(KNOWN_USER_ID);
    expect(ledgerArg.amount_zer).toBeCloseTo(0.05, 10);
    expect(ledgerArg.amount_usdc_total).toBeCloseTo(0.00065, 10); // 0.05*0.013
    expect(ledgerArg.user_amount_usdc).toBeCloseTo(0.00052, 10);
    expect(ledgerArg.platform_amount_usdc).toBeCloseTo(0.00013, 10);
    expect(ledgerArg.clicks).toBe(3);
    expect(ledgerArg.zer_to_usdc_rate).toBe(0.013);

    expect(prismaMock.__tx.txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(appendGameActivityLog).toHaveBeenCalledWith(
      null,
      KNOWN_USER_ID,
      'zerads_credit',
      expect.objectContaining({ amount_zer: 0.05, clicks: 3, rate: 0.013 })
    );
    // log final de sucesso
    const lastLog = prismaMock.zerads_callback_log.create.mock.calls.at(-1)?.[0].data;
    expect(lastLog.status).toBe('ok');
    expect(lastLog.user_id).toBe(KNOWN_USER_ID);
  });

  it('amount=0 regista ledger mas não chama $executeRaw (sem crédito)', async () => {
    const { app } = makeApp({ reqIp: '162.0.208.108' });
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=0&clicks=5`
      );
      expect(res.status).toBe(200);
    });
    expect(prismaMock.__tx.txLedgerCreate).toHaveBeenCalledTimes(1);
    expect(prismaMock.__tx.txExecuteRaw).not.toHaveBeenCalled();
  });

  it('aceita também POST (não só GET)', async () => {
    const { app } = makeApp({ reqIp: '162.0.208.108' });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/zeradsptc.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          pwd: CORRECT_PWD,
          user: VALID_TOKEN,
          amount: '0.02',
          clicks: '1'
        }).toString()
      });
      expect(res.status).toBe(200);
    });
    expect(prismaMock.__tx.transaction).toHaveBeenCalledTimes(1);
  });

  it('split honra ZERADS_USER_SPLIT alternativo', async () => {
    process.env.ZERADS_USER_SPLIT = '0.5';
    const { app } = makeApp({ reqIp: '162.0.208.108' });
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=1&clicks=0`
      );
      expect(res.status).toBe(200);
    });
    const ledgerArg = prismaMock.__tx.txLedgerCreate.mock.calls[0]?.[0].data;
    expect(ledgerArg.user_amount_usdc).toBeCloseTo(0.0065, 10); // 1 * 0.013 * 0.5
    expect(ledgerArg.platform_amount_usdc).toBeCloseTo(0.0065, 10);
  });

  it('idempotência: segundo call com mesmo bucket → 200 dup, sem crédito duplo', async () => {
    // P2002 = unique violation no idempotency_key.
    prismaMock.__tx.txLedgerCreate
      .mockResolvedValueOnce({} as never)
      .mockImplementationOnce(() => {
        const err: Error & { code?: string } = new Error('unique violation');
        err.code = 'P2002';
        throw err;
      });

    const { app } = makeApp({ reqIp: '162.0.208.108' });
    await withServer(app, async (base) => {
      const r1 = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=0.05&clicks=3`
      );
      expect(r1.status).toBe(200);
      const b1 = (await r1.json()) as { ok: boolean; dup?: boolean };
      expect(b1.dup).toBeUndefined();

      const r2 = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=0.05&clicks=3`
      );
      expect(r2.status).toBe(200);
      const b2 = (await r2.json()) as { ok: boolean; dup?: boolean };
      expect(b2).toEqual({ ok: true, dup: true });
    });

    // executeRaw chamado só uma vez (no primeiro). No segundo, falha antes.
    expect(prismaMock.__tx.txExecuteRaw).toHaveBeenCalledTimes(1);
    const lastLog = prismaMock.zerads_callback_log.create.mock.calls.at(-1)?.[0].data;
    expect(lastLog.status).toBe('dup');
  });

  it('erro inesperado no Prisma → 500 + log error com mensagem truncada', async () => {
    prismaMock.__tx.txLedgerCreate.mockImplementationOnce(() => {
      throw new Error('a'.repeat(800));
    });

    const { app } = makeApp({ reqIp: '162.0.208.108' });
    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=0.05&clicks=3`
      );
      expect(res.status).toBe(500);
    });
    const errLog = prismaMock.zerads_callback_log.create.mock.calls.at(-1)?.[0].data;
    expect(errLog.status).toBe('error');
    expect(String(errLog.message).length).toBeLessThanOrEqual(400);
  });

  it('falha de appendGameActivityLog não derruba o callback', async () => {
    const { app, appendGameActivityLog } = makeApp({ reqIp: '162.0.208.108' });
    appendGameActivityLog.mockRejectedValueOnce(new Error('mongo offline'));

    await withServer(app, async (base) => {
      const res = await fetch(
        `${base}/zeradsptc.php?pwd=${encodeURIComponent(CORRECT_PWD)}&user=${VALID_TOKEN}&amount=0.05&clicks=1`
      );
      expect(res.status).toBe(200);
    });
  });
});

// --------------------------------------------------------------------------
// /api/zerads/me/token
// --------------------------------------------------------------------------

describe('/api/zerads/me/token', () => {
  it('401 quando não autenticado', async () => {
    const { app } = makeApp({ authenticated: false });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/zerads/me/token`);
      expect(res.status).toBe(401);
    });
  });

  it('gera token novo (32 bytes hex) quando user não tem token', async () => {
    prismaMock.zerads_user_tokens.findUnique.mockResolvedValueOnce(null);
    prismaMock.zerads_user_tokens.create.mockImplementation(async (args: { data: { token: string } }) => ({
      user_id: KNOWN_USER_ID,
      token: args.data.token,
      created_at: BigInt(Date.now())
    } as never));

    const { app } = makeApp({ authenticated: true });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/zerads/me/token`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token: string; ptc_url: string };
      expect(body.token).toMatch(/^[a-f0-9]{64}$/);
      expect(body.ptc_url).toBe(
        `https://zerads.com/ptc.php?ref=11294&user=${body.token}`
      );
    });
    expect(prismaMock.zerads_user_tokens.create).toHaveBeenCalledTimes(1);
  });

  it('retorna token existente sem criar duplicado', async () => {
    prismaMock.zerads_user_tokens.findUnique.mockResolvedValue({
      user_id: KNOWN_USER_ID,
      token: VALID_TOKEN,
      created_at: BigInt(0)
    } as never);

    const { app } = makeApp({ authenticated: true });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/zerads/me/token`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token: string };
      expect(body.token).toBe(VALID_TOKEN);
    });
    expect(prismaMock.zerads_user_tokens.create).not.toHaveBeenCalled();
  });

  it('race condition: create falha (P2002), relê e devolve token existente', async () => {
    prismaMock.zerads_user_tokens.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        user_id: KNOWN_USER_ID,
        token: VALID_TOKEN,
        created_at: BigInt(0)
      } as never);
    prismaMock.zerads_user_tokens.create.mockImplementationOnce(() => {
      const err: Error & { code?: string } = new Error('unique violation');
      err.code = 'P2002';
      throw err;
    });

    const { app } = makeApp({ authenticated: true });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/zerads/me/token`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token: string };
      expect(body.token).toBe(VALID_TOKEN);
    });
  });
});

// --------------------------------------------------------------------------
// /api/zerads/me/stats
// --------------------------------------------------------------------------

describe('/api/zerads/me/stats', () => {
  it('401 quando não autenticado', async () => {
    const { app } = makeApp({ authenticated: false });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/zerads/me/stats`);
      expect(res.status).toBe(401);
    });
  });

  it('devolve totais e serializa BigInt created_at como Number', async () => {
    prismaMock.zerads_earnings_ledger.aggregate.mockResolvedValue({
      _sum: {
        amount_zer: 0.5,
        user_amount_usdc: 0.0052,
        platform_amount_usdc: 0.0013,
        clicks: 12
      },
      _count: { _all: 4 }
    } as never);
    prismaMock.zerads_earnings_ledger.findMany.mockResolvedValue([
      {
        amount_zer: 0.1,
        user_amount_usdc: 0.00104,
        clicks: 3,
        zer_to_usdc_rate: 0.013,
        created_at: BigInt(1_700_000_000_000)
      }
    ] as never);

    const { app } = makeApp({ authenticated: true });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/zerads/me/stats`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        totals: { callbacks: number; amount_zer: number; user_amount_usdc: number; clicks: number };
        recent: Array<{ created_at: number; amount_zer: number }>;
      };
      expect(body.totals.callbacks).toBe(4);
      expect(body.totals.amount_zer).toBeCloseTo(0.5);
      expect(body.totals.user_amount_usdc).toBeCloseTo(0.0052);
      expect(body.totals.clicks).toBe(12);
      expect(body.recent).toHaveLength(1);
      expect(body.recent[0]?.created_at).toBe(1_700_000_000_000);
      expect(typeof body.recent[0]?.created_at).toBe('number');
    });
  });

  it('vazio: retorna zeros e recent: []', async () => {
    prismaMock.zerads_earnings_ledger.aggregate.mockResolvedValue({
      _sum: {
        amount_zer: null,
        user_amount_usdc: null,
        platform_amount_usdc: null,
        clicks: null
      },
      _count: { _all: 0 }
    } as never);
    prismaMock.zerads_earnings_ledger.findMany.mockResolvedValue([] as never);

    const { app } = makeApp({ authenticated: true });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/zerads/me/stats`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        totals: { callbacks: number; amount_zer: number; user_amount_usdc: number; clicks: number };
        recent: unknown[];
      };
      expect(body.totals).toEqual({
        callbacks: 0,
        amount_zer: 0,
        user_amount_usdc: 0,
        platform_amount_usdc: 0,
        clicks: 0
      });
      expect(body.recent).toEqual([]);
    });
  });
});
