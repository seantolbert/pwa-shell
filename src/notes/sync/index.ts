import type { Table, UpdateSpec } from 'dexie';
import {
  getNotesDb,
  markAttachmentDirty as markAttachmentDirtyLocal,
  markFolderDirty as markFolderDirtyLocal,
  markNoteDirty as markNoteDirtyLocal,
} from '@/notes/db';
import type {
  AttachmentRow,
  FolderRow,
  LocalAttachmentRecord,
  LocalFolderRecord,
  LocalNoteRecord,
  NoteRow,
  SyncItemType,
  SyncStatus,
} from '@/notes/types';
import {
  downloadEncryptedAttachments,
  downloadEncryptedFolders,
  downloadEncryptedNotes,
  upsertSyncLogEntries,
  uploadEncryptedAttachments,
  uploadEncryptedFolders,
  uploadEncryptedNotes,
} from './supabase-client';

type AttachmentDownloadResult = Awaited<
  ReturnType<typeof downloadEncryptedAttachments>
>;

type StatusListener = (status: SyncStatus) => void;

const isClient = () => typeof window !== 'undefined';
const isOnline = () => (typeof navigator !== 'undefined' ? navigator.onLine : false);

let currentStatus: SyncStatus = {
  isSyncing: false,
  lastRun: null,
  lastError: null,
  offline: !isOnline(),
};

const statusListeners = new Set<StatusListener>();

const notifyStatusListeners = () => {
  statusListeners.forEach((listener) => listener(currentStatus));
};

const updateStatus = (patch: Partial<SyncStatus>) => {
  currentStatus = { ...currentStatus, ...patch };
  notifyStatusListeners();
};

export const subscribeToSyncStatus = (listener: StatusListener) => {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => {
    statusListeners.delete(listener);
  };
};

const ensureOnlineOrThrow = () => {
  if (!isOnline()) {
    const error = new Error('Sync attempted while offline.');
    updateStatus({ offline: true, lastError: error.message });
    throw error;
  }
};

const mapLocalNoteToRemote = (note: LocalNoteRecord): NoteRow => ({
  id: note.id,
  encrypted_title: note.encrypted_title,
  encrypted_content: note.encrypted_content,
  folder_id: note.folderId,
  pinned: note.pinned,
  starred: note.starred,
  created_at: note.createdAt,
  updated_at: note.updatedAt,
});

const mapLocalFolderToRemote = (folder: LocalFolderRecord): FolderRow => ({
  id: folder.id,
  encrypted_name: folder.encrypted_name,
  created_at: folder.createdAt,
});

const mapLocalAttachmentToRemote = (
  attachment: LocalAttachmentRecord
): AttachmentRow => ({
  id: attachment.id,
  note_id: attachment.noteId,
  type: attachment.type,
  encrypted_blob: attachment.encrypted_blob,
  created_at: attachment.createdAt,
});

const logEntryForItem = (type: SyncItemType, itemId: string, timestamp: string) => ({
  id: `${type}-${itemId}`,
  item_type: type,
  item_id: itemId,
  last_synced_at: timestamp,
});

const getDirtyRecords = async <T extends { dirty: boolean }>(
  table: Table<T, string>
) => {
  const all = await table.toArray();
  return all.filter((record) => record.dirty);
};

const markRecordsClean = async <T extends { dirty: boolean }>(
  table: Table<T, string>,
  ids: string[]
) => {
  await Promise.all(
    ids.map((id) =>
      table.update(id, { dirty: false } as unknown as UpdateSpec<T>)
    )
  );
};

const syncOutNotes = async () => {
  const db = getNotesDb();
  const dirtyNotes = await getDirtyRecords(db.notes);
  if (!dirtyNotes.length) return [];

  const now = new Date().toISOString();
  const payload = dirtyNotes.map(mapLocalNoteToRemote);
  const { error } = await uploadEncryptedNotes(payload);
  if (error) throw error;

  await markRecordsClean(db.notes, dirtyNotes.map((note) => note.id));
  return dirtyNotes.map((note) => logEntryForItem('note', note.id, now));
};

