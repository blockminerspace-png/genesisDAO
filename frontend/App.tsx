import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import {
  getGameState as apiGetGameState,
  updateUser as apiUpdateUser,
  getUpgrades,
  getAccessLevels,
  getLootBoxes,
  getSystemNews,
  getWeb3Settings,
  web3DepositFlagDisabled,
  postLuckyBoxPurchase,
  postLuckyBoxOpen,
  discardLootBox,
  impersonateUser,
  stopImpersonate,
  getEconomySettings,
  getMarketListings,
  sellMarketListing,
  buyMarketListing,
  cancelMarketListing,
  claimMarketFunds,
  getWalletState,
  postWalletExchangeLiquidate,
  newWheelIdempotencyKey,
  type WalletStatePayload,
  requestWithdrawal,
  getWithdrawalRequests,
  updateWithdrawalStatus,
  getSession,
  getServerTime,
  getMiningCoins,
  getMonetizationSettings,
  getGameNavLabels,
  getPublicBootstrap,
  getPublicBootstrapLite,
  saveGameState as apiSaveGameState,
  postServersRackAuxEquip,
  postServersRackAuxUnequip,
  postServersPlaceRack,
  postServersRemoveRack,
  postServersRackMinerEquip,
  postServersRackMinerUnequip,
  postServerRoomRoomCoins,
  getGlobalLastLoadTime,
  newServerIntentIdempotencyKey,
  setUpgrades as apiSetUpgrades,
  setAccessLevels as apiSetAccessLevels,
  setLootBoxes as apiSetLootBoxes,
  logout as apiLogout,
  getPlayerInventoryMe,
  getPlayerInventoryState,
  type InventoryStackableCategoryApi,
  type ServersRackAuxIntentOk
} from './services/api';
import { GameState, PlacedRack, StoredBattery, User, MarketListing, Upgrade, AccessLevel, LootBox, MiningCoin, Web3Settings, MonetizationSettings, EconomySettings, SystemNews, normalizePlacedRackRoomId, NFT_AUTO_ALLOWED_CHASSIS_ID, isNftAutoArmario1OnlyRoomContext, isAsicMachineUpgrade, isNftAutoArmario1OnlyRoom, isNftRoomExclusiveMiningCoin, NFT_ROOM_EXCLUSIVE_COIN_ERROR_PT } from './types';
import { DEFAULT_GAME_NAV_LABELS, GAME_NAV_LABEL_KEYS, type GameNavLabelKey } from './constants/gameNavLabels';
import { appendUsdcShortfallLine } from './utils/playerMoneyMessages';
import { computeHashByCoinFromPlacedRacks } from './models/nftRoomMiningModel';
import { findWithdrawTokenCfg, isWithdrawTokenUsable, minimumWithdrawCryptoAmount } from './utils/withdrawTokenMatch';
import type { WalletWithdrawResult } from './components/WalletActions';
import { trackSpaPageView } from './lib/analytics';
import {
  gamePathFromView,
  gameViewFromEnglishPathname,
  isEnglishGameSpaPath,
  PUBLIC_MAINTENANCE_SPA_PATH,
  type GamePathView
} from './lib/gamePathRoutes';
import { useStackSocketStore } from './stores/useStackSocketStore';
import { RemoteBannerImage } from './components/RemoteBannerImage';
import { UiNoticeModal, type UiNotice } from './components/UiNoticeModal';
import { DailyCheckinBanner } from './components/DailyCheckinBanner';
import { gpuDupLog } from './utils/gpuDupDebug';
import { HomePage } from './components/HomePage';
import { Footer } from './components/Footer';
import { lazyWithReload } from './lib/lazyWithReload';
import { Wallet, TrendingUp, RefreshCw, DollarSign, Coins, Server, ShoppingCart, LayoutDashboard, Package, LogOut, Home, BookOpen, User as UserIcon, Skull, Shield, Crown, Gift, ChevronDown, ChevronUp, Menu, X, Play, Wrench, Gamepad2, Trophy, Scale, Sparkles, Battery, LifeBuoy, Clapperboard, Construction, Grid3X3, History } from 'lucide-react';

const DocsPage = lazyWithReload(() => import('./components/DocsPage').then((m) => ({ default: m.DocsPage })));
const TermsPage = lazyWithReload(() => import('./components/TermsPage').then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazyWithReload(() => import('./components/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const CookiesPolicyPage = lazyWithReload(() =>
  import('./components/CookiesPolicyPage').then((m) => ({ default: m.CookiesPolicyPage }))
);
const AmlPolicyPage = lazyWithReload(() => import('./components/AmlPolicyPage').then((m) => ({ default: m.AmlPolicyPage })));
const Web3RiskPage = lazyWithReload(() => import('./components/Web3RiskPage').then((m) => ({ default: m.Web3RiskPage })));
const RefundPolicyPage = lazyWithReload(() =>
  import('./components/RefundPolicyPage').then((m) => ({ default: m.RefundPolicyPage }))
);
const CommunityPolicyPage = lazyWithReload(() =>
  import('./components/CommunityPolicyPage').then((m) => ({ default: m.CommunityPolicyPage }))
);
const AuthPage = lazyWithReload(() => import('./components/AuthPage').then((m) => ({ default: m.AuthPage })));
const AdminPanel = lazyWithReload(() => import('./components/AdminPanel').then((m) => ({ default: m.AdminPanel })));
const ProfilePage = lazyWithReload(() => import('./components/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const TransparencyPage = lazyWithReload(() => import('./components/TransparencyPage').then((m) => ({ default: m.TransparencyPage })));
const WithdrawalHistoryPage = lazyWithReload(() =>
  import('./components/WithdrawalHistoryPage').then((m) => ({ default: m.WithdrawalHistoryPage }))
);
const ServerRoom = lazyWithReload(() => import('./components/ServerRoom').then((m) => ({ default: m.ServerRoom })));
const PlayerCalculator = lazyWithReload(() => import('./components/PlayerCalculator').then((m) => ({ default: m.PlayerCalculator })));
const InventoryView = lazyWithReload(() => import('./components/InventoryView').then((m) => ({ default: m.InventoryView })));
const UpgradeShop = lazyWithReload(() => import('./components/UpgradeShop').then((m) => ({ default: m.UpgradeShop })));
const LuckyBoxStore = lazyWithReload(() => import('./components/LuckyBoxStore').then((m) => ({ default: m.LuckyBoxStore })));
const RoletaPage = lazyWithReload(() => import('./components/RoletaPage').then((m) => ({ default: m.RoletaPage })));
const SupportPage = lazyWithReload(() => import('./components/SupportPage').then((m) => ({ default: m.SupportPage })));
const PartnersPage = lazyWithReload(() => import('./components/PartnersPage').then((m) => ({ default: m.PartnersPage })));
const PartnerGamesPage = lazyWithReload(() => import('./components/PartnerGamesPage').then((m) => ({ default: m.PartnerGamesPage })));
const OfferwallPage = lazyWithReload(() => import('./components/OfferwallPage').then((m) => ({ default: m.OfferwallPage })));
const DashboardPage = lazyWithReload(() => import('./components/Dashboard').then((m) => ({ default: m.Dashboard })));
const BlackMarket = lazyWithReload(() => import('./components/BlackMarket').then((m) => ({ default: m.BlackMarket })));
const Exchange = lazyWithReload(() => import('./components/Exchange').then((m) => ({ default: m.Exchange })));
const WalletActions = lazyWithReload(() => import('./components/WalletActions').then((m) => ({ default: m.WalletActions })));
const UpgradeAccount = lazyWithReload(() => import('./components/UpgradeAccount').then((m) => ({ default: m.UpgradeAccount })));
const AdminRanking = lazyWithReload(() => import('./components/AdminRanking').then((m) => ({ default: m.AdminRanking })));
const RewardLoadingScreen = lazyWithReload(() =>
  import('./components/RewardLoadingScreen').then((m) => ({ default: m.RewardLoadingScreen }))
);
const AUTH_REQUIRED_EVENT = 'genesis:auth-required';

function LazyRouteFallback() {
  return (
    <div className="flex min-h-[32vh] w-full items-center justify-center text-amber-500/90" aria-busy="true" aria-label="A carregar">
      <RefreshCw className="animate-spin" size={28} />
    </div>
  );
}

const TelegramIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size} aria-hidden>
    <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 1 0 24 0 12 12 0 0 0-12-12zm4.962 7.224c.1-.422.436-.698.795-.652l2.318.327c.36 0 .65.268.65.588 0 .12-.025.24-.065.358l-3.738 13.45c-.23.824-.704 1.03-1.38.644l-3.84-2.83-1.854 1.78c-.204.205-.376.376-.77.376-.244 0-.49-.11-.642-.355l-1.314-2.01-3.68-2.84c-.66-.54-.53-.978.11-1.46l14.378-8.284z" />
  </svg>
);

// --- GAME LOGIC HELPERS ---

/** Catálogo para stock / `stored_batteries.item_id` quando `batteryId` na rig é UUID (sem fallback para “primeira bateria”). */
function resolveEquippedBatteryCatalogId(
  batteryId: string | null | undefined,
  storedBatteries: StoredBattery[],
  upgrades: Upgrade[],
  hints?: Readonly<Record<string, string>> | null
): string | null {
  if (batteryId == null) return null;
  const bid = String(batteryId).trim();
  if (!bid) return null;
  const hinted = hints?.[bid] != null ? String(hints[bid]).trim() : '';
  if (hinted && upgrades.some((u) => u.id === hinted && u.type === 'battery')) return hinted;
  if (upgrades.some((u) => u.id === bid && u.type === 'battery')) return bid;
  const row = storedBatteries.find((b) => String(b.id) === bid);
  const cat = row?.itemId != null ? String(row.itemId).trim() : '';
  if (cat && upgrades.some((u) => u.id === cat && u.type === 'battery')) return cat;
  return null;
}

const calculateProduction = (placedRacks: PlacedRack[], upgradesList: Upgrade[]) => {
  let total = 0;
  placedRacks.forEach(rack => {
    if (rack.isOn && rack.wiringId && rack.batteryId) {
      let rackBaseProd = 0;
      rack.slots.forEach(slotItemId => {
        if (slotItemId) {
          const upgrade = upgradesList.find(u => u.id === slotItemId);
          if (upgrade) rackBaseProd += upgrade.baseProduction;
        }
      });
      let multiplierFactor = 1;
      rack.multiplierSlots?.forEach(slotItemId => {
        if (slotItemId) {
          const upgrade = upgradesList.find(u => u.id === slotItemId);
          if (upgrade && upgrade.multiplier) multiplierFactor += upgrade.multiplier;
        }
      });
      total += (rackBaseProd * multiplierFactor);
    }
  });
  return total;
};

const calculateRackConsumption = (rack: PlacedRack, upgradesList: Upgrade[]) => {
  let totalWatts = 0;
  rack.slots.forEach(slotItemId => {
    if (slotItemId) {
      const upgrade = upgradesList.find(u => u.id === slotItemId);
      if (upgrade && upgrade.powerConsumption) totalWatts += upgrade.powerConsumption;
    }
  });
  rack.multiplierSlots?.forEach(slotItemId => {
    if (slotItemId) {
      const upgrade = upgradesList.find(u => u.id === slotItemId);
      if (upgrade && upgrade.powerConsumption) totalWatts += upgrade.powerConsumption;
    }
  });
  return totalWatts;
};

const countActiveMachines = (placedRacks: PlacedRack[]) => {
  let count = 0;
  placedRacks.forEach(rack => {
    rack.slots.forEach(slot => { if (slot) count++; });
  });
  return count;
}

const INITIAL_STATE: GameState = {
  usdc: 0,
  startTime: Date.now(),
  stock: {},
  unopenedBoxes: {},
  storedBatteries: [],
  placedRacks: [],
  playerListings: [],
  coinBalances: {},
  claimedReferrals: 0,
  referralBonusClaimed: false,
  claimedBoxes: [],
  dailyActions: {}
};

const processLoadedState = (parsed: any, _userEmail: string): GameState => {
  const state = { ...INITIAL_STATE, ...parsed };

  if (!state.storedBatteries) state.storedBatteries = [];
  state.storedBatteries = (state.storedBatteries as unknown[]).map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const b = raw as Record<string, unknown>;
    const id = typeof b.id === 'string' ? b.id.trim() : '';
    const itemId =
      typeof b.itemId === 'string' ? b.itemId.trim() : typeof b.item_id === 'string' ? String(b.item_id).trim() : '';
    if (!id || !itemId) return null;
    return {
      id,
      itemId,
      displayName: typeof b.displayName === 'string' ? b.displayName : typeof b.display_name === 'string' ? String(b.display_name) : null,
      imageUrl: typeof b.imageUrl === 'string' ? b.imageUrl : typeof b.image_url === 'string' ? String(b.image_url) : null
    };
  }).filter(Boolean) as typeof state.storedBatteries;
  if (!state.playerListings) state.playerListings = [];
  if (!state.unopenedBoxes) state.unopenedBoxes = {};
  if (state.claimedReferrals === undefined) state.claimedReferrals = 0;
  if (state.referralBonusClaimed === undefined) state.referralBonusClaimed = false;
  if (!state.claimedBoxes) state.claimedBoxes = [];
  if (!state.dailyActions) state.dailyActions = {};
  const minedUsdRaw = parsed?.nftAsicMinedUsdTotal ?? parsed?.nft_asic_mined_usd_total;
  const minedUsdNum = Number(minedUsdRaw);
  state.nftAsicMinedUsdTotal =
    Number.isFinite(minedUsdNum) && minedUsdNum > 0 ? minedUsdNum : 0;
  if (Array.isArray(parsed?.asicLeases)) {
    state.asicLeases = parsed.asicLeases;
  }
  if (Array.isArray(parsed?.asicLeaseDetails)) {
    state.asicLeaseDetails = parsed.asicLeaseDetails;
  }

  if (state.placedRacks) {
    state.placedRacks = state.placedRacks.map((r: any) => {
      const isLegacyRack = !r.itemId || r.itemId === 'server_rack';
      const itemId = isLegacyRack ? 'rack_10u' : r.itemId;
      let multiSlots = r.multiplierSlots || [];
      if (isLegacyRack && multiSlots.length === 0) multiSlots = [null, null];
      return {
        ...r,
        itemId: itemId,
        wiringId: r.wiringId || null,
        batteryId: r.batteryId || null,
        multiplierSlots: multiSlots,
        isOn: r.isOn !== undefined ? r.isOn : false,
        roomId: normalizePlacedRackRoomId(r.roomId)
      }
    });
  }
  if (state.stock && state.stock['server_rack']) {
    state.stock['rack_10u'] = (state.stock['rack_10u'] || 0) + state.stock['server_rack'];
    delete state.stock['server_rack'];
  }

  return state;
};

type SaveGameApiResponse = Awaited<ReturnType<typeof apiSaveGameState>>;

/** Quando o servidor desmonta rigs ilegais na sala NFT AUTO, sincroniza ref + estado para não reaparecerem no próximo save. */
function applyNftAutoSanitizedClientSync(
  res: SaveGameApiResponse,
  gameStateRef: React.MutableRefObject<GameState>,
  setGameState: React.Dispatch<React.SetStateAction<GameState>>
) {
  if (!res || res.forceReload || res.ok === false) return;
  if (!res.nftAutoSanitized || !Array.isArray(res.placedRacks)) return;
  const next: GameState = {
    ...gameStateRef.current,
    placedRacks: res.placedRacks,
    stock: res.stock != null ? { ...res.stock } : { ...gameStateRef.current.stock },
    storedBatteries: Array.isArray(res.storedBatteries) ? res.storedBatteries : [...gameStateRef.current.storedBatteries]
  };
  gameStateRef.current = next;
  setGameState(next);
}

type View = 'servers' | 'inventory' | 'hardware_store' | 'black_market' | 'wallet' | 'withdrawal_history' | 'profile' | 'upgrade' | 'lucky_store' | 'roleta' | 'arcade' | 'calculator' | 'ranking' | 'transparency' | 'support' | 'partners' | 'partner_games' | 'offerwall' | 'dashboard';
type GlobalView =
  | 'home'
  | 'docs'
  | 'login'
  | 'register'
  | 'terms'
  | 'privacy'
  | 'cookies'
  | 'aml'
  | 'web3_risk'
  | 'refunds'
  | 'community'
  | 'auth'
  | 'game'
  | 'admin';

const VALID_GAME_VIEWS: readonly View[] = [
  'servers',
  'inventory',
  'hardware_store',
  'black_market',
  'wallet',
  'withdrawal_history',
  'profile',
  'upgrade',
  'lucky_store',
  'roleta',
  'arcade',
  'calculator',
  'ranking',
  'transparency',
  'support',
  'partners',
  'partner_games',
  'offerwall',
  'dashboard',
] as const;

function legalPathFromView(view: GlobalView): string {
  switch (view) {
    case 'login':
      return '/login';
    case 'register':
      return '/registro';
    case 'terms':
      return '/termos';
    case 'privacy':
      return '/privacidade';
    case 'cookies':
      return '/cookies';
    case 'aml':
      return '/aml-antifraude-kyc';
    case 'web3_risk':
      return '/risco-web3-cripto';
    case 'refunds':
      return '/reembolsos';
    case 'community':
      return '/conteudo-comunidade';
    case 'docs':
      return '/docs';
    case 'auth':
      return '/login';
    case 'home':
    default:
      return '/';
  }
}

function legalViewFromPath(pathname: string): GlobalView | null {
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (path === '/verificar-email' || path.startsWith('/verificar-email/')) return 'login';
  if (path === '/redefinir-senha' || path.startsWith('/redefinir-senha/')) return 'login';
  switch (path) {
    case '/':
      return 'home';
    case '/login':
      return 'login';
    case '/registro':
      return 'register';
    case '/docs':
      return 'docs';
    case '/auth':
      return 'login';
    case '/termos':
      return 'terms';
    case '/privacidade':
      return 'privacy';
    case '/cookies':
      return 'cookies';
    case '/aml-antifraude-kyc':
      return 'aml';
    case '/risco-web3-cripto':
      return 'web3_risk';
    case '/reembolsos':
      return 'refunds';
    case '/conteudo-comunidade':
      return 'community';
    default:
      return null;
  }
}

