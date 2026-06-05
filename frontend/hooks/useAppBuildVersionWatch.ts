import { useEffect } from 'react';
import {
  remoteBuildStampDiffersFromLoadedJs,
  tryAutoRecoverFromStaleChunk,
} from '../lib/chunkRecovery';

const VERSION_POLL_MS = 4 * 60 * 1000;

/**
 * Detecta deploy novo com o separador aberto e recarrega antes de falhar um chunk lazy.
 */
export function useAppBuildVersionWatch(): void {
  useEffect(() => {
    if (!import.meta.env.PROD) return;

    let cancelled = false;

    const check = async () => {
      if (cancelled) return;
      try {
        if (await remoteBuildStampDiffersFromLoadedJs()) {
          tryAutoRecoverFromStaleChunk({ aggressive: true, force: true });
        }
      } catch {
        /* ignore */
      }
    };

    void check();

    const intervalId = window.setInterval(() => {
      void check();
    }, VERSION_POLL_MS);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void check();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