const syncOutFolders = async () => {
  const db = getNotesDb();
  const dirtyFolders = await getDirtyRecords(db.folders);
  if (!dirtyFolders.length) return [];

  const now = new Date().toISOString();
  const payload = dirtyFolders.map(mapLocalFolderToRemote);
  const { error } = await uploadEncryptedFolders(payload);
  if (error) throw error;

  await markRecordsClean(db.folders, dirtyFolders.map((folder) => folder.id));
  return dirtyFolders.map((folder) => logEntryForItem('folder', folder.id, now));
};

const syncOutAttachments = async () => {
  const db = getNotesDb();
  const dirtyAttachments = await getDirtyRecords(db.attachments);
  if (!dirtyAttachments.length) return [];

  const now = new Date().toISOString();
  const payload = dirtyAttachments.map(mapLocalAttachmentToRemote);
  const { error } = await uploadEncryptedAttachments(payload);
  if (error) throw error;

  await markRecordsClean(
    db.attachments,
    dirtyAttachments.map((attachment) => attachment.id)
  );
  return dirtyAttachments.map((attachment) =>
    logEntryForItem('attachment', attachment.id, now)
  );
};

export const syncOut = async () => {
  ensureOnlineOrThrow();
  const entries = [
    ...(await syncOutNotes()),
    ...(await syncOutFolders()),
    ...(await syncOutAttachments()),
  ];

  if (entries.length) {
    await upsertSyncLogEntries(entries);
  }
};

const getLatestLocalNoteUpdatedAt = async () => {
  const db = getNotesDb();
  const latest = await db.notes.orderBy('updatedAt').last();
  return latest?.updatedAt;
};

const getLatestLocalAttachmentCreatedAt = async () => {
  const db = getNotesDb();
  const latest = await db.attachments.orderBy('createdAt').last();
  return latest?.createdAt;
};

const dedupeById = <T extends { id: string }>(rows: T[]) => {
  const map = new Map<string, T>();
  rows.forEach((row) => map.set(row.id, row));
  return Array.from(map.values());
};

const upsertLocalNotes = async (notes: NoteRow[]) => {
  if (!notes.length) return [];
  const db = getNotesDb();
  const updates: string[] = [];

  await db.transaction('rw', db.notes, async () => {
    for (const remoteNote of notes) {
      const existing = await db.notes.get(remoteNote.id);
      if (!existing || remoteNote.updated_at > existing.updatedAt) {
        await db.notes.put({
          id: remoteNote.id,
          encrypted_title: remoteNote.encrypted_title,
          encrypted_content: remoteNote.encrypted_content,
          folderId: remoteNote.folder_id,
          pinned: remoteNote.pinned,
          starred: remoteNote.starred,
          createdAt: remoteNote.created_at,
          updatedAt: remoteNote.updated_at,
          attachments: existing?.attachments ?? [],
          dirty: false,
        });
        updates.push(remoteNote.id);
      }
    }
  });

  return updates.map((id) => logEntryForItem('note', id, new Date().toISOString()));
};

const upsertLocalFolders = async (folders: FolderRow[]) => {
  if (!folders.length) return [];
  const db = getNotesDb();
  const updates: string[] = [];
  await db.transaction('rw', db.folders, async () => {
    for (const folder of folders) {
      const existing = await db.folders.get(folder.id);
      if (!existing || folder.created_at > existing.createdAt) {
        await db.folders.put({
          id: folder.id,
          encrypted_name: folder.encrypted_name,
          createdAt: folder.created_at,
          dirty: false,
        });
        updates.push(folder.id);
      }
    }
  });

  return updates.map((id) => logEntryForItem('folder', id, new Date().toISOString()));
};

