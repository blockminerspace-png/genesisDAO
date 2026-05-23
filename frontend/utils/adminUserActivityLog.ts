import type { GameUserActivityEntry } from '../types';

export function formatUserActivityMeta(meta: GameUserActivityEntry['meta']): string {
  if (meta == null || typeof meta !== 'object') return '—';
  try {
    const s = JSON.stringify(meta);
    return s.length > 420 ? `${s.slice(0, 420)}…` : s;
  } catch {
    return '—';
  }
}

/** Data estimada de registo a partir de `game_states.start_time` (ms epoch, America/Sao_Paulo). */
export function formatAccountCreatedBrt(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo'
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

/** Filtros da aba Atividade (ações gravadas no Mongo `game_activity_logs`). */
export const ACTIVITY_LOG_FILTER_GROUPS: {
  id: string;
  label: string;
  test?: (action: string) => boolean;
}[] = [
  { id: 'all', label: 'Todas' },
  /** Sem `test` — tratado em `filterUserActivityLogs` com `accountCreatedAtMs`. */
  { id: 'near_account_creation', label: 'Perto da criação da conta (±5 min)' },
  {
    id: 'signup_complete',
    label: 'Registo signup (Mongo action_logs)',
    test: (a) => /^signup_complete$/i.test(a)
  },
  {
    id: 'deposit',
    label: 'Depósitos',
    test: (a) => /deposit/i.test(a),
  },
  {
    id: 'purchase',
    label: 'Compras / loja',
    test: (a) => /^(hardware_buy|loot_box_buy|rig_room_slot_purchase|exchange_sell)$/i.test(a),
  },
  {
    id: 'boxes',
    label: 'Caixas (abrir)',
    test: (a) => /loot_box_open/i.test(a),
  },
  {
    id: 'roleta',
    label: 'Roleta',
    test: (a) => /roleta_(roll|claim)|promo_redeem_roleta/i.test(a),
  },
  {
    id: 'promo',
    label: 'Códigos / promo',
    test: (a) => /promo_redeem/i.test(a) && !/roleta/i.test(a),
  },
  {
    id: 'rigs',
    label: 'Rigs / salas',
    test: (a) => /mining_rack|rack_dismantle|room_battery|room_coin_bulk/i.test(a),
  },
  {
    id: 'client',
    label: 'Cliente / telemetria',
    test: (a) => /^client_/i.test(a),
  },
  {
    id: 'login',
    label: 'Login / sessão',
    test: (a) => /login|session|auth|logout/i.test(a),
  },
];

const NEAR_ACCOUNT_WINDOW_MS = 5 * 60 * 1000;

export function filterUserActivityLogs(
  rows: GameUserActivityEntry[],
  activityLogFilterId: string,
  activityLogSearch: string,
  opts?: { accountCreatedAtMs?: number | null }
): GameUserActivityEntry[] {
  let out = Array.isArray(rows) ? rows : [];
  const q = activityLogSearch.trim().toLowerCase();
  if (q) {
    out = out.filter((r) => {
      const action = String(r.action || '').toLowerCase();
      const metaStr = formatUserActivityMeta(r.meta).toLowerCase();
      return action.includes(q) || metaStr.includes(q);
    });
  }
  if (activityLogFilterId === 'near_account_creation') {
    const t0 = opts?.accountCreatedAtMs;
    if (t0 == null || !Number.isFinite(t0) || t0 <= 0) return [];
    return out.filter(
      (r) => Number.isFinite(r.createdAt) && Math.abs(Number(r.createdAt) - t0) <= NEAR_ACCOUNT_WINDOW_MS
    );
  }
  const group = ACTIVITY_LOG_FILTER_GROUPS.find((g) => g.id === activityLogFilterId);
  if (!group?.test) return out;
  return out.filter((r) => group.test!(String(r.action || '')));
}
