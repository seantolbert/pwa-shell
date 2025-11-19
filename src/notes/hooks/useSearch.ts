import { useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import Fuse from 'fuse.js';
import { listNotes } from '@/notes/db';
import { decryptText } from '@/notes/services/encryption';
import type { LocalNoteRecord } from '@/notes/types';

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  updatedAt: string;
  score?: number;
}

interface SearchableNote {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

const decryptNoteForSearch = async (record: LocalNoteRecord): Promise<SearchableNote> => {
  const [title, content] = await Promise.all([
    record.encrypted_title ? decryptText(record.encrypted_title) : Promise.resolve(''),
    record.encrypted_content ? decryptText(record.encrypted_content) : Promise.resolve(''),
  ]);
  return {
    id: record.id,
    title,
    content,
    updatedAt: record.updatedAt,
  };
};

const buildSnippet = (content: string, query: string) => {
  if (!content) return '';
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerContent.indexOf(lowerQuery);
  if (idx === -1) {
    return content.slice(0, 120);
  }
  const start = Math.max(0, idx - 30);
  const end = Math.min(content.length, idx + lowerQuery.length + 30);
  return content.slice(start, end);
};

export const useSearch = (options: { debounceMs?: number } = {}) => {
  const debounceMs = options.debounceMs ?? 200;
  const [dataset, setDataset] = useState<SearchableNote[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const subscription = liveQuery(async () => {
      const records = await listNotes();
      const decrypted = await Promise.all(records.map(decryptNoteForSearch));
      return decrypted;
    }).subscribe({
      next: (value) => {
        if (!isMounted) return;
        setDataset(value);
      },
      error: (err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load notes');
      },
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const fuse = useMemo(() => {
    return new Fuse(dataset, {
      includeScore: true,
      keys: [
        { name: 'title', weight: 0.6 },
        { name: 'content', weight: 0.4 },
      ],
      threshold: 0.35,
    });
  }, [dataset]);

  useEffect(() => {
    if (!query.trim()) {
      setResults(
        dataset.slice(0, 25).map((note) => ({
          id: note.id,
          title: note.title,
          snippet: note.content.slice(0, 160),
          updatedAt: note.updatedAt,
        }))
      );
      return;
    }

    setIsSearching(true);

    if (typeof window === 'undefined') {
      setIsSearching(false);
      return undefined;
    }

    const handle = window.setTimeout(() => {
      const matches = fuse.search(query).map(({ item, score }) => ({
        id: item.id,
        title: item.title,
        snippet: buildSnippet(item.content, query),
        updatedAt: item.updatedAt,
        score: score ?? undefined,
      }));
      setResults(matches);
      setIsSearching(false);
    }, debounceMs);

    return () => {
      window.clearTimeout(handle);
    };
  }, [dataset, fuse, query, debounceMs]);

  return {
    query,
    setQuery,
    results,
    isSearching,
    offline: true,
    error,
  };
};
