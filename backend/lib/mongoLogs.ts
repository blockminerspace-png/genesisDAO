/**
 * Logs append-only no MongoDB (opcional via `MONGODB_URI`).
 * Contrato de campos por coleção: `backend/docs/MONGO_LOG_CONTRACT.md`.
 */
import { getGenesisMongo } from './genesisStack/init.js';

export { getGenesisMongo };

/** Base de dados Mongo só para logs / analytics (não é fonte de verdade). */
export const MONGO_LOG_DB = process.env.GENESIS_MONGO_DB?.trim() || 'genesis_logs';

export const MONGO_COLLECTIONS = {
  actionLogs: 'action_logs',
  eventHistory: 'event_history',
  analyticsEvents: 'analytics_events',
  /** Auditoria de jogo (ex.: caixas, roleta, depósitos) — antes em Postgres `game_activity_logs`. */
  gameActivity: 'game_activity_logs',
} as const;

export type MongoLogCollection = (typeof MONGO_COLLECTIONS)[keyof typeof MONGO_COLLECTIONS] | string;

/**
 * Escrita fire-and-forget (não bloqueia o pedido HTTP).
 * `collection`: use `MONGO_COLLECTIONS.*` ou nome próprio.
 */
export function mongoLogInsert(collection: MongoLogCollection, doc: Record<string, unknown>): void {
  const client = getGenesisMongo();
  if (!client) return;
  const payload = { ...doc, at: new Date() };
  void client
    .db(MONGO_LOG_DB)
    .collection(collection)
    .insertOne(payload)
    .catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[MongoLogs] insert falhou:', collection, msg);
    });
}

/**
 * Ação de utilizador (login, P2P, registo, etc.).
 * Não incluir palavras-passe, cookies, JWT nem dados de cartão — só ids e métricas agregadas.
 */
export function logUserAction(
  userId: number | null,
  action: string,
  meta: Record<string, unknown> = {}
): void {
  mongoLogInsert(MONGO_COLLECTIONS.actionLogs, {
    userId,
    action,
    ...meta,
  });
}

/** Evento de sistema / jogo (tick, job, erro controlado). */
export function logGameEvent(kind: string, meta: Record<string, unknown> = {}): void {
  mongoLogInsert(MONGO_COLLECTIONS.eventHistory, { kind, ...meta });
}

/** Métricas de analytics (agregações leves). */
export function logAnalyticsEvent(name: string, meta: Record<string, unknown> = {}): void {
  mongoLogInsert(MONGO_COLLECTIONS.analyticsEvents, { name, ...meta });
}

export type GameActivityLogRow = {
  id: string;
  action: string;
  meta: Record<string, unknown>;
  createdAt: number;
};

function mapGameActivityDoc(d: Record<string, unknown>): GameActivityLogRow {
  const id = d._id != null ? String(d._id) : '';
  const at = d.at instanceof Date ? d.at : d.at != null ? new Date(String(d.at)) : new Date();
  const createdAt =
    typeof d.created_at === 'number' && Number.isFinite(d.created_at) ? d.created_at : at.getTime();
  return {
    id,
    action: String(d.action ?? ''),
    meta: (d.meta && typeof d.meta === 'object' && !Array.isArray(d.meta) ? d.meta : {}) as Record<
      string,
      unknown
    >,
    createdAt
  };
}

/** `action_logs`: meta vem como campos extra no documento (não há `meta` aninhado). */
function mapActionLogDoc(d: Record<string, unknown>): GameActivityLogRow {
  const id = d._id != null ? `action:${String(d._id)}` : 'action:';
  const at = d.at instanceof Date ? d.at : d.at != null ? new Date(String(d.at)) : new Date();
  const createdAt =
    typeof d.created_at === 'number' && Number.isFinite(d.created_at) ? d.created_at : at.getTime();
  const action = String(d.action ?? '');
  const meta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (['_id', 'userId', 'action', 'at', 'created_at'].includes(k)) continue;
    meta[k] = v as unknown;
  }
  return { id, action, meta, createdAt };
}

/**
 * Grava um evento de atividade de jogo (auditoria admin). Exige Mongo configurado.
 */