function adminPathFromLocation(pathname: string): string {
  const raw = String(pathname || '').replace(/\/+$/, '') || '/';
  const lower = raw.toLowerCase();
  if (lower === '/admin' || lower === '/admin/') return '/admin/dashboard';
  if (lower.startsWith('/admin/')) return raw;
  return '/admin/dashboard';
}

function parseSavedGameView(raw: string | null | undefined): View {
  if (!raw || typeof raw !== 'string') return 'servers';
  const t = raw.trim();
  return (VALID_GAME_VIEWS as readonly string[]).includes(t) ? (t as View) : 'servers';
}
/** Alinha o save ao domínio da rota canónica (`/servers`, `/inventory`). */
function gameSaveDomainFromView(v: View): 'full' | 'inventory' | 'servers' {
  if (v === 'servers') return 'servers';
  if (v === 'inventory') return 'inventory';
  return 'full';
}

/** Acento por separador — alinhado ao resto da UI (âmbar base + cores por módulo). */
type GameNavTabAccent = 'amber' | 'yellow' | 'red' | 'orange' | 'rose' | 'emerald' | 'sky' | 'violet';

function gameNavTabClass(isActive: boolean, accent: GameNavTabAccent): string {
  const base =
    'flex items-center gap-1.5 px-2.5 sm:px-3 py-2 rounded-xl text-[11px] sm:text-xs font-bold normal-case tracking-wide border transition-all duration-200 shrink-0';
  const inactive =
    'border-slate-700/80 text-slate-300 bg-slate-800/92 hover:bg-slate-700/95 hover:border-slate-500/80 hover:text-white';
  const active: Record<GameNavTabAccent, string> = {
    amber:
      'border-amber-400/65 text-amber-100 bg-gradient-to-b from-amber-700/80 to-[#17120b] shadow-[inset_0_1px_0_rgba(253,230,138,0.18)] ring-1 ring-amber-400/30',
    yellow:
      'border-yellow-500/60 text-yellow-100 bg-gradient-to-b from-yellow-700/80 to-[#17120b] ring-1 ring-yellow-400/30',
    red: 'border-red-400/60 text-red-100 bg-gradient-to-b from-red-700/75 to-[#170b0b] ring-1 ring-red-400/25',
    orange:
      'border-orange-400/60 text-orange-100 bg-gradient-to-b from-orange-700/75 to-[#17100a] ring-1 ring-orange-400/25',
    rose: 'border-rose-400/60 text-rose-100 bg-gradient-to-b from-rose-700/75 to-[#170b10] ring-1 ring-rose-400/25',
    emerald:
      'border-emerald-400/60 text-emerald-100 bg-gradient-to-b from-emerald-700/70 to-[#0b1511] ring-1 ring-emerald-400/25',
    sky: 'border-sky-400/60 text-sky-100 bg-gradient-to-b from-sky-700/70 to-[#09131a] ring-1 ring-sky-400/25',
    violet:
      'border-violet-400/60 text-violet-100 bg-gradient-to-b from-violet-700/70 to-[#110a17] ring-1 ring-violet-400/25'
  };
  return `${base} ${isActive ? active[accent] : inactive}`;
}

