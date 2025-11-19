import { useCallback, useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import {
  createFolder as createFolderRecord,
  deleteFolder as deleteFolderRecord,
  getFolderById as getFolderRecordById,
  listFolders,
  updateFolder as updateFolderRecord,
} from '@/notes/db';
import { decryptText, encryptText } from '@/notes/services/encryption';
import { markDirty } from '@/notes/sync';
import { generateId, isoNow } from '@/notes/utils';
import type { FolderViewModel, LocalFolderRecord } from '@/notes/types';

const decryptFolderRecord = async (record: LocalFolderRecord): Promise<FolderViewModel> => ({
  id: record.id,
  name: record.encrypted_name ? await decryptText(record.encrypted_name) : '',
  createdAt: record.createdAt,
});

export const useFolders = () => {
  const [folders, setFolders] = useState<FolderViewModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const subscription = liveQuery(async () => {
      const records = await listFolders();
      return Promise.all(records.map(decryptFolderRecord));
    }).subscribe({
      next: (value) => {
        if (!isMounted) return;
        setFolders(value);
        setLoading(false);
      },
      error: (err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load folders');
        setLoading(false);
      },
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const getFolderById = useCallback(async (id: string) => {
    const record = await getFolderRecordById(id);
    if (!record) return null;
    return decryptFolderRecord(record);
  }, []);

  const createFolder = useCallback(async (name: string) => {
    const id = generateId();
    const now = isoNow();
    const encryptedName = await encryptText(name);
    await createFolderRecord({
      id,
      encrypted_name: encryptedName,
      createdAt: now,
    });
    return id;
  }, []);

  const updateFolder = useCallback(async (id: string, name: string) => {
    const encryptedName = await encryptText(name);
    await updateFolderRecord(id, {
      encrypted_name: encryptedName,
    });
  }, []);

  const deleteFolder = useCallback(async (id: string) => {
    await markDirty.folder(id);
    await deleteFolderRecord(id);
  }, []);

  return useMemo(
    () => ({
      folders,
      loading,
      error,
      getFolderById,
      createFolder,
      updateFolder,
      deleteFolder,
    }),
    [folders, loading, error, getFolderById, createFolder, updateFolder, deleteFolder]
  );
};