const upsertLocalAttachments = async (attachments: AttachmentRow[]) => {
  if (!attachments.length) return [];
  const db = getNotesDb();
  const updates: string[] = [];
  await db.transaction('rw', db.attachments, db.notes, async () => {
    for (const attachment of attachments) {
      const existing = await db.attachments.get(attachment.id);
      if (!existing || attachment.created_at > existing.createdAt) {
        await db.attachments.put({
          id: attachment.id,
          noteId: attachment.note_id,
          type: attachment.type,
          encrypted_blob: attachment.encrypted_blob,
          createdAt: attachment.created_at,
          dirty: false,
        });
        updates.push(attachment.id);

        const noteAttachments = await db.attachments
          .where('noteId')
          .equals(attachment.note_id)
          .toArray();
        await db.notes.update(attachment.note_id, {
          attachments: noteAttachments.map((item) => item.id),
        });
      }
    }
  });

  return updates.map((id) => logEntryForItem('attachment', id, new Date().toISOString()));
};

export const syncIn = async () => {
  ensureOnlineOrThrow();
  const latestLocal = await getLatestLocalNoteUpdatedAt();
  const latestAttachment = await getLatestLocalAttachmentCreatedAt();
  const [{ data: noteData, error: noteError }, { data: folderData, error: folderError }] =
    await Promise.all([downloadEncryptedNotes(latestLocal), downloadEncryptedFolders()]);

  if (noteError) throw noteError;
  if (folderError) throw folderError;

  const safeNoteData = (noteData ?? []) as NoteRow[];
  const safeFolderData = (folderData ?? []) as FolderRow[];

  const noteLogEntries = await upsertLocalNotes(safeNoteData);
  const folderLogEntries = await upsertLocalFolders(safeFolderData);

  const noteIds = safeNoteData.map((note) => note.id);
  let byNote: AttachmentDownloadResult = { data: [], error: null } as AttachmentDownloadResult;
  let byCreated: AttachmentDownloadResult = { data: [], error: null } as AttachmentDownloadResult;

  if (noteIds.length) {
    byNote = await downloadEncryptedAttachments({ noteIds });
  }

  if (latestAttachment) {
    byCreated = await downloadEncryptedAttachments({ createdAfter: latestAttachment });
  }

  if (byNote.error) throw byNote.error;
  if (byCreated.error) throw byCreated.error;

  const attachmentData = dedupeById([
    ...((byNote.data ?? []) as AttachmentRow[]),
    ...((byCreated.data ?? []) as AttachmentRow[]),
  ]);

  const attachmentLogEntries = await upsertLocalAttachments(attachmentData);

  const entries = [...noteLogEntries, ...folderLogEntries, ...attachmentLogEntries];
  if (entries.length) {
    await upsertSyncLogEntries(entries);
  }
};

let syncInFlight = Promise.resolve();
let isSyncing = false;

export const fullSync = async () => {
  if (!isClient()) return;
  if (isSyncing) return syncInFlight;
  if (!isOnline()) {
    updateStatus({ offline: true });
    return;
  }

  isSyncing = true;
  updateStatus({ isSyncing: true, lastError: null, offline: false });
  syncInFlight = (async () => {
    try {
      await syncOut();
      await syncIn();
      updateStatus({ lastRun: new Date().toISOString() });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      updateStatus({ lastError: message });
      console.error('[notes-sync] Sync failed:', error);
    } finally {
      isSyncing = false;
      updateStatus({ isSyncing: false });
    }
  })();

  return syncInFlight;
};

export const watchOnlineStatus = (listener: (online: boolean) => void) => {
  if (!isClient()) return () => {};
  const handler = () => {
    const online = isOnline();
    updateStatus({ offline: !online });
    listener(online);
    if (online) {
      void fullSync();
    }
  };
  window.addEventListener('online', handler);
  window.addEventListener('offline', handler);
  handler();
  return () => {
    window.removeEventListener('online', handler);
    window.removeEventListener('offline', handler);
  };
};

export const periodicSync = (interval = 30_000) => {
  if (!isClient()) return () => {};
  const timer = window.setInterval(() => {
    if (isOnline()) {
      void fullSync();
    } else {
      updateStatus({ offline: true });
    }
  }, interval);
  return () => window.clearInterval(timer);
};

export const getSyncStatus = () => currentStatus;

export const markDirty = {
  note: markNoteDirtyLocal,
  folder: markFolderDirtyLocal,
  attachment: markAttachmentDirtyLocal,
};

export const runNotesSync = fullSync;

export const registerSyncEvents = watchOnlineStatus;