export default function App() {
  const resolveInitialPublicView = (): GlobalView => {
    if (typeof window === 'undefined') return 'home';
    const params = new URLSearchParams(window.location.search || '');
    const refCode = params.get('ref');
    if (refCode) {
      // Persiste o código de indicação imediatamente, antes de qualquer navegação
      try { sessionStorage.setItem('genesis_ref', refCode.slice(0, 64)); } catch { /* ignore */ }
      // Se o link é /?ref=CODE (raiz), redireciona para /registro mantendo o parâmetro
      const path = (window.location.pathname || '').toLowerCase().replace(/\/+$/, '') || '/';
      if (path === '/' || path === '') {
        try { window.history.replaceState({}, '', `/registro?ref=${encodeURIComponent(refCode.slice(0, 64))}`); } catch { /* ignore */ }
        return 'register';
      }
    }
    const path = (window.location.pathname || '').toLowerCase().replace(/\/+$/, '') || '/';
    const legalView = legalViewFromPath(path);
    return legalView || 'home';
  };
  const [user, setUser] = useState<User | null>(null);
  /** Admin operador (não super): sem calculadora mining no jogo; Relatórios/Web3 já restringidos no painel. */
  const isOperatorAdminOnly = useMemo(
    () => !!(user?.isAdmin && !user?.isSuperAdmin),
    [user?.isAdmin, user?.isSuperAdmin]
  );
  const [globalView, setGlobalView] = useState<GlobalView>(() => resolveInitialPublicView());
  const [timeOffset, setTimeOffset] = useState<number>(0);
  const [web3SettingsState, setWeb3SettingsState] = useState<Web3Settings | null>(null);
  const [monetizationSettings, setMonetizationSettings] = useState<MonetizationSettings | null>(null);

  // Game State
  const [gameState, setGameState] = useState<GameState>(INITIAL_STATE);
  const gameStateRef = useRef(gameState);
  /** UUID na rig (bateria tirada do stock) → id de catálogo até existir linha em `stored_batteries` após save/reload. */
  const rackBatteryFromStockCatalogRef = useRef<Map<string, string>>(new Map());
  const rackAuxIntentBusyRef = useRef(false);
  const rackPlaceBusyRef = useRef(false);
  const withdrawBusyRef = useRef(false);

  /** Sincroniza hints UUID→catálogo com `stored_batteries` (GET/recuperação) e remove chaves órfãs. */
  useEffect(() => {
    const seen = new Set<string>();
    for (const r of gameState.placedRacks) {
      const bid = r.batteryId != null ? String(r.batteryId).trim() : '';
      if (!bid) continue;
      seen.add(bid);
      const row = gameState.storedBatteries.find((b) => String(b.id).trim() === bid);
      const itemId = row?.itemId != null ? String(row.itemId).trim() : '';
      if (itemId) rackBatteryFromStockCatalogRef.current.set(bid, itemId);
    }
    for (const key of [...rackBatteryFromStockCatalogRef.current.keys()]) {
      if (!seen.has(key)) rackBatteryFromStockCatalogRef.current.delete(key);
    }
  }, [gameState.placedRacks, gameState.storedBatteries]);

  const handleRewardComplete = useCallback(() => {
    setShowRewardModal(false);
  }, []);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  /** Socket.IO (stack): tempo real paralelo ao WS legado do jogo. */
  useEffect(() => {
    const api = import.meta.env.VITE_API_URL?.trim();
    if (!api) return;
    const base = api.replace(/\/api\/?$/i, '');
    if (!base) return;
    useStackSocketStore.getState().connect(base);
    return () => {
      useStackSocketStore.getState().disconnect();
    };
  }, []);

  const [productionRate, setProductionRate] = useState(0);
  /** Hash por moeda + total vindos de `/ws/player-game` (BD). `null` = usar só cálculo local. */
  const [livePlayerGameWs, setLivePlayerGameWs] = useState<{
    hashByCoinId: Record<string, number>;
    totalHash: number;
  } | null>(null);
  const [currentView, setCurrentView] = useState<View>(() => {
    try {
      if (typeof window !== 'undefined') {
        const fromPath = gameViewFromEnglishPathname(window.location.pathname);
        if (fromPath) return fromPath as View;
      }
      return parseSavedGameView(sessionStorage.getItem('lastView'));
    } catch {
      return 'servers';
    }
  });
  const [depositPrefill, setDepositPrefill] = useState<number | undefined>(undefined);
  const [saveLoaded, setSaveLoaded] = useState<boolean>(false);
  /** Erro ao carregar `/api/game-state/me` (UI de retry em vez de spinner infinito). */
  const [gameStateLoadError, setGameStateLoadError] = useState<string | null>(null);
  const [gameStateReloadNonce, setGameStateReloadNonce] = useState(0);

  const gameSaveLoadIsAdmin = !!user?.isAdmin;
  /**
   * Chave para efeitos de load/save: email preferido; senão `id` da sessão.
   * Contas com email vazio na BD deixavam `gameSaveLoadKey` vazio → o efeito saía cedo e nunca
   * chamava GET `/api/game-state/me` → spinner infinito ("Carregando estado…") em `/servers`, etc.
   */
  const gameSaveLoadKey = useMemo(() => {
    const em = user?.email?.trim();
    if (em) return em;
    const id = user?.id != null ? String(user.id).trim() : '';
    if (id) return id;
    return '';
  }, [user?.email, user?.id]);
  /** Rótulo para IDs estáveis na oficina (`ws_*`) quando não há email. */
  const gameStateProcessLabel = useMemo(
    () => user?.email?.trim() || user?.username?.trim() || String(user?.id || 'player'),
    [user?.email, user?.username, user?.id]
  );

  useEffect(() => {
    sessionStorage.setItem('lastView', currentView);
  }, [currentView]);

  /** GA4: `page_path` alinhado às rotas em inglês do jogo. */
  useEffect(() => {
    const path = (typeof window !== 'undefined' ? window.location.pathname : '').toLowerCase();
    const isSensitiveAuthPath =
      path.startsWith('/login') ||
      path.startsWith('/registro') ||
      path.startsWith('/verificar-email') ||
      path.startsWith('/redefinir-senha');
    if (isSensitiveAuthPath) return;
    if (globalView === 'game') {
      trackSpaPageView(gamePathFromView(currentView as GamePathView), `Genesis Miner — ${currentView}`);
    } else {
      const titles: Record<GlobalView, string> = {
        home: 'Genesis Miner — Início',
        docs: 'Genesis Miner — Documentação',
        login: 'Genesis Miner — Login',
        register: 'Genesis Miner — Registro',
        terms: 'Genesis Miner — Termos de Uso',
        privacy: 'Genesis Miner — Política de Privacidade',
        cookies: 'Genesis Miner — Política de Cookies',
        aml: 'Genesis Miner — Política de AML / Antifraude / KYC',
        web3_risk: 'Genesis Miner — Aviso de Risco Web3 / Cripto',
        refunds: 'Genesis Miner — Política de Reembolsos',
        community: 'Genesis Miner — Política de Conteúdo e Comunidade',
        auth: 'Genesis Miner — Login',
        game: 'Genesis Miner — Jogo',
        admin: 'Genesis Miner — Admin'
      };
      trackSpaPageView(`/${globalView}`, titles[globalView]);
    }
  }, [globalView, currentView]);

  useEffect(() => {
    if (isOperatorAdminOnly && currentView === 'calculator') {
      setCurrentView('servers');
    }
  }, [isOperatorAdminOnly, currentView]);

  // Dynamic Data
  const [gameUpgrades, setGameUpgrades] = useState<Upgrade[]>([]);
  const isReady = saveLoaded && gameUpgrades.length > 0;

  const [accessLevels, setAccessLevels] = useState<AccessLevel[]>([]);
  const [gameNavLabels, setGameNavLabels] = useState(() => ({ ...DEFAULT_GAME_NAV_LABELS }));
  /** Separador «Roleta» no menu: controlado em Definições → Rótulos (`nav.roleta_tab_visible`). */
  const [showRoletaInNav, setShowRoletaInNav] = useState(true);

  const [lootBoxDefs, setLootBoxDefs] = useState<LootBox[]>([]);
  const [miningCoins, setMiningCoins] = useState<MiningCoin[]>([]);
  const [coinsExpanded, setCoinsExpanded] = useState<boolean>(false);
  const [highlightedCoinId, setHighlightedCoinId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const GAME_NAV_EXPANDED_LS = 'minestation.gameNavExpanded';
  const [gameNavExpanded, setGameNavExpanded] = useState(() => {
    try {
      const v = localStorage.getItem(GAME_NAV_EXPANDED_LS);
      if (v === '0') return false;
      if (v === '1') return true;
    } catch {
      /* ignore */
    }
    return true;
  });
  const toggleGameNavExpanded = useCallback(() => {
    setGameNavExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(GAME_NAV_EXPANDED_LS, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const collapseGameNav = useCallback(() => {
    setGameNavExpanded(false);
    try {
      localStorage.setItem(GAME_NAV_EXPANDED_LS, '0');
    } catch {
      /* ignore */
    }
  }, []);
  const [economySettings, setEconomySettings] = useState<EconomySettings>({
    hardwareMarketEnabled: true,
    blackMarketEnabled: true,
    marketTaxPercent: 0,
    blackMarketPriceBandPercent: 20
  });
  const [showRewardModal, setShowRewardModal] = useState(false);
  const [offlineStats, setOfflineStats] = useState<Record<string, number>>({});
  const [pendingRewardSummary, setPendingRewardSummary] = useState<{ id: string, name: string, count: number }[]>([]);
  const [marketRefreshTrigger, setMarketRefreshTrigger] = useState(0);
  const [saveTrigger, setSaveTrigger] = useState(0);
  const currentViewRef = useRef<View>(currentView);
  const gamePathHydratedRef = useRef(false);
  const pendingSaveDomainRef = useRef<'full' | 'inventory' | 'servers'>('full');
  /**
   * Geração lógica de mutações autoritativas (Servidores). Cada intent bem-sucedida
   * incrementa este contador para que `runPlayerSaveWithRetries` possa descartar saves legados
   * em voo que capturaram um snapshot anterior (evita reintroduzir GPUs já libertadas do slot).
   */
  const serverIntentMutationGenRef = useRef(0);
  /** Sinaliza ao debounce que não há mais saves legados úteis enquanto não houver nova alteração. */
  const skipNextLegacySaveRef = useRef(false);
  /** Geração de pedido GET inventário — descarta respostas atrasadas ao mudar de separador. */
  const inventoryMeRequestGenRef = useRef(0);
  /** Baterias UUID infinitas em armazém conforme o servidor; `null` = ainda não hidratado nesta visita ao Estoque. */
  const [inventoryBatteries, setInventoryBatteries] = useState<StoredBattery[] | null>(null);
  /** Categorias de itens empilháveis vindas de `GET /api/inventory/state`; `null` = usar derivação local no `InventoryView`. */
  const [inventoryStackableCategories, setInventoryStackableCategories] = useState<InventoryStackableCategoryApi[] | null>(
    null
  );

  useEffect(() => {
    currentViewRef.current = currentView;
  }, [currentView]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!mobileMenuOpen) {
      document.body.style.overflow = '';
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (currentView !== 'inventory') {
      setInventoryBatteries(null);
      setInventoryStackableCategories(null);
    }
  }, [currentView]);

  useEffect(() => {
    if (currentView !== 'inventory' || !saveLoaded || !user || user.isAdmin || !gameSaveLoadKey) return;

    const gen = ++inventoryMeRequestGenRef.current;
    let cancelled = false;

    void (async () => {
      try {
        const r = await getPlayerInventoryState();
        if (cancelled || gen !== inventoryMeRequestGenRef.current) return;
        if (r.ok === true) {
          setInventoryBatteries(r.storedBatteries);
          setInventoryStackableCategories(r.stackableCategories);
          gpuDupLog('inventory_load', {
            stockSnapshot: Object.fromEntries(
              Object.entries(r.stock || {}).filter(([, v]) => Number(v) > 0)
            ),
            intentGen: serverIntentMutationGenRef.current
          });
          setGameState((p) => ({
            ...p,
            stock: { ...r.stock },
            storedBatteries: r.storedBatteries
          }));
          return;
        }
        const m = await getPlayerInventoryMe();
        if (cancelled || gen !== inventoryMeRequestGenRef.current) return;
        if (m.ok !== true) {
          console.warn('[inventory]', r.status, r.error || '', m.status, m.error || '');
          setInventoryStackableCategories(null);
          return;
        }
        setInventoryBatteries(m.storedBatteries);
        setInventoryStackableCategories(null);
        setGameState((p) => ({
          ...p,
          stock: { ...m.stock },
          storedBatteries: m.storedBatteries
        }));
      } catch (e) {
        console.error('[inventory]', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentView, saveLoaded, user?.id, user?.isAdmin, gameSaveLoadKey]);

  const [verticalAds, setVerticalAds] = useState<SystemNews[]>([]);
  const [bulkBatteryNotice, setBulkBatteryNotice] = useState<{ title: string; message: string } | null>(null);
  const [hardwareShopNotice, setHardwareShopNotice] = useState<UiNotice | null>(null);
  const [luckyBoxNotice, setLuckyBoxNotice] = useState<UiNotice | null>(null);
  /** Passa código à Roleta após resgate em Caixas (consumido pelo `RoletaPage`). */
  const [roletaBootstrap, setRoletaBootstrap] = useState<{ v: number; code: string } | null>(null);

  const requestSave = useCallback((domainOverride?: 'full' | 'inventory' | 'servers') => {
    pendingSaveDomainRef.current = domainOverride ?? gameSaveDomainFromView(currentViewRef.current);
    setSaveTrigger((prev) => prev + 1);
  }, []);

  const handleReloadGameState = useCallback(async (newBoxes?: Record<string, number>) => {
    if (!user) return;

    if (newBoxes) {
      setGameState(p => ({ ...p, unopenedBoxes: newBoxes }));
    }

    /**
     * Recarrega também o catálogo de loot boxes: a compra de pacotes em /upgrades cria
     * caixas dinâmicas (`upgrade_pkg_*`) que precisam aparecer no inventário imediatamente.
     */
    const [gs, freshUpgrades, freshLootBoxes] = await Promise.all([
      apiGetGameState('me'),
      getUpgrades(),
      getLootBoxes()
    ]);
    const { data } = gs;
    if (data) {
      const label =
        user.email?.trim() || user.username?.trim() || String(user.id || 'player');
      const parsed = processLoadedState(data, label);
      rackBatteryFromStockCatalogRef.current.clear();
      setGameState(parsed);
    }
    if (Array.isArray(freshUpgrades)) {
      setGameUpgrades(freshUpgrades);
    }
    if (Array.isArray(freshLootBoxes)) {
      setLootBoxDefs(freshLootBoxes);
    }
  }, [user]);

  /** Save completo + retentativas em falhas transitórias (502/522/rede). Usado pelo debounce e pelo auto-save. */
  const runPlayerSaveWithRetries = useCallback(
    async (showAlertOnHardFail: boolean) => {
      const saveKey = user?.email?.trim() || (user?.id != null ? String(user.id) : '');
      if (!saveKey || user.isAdmin) return;

      const transientSaveError = (msg: string) =>
        /502|503|504|522|network|fetch|failed|timeout|econnreset|socket/i.test(String(msg || ''));

      const domain = pendingSaveDomainRef.current;
      const startGen = serverIntentMutationGenRef.current;
      gpuDupLog('legacy_save_start', { domain, intentGen: startGen });
      for (let attempt = 0; attempt < 3; attempt++) {
        const payloadSnapshot = gameStateRef.current;
        gpuDupLog('legacy_save_payload', {
          domain,
          attempt,
          intentGen: startGen,
          placedRacksCount: payloadSnapshot.placedRacks?.length ?? 0,
          stockKeys: Object.keys(payloadSnapshot.stock || {}).length
        });
        const res = await apiSaveGameState(saveKey, payloadSnapshot, {
          domain: domain === 'full' ? undefined : domain
        });
        // Se uma mutação autoritativa de Servidores ocorreu durante este save legado, descarta
        // qualquer eco de estado (mesmo NFT-AUTO sanitised) — o servidor já é fonte da verdade.
        const staleByIntent = serverIntentMutationGenRef.current !== startGen;
        if (res && res.forceReload) {
          pendingSaveDomainRef.current = 'full';
          gpuDupLog('legacy_save_end', { result: 'forceReload', attempt, staleByIntent });
          await handleReloadGameState();
          return;
        }
        if (res && res.ok === false) {
          const errMsg = String((res as { error?: string }).error || '');
          const errCode = String((res as { code?: string }).code || '');
          if (attempt < 2 && transientSaveError(errMsg)) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            continue;
          }
          console.error('[SaveGame]', errCode || errMsg);
          gpuDupLog('legacy_save_end', { result: 'error', code: errCode, attempt, staleByIntent });
          if (showAlertOnHardFail) {
            if (errCode === 'LEGACY_SAVEGAME_CRITICAL_REJECTED') {
              alert(
                'O servidor recusou um pedido legado que alterava estado crítico. Recarregámos o estado; use só as acções do jogo suportadas (intenções / rotas novas).'
              );
            } else if (errCode === 'STATE_VERSION_CONFLICT') {
              // Caso esperado quando há corrida com mutação autoritativa de Servidores/Oficina:
              // não alarmar o utilizador — o reload abaixo já sincroniza o estado.
              console.warn('[SaveGame] STATE_VERSION_CONFLICT — A recarregar o estado.');
            } else if (errCode === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
              alert('Conflito de idempotência: não reutilize a mesma chave com um pedido diferente.');
            } else {
              alert('Não foi possível guardar: ' + errMsg + '\nA recarregar o estado do servidor.');
            }
          }
          pendingSaveDomainRef.current = 'full';
          await handleReloadGameState();
          return;
        }
        if (!staleByIntent) {
          applyNftAutoSanitizedClientSync(res, gameStateRef, setGameState);
        }
        gpuDupLog('legacy_save_end', { result: 'ok', attempt, staleByIntent });
        pendingSaveDomainRef.current = 'full';
        return;
      }
    },
    [user, handleReloadGameState]
  );

  // Structural Save Effect (for user actions)
  useEffect(() => {
    const canAutosave =
      Boolean(user?.email?.trim()) || (user?.id != null && String(user.id).trim() !== '');
    if (saveTrigger === 0 || !canAutosave || user.isAdmin || !saveLoaded) return;
    // Mutação autoritativa (Servidores/Oficina) já gravou o estado no servidor e devolveu o snapshot:
    // qualquer save legado em fila usaria um snapshot anterior e re-introduziria slots/stock obsoletos.
    if (skipNextLegacySaveRef.current) {
      skipNextLegacySaveRef.current = false;
      pendingSaveDomainRef.current = 'full';
      gpuDupLog('legacy_save_skipped_after_intent', { intentGen: serverIntentMutationGenRef.current });
      return;
    }
    const timeout = setTimeout(() => {
      void runPlayerSaveWithRetries(true);
    }, 500); // 500ms debounce
    return () => clearTimeout(timeout);
  }, [saveTrigger, user, saveLoaded, runPlayerSaveWithRetries]);

  // Removido save completo em `beforeunload`: enviar o jogo inteiro ao fechar o separador era
  // payload legado perigoso (race com outra aba / estado velho). Estado real vem do backend no próximo load.
  const DEFAULT_ALLOWED_PAGES = [
    'servers',
    'inventory',
    'arcade',
    'ranking',
    'hardware_store',
    'black_market',
    'lucky_store',
    'wallet',
    'withdrawal_history',
    'upgrade',
    'profile',
    'transparency',
    'support',
    'partners'
  ] as const;

  const getAllowedPages = (): string[] => {
    const userLvls = user?.accessLevelIds || (user?.accessLevelId ? [user.accessLevelId] : []);
    let pages: string[];
    if (userLvls.length === 0) {
      const defaultLvl = accessLevels.find((l) => l.id === (user?.accessLevelId || ''));
      pages = Array.isArray(defaultLvl?.allowedPages)
        ? [...defaultLvl.allowedPages]
        : [...DEFAULT_ALLOWED_PAGES];
    } else {
      const allAllowed = new Set<string>();
      let hasExplicitConfig = false;
      userLvls.forEach((lid) => {
        const lvl = accessLevels.find((l) => l.id === lid);
        if (lvl && Array.isArray(lvl.allowedPages)) {
          hasExplicitConfig = true;
          lvl.allowedPages.forEach((p) => allAllowed.add(p));
        }
      });
      pages = hasExplicitConfig ? Array.from(allAllowed) : [...DEFAULT_ALLOWED_PAGES];
    }
    // `oficina` foi descontinuada: nunca expor mesmo se algum allowedPages legado ainda contiver o id.
    pages = pages.filter((p) => p !== 'oficina');
    // Estas áreas devem continuar acessíveis no menu do jogo para todos os jogadores autenticados.
    if (!pages.includes('partners')) {
      pages = [...pages, 'partners'];
    }
    return pages;
  };

  /** Evita ecrã em branco se `lastView` ou permissões mudarem (ex.: roleta sem `lucky_store`). */
  useEffect(() => {
    if (!saveLoaded || !user || user.isAdmin) return;
    const pages = getAllowedPages();
    const gated: Array<{ view: View; requiredPage: string }> = [
      { view: 'roleta', requiredPage: 'roleta' },
      { view: 'transparency', requiredPage: 'transparency' },
      { view: 'support', requiredPage: 'support' },
      { view: 'partners', requiredPage: 'partners' },
    ];
    for (const { view, requiredPage } of gated) {
      if (currentView === view && !pages.includes(requiredPage)) {
        setCurrentView('servers');
        break;
      }
    }
  }, [saveLoaded, user, currentView, accessLevels, economySettings.blackMarketEnabled]);

  /** Cada ecrã do jogo = URL própria no histórico (`pushState`): partilhável e botão «atrás». */
  const goToGameView = useCallback(
    (view: View) => {
      if (typeof window === 'undefined') return;
      if (globalView !== 'game' || !user) return;
      const next = gamePathFromView(view as GamePathView);
      if (window.location.pathname !== next) {
        window.history.pushState(window.history.state ?? null, '', next);
      }
      setCurrentView(view);
    },
    [globalView, user]
  );

  const openRoletaWithCode = useCallback(
    (code: string) => {
      const t = String(code || '').trim();
      if (!t) return;
      setRoletaBootstrap((prev) => ({ v: (prev?.v ?? 0) + 1, code: t }));
      goToGameView('roleta');
    },
    [goToGameView]
  );

  const clearRoletaBootstrap = useCallback(() => {
    setRoletaBootstrap(null);
  }, []);

  /** Alinha URL ao `currentView` quando o estado muda sem `goToGameView` (ex.: redirect, load). */
  useEffect(() => {
    if (globalView !== 'game' || !user) return;
    const next = gamePathFromView(currentView as GamePathView);
    if (typeof window !== 'undefined' && window.location.pathname !== next) {
      window.history.replaceState(null, '', next);
    }
  }, [currentView, globalView, user]);

  useEffect(() => {
    if (globalView === 'game') return;
    gamePathHydratedRef.current = false;
    if (typeof window !== 'undefined') {
      if (isEnglishGameSpaPath(window.location.pathname)) {
        window.history.replaceState(null, '', '/');
      }
    }
  }, [globalView]);

  useEffect(() => {
    if (!user) return;
    const syncFromPath = () => {
      if (globalView !== 'game' || !saveLoaded) return;
      const fromUrl = gameViewFromEnglishPathname(window.location.pathname);
      const allowed = getAllowedPages();
      const calcOk = !isOperatorAdminOnly;
      const ok = (v: View) =>
        v === 'calculator' ? calcOk : v === 'dashboard' ? true : allowed.includes(v);
      if (fromUrl && ok(fromUrl)) {
        setCurrentView((prev) => (fromUrl !== prev ? fromUrl : prev));
        return;
      }
      if (fromUrl && !ok(fromUrl)) {
        setCurrentView('servers');
        if (typeof window !== 'undefined' && window.location.pathname !== gamePathFromView('servers')) {
          window.history.replaceState(null, '', gamePathFromView('servers'));
        }
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', syncFromPath);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('popstate', syncFromPath);
      }
    };
  }, [user, globalView, saveLoaded, accessLevels, economySettings, isOperatorAdminOnly]);

  useEffect(() => {
    if (!saveLoaded || !user || globalView !== 'game') return;
    if (gamePathHydratedRef.current) return;
    gamePathHydratedRef.current = true;
    const fromUrl = gameViewFromEnglishPathname(window.location.pathname);
    const allowed = getAllowedPages();
    const calcOk = !isOperatorAdminOnly;
    const ok = (v: View) =>
      v === 'calculator' ? calcOk : v === 'dashboard' ? true : allowed.includes(v);
    if (fromUrl && ok(fromUrl)) {
      setCurrentView((prev) => (fromUrl !== prev ? fromUrl : prev));
      return;
    }
    if (fromUrl && !ok(fromUrl)) {
      setCurrentView('servers');
      if (typeof window !== 'undefined' && window.location.pathname !== gamePathFromView('servers')) {
        window.history.replaceState(null, '', gamePathFromView('servers'));
      }
    }
  }, [saveLoaded, user, globalView, accessLevels, economySettings, isOperatorAdminOnly]);

  const gameNav = useCallback((k: GameNavLabelKey) => {
    const t = gameNavLabels[k];
    return typeof t === 'string' && t.trim() ? t.trim() : DEFAULT_GAME_NAV_LABELS[k];
  }, [gameNavLabels]);

  const navigateGlobalView = useCallback(
    (view: GlobalView, opts?: { authMode?: 'login' | 'register'; replace?: boolean }) => {
      const resolvedView =
        view === 'auth' ? (opts?.authMode === 'register' ? 'register' : 'login') : view;
      if (typeof window === 'undefined' || resolvedView === 'game' || resolvedView === 'admin') return;
      const nextUrl = legalPathFromView(resolvedView);
      const currentUrl = `${window.location.pathname}${window.location.search}`;

      setGlobalView(resolvedView);
      if (currentUrl !== nextUrl) {
        if (opts?.replace) window.history.replaceState(null, '', nextUrl);
        else window.history.pushState(window.history.state ?? null, '', nextUrl);
      }
    },
    [globalView, user]
  );

  const handleExpiredSession = useCallback(async () => {
    const currentPath =
      typeof window !== 'undefined'
        ? (window.location.pathname || '').toLowerCase().replace(/\/+$/, '') || '/'
        : '/';
    const isProtectedPath =
      currentPath === '/admin' ||
      currentPath.startsWith('/admin/') ||
      gameViewFromEnglishPathname(currentPath) != null ||
      isEnglishGameSpaPath(currentPath);

    rackBatteryFromStockCatalogRef.current.clear();
    setUser(null);
    setGameState(INITIAL_STATE);
    setSaveLoaded(false);
    setGameStateLoadError(isProtectedPath ? 'Sessão expirada. Faça login novamente.' : null);
    setGlobalView(isProtectedPath ? 'login' : (legalViewFromPath(currentPath) || 'home'));
    try {
      await apiLogout();
    } catch {
      /* ignore */
    }
    if (typeof window !== 'undefined' && isProtectedPath) {
      const nextUrl = legalPathFromView('login');
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      if (currentUrl !== nextUrl) window.location.replace(nextUrl);
    }
  }, []);

  type GameNavSectionKey = 'operacao' | 'economia' | 'hub';
  type GameNavItem = {
    key: View;
    label: string;
    icon: typeof Server;
    accent: GameNavTabAccent;
    section: GameNavSectionKey;
    allowed: boolean;
  };

  const gameNavSectionLabels: Record<GameNavSectionKey, string> = {
    operacao: 'Operação',
    economia: 'Economia',
    hub: 'Hub'
  };

  const gameNavItems = useMemo<GameNavItem[]>(() => {
    const allowedPages = getAllowedPages();
    const has = (page: string) => allowedPages.includes(page);
    const items: GameNavItem[] = [
      { key: 'servers', label: gameNav('servers'), icon: Server, accent: 'amber', section: 'operacao', allowed: has('servers') },
      { key: 'profile', label: 'Perfil', icon: UserIcon, accent: 'sky', section: 'operacao', allowed: !!user },
      { key: 'inventory', label: gameNav('inventory'), icon: Package, accent: 'yellow', section: 'operacao', allowed: has('inventory') },
      {
        key: 'hardware_store',
        label: gameNav('hardware_store'),
        icon: ShoppingCart,
        accent: 'amber',
        section: 'operacao',
        allowed: has('hardware_store')
      },
      { key: 'upgrade', label: gameNav('upgrade'), icon: Crown, accent: 'yellow', section: 'operacao', allowed: has('upgrade') },
      {
        key: 'black_market',
        label: gameNav('black_market'),
        icon: Skull,
        accent: 'red',
        section: 'economia',
        allowed: has('black_market')
      },
      {
        key: 'lucky_store',
        label: gameNav('lucky_store'),
        icon: Gift,
        accent: 'orange',
        section: 'economia',
        allowed: has('lucky_store')
      },
      { key: 'wallet', label: gameNav('wallet'), icon: Wallet, accent: 'orange', section: 'economia', allowed: has('wallet') },
      { key: 'ranking', label: gameNav('ranking'), icon: Trophy, accent: 'yellow', section: 'economia', allowed: has('ranking') },
      {
        key: 'calculator',
        label: 'Calculadora',
        icon: Wrench,
        accent: 'yellow',
        section: 'economia',
        allowed: !isOperatorAdminOnly
      },
      {
        key: 'transparency',
        label: gameNav('transparency'),
        icon: Scale,
        accent: 'emerald',
        section: 'hub',
        allowed: has('transparency')
      },
      { key: 'support', label: gameNav('support'), icon: LifeBuoy, accent: 'sky', section: 'hub', allowed: has('support') },
      { key: 'partners', label: gameNav('partners'), icon: Clapperboard, accent: 'violet', section: 'hub', allowed: !!user },
      { key: 'offerwall', label: gameNav('offerwall'), icon: Coins, accent: 'emerald', section: 'hub', allowed: !!user },
      { key: 'arcade', label: gameNav('arcade'), icon: Gamepad2, accent: 'amber', section: 'hub', allowed: has('arcade') },
      {
        key: 'roleta',
        label: gameNav('roleta'),
        icon: Sparkles,
        accent: 'rose',
        section: 'hub',
        allowed: has('roleta') && showRoletaInNav
      }
    ];
    return items.filter((item) => item.allowed);
  }, [gameNav, getAllowedPages, isOperatorAdminOnly, showRoletaInNav, user]);

  const updateGameUpgrades = async (newUpgrades: Upgrade[]) => {
    try {
      await apiSetUpgrades(newUpgrades);
      const fresh = await getUpgrades();
      setGameUpgrades(fresh.length > 0 ? fresh : newUpgrades);
    } catch (e: any) {
      console.error('Failed to save upgrades:', e);
      throw e; // Propagate to caller (AdminPanel -> AdminEditor)
    }
  };

  const updateAccessLevels = async (newLevels: AccessLevel[]) => {
    try {
      setAccessLevels(newLevels);
      await apiSetAccessLevels(newLevels);
    } catch (e: any) {
      console.error('Failed to save access levels:', e);
      alert('Erro ao salvar níveis de acesso: ' + (e.message || 'Erro desconhecido'));
    }
  };

  const updateLootBoxes = async (newBoxes: LootBox[]) => {
    try {
      setLootBoxDefs(newBoxes);
      const { warnings } = await apiSetLootBoxes(newBoxes, { replaceCatalog: true });
      const fresh = await getLootBoxes();
      setLootBoxDefs(fresh);
      if (warnings && warnings.length > 0) {
        alert('Caixas gravadas. Aviso do servidor:\n\n' + warnings.join('\n\n'));
      }
    } catch (e: any) {
      console.error('Failed to save loot boxes:', e);
      alert('Erro ao salvar as caixas: ' + (e.message || 'Erro desconhecido'));
      const fresh = await getLootBoxes();
      setLootBoxDefs(fresh);
    }
  };

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let handling = false;
    const onAuthRequired = () => {
      if (handling) return;
      handling = true;
      void handleExpiredSession().finally(() => {
        handling = false;
      });
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    };
  }, [handleExpiredSession]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const path = (window.location.pathname || '').toLowerCase().replace(/\/+$/, '');
        const isAdminUrl = path === '/admin' || path.startsWith('/admin/');
        const isPasswordResetUrl = path === '/redefinir-senha' || path.startsWith('/redefinir-senha/');
        const isEmailVerificationUrl = path === '/verificar-email' || path.startsWith('/verificar-email/');
        const legalView = legalViewFromPath(path);

        const [sess, ms, timeRes] = await Promise.all([
          getSession(),
          getMonetizationSettings(),
          getServerTime()
        ]);
        if (cancelled) return;

        const serverTime =
          timeRes && typeof (timeRes as { serverTime?: unknown }).serverTime === 'number'
            ? (timeRes as { serverTime: number }).serverTime
            : Date.now();

        if (sess) {
          setUser(sess);
          if (isPasswordResetUrl || isEmailVerificationUrl) setGlobalView('login');
          else if (isAdminUrl) setGlobalView(sess.isAdmin ? 'admin' : 'game');
          else if (legalView === 'login' || legalView === 'register' || legalView === 'auth') {
            // Sessão já válida nunca deve ficar "presa" na tela de login/cadastro.
            setGlobalView(sess.isAdmin ? 'admin' : 'game');
          } else if (legalView && legalView !== 'home') setGlobalView(legalView);
          else setGlobalView(sess.isAdmin ? 'admin' : 'game');
        } else {
          setUser(null);
          if (isAdminUrl || isPasswordResetUrl || isEmailVerificationUrl) setGlobalView('login');
          else if (legalView) setGlobalView(legalView);
          else setGlobalView('home');
        }
        if (ms) setMonetizationSettings(ms);
        setTimeOffset(serverTime - Date.now());
      } catch (e) {
        console.error('[SessionInit]', e);
        if (!cancelled) {
          const path = (window.location.pathname || '').toLowerCase().replace(/\/+$/, '') || '/';
          const isAdminUrl = path === '/admin' || path.startsWith('/admin/');
          const legalView = legalViewFromPath(path);
          setUser(null);
          setGlobalView(isAdminUrl ? 'login' : (legalView || 'home'));
          setTimeOffset(0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (globalView === 'game' || globalView === 'admin') return;
    const currentPath = (window.location.pathname || '').replace(/\/+$/, '') || '/';
    if (currentPath.startsWith('/verificar-email') || currentPath.startsWith('/redefinir-senha')) return;
    const nextPath = legalPathFromView(globalView);
    if (currentPath !== nextPath) {
      window.history.replaceState(null, '', nextPath);
    }
  }, [globalView]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (globalView !== 'admin' || !user?.isAdmin) return;
    const current = (window.location.pathname || '').replace(/\/+$/, '') || '/';
    const next = adminPathFromLocation(current);
    if (current !== next) {
      window.history.replaceState(null, '', next);
    }
  }, [globalView, user?.isAdmin]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      const path = (window.location.pathname || '').toLowerCase().replace(/\/+$/, '') || '/';
      const isAdminUrl = path === '/admin' || path.startsWith('/admin/');
      if (isAdminUrl) {
        setGlobalView(user?.isAdmin ? 'admin' : 'login');
        return;
      }
      const legalView = legalViewFromPath(path);
      if (legalView) {
        setGlobalView(legalView);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [user?.isAdmin]);

  // Seed dynamic data from DB (um GET /api/bootstrap em vez de 8 pedidos em paralelo)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const boot = await getPublicBootstrap();
        if (cancelled) return;
        if (boot) {
          console.log('[Init] Loaded (bootstrap):', {
            up: boot.upgrades.length,
            lv: boot.accessLevels.length,
            lb: boot.lootBoxes.length,
            mc: boot.miningCoins.length
          });
          setGameUpgrades(boot.upgrades);
          setAccessLevels(boot.accessLevels);
          setLootBoxDefs(boot.lootBoxes);
          setMiningCoins(boot.miningCoins);
          if (boot.economySettings) setEconomySettings(boot.economySettings);
          if (boot.web3Settings) setWeb3SettingsState(boot.web3Settings);
          setVerticalAds(boot.systemNews.filter((n) => n.adType === 'vertical' && n.active));
          setGameNavLabels({ ...DEFAULT_GAME_NAV_LABELS, ...boot.gameNavLabels });
          setShowRoletaInNav(boot.showRoletaInNav !== false);
          return;
        }
        const [up, lv, lb, mc, econ, web3, news, navLab] = await Promise.all([
          getUpgrades(),
          getAccessLevels(),
          getLootBoxes(),
          getMiningCoins(),
          getEconomySettings(),
          getWeb3Settings(),
          getSystemNews(),
          getGameNavLabels()
        ]);
        if (cancelled) return;
        console.log('[Init] Loaded (fallback):', { up: up.length, lv: lv.length, lb: lb.length, mc: mc.length });
        setGameUpgrades(up);
        setAccessLevels(lv);
        setLootBoxDefs(lb);
        setMiningCoins(mc);
        if (econ) setEconomySettings(econ);
        if (web3) setWeb3SettingsState(web3);
        setVerticalAds(news.filter((n) => n.adType === 'vertical' && n.active));
        setGameNavLabels({ ...DEFAULT_GAME_NAV_LABELS, ...navLab });
        setShowRoletaInNav(true);
      } catch (e) {
        console.error('[Init] Fatal Error loading initial data:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-fetch upgrades if user is authenticated but gameUpgrades is empty (e.g., JWT expired at bootstrap time)
  useEffect(() => {
    if (!user || user.isAdmin || gameUpgrades.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const ups = await getUpgrades();
        if (!cancelled && Array.isArray(ups) && ups.length > 0) {
          setGameUpgrades(ups);
        }
      } catch {
        /* silent — fallback optional */
      }
    })();
    return () => { cancelled = true; };
  }, [user, gameUpgrades.length]);

  // WebSocket: cabeçalho do jogo — saldos (coin_balances + USDC) e hashrate alinhados à BD (~3,5s)
  useEffect(() => {
    if (!user || user.isAdmin || globalView !== 'game' || !saveLoaded) {
      setLivePlayerGameWs(null);
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws/player-game`;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(url);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as {
            type?: string;
            event?: string;
            data?: {
              coinBalances?: Record<string, number>;
              usdc?: number;
              hashByCoinId?: Record<string, number>;
              totalHash?: number;
            };
          };
          if (msg.type !== 'player_game' || msg.event !== 'tick' || !msg.data) return;
          const d = msg.data;
          const hashByCoinId =
            d.hashByCoinId && typeof d.hashByCoinId === 'object' && !Array.isArray(d.hashByCoinId)
              ? d.hashByCoinId
              : {};
          const totalHash = typeof d.totalHash === 'number' && Number.isFinite(d.totalHash) ? d.totalHash : 0;
          setLivePlayerGameWs({ hashByCoinId, totalHash });
          setGameState((prev) => {
            const nextCb =
              d.coinBalances && typeof d.coinBalances === 'object' && !Array.isArray(d.coinBalances)
                ? { ...prev.coinBalances, ...d.coinBalances }
                : prev.coinBalances;
            const nextUsdc = typeof d.usdc === 'number' && Number.isFinite(d.usdc) ? d.usdc : prev.usdc;
            if (nextCb === prev.coinBalances && nextUsdc === prev.usdc) return prev;
            return { ...prev, coinBalances: nextCb, usdc: nextUsdc };
          });
        } catch {
          /* frame inválido */
        }
      };
      ws.onclose = () => setLivePlayerGameWs(null);
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
    } catch {
      setLivePlayerGameWs(null);
    }
    return () => {
      setLivePlayerGameWs(null);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, [user, globalView, saveLoaded]);

  // Load Save when User changes (inclui admin: ranking / troféu na header)
  useEffect(() => {
    if (!user) {
      rackBatteryFromStockCatalogRef.current.clear();
      setGameState(INITIAL_STATE);
      setSaveLoaded(false);
      setGameStateLoadError(null);
      return;
    }
    if (!gameSaveLoadKey && !user.isAdmin) return;

    let cancelled = false;
    setGameStateLoadError(null);
    (async () => {
      try {
        const { data, status, error: errBody } = await apiGetGameState('me');
        if (cancelled) return;
        if (data) {
          setOfflineStats((data as any).offlineMined || {});
          const parsed = processLoadedState(data, gameStateProcessLabel);
          rackBatteryFromStockCatalogRef.current.clear();
          setGameState(parsed);
          setSaveLoaded(true);
          setGameStateLoadError(null);
        } else if (status === 404) {
          setGameState(INITIAL_STATE);
          const saveKey404 = gameSaveLoadKey || user?.email?.trim() || (user?.id != null ? String(user.id) : '');
          if (saveKey404) {
            await apiSaveGameState(saveKey404, INITIAL_STATE, { adminOverride: false });
          }
          if (!cancelled) {
            setSaveLoaded(true);
            setGameStateLoadError(null);
          }
        } else {
          if (status === 401) {
            await handleExpiredSession();
            return;
          }
          const hint =
            errBody ||
            (status === 401
              ? 'Sessão expirou. Entre novamente.'
              : status >= 500
                ? 'Servidor não conseguiu carregar o guardado. Tente de novo em instantes.'
                : 'Não foi possível carregar o estado do jogo.');
          console.error('[GameState] Falha ao carregar:', status, hint);
          if (!cancelled) setGameStateLoadError(hint);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Erro inesperado ao processar o guardado.';
        console.error('[GameState] Excepção ao carregar:', e);
        if (!cancelled) setGameStateLoadError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameSaveLoadKey, gameSaveLoadIsAdmin, gameStateReloadNonce, gameStateProcessLabel, handleExpiredSession]);

  // INTRO PRESENTATION (CMD STYLE)
  // Trigger on every fresh login (session start)
  const hasShownIntro = useRef(false);

  // Reset intro flag when user logs out
  useEffect(() => {
    if (!user) {
      hasShownIntro.current = false;
    }
  }, [user]);

  useEffect(() => {
    // Terminal intro first: do not wait for save (avoids flashing the game shell before the overlay).
    if (user && !user.isAdmin && !hasShownIntro.current) {
      hasShownIntro.current = true;

      const rewardsToShow = [];
      if ((user as any).isNewRegistration) {
        rewardsToShow.push({ id: 'reg_bonus', name: 'Pacote de Boas-vindas', count: 1 });
        if (user.referredBy) rewardsToShow.push({ id: 'ref_bonus', name: 'Prêmio de Indicado', count: 1 });
      }

      setPendingRewardSummary(rewardsToShow);
      setShowRewardModal(true);
    }
  }, [user]);

  // Recalculate Production Rate
  useEffect(() => {
    setProductionRate(calculateProduction(gameState.placedRacks, gameUpgrades));
  }, [gameState.placedRacks, gameUpgrades]);

  /** Racks / oficina / baterias: fonte de verdade é o backend (`GET /api/game-state/...` com `computeProgressForUser`). Sem simulação local de carga (evita divergência BD vs UI). */
  const BATTERY_STATE_POLL_MS = 12000;
  useEffect(() => {
    if (!user || user.isAdmin || !saveLoaded || gameUpgrades.length === 0) return;

    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      void handleReloadGameState();
    };
    const interval = setInterval(tick, BATTERY_STATE_POLL_MS);
    return () => clearInterval(interval);
  }, [user, gameUpgrades, saveLoaded, handleReloadGameState]);

  // Atualizações globais (loja / economia / web3) — só com sessão; pausa em separador oculto para menos rede/CPU
  useEffect(() => {
    if (!user) return;
    const tick = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const lite = await getPublicBootstrapLite();
        if (lite) {
          setAccessLevels(lite.accessLevels);
          setMiningCoins(lite.miningCoins);
          if (lite.economySettings) setEconomySettings(lite.economySettings);
          setLootBoxDefs(lite.lootBoxes);
          if (lite.web3Settings) setWeb3SettingsState(lite.web3Settings);
          return;
        }
        const [lv, mc, econ, lb, web3] = await Promise.all([
          getAccessLevels(),
          getMiningCoins(),
          getEconomySettings(),
          getLootBoxes(),
          getWeb3Settings()
        ]);
        setAccessLevels(lv);
        setMiningCoins(mc);
        if (econ) setEconomySettings(econ);
        setLootBoxDefs(lb);
        if (web3) setWeb3SettingsState(web3);
      } catch (e) {
        console.error('[Global refresh] failed', e);
      }
    };
    void tick();
    const interval = setInterval(tick, 10000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user]);

  // Auth Handlers
  const handleLogin = async (u: User) => {
    if (!u) return;
    setUser(u);
    setGlobalView(u.isAdmin ? 'admin' : 'game');
    if (typeof window !== 'undefined' && u.isAdmin) {
      const current = (window.location.pathname || '').replace(/\/+$/, '') || '/';
      const next = adminPathFromLocation(current);
      if (current !== next) {
        window.history.replaceState(null, '', next);
      }
    }
  };

  const handleLogout = async () => {
    await apiLogout();
    rackBatteryFromStockCatalogRef.current.clear();
    setUser(null);
    setGlobalView('home');
    setGameState(INITIAL_STATE);
  };



  const handleUpdateUser = async (
    updatedUser: User,
    opts?: { skipApi?: boolean }
  ): Promise<{ ok: boolean; error?: string; code?: string; accounts?: unknown[] }> => {
    if (!opts?.skipApi) {
      const out = await apiUpdateUser(updatedUser);
      if (!out.ok) {
        return out;
      }
    }
    setUser(updatedUser);
    return { ok: true };
  };

  const handleUpgradeAccess = (newLevelId: string) => {
    if (!user) return;
    const newLvlIds = Array.from(new Set([...(user.accessLevelIds || []), newLevelId]));
    const updatedUser = { ...user, accessLevelId: newLevelId, accessLevelIds: newLvlIds };
    handleUpdateUser(updatedUser);
    // Give Upgrade Rewards if any
    const rewardBoxes = lootBoxDefs.filter(b => b.trigger === 'upgrade');
    if (rewardBoxes.length > 0) {
      setGameState(prev => {
        const newBoxes = { ...prev.unopenedBoxes };
        rewardBoxes.forEach(b => newBoxes[b.id] = (newBoxes[b.id] || 0) + 1);
        return { ...prev, unopenedBoxes: newBoxes };
      });
    }
  }

  // --- ACTIONS ---

  const handleSuggestDeposit = useCallback(
    (amount: number) => {
      setDepositPrefill(amount);
      goToGameView('wallet');
    },
    [goToGameView]
  );

  const handlePassPurchased = useCallback((seasonId: string, passId: string, newUsdc: number) => {
    setGameState(prev => ({ ...prev, usdc: newUsdc }));
  }, []);



  const handleP2PBuy = useCallback(async (listing: MarketListing) => {
    const q = Math.max(1, parseInt(String(listing.qty ?? 1), 10) || 1);
    const res = await buyMarketListing(listing.id, q);
    if (!res.ok) {
      if (res.error === 'Insufficient USDC') alert(`Saldo insuficiente.Faltam $${res.missing?.toFixed(2) || '0.00'} `);
      if (res.error === 'Not authenticated') alert('Você precisa estar logado para comprar.');
      return;
    }
    setMarketRefreshTrigger(p => p + 1);
    if (!user) return;
    const { data } = await apiGetGameState('me');
    if (data) {
      const label =
        user.email?.trim() || user.username?.trim() || String(user.id || 'player');
      const parsed = processLoadedState(data, label);
      rackBatteryFromStockCatalogRef.current.clear();
      setGameState(parsed);
    }
  }, [user]);

  const handleCreateListing = useCallback(async (itemId: string, price: number, qty: number) => {
    if (!user?.email) return;
    const res = await sellMarketListing(itemId, price, qty);
    if (res.ok) {
      setMarketRefreshTrigger(p => p + 1);
      handleReloadGameState();
      alert('Item listado com sucesso!');
    } else {
      alert('Erro ao listar item: ' + (res.error || 'Erro desconhecido'));
    }
  }, [user]);

  const handleCancelListing = useCallback(async (listingId: string) => {
    const res = await cancelMarketListing(listingId);
    if (res.ok) {
      setMarketRefreshTrigger(p => p + 1);
      handleReloadGameState();
      alert('Listagem cancelada!');
    } else {
      alert('Erro ao cancelar: ' + (res.error || 'Erro desconhecido'));
    }
  }, []);

  // Venda de Nanit removida: apenas moedas definidas no backend podem ser vendidas


  /* handleSellCoin moved below to use API */


  const handleAddUSDC = useCallback(async (amt: number, network: string = 'polygon'): Promise<{ ok: boolean; tx?: string; cancelled?: boolean; error?: string }> => {
    if (!amt || amt < 0.001) return { ok: false };
    if (!user?.polygonWallet) {
      return { ok: false, error: 'Conecte uma carteira para depositar.' };
    }
    const s = await getWeb3Settings();
    if (!s) {
      alert('Não foi possível carregar as configurações de depósito. Atualiza a página e tenta novamente.');
      return { ok: false };
    }
    const netKey = (network || 'polygon').toLowerCase();
    if (netKey === 'polygon' || netKey === 'matic') {
      if (web3DepositFlagDisabled(s.depositPolygonDisabled)) {
        alert('Depósitos na Polygon estão desativados pelo administrador.');
        return { ok: false };
      }
    } else if (netKey === 'bnb' || netKey === 'bsc') {
      if (web3DepositFlagDisabled(s.depositBnbDisabled)) {
        alert('Depósitos na BNB Chain estão desativados pelo administrador.');
        return { ok: false };
      }
    } else if (netKey === 'base') {
      if (web3DepositFlagDisabled(s.depositBaseDisabled)) {
        alert('Depósitos na Base estão desativados pelo administrador.');
        return { ok: false };
      }
    }

    let contract = '';
    let targetChainId = '0x89';
    let chainName = 'Polygon Mainnet';
    let nativeCurrency = { name: 'MATIC', symbol: 'MATIC', decimals: 18 };
    let rpcUrls = ['https://polygon-rpc.com'];
    let blockExplorerUrls = ['https://polygonscan.com'];

    if (network === 'bnb' || network === 'bsc') {
      contract = s?.depositTokenContractBnb || '';
      targetChainId = '0x38';
      chainName = 'Binance Smart Chain';
      nativeCurrency = { name: 'BNB', symbol: 'BNB', decimals: 18 };
      rpcUrls = ['https://bsc-dataseed.binance.org/'];
      blockExplorerUrls = ['https://bscscan.com'];
    } else if (network === 'base') {
      contract = s?.depositTokenContractBase || '';
      targetChainId = '0x2105';
      chainName = 'Base Mainnet';
      nativeCurrency = { name: 'ETH', symbol: 'ETH', decimals: 18 };
      rpcUrls = ['https://mainnet.base.org'];
      blockExplorerUrls = ['https://basescan.org'];
    } else {
      contract = s?.depositTokenContract || ''; // Polygon
    }

    const dest = s?.depositWallet || '';
    if (!/^0x[a-fA-F0-9]{40}$/.test(contract) || !/^0x[a-fA-F0-9]{40}$/.test(dest)) {
      alert(`Configuração de contrato/carteira incompleta para a rede ${network}.`);
      return { ok: false };
    }

    const eth = (window as any).ethereum;
    if (!eth) return { ok: false };
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    const from = accounts && accounts[0];
    if (!from || !/^0x[a-fA-F0-9]{40}$/.test(from)) return { ok: false };
    if (from.toLowerCase() !== user.polygonWallet.toLowerCase()) { alert('Depósito deve ser realizado exclusivamente pela carteira conectada no Perfil.'); return { ok: false }; }

    try {
      const chainId = await eth.request({ method: 'eth_chainId' });
      if (chainId.toLowerCase() !== targetChainId.toLowerCase()) {
        try {
          await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetChainId }] });
        } catch {
          try {
            await eth.request({
              method: 'wallet_addEthereumChain', params: [{
                chainId: targetChainId,
                chainName,
                nativeCurrency,
                rpcUrls,
                blockExplorerUrls
              }]
            });
          } catch { }
        }
      }
    } catch { }

    let decimals = 6;
    try {
      const decRes = await eth.request({ method: 'eth_call', params: [{ to: contract, data: '0x313ce567' }, 'latest'] });
      if (typeof decRes === 'string' && decRes.startsWith('0x')) {
        const d = parseInt(decRes, 16);
        if (!isNaN(d) && d > 0 && d < 36) decimals = d;
      }
    } catch { }

    const raw = BigInt(Math.round(amt * Math.pow(10, decimals)));
    const amountHex = raw.toString(16);
    const toPadded = dest.replace(/^0x/, '').padStart(64, '0');
    const amtPadded = amountHex.padStart(64, '0');
    const data = '0xa9059cbb' + toPadded + amtPadded;

    try {
      const proceed = window.confirm(`Atenção: você pagará o gas na rede ${network.toUpperCase()}. Deseja continuar?`);
      if (!proceed) return { ok: false, cancelled: true };
      const tx = await eth.request({ method: 'eth_sendTransaction', params: [{ from, to: contract, value: '0x0', data }] });
      if (typeof tx === 'string' && tx) {
        // Wait for receipt
        for (let i = 0; i < 30; i++) {
          await new Promise(res => setTimeout(res, 2000));
          try {
            const receipt = await eth.request({ method: 'eth_getTransactionReceipt', params: [tx] });
            if (receipt && typeof receipt === 'object' && 'status' in receipt) {
              const ok = receipt.status === '0x1' || receipt.status === 1;
              return { ok, tx };
            }
          } catch { }
        }
        return { ok: false, tx };
      }
      return { ok: false };
    } catch {
      return { ok: false, cancelled: true };
    }
  }, [getWeb3Settings, user]);

  const [depositFlow, setDepositFlow] = useState<{
    pending: boolean;
    status?: 'awaiting' | 'success' | 'queued' | 'cancelled' | 'failed';
    amount?: number;
    txHash?: string;
    network?: string;
    /** Mensagem do servidor / rede quando o depósito falha (ex.: saldo insuficiente on-chain). */
    failureReason?: string;
  }>({ pending: false });

  const [walletServerSnapshot, setWalletServerSnapshot] = useState<WalletStatePayload | null>(null);

  const deskCoinBalancesForExchange = useMemo(() => {
    if (walletServerSnapshot?.ok && Array.isArray(walletServerSnapshot.minedBalances)) {
      const acc: Record<string, number> = {};
      for (const m of walletServerSnapshot.minedBalances) {
        acc[m.coinId] = typeof m.minedBalance === 'number' && Number.isFinite(m.minedBalance) ? m.minedBalance : 0;
      }
      return acc;
    }
    return gameState.coinBalances || {};
  }, [walletServerSnapshot, gameState.coinBalances]);

  const deskMiningCoinsForExchange = useMemo(() => {
    if (walletServerSnapshot?.ok && Array.isArray(walletServerSnapshot.minedBalances)) {
      return walletServerSnapshot.minedBalances.map((m) => ({
        id: m.coinId,
        name: m.name,
        usdcRate: m.usdcRate,
        showInExchange: m.showInExchange !== false
      }));
    }
    return miningCoins.map((c) => ({
      id: c.id,
      name: c.name,
      usdcRate: c.usdcRate,
      showInExchange: c.showInExchange !== false
    }));
  }, [walletServerSnapshot, miningCoins]);

  const serverDeskSettingsForExchange = useMemo(() => {
    if (!walletServerSnapshot?.ok) return null;
    return {
      minExchangeAmount: walletServerSnapshot.exchange.minUsdc,
      exchangeFeePercent: walletServerSnapshot.exchange.feePercent
    };
  }, [walletServerSnapshot]);

  const verifyDepositWithServer = useCallback(
    async (txHash: string, network: string): Promise<{ ok: boolean; pending?: boolean; error?: string }> => {
      if (!user?.email) return { ok: false, error: 'Sessão inválida.' };
      const txNorm = String(txHash || '').trim().toLowerCase();
      const verifyRes = await fetch('/api/deposit/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: user.email, txHash: txNorm, network })
      });
      let verifyData: { ok?: boolean; pending?: boolean; newUsdc?: number; error?: string; message?: string };
      try {
        verifyData = await verifyRes.json();
      } catch {
        return { ok: false, error: 'Resposta inválida do servidor.' };
      }
      if (verifyRes.ok && verifyData.ok) {
        setGameState((p) => ({ ...p, usdc: verifyData.newUsdc ?? p.usdc }));
        return { ok: true };
      }
      if (verifyData.pending) return { ok: false, pending: true };
      return {
        ok: false,
        error: verifyData.error || (!verifyRes.ok ? 'Pedido rejeitado pelo servidor.' : 'Falha na validação.')
      };
    },
    [user?.email]
  );

  useEffect(() => {
    if (depositFlow.status !== 'queued' || !depositFlow.txHash || !user?.email) return;
    const network = depositFlow.network || 'polygon';
    const txHash = depositFlow.txHash;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 24;
    const tick = async () => {
      if (cancelled || attempts++ >= maxAttempts) return;
      const out = await verifyDepositWithServer(txHash, network);
      if (cancelled) return;
      if (out.ok) {
        setDepositFlow((f) => ({ ...f, status: 'success' }));
      }
    };
    const id = setInterval(tick, 15000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [depositFlow.status, depositFlow.txHash, depositFlow.network, user?.email, verifyDepositWithServer]);

  const handleStartDeposit = useCallback(async (amt: number, network: string = 'polygon') => {
    const minDep = web3SettingsState?.minDepositUsdc ?? 0.001;
    if (!amt || amt < minDep || !user?.polygonWallet || !user?.email) return;

    setDepositFlow({ pending: true, status: 'awaiting', amount: amt, network });
    const res = await handleAddUSDC(amt, network);

    // Com hash de tx, validar sempre no servidor — mesmo se a carteira não devolveu o recibo a tempo
    // (timeout devolve ok:false mas tx presente; na chain a tx pode já estar confirmada).
    if (res && res.tx && !res.cancelled) {
      try {
        const verifyDataResult = await verifyDepositWithServer(res.tx, network);
        if (verifyDataResult.ok) {
          setDepositFlow({ pending: false, status: 'success', amount: amt, txHash: res.tx, network });
        } else if (verifyDataResult.pending) {
          setDepositFlow({ pending: false, status: 'queued', amount: amt, txHash: res.tx, network });
          alert(
            'Transação enviada. Os USDC serão creditados quando a rede confirmar — esta página tenta sincronizar sozinha a cada 15 s; também pode usar «Sincronizar agora» na carteira. Na Polygon, USDC nativo (Circle) e USDC.e contam, desde que o destino seja o endereço de depósito do jogo.'
          );
        } else {
          setDepositFlow({
            pending: false,
            status: 'failed',
            amount: amt,
            txHash: res.tx,
            network,
            failureReason: verifyDataResult.error || 'Não foi possível validar o depósito.'
          });
          console.error('[DepositVerify] Failed:', verifyDataResult.error);
        }
      } catch (e: any) {
        console.error('[DepositVerify] Connection Error:', e);
        setDepositFlow({
          pending: false,
          status: 'failed',
          amount: amt,
          txHash: res.tx,
          network,
          failureReason: e?.message ? `Erro ao falar com o servidor: ${e.message}` : 'Erro de rede ao validar o depósito.'
        });
      }
    } else if (res && res.cancelled) {
      setDepositFlow({ pending: false, status: 'cancelled', amount: amt, network });
    } else {
      setDepositFlow({ pending: false, status: 'failed', amount: amt, txHash: res?.tx, network });
    }
  }, [handleAddUSDC, user, web3SettingsState, verifyDepositWithServer]);

  /* Desk de câmbio: POST /api/wallet/exchange/liquidate + idempotência; estado via GET /api/wallet/state */
  const handleSellCoin = useCallback(
    async (coinId: string, percentagePoints: 10 | 50 | 100) => {
      if (!user?.email) return;
      if (percentagePoints === 100) {
        if (!confirm('Liquidar todo o saldo desta moeda para USDC?')) return;
      }
      const idem = newWheelIdempotencyKey();
      const res = await postWalletExchangeLiquidate({
        coinId,
        mode: 'PERCENTAGE',
        percentage: percentagePoints,
        idempotencyKey: idem
      });
      if (res.ok === false) {
        const st = res.status;
        if (st === 409 || st === 422) {
          await handleReloadGameState();
          const ws = await getWalletState();
          if (ws?.ok) setWalletServerSnapshot(ws);
          alert(res.error || 'Seu saldo foi atualizado, tente novamente.');
          return;
        }
        alert(res.error || 'Falha na liquidação.');
        return;
      }
      await handleReloadGameState();
      const ws = await getWalletState();
      if (ws?.ok) setWalletServerSnapshot(ws);
      const feeMsg = res.feeUsdc && res.feeUsdc > 0 ? ` (Taxa: $${Number(res.feeUsdc).toFixed(4)})` : '';
      alert(`Venda realizada com sucesso! +$${Number(res.netUsdc ?? 0).toFixed(4)} USDC${feeMsg}`);
    },
    [user, handleReloadGameState]
  );

  useEffect(() => { (async () => { const s = await getWeb3Settings(); setWeb3SettingsState(s); })(); }, []);
  useEffect(() => {
    if (!saveLoaded || currentView !== 'wallet') return;
    let cancelled = false;
    (async () => {
      const s = await getWeb3Settings();
      if (!cancelled) setWeb3SettingsState(s);
    })();
    return () => { cancelled = true; };
  }, [saveLoaded, currentView]);

  useEffect(() => {
    if (!saveLoaded || currentView !== 'wallet' || !user?.email || user.isAdmin) return;
    let cancelled = false;
    const tick = async () => {
      const ws = await getWalletState();
      if (!cancelled && ws?.ok) setWalletServerSnapshot(ws);
    };
    void tick();
    const id = window.setInterval(tick, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [saveLoaded, currentView, user?.email, user?.isAdmin]);

  const handleMintNFT = useCallback((id: string, amt: number) => { setGameState(p => ({ ...p, stock: { ...p.stock, [id]: (p.stock[id] || 0) + amt } })); requestSave(); }, [requestSave]);
  const handleBurnNFT = useCallback((id: string, amt: number) => { setGameState(p => { const cur = p.stock[id] || 0; if (cur < amt) return p; return { ...p, stock: { ...p.stock, [id]: cur - amt } }; }); requestSave(); }, [requestSave]);

  const handlePlaceRack = useCallback(
    async (typeId: string, roomId: string, slotIndex: number, ctx?: { roomName?: string; nftAutoArmario1Only?: boolean }) => {
      if (isNftAutoArmario1OnlyRoomContext(roomId, ctx?.roomName, ctx?.nftAutoArmario1Only) && typeId !== NFT_AUTO_ALLOWED_CHASSIS_ID) {
        alert('Nesta sala só é permitido o chassis Rack H1 NFT Collection.');
        return;
      }
      if (!user?.email || rackPlaceBusyRef.current) return;
      rackPlaceBusyRef.current = true;
      const roomNorm = normalizePlacedRackRoomId(roomId);
      try {
        const out = await postServersPlaceRack({
          catalogItemId: typeId,
          roomId: roomNorm,
          slotIndex,
          idempotencyKey: newServerIntentIdempotencyKey(),
          clientStateVersion: getGlobalLastLoadTime()
        });
        if (out.ok !== true) {
          if (out.forceReload || out.code === 'STATE_VERSION_CONFLICT' || out.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
            setGameStateReloadNonce((n) => n + 1);
          }
          alert(out.error || 'Não foi possível colocar a rig.');
          return;
        }
        serverIntentMutationGenRef.current += 1;
        skipNextLegacySaveRef.current = true;
        setGameState((p) => ({
          ...p,
          stock: { ...out.stock },
          placedRacks: [...out.placedRacks],
          storedBatteries: [...out.storedBatteries]
        }));
      } finally {
        rackPlaceBusyRef.current = false;
      }
    },
    [user?.email, setGameStateReloadNonce]
  );

  const handleRemoveRack = useCallback(async (rackId: string) => {
    if (!confirm('Desmontar esta rig? Todos os componentes (GPUs, fiação, bateria, multiplicadores) voltam para o estoque.')) return;
    if (!user?.email || rackPlaceBusyRef.current) return;
    rackPlaceBusyRef.current = true;
    try {
      const out = await postServersRemoveRack(rackId);
      if (out.ok !== true) {
        if (out.forceReload || out.code === 'STATE_VERSION_CONFLICT' || out.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
          setGameStateReloadNonce((n) => n + 1);
        }
        alert(out.error || 'Não foi possível desmontar a rig.');
        return;
      }
      serverIntentMutationGenRef.current += 1;
      skipNextLegacySaveRef.current = true;
      setGameState((p) => ({
        ...p,
        stock: { ...out.stock },
        placedRacks: [...out.placedRacks],
        storedBatteries: [...out.storedBatteries]
      }));
    } finally {
      rackPlaceBusyRef.current = false;
    }
  }, [user?.email, setGameStateReloadNonce]);

  const handleEquipMiner = useCallback(async (rid: string, idx: number, mid: string) => {
    if (!user?.email || rackAuxIntentBusyRef.current) return;
    rackAuxIntentBusyRef.current = true;
    gpuDupLog('before_equip', { rackId: rid, slotIndex: idx, itemId: mid });
    try {
      const out = await postServersRackMinerEquip(rid, idx, mid);
      if (out.ok !== true) {
        if (out.status === 409 || out.forceReload) setGameStateReloadNonce((n) => n + 1);
        alert(out.error || 'Não foi possível instalar a GPU.');
        return;
      }
      serverIntentMutationGenRef.current += 1;
      skipNextLegacySaveRef.current = true;
      gpuDupLog('after_equip_response', {
        rackId: rid,
        slotIndex: idx,
        itemId: mid,
        stateVersion: out.stateVersion,
        rackSlots: out.placedRacks.find((r) => r.id === rid)?.slots ?? null,
        stockDelta: out.stock[mid] ?? null,
        intentGen: serverIntentMutationGenRef.current
      });
      setGameState((p) => ({
        ...p,
        stock: out.stock,
        storedBatteries: out.storedBatteries,
        placedRacks: out.placedRacks
      }));
    } finally {
      rackAuxIntentBusyRef.current = false;
    }
  }, [user?.email, setGameStateReloadNonce]);

  const handleUnequipMiner = useCallback(async (rid: string, idx: number) => {
    if (!user?.email || rackAuxIntentBusyRef.current) return;
    rackAuxIntentBusyRef.current = true;
    gpuDupLog('before_unequip', {
      rackId: rid,
      slotIndex: idx,
      currentSlot: gameStateRef.current.placedRacks.find((r) => r.id === rid)?.slots?.[idx] ?? null
    });
    try {
      const out = await postServersRackMinerUnequip(rid, idx);
      if (out.ok !== true) {
        if (out.status === 409 || out.forceReload) setGameStateReloadNonce((n) => n + 1);
        alert(out.error || 'Não foi possível remover a GPU.');
        return;
      }
      serverIntentMutationGenRef.current += 1;
      skipNextLegacySaveRef.current = true;
      const rackOut = out.placedRacks.find((r) => r.id === rid);
      gpuDupLog('after_unequip_response', {
        rackId: rid,
        slotIndex: idx,
        stateVersion: out.stateVersion,
        rackSlots: rackOut?.slots ?? null,
        stockSnapshot: Object.fromEntries(
          Object.entries(out.stock).filter(([, v]) => Number(v) > 0)
        ),
        intentGen: serverIntentMutationGenRef.current
      });
      setGameState((p) => ({
        ...p,
        stock: out.stock,
        storedBatteries: out.storedBatteries,
        placedRacks: out.placedRacks
      }));
      gpuDupLog('after_set_state', { rackId: rid, slotIndex: idx, intentGen: serverIntentMutationGenRef.current });
    } finally {
      rackAuxIntentBusyRef.current = false;
    }
  }, [user?.email, setGameStateReloadNonce]);

  const handleEquipAux = useCallback(
    async (rid: string, iid: string, type: string, sbid?: string, idx?: number) => {
      if (!user?.email || rackAuxIntentBusyRef.current) return;
      rackAuxIntentBusyRef.current = true;
      const applyServer = (out: ServersRackAuxIntentOk) => {
        serverIntentMutationGenRef.current += 1;
        skipNextLegacySaveRef.current = true;
        setGameState((p) => ({
          ...p,
          stock: out.stock,
          storedBatteries: out.storedBatteries,
          placedRacks: out.placedRacks
        }));
        for (const r of out.placedRacks) {
          const bid = r.batteryId != null ? String(r.batteryId).trim() : '';
          const cat = r.batteryCatalogItemId != null ? String(r.batteryCatalogItemId).trim() : '';
          if (bid && cat) rackBatteryFromStockCatalogRef.current.set(bid, cat);
        }
      };
      try {
        if (type === 'battery') {
          const out = await postServersRackAuxEquip(rid, {
            kind: 'battery',
            ...(sbid ? { storedBatteryId: sbid } : { catalogItemId: iid })
          });
          if (out.ok !== true) {
            if (out.status === 409 || out.forceReload) setGameStateReloadNonce((n) => n + 1);
            alert(out.error);
            return;
          }
          applyServer(out);
        } else if (type === 'wiring') {
          const out = await postServersRackAuxEquip(rid, { kind: 'wiring', catalogItemId: iid });
          if (out.ok !== true) {
            if (out.status === 409 || out.forceReload) setGameStateReloadNonce((n) => n + 1);
            alert(out.error);
            return;
          }
          applyServer(out);
        } else if (type === 'multiplier' && idx !== undefined) {
          const out = await postServersRackAuxEquip(rid, {
            kind: 'multiplier',
            catalogItemId: iid,
            multiplierSlotIndex: idx
          });
          if (out.ok !== true) {
            if (out.status === 409 || out.forceReload) setGameStateReloadNonce((n) => n + 1);
            alert(out.error);
            return;
          }
          applyServer(out);
        }
      } finally {
        rackAuxIntentBusyRef.current = false;
      }
    },
    [user?.email, setGameStateReloadNonce]
  );

  const handleUnequipAux = useCallback(
    async (rid: string, type: string, idx?: number) => {
      if (!user?.email || rackAuxIntentBusyRef.current) return;
      rackAuxIntentBusyRef.current = true;
      const applyServer = (out: ServersRackAuxIntentOk) => {
        serverIntentMutationGenRef.current += 1;
        skipNextLegacySaveRef.current = true;
        setGameState((p) => ({
          ...p,
          stock: out.stock,
          storedBatteries: out.storedBatteries,
          placedRacks: out.placedRacks
        }));
        for (const r of out.placedRacks) {
          const bid = r.batteryId != null ? String(r.batteryId).trim() : '';
          const cat = r.batteryCatalogItemId != null ? String(r.batteryCatalogItemId).trim() : '';
          if (bid && cat) rackBatteryFromStockCatalogRef.current.set(bid, cat);
        }
      };
      try {
        if (type === 'multiplier' && idx === undefined) return;
        const body =
          type === 'multiplier'
            ? ({ kind: 'multiplier' as const, multiplierSlotIndex: idx ?? 0 } as const)
            : type === 'wiring'
              ? ({ kind: 'wiring' as const } as const)
              : ({ kind: 'battery' as const } as const);
        const out = await postServersRackAuxUnequip(rid, body);
        if (out.ok !== true) {
          if (out.status === 409 || out.forceReload) setGameStateReloadNonce((n) => n + 1);
          alert(out.error);
          return;
        }
        applyServer(out);
      } finally {
        rackAuxIntentBusyRef.current = false;
      }
    },
    [user?.email, setGameStateReloadNonce]
  );

  const handleTogglePower = useCallback((rid: string) => {
    setGameState(p => {
      const ri = p.placedRacks.findIndex(r => r.id === rid);
      if (ri === -1) return p;
      const rack = p.placedRacks[ri];
      const nftRoom = isNftAutoArmario1OnlyRoom({ id: normalizePlacedRackRoomId(rack.roomId) });

      if (!rack.isOn) {
        const missing = [];
        if (!nftRoom && !rack.selectedCoinId) missing.push('Escolher uma criptomoeda');
        if (!rack.batteryId) missing.push('Instalar uma Bateria');
        if (!rack.wiringId) missing.push('Conectar o Circuito');
        const equipped = rack.slots.filter((s): s is string => Boolean(s));
        if (equipped.length === 0) {
          missing.push(nftRoom ? 'Instalar pelo menos um ASIC' : 'Instalar pelo menos uma GPU');
        } else if (nftRoom) {
          for (const sid of equipped) {
            const up = gameUpgrades.find((u) => u.id === sid);
            if (!up || !isAsicMachineUpgrade(up)) {
              missing.push('Só ASICs na Sala NFT');
              break;
            }
            if (!up.nftMiningCoinId) {
              missing.push(`ASIC sem moeda no admin: ${up.name || sid}`);
            }
          }
        }

        if (missing.length > 0) {
          alert('SISTEMA BLOQUEADO! Para ligar a Rig você precisa primeiro:\n\n' + missing.map((m) => '• ' + m).join('\n'));
          return p;
        }
      }

      const ur = [...p.placedRacks];
      ur[ri] = { ...ur[ri], isOn: !ur[ri].isOn };
      return { ...p, placedRacks: ur };
    });
    requestSave();
  }, [gameUpgrades, requestSave]);

  const handleSetRackCoin = useCallback((rid: string, coinId: string) => {
    setGameState(prev => {
      const ri = prev.placedRacks.findIndex(r => r.id === rid);
      if (ri === -1) return prev;
      const rack = prev.placedRacks[ri];
      const coin = coinId ? miningCoins.find(c => c.id === coinId) : null;
      if (coinId && coin && !coin.isActive) return prev;
      if (
        coinId &&
        coin &&
        isNftRoomExclusiveMiningCoin(coin) &&
        !isNftAutoArmario1OnlyRoomContext(normalizePlacedRackRoomId(rack.roomId))
      ) {
        alert(NFT_ROOM_EXCLUSIVE_COIN_ERROR_PT);
        return prev;
      }
      const ur = [...prev.placedRacks];
      const selected = coinId && coin ? coinId : undefined;
      ur[ri] = { ...ur[ri], selectedCoinId: selected, isOn: selected ? ur[ri].isOn : false };
      return { ...prev, placedRacks: ur };
    });
    requestSave();
  }, [miningCoins, requestSave]);

  const handleSetRoomRacksCoin = useCallback(async (roomId: string, coinId: string) => {
    const roomNorm = normalizePlacedRackRoomId(roomId);
    if (coinId) {
      const coin = miningCoins.find((c) => c.id === coinId);
      if (coin && isNftRoomExclusiveMiningCoin(coin) && !isNftAutoArmario1OnlyRoomContext(roomNorm)) {
        setBulkBatteryNotice({
          title: 'Moeda na sala',
          message: NFT_ROOM_EXCLUSIVE_COIN_ERROR_PT
        });
        return;
      }
    }
    const res = await postServerRoomRoomCoins(roomNorm, coinId);
    if (!res.ok) {
      setBulkBatteryNotice({ title: 'Moeda na sala', message: 'error' in res ? res.error : 'Erro desconhecido.' });
      return;
    }
    setGameState((prev) => ({ ...prev, placedRacks: res.placedRacks }));
  }, [miningCoins]);

  const handleReset = () => {
    if (user && window.confirm('ATENÇÃO: Isso apagará seu save permanentemente.')) {
      const st = INITIAL_STATE;
      setGameState(st);
      requestSave('full');
    }
  };

  const handleWithdrawCoin = useCallback(async (coinId: string, amt: number): Promise<WalletWithdrawResult> => {
    const s = web3SettingsState;
    const coin = miningCoins.find((c) => c.id === coinId);
    if (!user?.polygonWallet || !coin) {
      return { ok: false, error: 'Conecte uma carteira de saque para sacar cripto.' };
    }
    const matching = findWithdrawTokenCfg(s?.withdrawTokens, coin);
    if (!matching || !isWithdrawTokenUsable(matching)) {
      return {
        ok: false,
        error: `Saque indisponível para ${coin.symbol || coin.name}. Confirma a configuração no painel administrativo.`
      };
    }

    const minW = minimumWithdrawCryptoAmount(coin, matching);
    const cur = (gameState.coinBalances || {})[coinId] || 0;

    if (!Number.isFinite(amt) || amt <= 0) {
      return { ok: false, error: 'Valor de saque inválido.' };
    }
    if (minW > 0 && amt + 1e-12 < minW) {
      return {
        ok: false,
        error: `O valor mínimo para saque (bruto) é ${minW.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${coin.symbol}.`
      };
    }
    if (amt > cur + 1e-9) {
      return { ok: false, error: `Saldo insuficiente. Você tem ${cur.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${coin.symbol} disponíveis.` };
    }

    if (withdrawBusyRef.current) {
      return { ok: false, error: 'Já existe um pedido em andamento. Aguarda alguns segundos.' };
    }
    withdrawBusyRef.current = true;
    const idempotencyKey = `wd_${crypto.randomUUID()}`;
    try {
      const res = await requestWithdrawal(coinId, amt, user.polygonWallet, idempotencyKey);

      if (res.ok) {
        setGameState(prev => {
          const next = { ...(prev.coinBalances || {}) };
          next[coinId] = Math.max(0, (next[coinId] || 0) - amt);
          return { ...prev, coinBalances: next };
        });
        /** Recarrega o estado da carteira para refletir withdrawal_requests (histórico) sem precisar de F5. */
        try {
          const fresh = await getWalletState();
          if (fresh) {
            const mined = Array.isArray((fresh as { minedBalances?: { coinId: string; minedBalance: number }[] }).minedBalances)
              ? (fresh as { minedBalances?: { coinId: string; minedBalance: number }[] }).minedBalances
              : null;
            if (mined && mined.length) {
              setGameState(prev => {
                const next = { ...(prev.coinBalances || {}) };
                for (const m of mined) {
                  if (m && typeof m.coinId === 'string') {
                    next[m.coinId] = Number(m.minedBalance) || 0;
                  }
                }
                return { ...prev, coinBalances: next };
              });
            }
          }
        } catch { /* refresh é best-effort */ }
        requestSave('full');
        return {
          ok: true,
          message:
            res.message ||
            'Solicitação de saque enviada com sucesso. O saque será confirmado em até 24 horas.'
        };
      }

      const code = (res as { code?: string }).code;
      const status = (res as { status?: number }).status ?? 0;
      if (code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') {
        return { ok: false, error: res.error || 'Pedido em conflito. Recarrega o estado da carteira.' };
      }
      if (status >= 400 && status < 500 && res.error) {
        /** 4xx → mensagem específica do backend (saldo insuficiente, moeda não configurada, mínimo, etc.). */
        return { ok: false, error: res.error };
      }
      if (status >= 500) {
        return { ok: false, error: 'Erro interno no servidor. Tenta novamente em alguns minutos.' };
      }
      return { ok: false, error: res.error || 'Erro ao solicitar saque. Tenta novamente.' };
    } finally {
      withdrawBusyRef.current = false;
    }
  }, [web3SettingsState, miningCoins, user, gameState.coinBalances, requestSave]);


  // --- LOOT BOX LOGIC ---
  const handleBuyBox = async (boxId: string) => {
    if (!user?.email) return;
    const box = lootBoxDefs.find(b => b.id === boxId);
    if (!box) return;

    if (!Number.isFinite(box.price) || box.price <= 0) {
      setLuckyBoxNotice({
        variant: 'error',
        title: 'Caixas da Sorte',
        message: 'Esta caixa não está à venda (preço inválido). Contacta o suporte.'
      });
      return;
    }

    // Optimistic check
    if (gameState.usdc < box.price) {
      const short = Math.max(0, box.price - gameState.usdc);
      setLuckyBoxNotice({
        variant: 'error',
        title: 'Caixas da Sorte',
        message: appendUsdcShortfallLine('Saldo USDC insuficiente na reserva.', short)
      });
      return;
    }

    const saldoApos = gameState.usdc - box.price;
    const ok = window.confirm(
      `Confirmar compra da caixa «${box.name}»?\n\n` +
        `Preço: USDC ${Number(box.price).toFixed(2)}\n` +
        `Saldo após: USDC ${saldoApos.toFixed(2)}\n\n` +
        `O valor será debitado no servidor.`
    );
    if (!ok) return;

    // Call API
    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `lb_buy_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const res = await postLuckyBoxPurchase({
      boxId,
      email: user.email,
      quantity: 1,
      idempotencyKey
    });

    if (res.ok) {
      await handleReloadGameState();
      setLuckyBoxNotice({
        variant: 'success',
        title: 'Caixas da Sorte',
        message: 'Caixa comprada com sucesso! Seu inventário de caixas foi atualizado.'
      });
    } else {
      setLuckyBoxNotice({
        variant: 'error',
        title: 'Caixas da Sorte',
        message: appendUsdcShortfallLine(res.error || 'Erro ao comprar a caixa.', res.missing)
      });
    }
  };

  const handleOpenBox = async (boxId: string, opts?: { idempotencyKey?: string }) => {
    if (!user?.email) return null;
    // Não exigir definição no catálogo ativo: inventário pode ter caixas retiradas da loja.

    const res = await postLuckyBoxOpen({
      boxId,
      email: user.email,
      idempotencyKey: opts?.idempotencyKey
    });

    if (!res.ok) {
      setLuckyBoxNotice({
        variant: 'error',
        title: 'Caixas da Sorte',
        message: res.error || 'Erro ao abrir a caixa.'
      });
      return null;
    }

    void handleReloadGameState();
    const rewards = Array.isArray(res.rewards) ? res.rewards : [];
    if (rewards.length === 0) {
      setLuckyBoxNotice({
        variant: 'info',
        title: 'Caixas da Sorte',
        message:
          'Abertura registada. Recarrega a página para ver o stock; se a caixa desapareceu e não há itens novos, contacta o suporte com a hora do pedido.'
      });
    }
    return { rewards };
  };

  const handleDiscardLootBox = async (boxId: string) => {
    if (!user?.email) return { ok: false as const, error: 'Sessão inválida' };
    const res = await discardLootBox(user.email, boxId);
    if (res.ok && res.discardedQty != null) {
      setGameState((prev) => {
        const nb = { ...prev.unopenedBoxes };
        const remaining = typeof res.remainingQty === 'number' ? res.remainingQty : 0;
        if (remaining <= 0) delete nb[boxId];
        else nb[boxId] = remaining;
        return { ...prev, unopenedBoxes: nb };
      });
      return { ok: true as const };
    }
    return { ok: false as const, error: res.error || 'Erro ao descartar.' };
  };

  // Refresh loot boxes after code redemption (as it may create new box types)
  const handleRedeemSuccess = useCallback(async (newBoxes?: Record<string, number>) => {
    const lb = await getLootBoxes();
    setLootBoxDefs(lb);
    handleReloadGameState(newBoxes);
  }, [handleReloadGameState]);

  // Formatters
  const formatAmount = (val: number) => {
    if (val === 0) return "0";
    if (val < 1) return val.toFixed(12);
    if (val < 1000) return val.toLocaleString('en-US', { maximumFractionDigits: 4 });
    return Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 2 }).format(val);
  };
  const formatMoney = (val: number) => val < 0.01 && val > 0 ? val.toFixed(3) : val.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const formatHash = (val: number) => val === 0 ? "0 H/s" : (val < 0.0001 ? val.toFixed(8) + " H/s" : Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 2 }).format(val) + " H/s");

  /** Dashboard / Parceiros: menos altura no header + menu para dar espaço ao conteúdo. */
  const compactGameChrome = Boolean(
    user && globalView === 'game' && (currentView === 'dashboard' || currentView === 'partners')
  );

  return (
    <div className="h-screen min-h-0 w-full min-w-0 max-w-full flex flex-col bg-slate-50 dark:bg-[#0f0c08] text-slate-800 dark:text-slate-200 font-sans selection:bg-amber-500/30 overflow-hidden transition-colors duration-300">
      <a
        href="#main-content"
        className="fixed left-4 top-0 z-[9999] -translate-y-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-stone-950 shadow-lg outline-none ring-2 ring-amber-200 transition focus:translate-y-4 focus:ring-offset-2 focus:ring-offset-[#0f0c08]"
      >
        Saltar para o conteúdo principal
      </a>
      {/* GLOBAL NAVIGATION HEADER */}
      <header className="bg-white/90 dark:bg-slate-900/90 border-b border-slate-200 dark:border-amber-900/30 shrink-0 backdrop-blur-md z-50 shadow-sm transition-colors duration-300">
        <div
          className={`max-w-7xl mx-auto min-w-0 w-full px-3 sm:px-4 flex flex-col md:flex-row justify-between ${
            compactGameChrome ? 'py-1 md:py-1.5 gap-1 md:gap-2' : 'py-2 md:py-2.5 gap-2 md:gap-3'
          }`}
        >
          {/* Logo */}
          <div
            className="flex w-full items-center justify-between md:w-auto md:min-w-0 md:flex-none"
          >
            <div
              className="flex min-w-0 items-center gap-3 cursor-pointer"
              role="button"
              tabIndex={0}
              aria-label="Ir para início — Genesis Miner"
              onClick={() => {
                if (user) {
                  setGlobalView(user.isAdmin ? 'admin' : 'game');
                } else {
                  navigateGlobalView('home');
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (user) {
                    setGlobalView(user.isAdmin ? 'admin' : 'game');
                  } else {
                    navigateGlobalView('home');
                  }
                }
              }}
            >
              <div
                className={`rounded-full overflow-hidden shrink-0 ring-2 ring-amber-500/50 shadow-lg shadow-amber-600/25 bg-slate-900 ${
                  compactGameChrome ? 'w-9 h-9' : 'w-10 h-10'
                }`}
              >
                <img
                  src="/img/favicon/genesis-miner-logo.png"
                  alt=""
                  className="w-full h-full object-cover"
                  width={40}
                  height={40}
                  fetchPriority="high"
                  aria-hidden
                />
              </div>
              <div className="min-w-0 text-left">
                <p
                  className={`truncate font-bold bg-gradient-to-r from-amber-600 to-orange-600 dark:from-amber-400 dark:to-orange-400 bg-clip-text text-transparent ${
                    compactGameChrome ? 'text-lg leading-tight' : 'text-xl'
                  }`}
                >
                  Genesis Miner
                </p>
                <span
                  className={`block truncate font-semibold tracking-wider bg-gradient-to-r from-amber-600 to-orange-600 dark:from-amber-400 dark:to-orange-400 bg-clip-text text-transparent ${
                    compactGameChrome ? 'text-[9px] leading-tight' : 'text-[10px]'
                  }`}
                >
                  Ecossistema online V0.5 — Genesis DAO
                </span>
              </div>
            </div>
            <button
              onClick={() => setMobileMenuOpen(v => !v)}
              className="ml-3 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-200 dark:hover:bg-slate-800 lg:hidden"
              aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'}
            >
              {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>

          {/* In-Game Stats */}
          {user && globalView === 'game' && (
            <div
              className={`flex items-center gap-3 bg-slate-100 dark:bg-slate-800/50 rounded-lg border border-slate-200 dark:border-slate-700/50 text-xs md:text-sm shadow-inner ${
                compactGameChrome ? 'p-1 gap-2' : 'p-1.5 gap-3'
              }`}
            >
              <div className="flex flex-col items-end px-3 border-r border-slate-300 dark:border-slate-700">
                <span className="text-[10px] text-amber-600 dark:text-amber-500 uppercase tracking-wider flex gap-1 items-center"><Coins size={10} /> Tokens <button onClick={() => setCoinsExpanded(e => !e)} className="ml-1 p-0.5 rounded text-slate-500 hover:text-slate-800 dark:hover:text-white">{coinsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button></span>
                <div className="flex flex-col gap-0.5 items-end">
                  {miningCoins.length === 0 ? (
                    <span className="font-mono text-slate-500">—</span>
                  ) : (
                    (() => {
                      const hashByCoinLocal = computeHashByCoinFromPlacedRacks(
                        gameState.placedRacks,
                        gameUpgrades
                      );
                      const coinsWithPower = miningCoins.map((c) => {
                        const localP = hashByCoinLocal[c.id] || 0;
                        const wsP = livePlayerGameWs?.hashByCoinId?.[c.id];
                        const power =
                          wsP != null && Number.isFinite(wsP) && wsP > 0
                            ? wsP
                            : localP;
                        return { ...c, power };
                      }).sort((a, b) => {
                        // Sort by Power DESC, then by Name ASC
                        if (b.power !== a.power) return b.power - a.power;
                        return String(a?.name ?? '').localeCompare(String(b?.name ?? ''), undefined, {
                          sensitivity: 'base',
                        });
                      });

                      if (coinsExpanded) {
                        return coinsWithPower.map(c => {
                          const total = (gameState.coinBalances || {})[c.id] || 0;
                          const isActive = highlightedCoinId === c.id;
                          return (
                            <button key={c.id} onClick={() => setHighlightedCoinId(c.id)} className={`flex items-center gap-2 ${isActive ? 'text-amber-600 dark:text-amber-300' : 'text-slate-700 dark:text-slate-200'}`}>
                              <span className="font-mono font-bold">{c.name}: {formatAmount(total)} • H/s {formatAmount(c.power)}</span>
                            </button>
                          );
                        });
                      } else {
                        // Show highlighted if set, OR the first one (which is now the one with most power)
                        const c = highlightedCoinId ? coinsWithPower.find(x => x.id === highlightedCoinId) || coinsWithPower[0] : coinsWithPower[0];
                        if (!c) return <span className="font-mono text-slate-500">—</span>;
                        const total = (gameState.coinBalances || {})[c.id] || 0;
                        return <span className="font-mono font-bold text-amber-700 dark:text-amber-300">{c.name}: {formatAmount(total)}</span>;
                      }
                    })()
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end px-3 border-r border-slate-300 dark:border-slate-700">
                <span className="text-[10px] text-green-600 dark:text-green-500 uppercase tracking-wider flex gap-1"><DollarSign size={10} /> USDC</span>
                <span className="font-mono font-bold text-green-600 dark:text-green-400">${formatMoney(gameState.usdc)}</span>
              </div>
              <div className="flex flex-col items-end px-2">
                <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider flex gap-1"><TrendingUp size={10} /> Hash Total</span>
                <span className="font-mono text-slate-700 dark:text-slate-200">{formatHash(livePlayerGameWs ? livePlayerGameWs.totalHash : productionRate)}</span>
              </div>
            </div>
          )}

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-2">
              <button onClick={() => navigateGlobalView('home')} className={`px-3 py-2 text-sm font-bold rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition ${globalView === 'home' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`} title="Início (landing)"><Home size={18} /></button>
              <a href="https://t.me/+Fm72joLwb-tjYTZh" target="_blank" rel="noopener noreferrer" className="px-3 py-2 text-sm font-bold rounded text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-[#229ED9] transition" title="Telegram — Genesis Miner"><TelegramIcon size={18} /></a>
              <button onClick={() => { if (!user) navigateGlobalView('auth'); else { setGlobalView('game'); setCurrentView('ranking'); } }} className="px-3 py-2 text-sm font-bold rounded text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-yellow-500 transition" title="Ranking de mineradores"><Trophy size={18} /></button>
              <button onClick={() => navigateGlobalView('docs')} className={`px-3 py-2 text-sm font-bold rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition ${globalView === 'docs' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500'}`} title="Documentação"><BookOpen size={18} /></button>
              {user && (globalView === 'home' || globalView === 'docs') && !user.isAdmin && (
                <div className="flex gap-2">
                  <button onClick={() => { setGlobalView('game'); setCurrentView('servers'); }} className="px-3 py-2 text-sm font-bold rounded hover:bg-slate-200 dark:hover:bg-slate-800 transition text-amber-600 dark:text-amber-400" title="Voltar ao Jogo"><Play size={18} fill="currentColor" /></button>
                </div>
              )}

              {!user ? (
                <button onClick={() => navigateGlobalView('auth')} className="bg-gradient-to-r from-amber-400 to-amber-600 hover:from-amber-300 hover:to-amber-500 text-stone-950 px-4 py-2 rounded font-bold text-sm shadow-lg shadow-amber-600/30 border border-amber-300/40 transition flex items-center gap-2"><UserIcon size={16} /> LOGIN</button>
              ) : (
                <div className="flex items-center gap-4">
                  {globalView === 'game' && (
                    <button onClick={() => goToGameView('profile')} className={`p-2 rounded-lg transition-colors ${currentView === 'profile' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800'}`} title="Meu Perfil"><UserIcon size={18} /></button>
                  )}
                  <div className="text-right">
                    <div className="text-xs text-slate-500 uppercase">{user.isAdmin ? 'ADMINISTRATOR' : 'Operador'}</div>
                    <div className={`text-sm font-bold ${user.isAdmin ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}`}>{user.username}</div>
                  </div>

                  {(user.isAdmin || user.isImpersonating) && globalView !== 'admin' && (
                    <button onClick={async () => {
                      if (user.isImpersonating) {
                        await stopImpersonate();
                        window.location.reload();
                      } else {
                        setGlobalView('admin');
                      }
                    }} className="text-red-500 hover:text-red-400 font-bold text-sm">
                      {user.isImpersonating ? 'ADMIN' : 'ADMIN'}
                    </button>
                  )}
                  <button onClick={handleLogout} className="bg-red-100 dark:bg-red-900/20 hover:bg-red-200 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 p-2 rounded border border-red-200 dark:border-red-900/50 transition" title="Logout"><LogOut size={18} /></button>
                </div>
              )}
            </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setMobileMenuOpen(false)}
            className="absolute inset-0 bg-slate-950/72 backdrop-blur-[2px]"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[84vw] max-w-[320px] flex-col border-r border-amber-500/20 bg-gradient-to-b from-[#0b1224] via-[#0b1020] to-[#080d18] shadow-[0_20px_60px_rgba(0,0,0,0.55)]">
            <div className="flex items-center justify-between border-b border-slate-800/90 px-4 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-slate-900 ring-2 ring-amber-500/50 shadow-lg shadow-amber-600/25">
                  <img
                    src="/img/favicon/genesis-miner-logo.png"
                    alt=""
                    className="h-full w-full object-cover"
                    width={40}
                    height={40}
                    aria-hidden
                  />
                </div>
                <div className="min-w-0 text-left">
                  <div className="truncate text-lg font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                    Genesis Miner
                  </div>
                  <div className="block truncate text-[9px] font-semibold tracking-wider bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                    Ecossistema online V0.5 — Genesis DAO
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg border border-slate-700 bg-slate-900/80 p-2 text-slate-300 transition hover:border-amber-500/40 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div
              className="flex-1 overflow-y-auto px-3 py-4 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.38)_rgba(15,23,42,0.16)] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-slate-950/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-500/60 [&::-webkit-scrollbar-thumb]:border [&::-webkit-scrollbar-thumb]:border-slate-900/70"
            >
              <div className="space-y-2">
                {globalView === 'game' && user && (
                  <div className="mb-4 space-y-3 border-b border-slate-800/90 pb-4">
                    {(Object.keys(gameNavSectionLabels) as GameNavSectionKey[]).map((section) => {
                      const items = gameNavItems.filter((item) => item.section === section);
                      if (items.length === 0) return null;
                      return (
                        <div key={section} className="space-y-2">
                          <div className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-amber-400/80">
                            {gameNavSectionLabels[section]}
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            {items.map((item) => {
                              const Icon = item.icon;
                              return (
                                <button
                                  key={item.key}
                                  onClick={() => {
                                    goToGameView(item.key);
                                    setMobileMenuOpen(false);
                                  }}
                                  className={`${gameNavTabClass(currentView === item.key, item.accent)} w-full justify-start`}
                                >
                                  <Icon size={16} className="shrink-0 opacity-90" />
                                  <span className="truncate">{item.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  onClick={() => { navigateGlobalView('home'); setMobileMenuOpen(false); }}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm font-bold transition ${
                    globalView === 'home'
                      ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                      : 'border-slate-800 bg-slate-900/70 text-slate-200 hover:border-slate-600 hover:bg-slate-800/90'
                  }`}
                >
                  <Home size={17} /> Início
                </button>
                <a
                  href="https://t.me/+Fm72joLwb-tjYTZh"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-sm font-bold text-[#229ED9] transition hover:border-slate-600 hover:bg-slate-800/90"
                >
                  <TelegramIcon size={17} /> Telegram
                </a>
                <button
                  onClick={() => { setMobileMenuOpen(false); if (!user) navigateGlobalView('auth'); else { setGlobalView('game'); setCurrentView('ranking'); } }}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-left text-sm font-bold text-yellow-400 transition hover:border-slate-600 hover:bg-slate-800/90"
                >
                  <Trophy size={17} /> Ranking
                </button>
                <button
                  onClick={() => { navigateGlobalView('docs'); setMobileMenuOpen(false); }}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm font-bold transition ${
                    globalView === 'docs'
                      ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                      : 'border-slate-800 bg-slate-900/70 text-slate-200 hover:border-slate-600 hover:bg-slate-800/90'
                  }`}
                >
                  <BookOpen size={17} /> Docs
                </button>

                {user && (globalView === 'home' || globalView === 'docs') && !user.isAdmin && (
                  <button
                    onClick={() => { setGlobalView('game'); setCurrentView('servers'); setMobileMenuOpen(false); }}
                    className="flex w-full items-center gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 px-3 py-3 text-left text-sm font-bold text-amber-300 transition hover:bg-amber-500/15"
                  >
                    <Play size={17} fill="currentColor" /> Jogar
                  </button>
                )}

                {!user ? (
                  <button
                    onClick={() => { navigateGlobalView('auth'); setMobileMenuOpen(false); }}
                    className="mt-4 flex w-full items-center gap-3 rounded-xl bg-gradient-to-r from-amber-400 to-amber-600 px-3 py-3 text-sm font-bold text-stone-950 shadow-lg shadow-amber-950/30 transition hover:from-amber-300 hover:to-amber-500"
                  >
                    <UserIcon size={17} /> Login
                  </button>
                ) : (
                  <div className="mt-5 space-y-2 border-t border-slate-800/90 pt-4">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
                      <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                        {user.isAdmin ? 'Administrator' : 'Operador'}
                      </div>
                      <div className={`mt-1 text-sm font-bold ${user.isAdmin ? 'text-red-400' : 'text-amber-300'}`}>
                        {user.username}
                      </div>
                    </div>
                    {user.isAdmin && globalView !== 'admin' && (
                      <button
                        onClick={() => { setGlobalView('admin'); setMobileMenuOpen(false); }}
                        className="flex w-full items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-left text-sm font-bold text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10"
                      >
                        <Shield size={17} /> Painel Admin
                      </button>
                    )}
                    <button
                      onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
                      className="flex w-full items-center gap-3 rounded-xl border border-red-900/50 bg-red-950/20 px-3 py-3 text-left text-sm font-bold text-red-400 transition hover:bg-red-950/40"
                    >
                      <LogOut size={17} /> Sair
                    </button>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* CONTENT AREA — um único <main> (evita landmark aninhado no jogo) */}
      <main id="main-content" className="flex-1 min-h-0 min-w-0 overflow-hidden relative flex flex-col">
        {globalView === 'home' && <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col"><div className="flex-1 min-w-0"><HomePage onNavigate={(view, opts) => {
          navigateGlobalView(view, { authMode: opts?.mode });
        }} /></div><Footer onNavigate={navigateGlobalView} showMarketNews={false} /></div>}
        {globalView === 'docs' && (
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
            <div className="flex-1 min-w-0">
              <Suspense fallback={<LazyRouteFallback />}>
                <DocsPage />
              </Suspense>
            </div>
            <Footer onNavigate={navigateGlobalView} />
          </div>
        )}
        {globalView === 'terms' && (
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
            <div className="flex-1 min-w-0">
              <Suspense fallback={<LazyRouteFallback />}>
                <TermsPage />
              </Suspense>
            </div>
            <Footer onNavigate={navigateGlobalView} showMarketNews={false} />
          </div>
        )}
        {globalView === 'privacy' && (
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
            <div className="flex-1 min-w-0">
              <Suspense fallback={<LazyRouteFallback />}>
                <PrivacyPage />
              </Suspense>
            </div>
            <Footer onNavigate={navigateGlobalView} showMarketNews={false} />
          </div>
        )}
        {globalView === 'cookies' && (
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
            <div className="flex-1 min-w-0">
              <Suspense fallback={<LazyRouteFallback />}>
                <CookiesPolicyPage />
              </Suspense>
            </div>
            <Footer onNavigate={navigateGlobalView} showMarketNews={false} />
          </div>
        )}
        {globalView === 'aml' && (
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
            <div className="flex-1 min-w-0">
              <Suspense fallback={<LazyRouteFallback />}>
                <AmlPolicyPage />
              </Suspense>
            </div>
            <Footer onNavigate={navigateGlobalView} showMarketNews={false} />
          </div>
        )}
        {globalView === 'web3_risk' && (
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
            <div className="flex-1 min-w-0">
              <Suspense fallback={<LazyRouteFallback />}>
                <Web3RiskPage />
              </Suspense>
            </div>
            <Footer onNavigate={navigateGlobalView} showMarketNews={false} />
          </div>
        )}
        {globalView === 'refunds' && (
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
            <div className="flex-1 min-w-0">
              <Suspense fallback={<LazyRouteFallback />}>
                <RefundPolicyPage />
              </Suspense>
            </div>
            <Footer onNavigate={navigateGlobalView} showMarketNews={false} />
          </div>
        )}
        {globalView === 'community' && (
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
            <div className="flex-1 min-w-0">
              <Suspense fallback={<LazyRouteFallback />}>
                <CommunityPolicyPage />
              </Suspense>
            </div>
            <Footer onNavigate={navigateGlobalView} showMarketNews={false} />
          </div>
        )}
        {(globalView === 'login' || globalView === 'register' || globalView === 'auth') && (
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar bg-slate-50 dark:bg-slate-950 flex flex-col">
            <div className="flex-1 min-w-0">
              <Suspense fallback={<LazyRouteFallback />}>
                <AuthPage
                  onLogin={handleLogin}
                  accessLevels={accessLevels}
                  initialMode={globalView === 'register' ? 'register' : 'login'}
                />
              </Suspense>
            </div>
            <Footer onNavigate={navigateGlobalView} showMarketNews={false} />
          </div>
        )}

        {globalView === 'admin' && user?.isAdmin && (
          <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
            <div className="flex-1 min-w-0">
              <Suspense fallback={<LazyRouteFallback />}>
                <AdminPanel
                  user={user}
                  onUpdateGameUpgrades={updateGameUpgrades} gameUpgrades={gameUpgrades}
                  onUpdateAccessLevels={updateAccessLevels} accessLevels={accessLevels}
                  onUpdateLootBoxes={updateLootBoxes} lootBoxes={lootBoxDefs}
                />
              </Suspense>
            </div>
            <Footer onNavigate={navigateGlobalView} />
          </div>
        )}

        {globalView === 'game' && user && (
          <>
            {/* GAME CONTENT WRAPPER WITH SIDEBARS */}
            <div
              className={`flex-1 min-w-0 flex overflow-hidden relative w-full h-full ${
                currentView === 'dashboard' || currentView === 'partners' || currentView === 'partner_games' ? 'justify-start' : 'justify-center'
              }`}
            >
              <aside
                className={`hidden lg:flex shrink-0 ${
                  gameNavExpanded ? 'w-[250px]' : 'w-[92px]'
                } sticky top-24 self-start mt-4 ml-4 mr-3 max-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-slate-800/90 bg-[#121212]/96 backdrop-blur-md shadow-[0_24px_60px_-30px_rgba(0,0,0,0.65)] transition-all duration-300`}
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-3">
                  {gameNavExpanded ? (
                    <div className="min-w-0">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-400/90">Operação</p>
                      <p className="truncate text-xs font-semibold text-slate-400">
                        {GAME_NAV_LABEL_KEYS.includes(currentView as GameNavLabelKey) && getAllowedPages().includes(currentView)
                          ? gameNav(currentView as GameNavLabelKey)
                          : 'Menu do jogo'}
                      </p>
                    </div>
                  ) : (
                    <span className="mx-auto text-[10px] font-black uppercase tracking-[0.2em] text-amber-400/90">Nav</span>
                  )}
                  <button
                    type="button"
                    onClick={toggleGameNavExpanded}
                    aria-expanded={gameNavExpanded}
                    aria-label={gameNavExpanded ? 'Recolher menu lateral' : 'Expandir menu lateral'}
                    title={gameNavExpanded ? 'Recolher menu lateral' : 'Expandir menu lateral'}
                    className={`shrink-0 rounded-lg border p-2 transition-all ${
                      gameNavExpanded
                        ? 'border-amber-400/55 text-amber-200 bg-amber-950/45'
                        : 'border-amber-500/65 text-amber-100 bg-amber-500/15 ring-1 ring-amber-400/25'
                    }`}
                  >
                    {gameNavExpanded ? <ChevronUp size={16} /> : <Menu size={16} />}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar p-2">
                  <div className="space-y-3">
                    {(Object.keys(gameNavSectionLabels) as GameNavSectionKey[]).map((section) => {
                      const items = gameNavItems.filter((item) => item.section === section);
                      if (items.length === 0) return null;
                      return (
                        <div key={section} className="space-y-2">
                          {gameNavExpanded ? (
                            <div className="px-2 text-[10px] font-black uppercase tracking-[0.2em] text-amber-400/80">
                              {gameNavSectionLabels[section]}
                            </div>
                          ) : null}
                          <div className="flex flex-col gap-2">
                            {items.map((item) => {
                              const Icon = item.icon;
                              return (
                                <button
                                  key={item.key}
                                  type="button"
                                  onClick={() => { goToGameView(item.key); }}
                                  className={`${gameNavTabClass(currentView === item.key, item.accent)} w-full justify-start ${gameNavExpanded ? '' : 'px-0 justify-center'}`}
                                  title={item.label}
                                >
                                  <Icon size={16} className="shrink-0 opacity-90" />
                                  {gameNavExpanded ? <span className="truncate">{item.label}</span> : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </aside>

              <div
                className={`flex-1 min-w-0 overflow-hidden relative w-full flex flex-col min-h-0 ${
                  currentView === 'dashboard' || currentView === 'partners' || currentView === 'partner_games'
                    ? 'max-w-none'
                    : 'max-w-7xl'
                }`}
              >
                {currentView === 'servers' && (
                  <DailyCheckinBanner saveLoaded={saveLoaded} onRewardGranted={() => setGameStateReloadNonce((n) => n + 1)} />
                )}
                <div
                  className={`flex-1 min-w-0 relative min-h-0 flex flex-col font-mono ${
                    currentView === 'calculator'
                      ? 'overflow-hidden'
                      : 'overflow-y-auto overflow-x-hidden custom-scrollbar'
                  }`}
                >
                  {!saveLoaded && gameStateLoadError && (
                    <div className="flex min-h-[40vh] w-full flex-col items-center justify-center gap-4 bg-slate-900/80 text-slate-200 font-mono rounded-xl border border-red-900/30 px-6 py-8 text-center">
                      <p className="text-sm text-red-300 max-w-md">{gameStateLoadError}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setGameStateLoadError(null);
                          setGameStateReloadNonce((n) => n + 1);
                        }}
                        className="rounded-lg border border-amber-500/60 bg-amber-600/20 px-4 py-2 text-sm font-bold text-amber-200 hover:bg-amber-600/30 transition"
                      >
                        Tentar novamente
                      </button>
                    </div>
                  )}
                  {!saveLoaded && !gameStateLoadError && (
                    <div className="flex min-h-[40vh] w-full items-center justify-center bg-slate-900/80 text-amber-500 font-mono rounded-xl border border-amber-900/20">
                      <div className="text-xl animate-pulse tracking-widest">Carregando estado…</div>
                    </div>
                  )}

                  {saveLoaded && currentView === 'servers' && (
                    <div className="flex-1 p-6 space-y-6 animate-in fade-in zoom-in-95 duration-300 flex flex-col">
                      <div className="flex-1 flex flex-col">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <ServerRoom
                            {...gameState}
                            rackBatteryCatalogHints={Object.fromEntries(rackBatteryFromStockCatalogRef.current)}
                            onPlaceRack={handlePlaceRack}
                            onRemoveRack={handleRemoveRack}
                            onEquipMiner={handleEquipMiner}
                            onUnequipMiner={handleUnequipMiner}
                            onEquipAux={handleEquipAux}
                            onUnequipAux={handleUnequipAux}
                            onTogglePower={handleTogglePower}
                            upgrades={gameUpgrades}
                            miningCoins={miningCoins}
                            onSetRackCoin={handleSetRackCoin}
                            onSetRoomRacksCoin={handleSetRoomRacksCoin}
                            userEmail={user?.email}
                            onRoomPurchase={() => handleReloadGameState()}
                            onOpenCalculator={isOperatorAdminOnly ? undefined : () => goToGameView('calculator')}
                          />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}

                  {saveLoaded && currentView === 'calculator' && !isOperatorAdminOnly && (
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-300">
                      <Suspense fallback={<LazyRouteFallback />}>
                        <PlayerCalculator onBack={() => goToGameView('servers')} />
                      </Suspense>
                    </div>
                  )}


                  {/* Aba Oficina removida: sistema de carregamento foi descontinuado e
                      todas as baterias passaram a ser Estelar (infinitas). */}
                  {saveLoaded && currentView === 'arcade' && (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500 py-20">
                      <Gamepad2 size={48} className="animate-bounce" />
                      <h2 className="text-2xl font-bold uppercase tracking-widest bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">Arcade em preparação</h2>
                      <p className="max-w-md text-center text-sm">Estamos montando uma zona arcade dentro do Genesis Miner. Volte em breve para novidades.</p>
                    </div>
                  )}
                  {saveLoaded && currentView === 'inventory' && (
                    <div className="flex-1 flex flex-col">
                      <div className="flex-1 p-6">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <InventoryView
                            stock={gameState.stock}
                            storedBatteries={inventoryBatteries ?? gameState.storedBatteries}
                            inventoryStackableCategories={inventoryStackableCategories}
                            asicLeases={gameState.asicLeases}
                            upgrades={gameUpgrades}
                          />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'hardware_store' && (
                    <div className="flex-1 flex flex-col p-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <UpgradeShop
                            gameState={gameState}
                            user={user}
                            upgrades={gameUpgrades}
                            onSuggestDeposit={handleSuggestDeposit}
                            isEnabled={economySettings.hardwareMarketEnabled}
                            onAfterShopCheckout={handleReloadGameState}
                            onShopNotice={setHardwareShopNotice}
                          />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'lucky_store' && (
                    <div className="flex-1 flex flex-col p-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <LuckyBoxStore
                            gameState={gameState}
                            lootBoxes={lootBoxDefs}
                            upgrades={gameUpgrades}
                            userEmail={user?.email ?? null}
                            onBuyBox={handleBuyBox}
                            onOpenBox={handleOpenBox}
                            onDiscardBox={handleDiscardLootBox}
                            onRedeemSuccess={handleRedeemSuccess}
                            onOpenRoleta={openRoletaWithCode}
                          />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'roleta' && getAllowedPages().includes('roleta') && (
                    /** Roleta: sem `<Footer />` (sem MarketNews/ads/copyright) para a tela ficar limpa e
                     *  sem barra a invadir o conteúdo principal — a UX deste ecrã é a roda + cartas, não
                     *  conteúdo "abaixo da dobra". */
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden custom-scrollbar animate-in fade-in slide-in-from-right-4 duration-300">
                      <Suspense fallback={<LazyRouteFallback />}>
                        <RoletaPage
                          upgrades={gameUpgrades}
                          onRedeemSuccess={handleRedeemSuccess}
                          bootstrap={roletaBootstrap}
                          onBootstrapConsumed={clearRoletaBootstrap}
                          usdcBalance={gameState.usdc}
                          onReloadGameState={handleReloadGameState}
                          onGoToLuckyBoxes={() => setCurrentView('lucky_store')}
                        />
                      </Suspense>
                    </div>
                  )}
                  {saveLoaded && currentView === 'black_market' && (
                    <div className="flex-1 flex flex-col p-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1 min-h-0" style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
                        <Suspense fallback={<LazyRouteFallback />}>
                          <BlackMarket gameState={gameState} onBuyListing={handleP2PBuy} onCreateListing={handleCreateListing} onCancelListing={handleCancelListing} upgrades={gameUpgrades} currentUserName={user?.username} currentUserEmail={user?.email} isEnabled={economySettings.blackMarketEnabled} onClaimSuccess={handleReloadGameState} refreshTrigger={marketRefreshTrigger} priceBandPercent={economySettings.blackMarketPriceBandPercent ?? 20} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'wallet' && (
                    <div className="flex-1 flex flex-col p-6 space-y-6 animate-in fade-in slide-in-from-left-4 duration-300">
                      <div className="flex-1">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
                            <Exchange
                              coinBalances={deskCoinBalancesForExchange}
                              miningCoins={deskMiningCoinsForExchange}
                              onSellCoin={handleSellCoin}
                              serverDeskSettings={serverDeskSettingsForExchange}
                            />
                            <WalletActions onAddUSDC={handleAddUSDC} onStartDeposit={handleStartDeposit} depositStatus={depositFlow.status} depositAmount={depositFlow.amount} depositFailureMessage={depositFlow.failureReason} onCloseDepositStatus={() => setDepositFlow({ pending: false })} onSyncQueuedDeposit={depositFlow.status === 'queued' && depositFlow.txHash && user?.email ? async () => { const net = depositFlow.network || 'polygon'; const out = await verifyDepositWithServer(depositFlow.txHash!, net); if (out.ok) setDepositFlow((f) => ({ ...f, status: 'success' })); else if (out.pending) alert('Ainda à espera de confirmação na rede.'); else alert(out.error || 'Não foi possível sincronizar.'); } : undefined} onOpenWithdrawalHistory={() => goToGameView('withdrawal_history')} userEmail={user?.email || null} onVerifyDepositByHash={user?.email ? async (txHash, network) => verifyDepositWithServer(txHash.trim(), network) : undefined} hasWallet={!!user?.polygonWallet} coinBalances={gameState.coinBalances || {}} miningCoins={miningCoins.map((c) => ({
                              id: c.id,
                              name: c.name,
                              symbol: c.symbol,
                              priceUSD: c.priceUSD || 0,
                              usdcRate:
                                typeof c.usdcRate === 'number' && c.usdcRate > 0 ? c.usdcRate : c.priceUSD || 0
                            }))} coinRates={(() => { const rates: Record<string, number> = {}; gameState.placedRacks.forEach(r => { if (!r.isOn || !r.wiringId || !r.batteryId || !r.selectedCoinId) return; let base = 0; r.slots.forEach(sid => { if (!sid) return; const up = gameUpgrades.find(u => u.id === sid); if (up) base += up.baseProduction; }); let mult = 1; r.multiplierSlots?.forEach(sid => { if (!sid) return; const mod = gameUpgrades.find(u => u.id === sid); if (mod && mod.multiplier) mult += mod.multiplier; }); const prod = base * mult; const coin = miningCoins.find(c => c.id === r.selectedCoinId); const yieldPerHash = coin ? (coin.minProportion || 0) : 0; const rate = prod * yieldPerHash; rates[r.selectedCoinId] = (rates[r.selectedCoinId] || 0) + rate; }); return rates; })()} onWithdrawCoin={handleWithdrawCoin} prefillAmount={depositPrefill} withdrawTokens={web3SettingsState?.withdrawTokens?.map(t => ({ name: t.name, symbol: (t as { symbol?: string }).symbol, coinId: (t as { coinId?: string }).coinId, contract: t.contract, payoutWallet: (t as { payoutWallet?: string }).payoutWallet, minAmount: t.minAmount, minWithdrawalUsdc: t.minWithdrawalUsdc, feePercent: t.feePercent, disabled: (t as { disabled?: boolean }).disabled }))} minDepositUsdc={web3SettingsState?.minDepositUsdc} depositPolygonDisabled={web3SettingsState?.depositPolygonDisabled} depositBnbDisabled={web3SettingsState?.depositBnbDisabled} depositBaseDisabled={web3SettingsState?.depositBaseDisabled} />
                            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-lg flex flex-col justify-between md:col-span-2 lg:col-span-2 xl:col-span-2 transition-colors">
                              <div>
                                <h3 className="text-slate-700 dark:text-slate-300 font-bold flex items-center gap-2 mb-4 border-b border-slate-200 dark:border-slate-800 pb-2"><LayoutDashboard size={18} /> ESTATÍSTICAS</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                  <div className="flex flex-col bg-slate-50 dark:bg-slate-950 p-4 rounded border border-slate-200 dark:border-slate-800"><span className="text-slate-500 text-sm">Máquinas Ativas</span><span className="font-mono text-slate-700 dark:text-slate-200">{countActiveMachines(gameState.placedRacks)} Unidades</span></div>
                                  <div className="flex flex-col bg-slate-50 dark:bg-slate-950 p-4 rounded border border-slate-200 dark:border-slate-800"><span className="text-slate-500 text-sm">Rigs Instalados</span><span className="font-mono text-slate-700 dark:text-slate-200">{gameState.placedRacks.length} Unidades</span></div>
                                </div>
                              </div>
                              <div className="mt-8 pt-4 border-t border-slate-200 dark:border-slate-800" />
                            </div>
                          </div>
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}

                  {saveLoaded && currentView === 'upgrade' && (
                    <div className="flex-1 flex flex-col">
                      <div className="flex-1">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <UpgradeAccount user={user} accessLevels={accessLevels} onUpgrade={handleUpgradeAccess} usdcBalance={gameState.usdc} onSuggestDeposit={handleSuggestDeposit} onPassPurchased={handlePassPurchased} onReloadGameState={handleReloadGameState} onGoToLuckyBoxes={() => setCurrentView('lucky_store')} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'ranking' && (
                    <div className="flex-1 flex flex-col p-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <AdminRanking isPublic={true} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'transparency' && getAllowedPages().includes('transparency') && (
                    <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <TransparencyPage />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'withdrawal_history' && user && (
                    <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <WithdrawalHistoryPage />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'support' && user && getAllowedPages().includes('support') && (
                    <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <SupportPage
                            userEmail={user.email?.trim() ? user.email : undefined}
                            username={user.username?.trim() ? user.username : undefined}
                            onClose={() => goToGameView('servers')}
                          />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'partners' && getAllowedPages().includes('partners') && (
                    <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <PartnersPage />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'partner_games' && user && (
                    <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <PartnersPage />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'offerwall' && user && (
                    <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <OfferwallPage />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'profile' && user && (
                    <div className="flex-1 flex flex-col">
                      <div className="flex-1">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <ProfilePage user={user} onUpdateProfile={handleUpdateUser} onUpdateGameState={(next) => setGameState(next)} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                  {saveLoaded && currentView === 'dashboard' && user && (
                    <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col">
                        <Suspense fallback={<LazyRouteFallback />}>
                          <DashboardPage onNavigate={(v) => goToGameView(v as View)} />
                        </Suspense>
                      </div>
                      <Footer />
                    </div>
                  )}
                </div>
              </div>

              {currentView !== 'dashboard' && currentView !== 'partners' && (
              <aside className="hidden 2xl:flex shrink-0 w-[145.6px] h-[546px] sticky top-24 mx-4 overflow-hidden rounded-xl border border-orange-500/20 bg-slate-900/40 backdrop-blur-sm self-start mt-4 transition-all duration-500 hover:border-orange-500/40 shadow-2xl shadow-orange-500/5">
                {verticalAds[1] || verticalAds[0] ? (
                  <a href={(verticalAds[1] || verticalAds[0]).link || '#'} target={(verticalAds[1] || verticalAds[0]).link ? "_blank" : "_self"} rel="noopener noreferrer" className="w-full h-full block">
                    {(verticalAds[1] || verticalAds[0]).imageUrl ? (
                      <RemoteBannerImage
                        src={(verticalAds[1] || verticalAds[0]).imageUrl!}
                        alt={(verticalAds[1] || verticalAds[0]).text}
                        className="w-full h-full object-contain"
                        failureHint="Lateral — URL falhou"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-4 text-center bg-slate-950/50">
                        <span className="text-xs text-orange-400 font-bold uppercase">{(verticalAds[1] || verticalAds[0]).text}</span>
                      </div>
                    )}
                  </a>
                ) : (
                  <RemoteBannerImage
                    src="/brain/c5bf420e-fa44-42f3-b118-ac4247fdd4b0/skyscrapers_ad_160x600_right_1768840857057.png"
                    alt="Lateral Direita"
                    className="w-full h-full object-contain"
                    failureHint="Sem imagem"
                  />
                )}
              </aside>
              )}

            </div>
          </>
        )}
        {showRewardModal && (
          <Suspense fallback={<div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80"><RefreshCw className="animate-spin text-amber-400" size={32} /></div>}>
            <RewardLoadingScreen
              rewards={pendingRewardSummary}
              onComplete={handleRewardComplete}
              isReturningUser={!(user as any).isNewRegistration}
              offlineEarnings={offlineStats}
              coinNames={Object.fromEntries(miningCoins.map(c => [c.id, c.name]))}
            />
          </Suspense>
        )}

        <UiNoticeModal
          notice={hardwareShopNotice}
          onClose={() => setHardwareShopNotice(null)}
          overlayZClassName="z-[140]"
        />
        <UiNoticeModal
          notice={luckyBoxNotice}
          onClose={() => setLuckyBoxNotice(null)}
          overlayZClassName="z-[140]"
        />

        {bulkBatteryNotice && (
          <div
            className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/60 dark:bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-battery-notice-title"
          >
            <div className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl animate-in zoom-in-95 duration-200 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex gap-3 border-b border-amber-500/35 bg-amber-50 p-4 dark:border-amber-600/30 dark:bg-amber-950/25">
                <Battery className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" size={22} aria-hidden />
                <div className="min-w-0">
                  <h3 id="bulk-battery-notice-title" className="text-sm font-black uppercase tracking-wide text-slate-900 dark:text-white">
                    {bulkBatteryNotice.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{bulkBatteryNotice.message}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <button
                  type="button"
                  onClick={() => setBulkBatteryNotice(null)}
                  className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-bold uppercase tracking-wide text-white shadow-md shadow-amber-600/20 transition hover:bg-amber-500 active:scale-[0.98]"
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        )}


      </main>
    </div>
  );
}
