'use client';

import type { ReactNode } from 'react';
import { useSync } from '@/notes/hooks/useSync';

/**
 * Layout placeholder for the Notes experience.
 * Will eventually compose toolbars, lists, editors, and sync indicators while
 * remaining mobile-first.
 */
export const NotesShell = ({ children }: { children?: ReactNode }) => {
  const { state, offline, lastError, triggerSync } = useSync();

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background/80 px-4 py-3 backdrop-blur">
        <div className="flex flex-col">
          <span className="text-lg font-semibold">Notes</span>
          <span className="text-xs text-muted-foreground">
            {state === 'syncing' && 'Syncing…'}
            {state === 'idle' && 'All changes saved locally'}
            {state === 'error' && 'Sync issues detected'}
            {state === 'offline' && 'Working offline'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {offline && (
            <span className="rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-900">
              Offline
            </span>
          )}
          <button
            type="button"
            onClick={() => triggerSync()}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium"
          >
            Sync
          </button>
        </div>
      </div>
      {lastError && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {lastError}
        </div>
      )}
      <div className="px-4 py-3">{children ?? 'NotesShell placeholder'}</div>
    </div>
  );
};
