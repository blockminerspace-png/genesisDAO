import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getZeradsStats, getZeradsToken } from '../services/api';

/**
 * Mocks de `fetch` para os clientes ZERads em services/api.ts.
 *
 * `apiFetch` (interno) chama `fetch` global; em 401 tenta refresh apenas se
 * `genesis_has_session=1` no localStorage — limpamos no beforeEach pra evitar
 * a tentativa de refresh nesses testes (mantém os mocks simples).
 */
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  try {
    window.localStorage.removeItem('genesis_has_session');
  } catch {
    /* jsdom já cobre, ignore */
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain' } });
}

describe('getZeradsToken', () => {
  it('retorna payload completo em 200', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        token: 'a'.repeat(64),
        ptc_url: `https://zerads.com/ptc.php?ref=11294&user=${'a'.repeat(64)}`
      })
    );

    const res = await getZeradsToken();
    expect(res).not.toBeNull();
    expect(res?.token).toMatch(/^[a-f0-9]{64}$/);
    expect(res?.ptc_url).toContain('ref=11294');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('/api/zerads/me/token');
    expect((init as RequestInit | undefined)?.credentials).toBe('include');
  });

  it('retorna null em 401 sem lançar', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unauthenticated' }, 401));
    const res = await getZeradsToken();
    expect(res).toBeNull();
  });

  it('retorna null em 500', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
    const res = await getZeradsToken();
    expect(res).toBeNull();
  });

  it('retorna null quando fetch rejeita (rede offline)', async () => {
    fetchMock.mockRejectedValue(new TypeError('NetworkError'));
    const res = await getZeradsToken();
    expect(res).toBeNull();
  });

  it('retorna null quando body não é JSON parseable', async () => {
    fetchMock.mockResolvedValue(textResponse('not json', 200));
    const res = await getZeradsToken();
    expect(res).toBeNull();
  });
});

describe('getZeradsStats', () => {
  const fullPayload = {
    totals: {
      callbacks: 3,
      amount_zer: 0.15,
      user_amount_usdc: 0.00156,
      platform_amount_usdc: 0.00039,
      clicks: 9
    },
    recent: [
      {
        amount_zer: 0.05,
        user_amount_usdc: 0.00052,
        clicks: 3,
        zer_to_usdc_rate: 0.013,
        created_at: 1_700_000_000_000
      }
    ]
  };

  it('retorna payload completo em 200', async () => {
    fetchMock.mockResolvedValue(jsonResponse(fullPayload));
    const res = await getZeradsStats();
    expect(res).toEqual(fullPayload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('/api/zerads/me/stats');
  });

  it('retorna estrutura vazia quando recent: []', async () => {
    const empty = {
      totals: {
        callbacks: 0,
        amount_zer: 0,
        user_amount_usdc: 0,
        platform_amount_usdc: 0,
        clicks: 0
      },
      recent: []
    };
    fetchMock.mockResolvedValue(jsonResponse(empty));
    const res = await getZeradsStats();
    expect(res).toEqual(empty);
    expect(res?.recent).toEqual([]);
  });

  it('retorna null em 500', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'boom' }, 500));
    const res = await getZeradsStats();
    expect(res).toBeNull();
  });

  it('retorna null quando fetch rejeita', async () => {
    fetchMock.mockRejectedValue(new TypeError('NetworkError'));
    const res = await getZeradsStats();
    expect(res).toBeNull();
  });

  it('retorna null em 401 sem propagar refresh side-effects', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'unauthenticated' }, 401));
    const res = await getZeradsStats();
    expect(res).toBeNull();
    // sem session hint, o apiFetch não tenta refresh — então é uma única chamada
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
