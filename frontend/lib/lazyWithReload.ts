import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { isChunkLikeLoadError, tryAutoRecoverFromStaleChunk } from './chunkRecovery';

/**
 * `React.lazy` com auto-recarga se o chunk falhar (HTML/JS antigo após deploy).
 * Evita ecrã preso em "Failed to fetch dynamically imported module".
 */
export function lazyWithReload<T extends ComponentType<unknown>>(
  importer: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await importer();
    } catch (err) {
      if (typeof window !== 'undefined' && isChunkLikeLoadError(err)) {
        const reloading = tryAutoRecoverFromStaleChunk({ aggressive: true });
        if (reloading) {
          return await new Promise<{ default: T }>(() => {});
        }
      }
      throw err;
    }
  });
}
