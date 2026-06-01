/**
 * Espelho do formatter backend para testes e fallback offline.
 * Em produção o admin usa `display` vindo da API.
 */
export type ActivityDisplayCategory =
  | 'auth'
  | 'inventory'
  | 'rigs'
  | 'economy'
  | 'boxes'
  | 'session'
  | 'p2p'
  | 'other';

export type ActivityDisplaySeverity = 'info' | 'success' | 'warning' | 'danger';

export type ActivityEventDisplay = {
  category: ActivityDisplayCategory;
  severity: ActivityDisplaySeverity;
  title: string;
  summary: string;
  lines?: string[];
  technicalMeta?: Record<string, unknown> | null;
};

function metaObj(meta: unknown): Record<string, unknown> {
  if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) return {};
  return meta as Record<string, unknown>;
}

function str(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtUsdc(v: unknown): string {
  const n = num(v);
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function fmtQty(v: unknown): string {
  const n = num(v);
  if (n == null) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
}

function defaultDisplay(action: string, meta: Record<string, unknown>): ActivityEventDisplay {
  const keys = Object.keys(meta);
  const summary =
    keys.length === 0
      ? `Evento técnico: ${action}`
      : keys.slice(0, 4).map((k) => `${k}=${JSON.stringify(meta[k])?.slice(0, 80)}`).join(' · ');
  return {
    category: 'other',
    severity: 'info',
    title: action.replace(/_/g, ' '),
    summary,
    technicalMeta: meta
  };
}

function formatSessionSnapshot(meta: Record<string, unknown>): ActivityEventDisplay {
  const economy = metaObj(meta.economy);
  const inventory = metaObj(meta.inventory);
  const rigs = metaObj(meta.rigs);
  const boxes = metaObj(meta.boxes);
  const batteries = metaObj(meta.batteries);
  const usdc = fmtUsdc(economy.usdc);
  const stockLines = num(inventory.distinctItems) ?? 0;
  const stockQty = num(inventory.totalQty) ?? 0;
  const rackCount = num(rigs.count) ?? 0;
  const boxesTotal = num(boxes.totalQty) ?? 0;
  const batCount = num(batteries.count) ?? 0;
  const fp = str(meta.fingerprint).slice(0, 12);
  return {
    category: 'session',
    severity: 'success',
    title: 'Estado da conta ao entrar',
    summary: `${usdc} USDC · ${stockLines} tipos de item (${stockQty} un.) · ${rackCount} rig(s) · ${boxesTotal} caixa(s) fechada(s) · ${batCount} bateria(s) no armazém`,
    lines: fp ? [`Assinatura de estado: ${fp}…`] : undefined,
    technicalMeta: meta
  };
}

function formatStockDelta(meta: Record<string, unknown>): ActivityEventDisplay {
  const itemId = str(meta.itemId || meta.catalogItemId);
  const name = str(meta.itemName) || itemId;
  const before = num(meta.before ?? meta.quantity_before);
  const after = num(meta.after ?? meta.quantity_after);
  const delta = num(meta.delta) ?? (before != null && after != null ? after - before : null);
  const isLoss = delta != null && delta < 0;
  return {
    category: 'inventory',
    severity: isLoss ? 'warning' : delta != null && delta > 0 ? 'success' : 'info',
    title: isLoss ? 'Inventário: perda de item' : delta != null && delta > 0 ? 'Inventário: ganho de item' : 'Inventário alterado',
    summary: `${name}: ${fmtQty(before)} → ${fmtQty(after)}${delta != null ? ` (Δ ${delta > 0 ? '+' : ''}${delta})` : ''}`,
    lines: [str(meta.source) ? `Origem: ${meta.source}` : ''].filter(Boolean),
    technicalMeta: meta
  };
}

function formatRackEvent(action: string, meta: Record<string, unknown>): ActivityEventDisplay {
  const rackId = str(meta.rackId);
  const room = str(meta.room || meta.roomId);
  if (action === 'rack_dismantle') {
    const parts = metaObj(meta.parts);
    const miners = Array.isArray(parts.miners) ? parts.miners.length : 0;
    return {
      category: 'rigs',
      severity: 'warning',
      title: 'Rig desmontada',
      summary: `Rig ${rackId.slice(0, 8)}…${room ? ` · sala ${room}` : ''}`,
      lines: [
        parts.chassis ? `Chassis: ${str(meta.chassisName) || parts.chassis}` : '',
        miners > 0 ? `${miners} miner(s) removido(s)` : ''
      ].filter(Boolean),
      technicalMeta: meta
    };
  }
  if (action === 'rack_place') {
    return {
      category: 'rigs',
      severity: 'success',
      title: 'Rig colocada',
      summary: `${str(meta.itemName) || str(meta.itemId)} · rig ${rackId.slice(0, 8)}…${room ? ` · ${room}` : ''}`,
      technicalMeta: meta
    };
  }
  if (action === 'mining_rack_update') {
    const changed = Array.isArray(meta.changed) ? (meta.changed as string[]).join(', ') : str(meta.changed);
    return {
      category: 'rigs',
      severity: 'info',
      title: 'Rig atualizada',
      summary: `Rig ${rackId.slice(0, 8)}… — alterado: ${changed || 'configuração'}`,
      lines: Array.isArray(meta.changeDetail)
        ? (meta.changeDetail as string[]).slice(0, 6)
        : undefined,
      technicalMeta: meta
    };
  }
  return defaultDisplay(action, meta);
}

export function formatActivityEvent(action: string, meta: unknown): ActivityEventDisplay {
  const a = String(action || '').trim();
  const m = metaObj(meta);

  if (a === 'session_state_snapshot' || a === 'session_resync') {
    return formatSessionSnapshot(m);
  }

  if (a === 'stock_delta' || a === 'stock_save_delta' || a === 'inventory_loss_alert') {
    if (a === 'inventory_loss_alert') {
      const d = formatStockDelta(m);
      return { ...d, severity: 'danger', title: 'Alerta: item sumiu do inventário' };
    }
    return formatStockDelta(m);
  }

  if (/^login_success$/i.test(a)) {
    return {
      category: 'auth',
      severity: 'success',
      title: 'Login com sucesso',
      summary: m.ip ? `IP ${m.ip}` : 'Sessão iniciada',
      technicalMeta: m
    };
  }
  if (/^login_failed$/i.test(a)) {
    return {
      category: 'auth',
      severity: 'warning',
      title: 'Tentativa de login falhada',
      summary: m.ip ? `IP ${m.ip}` : 'Credenciais incorrectas',
      technicalMeta: m
    };
  }
  if (/^login_blocked/i.test(a)) {
    return {
      category: 'auth',
      severity: 'danger',
      title: 'Login bloqueado',
      summary: m.retryAfterSeconds
        ? `Conta bloqueada temporariamente (${m.retryAfterSeconds}s)`
        : 'Conta bloqueada',
      technicalMeta: m
    };
  }
  if (/^signup_complete$/i.test(a)) {
    return {
      category: 'auth',
      severity: 'success',
      title: 'Registo concluído',
      summary: 'Conta criada com sucesso',
      technicalMeta: m
    };
  }
  if (/^wallet_link$/i.test(a)) {
    return {
      category: 'auth',
      severity: 'info',
      title: 'Carteira ligada',
      summary: 'Sessão Web3 / Polygon associada',
      technicalMeta: m
    };
  }

  if (/^deposit_credit$/i.test(a)) {
    return {
      category: 'economy',
      severity: 'success',
      title: 'Depósito creditado',
      summary: `${fmtUsdc(m.amountUsdc ?? m.amount)} USDC${m.txHash ? ` · tx ${str(m.txHash).slice(0, 14)}…` : ''}`,
      technicalMeta: m
    };
  }
  if (/^exchange_sell$/i.test(a)) {
    return {
      category: 'economy',
      severity: 'info',
      title: 'Venda na exchange',
      summary: `${str(m.coinId)} · ${fmtUsdc(m.usdcReceived ?? m.amountUsdc)} USDC`,
      technicalMeta: m
    };
  }
  if (/^zerads_credit$/i.test(a)) {
    return {
      category: 'economy',
      severity: 'success',
      title: 'Crédito Zerads',
      summary: `${fmtUsdc(m.amountUsdc)} USDC`,
      technicalMeta: m
    };
  }

  if (/^loot_box_open$/i.test(a)) {
    return {
      category: 'boxes',
      severity: 'success',
      title: 'Caixa aberta',
      summary: `${str(m.boxName) || str(m.boxId)}${m.wonItemId ? ` → ${str(m.wonItemName) || m.wonItemId}` : ''}`,
      technicalMeta: m
    };
  }
  if (/^loot_box_buy$/i.test(a)) {
    return {
      category: 'boxes',
      severity: 'info',
      title: 'Caixa comprada',
      summary: `${str(m.boxId)} × ${fmtQty(m.qty ?? 1)} · ${fmtUsdc(m.price)} USDC`,
      technicalMeta: m
    };
  }

  if (/^rack_/.test(a) || /^mining_rack/.test(a) || /^room_battery/.test(a) || /^room_coin_bulk/.test(a)) {
    if (/^room_battery/.test(a)) {
      return {
        category: 'rigs',
        severity: 'info',
        title: 'Baterias na sala',
        summary: a.replace(/_/g, ' '),
        lines: m.roomId ? [`Sala: ${m.roomId}`] : undefined,
        technicalMeta: m
      };
    }
    return formatRackEvent(a, m);
  }

  if (/^p2p_/.test(a)) {
    return {
      category: 'p2p',
      severity: 'info',
      title: 'Mercado P2P',
      summary: a.replace(/^p2p_/, '').replace(/_/g, ' '),
      lines: [
        m.itemId ? `Item: ${m.itemId}` : '',
        m.totalUsdc != null ? `Total: ${fmtUsdc(m.totalUsdc)} USDC` : ''
      ].filter(Boolean),
      technicalMeta: m
    };
  }

  if (/^client_/.test(a)) {
    return {
      category: 'other',
      severity: 'info',
      title: 'Acção no cliente',
      summary: a.replace(/^client_/, '').replace(/_/g, ' '),
      technicalMeta: m
    };
  }

  if (/^hardware_buy|^shop_/.test(a)) {
    return {
      category: 'economy',
      severity: 'info',
      title: 'Compra na loja',
      summary: a.replace(/_/g, ' '),
      technicalMeta: m
    };
  }

  if (/^promo_redeem/.test(a) || /^roleta_/.test(a) || /^wheel_/.test(a)) {
    return {
      category: 'boxes',
      severity: 'success',
      title: 'Recompensa / jogo',
      summary: a.replace(/_/g, ' '),
      technicalMeta: m
    };
  }

  if (/^support_ticket/.test(a)) {
    return {
      category: 'other',
      severity: 'info',
      title: 'Suporte',
      summary: str(m.ticketId) ? `Ticket ${m.ticketId}` : a.replace(/_/g, ' '),
      technicalMeta: m
    };
  }

  return defaultDisplay(a, m);
}

export const ACTIVITY_LOG_FILTER_GROUPS: {
  id: string;
  label: string;
  test?: (action: string, display: ActivityEventDisplay) => boolean;
}[] = [
  { id: 'all', label: 'Todas' },
  { id: 'near_account_creation', label: 'Perto da criação da conta (±5 min)' },
  {
    id: 'losses',
    label: 'Perdas de inventário',
    test: (_a, d) => d.category === 'inventory' && (d.severity === 'warning' || d.severity === 'danger')
  },
  { id: 'session', label: 'Estado / sessão', test: (_a, d) => d.category === 'session' },
  { id: 'inventory', label: 'Inventário', test: (_a, d) => d.category === 'inventory' },
  { id: 'p2p', label: 'Mercado P2P', test: (_a, d) => d.category === 'p2p' },
  { id: 'auth', label: 'Login / conta', test: (_a, d) => d.category === 'auth' },
  {
    id: 'signup_complete',
    label: 'Registo',
    test: (a) => /^signup_complete$/i.test(a)
  },
  { id: 'deposit', label: 'Depósitos', test: (a) => /deposit/i.test(a) },
  {
    id: 'purchase',
    label: 'Compras / loja',
    test: (a) => /^(hardware_buy|loot_box_buy|rig_room_slot_purchase|exchange_sell)$/i.test(a)
  },
  { id: 'boxes', label: 'Caixas', test: (_a, d) => d.category === 'boxes' },
  { id: 'roleta', label: 'Roleta', test: (a) => /roleta_(roll|claim)|promo_redeem_roleta/i.test(a) },
  {
    id: 'promo',
    label: 'Códigos / promo',
    test: (a) => /promo_redeem/i.test(a) && !/roleta/i.test(a)
  },
  { id: 'rigs', label: 'Rigs / salas', test: (_a, d) => d.category === 'rigs' },
  { id: 'client', label: 'Cliente / telemetria', test: (a) => /^client_/i.test(a) },
  { id: 'login', label: 'Login / sessão', test: (_a, d) => d.category === 'auth' }
];

const NEAR_ACCOUNT_WINDOW_MS = 5 * 60 * 1000;

export function filterUserActivityLogs<
  T extends { action: string; meta: Record<string, unknown> | null; createdAt: number; display?: ActivityEventDisplay }
>(
  rows: T[],
  activityLogFilterId: string,
  activityLogSearch: string,
  opts?: { accountCreatedAtMs?: number | null }
): T[] {
  let out = Array.isArray(rows) ? rows : [];
  const q = activityLogSearch.trim().toLowerCase();
  if (q) {
    out = out.filter((r) => {
      const d = r.display ?? formatActivityEvent(r.action, r.meta);
      const hay = `${r.action} ${d.title} ${d.summary} ${(d.lines || []).join(' ')}`.toLowerCase();
      return hay.includes(q);
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
  return out.filter((r) => {
    const d = r.display ?? formatActivityEvent(r.action, r.meta);
    return group.test!(String(r.action || ''), d);
  });
}
