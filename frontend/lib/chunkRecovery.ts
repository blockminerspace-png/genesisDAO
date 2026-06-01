const CHUNK_RELOAD_KEY = 'gm_chunk_autoreload_v1';
const BUILD_STAMP_KEY = 'gm_app_build_stamp_v1';
const HTML_BUILD_STAMP_KEY = 'gm_html_build_stamp_v1';
const BOUNDARY_RECOVERY_KEY = 'gm_boundary_recovery_v1';
const MAX_AUTO_RELOADS = 3;

export function isChunkLikeLoadError(err: unknown): boolean {
  if (err == null) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /Failed to fetch dynamically imported module|ChunkLoadError|Loading chunk \d+ failed|Unable to preload CSS|Importing a module script failed|error loading dynamically imported module/i.test(
    msg
  );
}

function jsBuildStamp(): string {
  return typeof __APP_BUILD_STAMP__ !== 'undefined' && __APP_BUILD_STAMP__
    ? String(__APP_BUILD_STAMP__)
    : 'dev';
}

/** Stamp injectado no `index.html` em cada build — legível mesmo com JS antigo em cache. */
export function htmlBuildStampFromDom(): string | null {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector('meta[name="gm-build-id"]');
  const value = meta?.getAttribute('content')?.trim();
  return value || null;
}

function clearRecoveryFlags(): void {
  sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  sessionStorage.removeItem(BOUNDARY_RECOVERY_KEY);
}

function reloadCount(): number {
  const raw = sessionStorage.getItem(CHUNK_RELOAD_KEY);
  const n = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** HTML novo + JS antigo em cache (caso típico pós-deploy). */
export function isStaleJsBundleLoaded(): boolean {
  const html = htmlBuildStampFromDom();
  const js = jsBuildStamp();
  if (!html || js === 'dev') return false;
  return html !== js;
}

/** Em cada build de produção o stamp muda → permite nova auto-recarga após deploy. */
export function syncBuildStampWithSession(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const html = htmlBuildStampFromDom();
    const js = jsBuildStamp();
    const stamp = html || js;
    const prev = sessionStorage.getItem(BUILD_STAMP_KEY);
    const prevHtml = sessionStorage.getItem(HTML_BUILD_STAMP_KEY);

    if (html && prevHtml !== html) {
      clearRecoveryFlags();
      sessionStorage.setItem(HTML_BUILD_STAMP_KEY, html);
    }

    if (prev !== stamp) {
      clearRecoveryFlags();
      sessionStorage.setItem(BUILD_STAMP_KEY, stamp);
      return true;
    }
  } catch {
    /* private mode / quota */
  }
  return false;
}

export async function clearAppCaches(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* ignore */
  }
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
  } catch {
    /* ignore */
  }
}

/** Recarrega com cache-bust na URL (evita bfcache agressivo no mobile). */
export function hardReloadWithCacheBust(clearCaches = false): void {
  if (typeof window === 'undefined') return;
  const navigate = () => {
    const u = new URL(window.location.href);
    u.searchParams.set('_v', String(Date.now()));
    window.location.replace(u.pathname + u.search + u.hash);
  };
  if (clearCaches) {
    void clearAppCaches().finally(navigate);
  } else {
    navigate();
  }
}

async function probeFreshHtmlBuildStamp(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const path = window.location.pathname + window.location.search;
    const res = await fetch(path || '/', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/<meta\s+name="gm-build-id"\s+content="([^"]+)"/i);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function registerCleanupServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!import.meta.env.PROD) return;
  void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

/**
 * Tenta auto-recuperação após chunk/CSS stale (pós-deploy).
 * Devolve true se disparou reload (o caller deve abortar o fluxo actual).
 */
export function tryAutoRecoverFromStaleChunk(options?: { aggressive?: boolean; force?: boolean }): boolean {
  if (typeof window === 'undefined') return false;

  try {
    syncBuildStampWithSession();
    const staleBundle = isStaleJsBundleLoaded();
    const count = reloadCount();
    if (!options?.force && !staleBundle && count >= MAX_AUTO_RELOADS) return false;

    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(count + 1));
    hardReloadWithCacheBust(staleBundle || count >= 1 || options?.aggressive === true || options?.force === true);
    return true;
  } catch {
    hardReloadWithCacheBust(true);
    return true;
  }
}

/** Fallback para erros de import fora do React.lazy (unhandledrejection). */
export function tryAutoRecoverFromStaleChunkError(err: unknown): boolean {
  if (!isChunkLikeLoadError(err)) return false;
  return tryAutoRecoverFromStaleChunk({
    aggressive: true,
    force: isStaleJsBundleLoaded(),
  });
}

/** Uma tentativa extra via error boundary (limpa caches antes de recarregar). */
export function tryBoundaryStaleChunkRecovery(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    syncBuildStampWithSession();
    if (!isStaleJsBundleLoaded() && sessionStorage.getItem(BOUNDARY_RECOVERY_KEY)) return false;
    sessionStorage.setItem(BOUNDARY_RECOVERY_KEY, '1');
    hardReloadWithCacheBust(true);
    return true;
  } catch {
    hardReloadWithCacheBust(true);
    return true;
  }
}

async function verifyFreshBuildStamp(): Promise<void> {
  if (!import.meta.env.PROD) return;
  const remote = await probeFreshHtmlBuildStamp();
  if (!remote) return;
  const js = jsBuildStamp();
  if (js !== 'dev' && remote !== js) {
    tryAutoRecoverFromStaleChunk({ aggressive: true, force: true });
  }
}

export function initChunkRecoveryBoot(): void {
  if (typeof window === 'undefined') return;

  if (isStaleJsBundleLoaded()) {
    tryAutoRecoverFromStaleChunk({ aggressive: true, force: true });
    return;
  }

  const stampChanged = syncBuildStampWithSession();
  if (stampChanged && import.meta.env.PROD) {
    registerCleanupServiceWorker();
  }

  void verifyFreshBuildStamp();

  window.addEventListener('unhandledrejection', (event) => {
    if (tryAutoRecoverFromStaleChunkError(event.reason)) {
      event.preventDefault();
    }
  });

  window.addEventListener(
    'error',
    (event) => {
      const target = event.target;
      if (target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) {
        const src =
          target instanceof HTMLScriptElement
            ? target.src
            : target instanceof HTMLLinkElement
              ? target.href
              : '';
        if (src && /\/assets\//.test(src)) {
          if (tryAutoRecoverFromStaleChunk({ aggressive: true })) {
            event.preventDefault();
          }
        }
      }
    },
    true
  );

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void verifyFreshBuildStamp();
    }
  });
}

export function staleChunkRecoveryHint(): string {
  if (typeof window === 'undefined') {
    return 'Recarrega a página para obter a versão mais recente.';
  }
  const mobile =
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 768px)').matches);
  if (mobile) {
    return 'No telemóvel: fecha o separador, abre de novo o site, ou mantém premido o botão de recarregar e escolhe «Recarregar sem cache».';
  }
  return 'No computador: Ctrl+Shift+R (Windows/Linux) ou Cmd+Shift+R (macOS).';
}
