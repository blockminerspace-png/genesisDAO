import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isChunkLikeLoadError,
  probeFreshHtmlBuildStamp,
  tryAutoRecoverFromStaleChunkError,
} from '../lib/chunkRecovery';

describe('isChunkLikeLoadError', () => {
  it('deteta mensagem EN de import dinâmico', () => {
    const err = new Error('Failed to fetch dynamically imported module: https://example.com/assets/AuthPage-x.js');
    expect(isChunkLikeLoadError(err)).toBe(true);
  });

  it('deteta mensagem PT de import dinâmico', () => {
    const err = new Error(
      'Falha ao buscar o módulo importado dinamicamente: https://genesisdao.tech/assets/AuthPage-DTnmN-2a.js'
    );
    expect(isChunkLikeLoadError(err)).toBe(true);
  });

  it('deteta mensagem ES de import dinâmico', () => {
    const err = new Error('Error al importar un módulo dinámicamente: https://example.com/assets/App-x.js');
    expect(isChunkLikeLoadError(err)).toBe(true);
  });

  it('deteta URL /assets/*.js mesmo sem texto conhecido', () => {
    expect(isChunkLikeLoadError('network /assets/AuthPage-abc123.js')).toBe(true);
  });

  it('ignora erros genéricos', () => {
    expect(isChunkLikeLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLikeLoadError(null)).toBe(false);
  });
});

describe('tryAutoRecoverFromStaleChunkError', () => {
  const replaceSpy = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('location', {
      href: 'https://genesisdao.tech/game',
      pathname: '/game',
      search: '',
      hash: '',
      origin: 'https://genesisdao.tech',
      replace: replaceSpy,
    });
    sessionStorage.clear();
    document.head.innerHTML = '<meta name="gm-build-id" content="prod-old" />';
    replaceSpy.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('força reload em falha de chunk mesmo com stamps HTML/JS coincidentes', async () => {
    vi.stubGlobal('caches', {
      keys: () => Promise.resolve([]),
    });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistrations: () => Promise.resolve([]),
      },
    });

    const err = new Error(
      'Falha ao buscar o módulo importado dinamicamente: https://genesisdao.tech/assets/AuthPage-old.js'
    );
    const reloading = tryAutoRecoverFromStaleChunkError(err);
    expect(reloading).toBe(true);
    expect(sessionStorage.getItem('gm_chunk_autoreload_v1')).toBe('1');
    await vi.waitFor(() => expect(replaceSpy).toHaveBeenCalled());
  });
});

describe('probeFreshHtmlBuildStamp', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('pede HTML com query de cache-bust', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<meta name="gm-build-id" content="prod-new" />',
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      pathname: '/game',
      origin: 'https://genesisdao.tech',
    });

    const stamp = await probeFreshHtmlBuildStamp();
    expect(stamp).toBe('prod-new');
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('_gm_probe=');
  });
});
