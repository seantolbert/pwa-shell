import { useEffect, useMemo, useState } from 'react';
import {
  fullSync,
  getSyncStatus,
  periodicSync,
  subscribeToSyncStatus,
  watchOnlineStatus,
} from '@/notes/sync';
import type { SyncStatus } from '@/notes/types';

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

const deriveState = (status: SyncStatus): SyncState => {
  if (status.isSyncing) return 'syncing';
  if (status.offline) return 'offline';
  if (status.lastError) return 'error';
  return 'idle';
};

/**
 * Initializes the sync engine when mounted and surfaces current status for UI
 * components (e.g., showing progress, errors, or offline alerts).
 */
export const useSync = () => {
  const [status, setStatus] = useState<SyncStatus>(() => getSyncStatus());

  useEffect(() => {
    const unsubscribeStatus = subscribeToSyncStatus(setStatus);
    const unsubscribeOnline = watchOnlineStatus(() => undefined);
    const stopPeriodic = periodicSync();

    void fullSync();

    return () => {
      unsubscribeStatus();
      unsubscribeOnline();
      stopPeriodic();
    };
  }, []);

  const state = useMemo(() => deriveState(status), [status]);

  return {
    state,
    isSyncing: status.isSyncing,
    lastRun: status.lastRun,
    lastError: status.lastError,
    offline: status.offline,
    triggerSync: () => fullSync(),
  };
};