export async function appendGameActivityLogMongo(
  userId: number,
  action: string,
  meta: Record<string, unknown>
): Promise<void> {
  const client = getGenesisMongo();
  if (!client) {
    console.warn('[MongoLogs] appendGameActivityLogMongo: MONGODB_URI ausente; evento não gravado:', action);
    return;
  }
  const safeAction = String(action).slice(0, 200);
  let metaObj: Record<string, unknown> = {};
  try {
    metaObj = JSON.parse(JSON.stringify(meta ?? {})) as Record<string, unknown>;
  } catch {
    metaObj = {};
  }
  const at = new Date();
  const created_at = at.getTime();
  try {
    await client.db(MONGO_LOG_DB).collection(MONGO_COLLECTIONS.gameActivity).insertOne({
      userId,
      action: safeAction,
      meta: metaObj,
      at,
      created_at
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[MongoLogs] game_activity insert falhou:', safeAction, msg);
  }
}

/**
 * Lista eventos de atividade para o painel admin (`GET /api/admin/user-activity`).
 */
export async function listGameActivityLogsMongo(userId: number, limit: number): Promise<GameActivityLogRow[]> {
  const client = getGenesisMongo();
  if (!client) return [];
  const lim = Math.min(500, Math.max(1, Math.floor(limit)));
  try {
    const docs = await client
      .db(MONGO_LOG_DB)
      .collection(MONGO_COLLECTIONS.gameActivity)
      .find({ userId })
      .sort({ at: -1 })
      .limit(lim)
      .toArray();
    return docs.map((d) => mapGameActivityDoc(d as Record<string, unknown>));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[MongoLogs] listGameActivityLogsMongo:', msg);
    return [];
  }
}

async function listUserActionLogsMongo(userId: number, limit: number): Promise<GameActivityLogRow[]> {
  const client = getGenesisMongo();
  if (!client) return [];
  const lim = Math.min(300, Math.max(1, Math.floor(limit)));
  try {
    const docs = await client
      .db(MONGO_LOG_DB)
      .collection(MONGO_COLLECTIONS.actionLogs)
      .find({ userId })
      .sort({ at: -1 })
      .limit(lim)
      .toArray();
    return docs.map((d) => mapActionLogDoc(d as Record<string, unknown>));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[MongoLogs] listUserActionLogsMongo:', msg);
    return [];
  }
}

const ADMIN_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;

async function listGameActivityInWindowMongo(
  userId: number,
  centerMs: number,
  windowMs: number
): Promise<GameActivityLogRow[]> {
  const client = getGenesisMongo();
  if (!client) return [];
  const from = new Date(centerMs - windowMs);
  const to = new Date(centerMs + windowMs);
  try {
    const docs = await client
      .db(MONGO_LOG_DB)
      .collection(MONGO_COLLECTIONS.gameActivity)
      .find({ userId, at: { $gte: from, $lte: to } })
      .sort({ at: -1 })
      .limit(80)
      .toArray();
    return docs.map((d) => mapGameActivityDoc(d as Record<string, unknown>));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[MongoLogs] listGameActivityInWindowMongo:', msg);
    return [];
  }
}

async function listUserActionLogsInWindowMongo(
  userId: number,
  centerMs: number,
  windowMs: number
): Promise<GameActivityLogRow[]> {
  const client = getGenesisMongo();
  if (!client) return [];
  const from = new Date(centerMs - windowMs);
  const to = new Date(centerMs + windowMs);
  try {
    const docs = await client
      .db(MONGO_LOG_DB)
      .collection(MONGO_COLLECTIONS.actionLogs)
      .find({ userId, at: { $gte: from, $lte: to } })
      .sort({ at: -1 })
      .limit(80)
      .toArray();
    return docs.map((d) => mapActionLogDoc(d as Record<string, unknown>));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[MongoLogs] listUserActionLogsInWindowMongo:', msg);
    return [];
  }
}

/**
 * União para o painel admin: `game_activity_logs` + `action_logs` (ex.: `signup_complete`, `login`),
 * e eventos numa janela temporal à volta de `accountCreatedAtMs` (registo fora dos N mais recentes).
 */
export async function listAdminUserActivityLogsMongo(
  userId: number,
  limit: number,
  opts?: { accountCreatedAtMs?: number | null; beforeMs?: number | null }
): Promise<{ rows: GameActivityLogRow[]; hasMore: boolean }> {
  const lim = Math.min(500, Math.max(1, Math.floor(limit)));
  const fetchCap = Math.min(800, lim * 4);
  const gameRecent = await listGameActivityLogsMongo(userId, fetchCap);
  const actionRecent = await listUserActionLogsMongo(userId, Math.min(400, fetchCap));

  const center = opts?.accountCreatedAtMs;
  let around: GameActivityLogRow[] = [];
  if (center != null && Number.isFinite(center) && center > 0) {
    const [g, a] = await Promise.all([
      listGameActivityInWindowMongo(userId, center, ADMIN_ACTIVITY_WINDOW_MS),
      listUserActionLogsInWindowMongo(userId, center, ADMIN_ACTIVITY_WINDOW_MS)
    ]);
    around = [...g, ...a];
  }

  const byId = new Map<string, GameActivityLogRow>();
  const put = (r: GameActivityLogRow) => {
    if (!r.id) return;
    if (!byId.has(r.id)) byId.set(r.id, r);
  };
  for (const r of around) put(r);
  const mergedRecent = [...gameRecent, ...actionRecent].sort((a, b) => b.createdAt - a.createdAt);
  for (const r of mergedRecent) put(r);

  let sorted = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  const beforeMs = opts?.beforeMs;
  if (beforeMs != null && Number.isFinite(beforeMs) && beforeMs > 0) {
    sorted = sorted.filter((r) => r.createdAt < beforeMs);
  }

  const hasMore = sorted.length > lim;
  const rows = sorted.slice(0, lim);
  return { rows, hasMore };
}

/** Snapshots de sessão (`session_state_snapshot` / `session_resync`). */
export async function listSessionSnapshotsMongo(
  userId: number,
  limit: number
): Promise<GameActivityLogRow[]> {
  const client = getGenesisMongo();
  if (!client) return [];
  const lim = Math.min(100, Math.max(1, Math.floor(limit)));
  try {
    const docs = await client
      .db(MONGO_LOG_DB)
      .collection(MONGO_COLLECTIONS.gameActivity)
      .find({
        userId,
        action: { $in: ['session_state_snapshot', 'session_resync'] }
      })
      .sort({ at: -1 })
      .limit(lim)
      .toArray();
    return docs.map((d) => mapGameActivityDoc(d as Record<string, unknown>));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[MongoLogs] listSessionSnapshotsMongo:', msg);
    return [];
  }
}
