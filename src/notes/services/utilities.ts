import { getNotesDb } from '@/notes/db';
import type { EncryptedNotesBackup } from '@/notes/types';

const BACKUP_VERSION = 1;

const assertValidBackup = (payload: Partial<EncryptedNotesBackup>): payload is EncryptedNotesBackup => {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    payload.version === BACKUP_VERSION &&
    Array.isArray(payload.notes) &&
    Array.isArray(payload.folders) &&
    Array.isArray(payload.attachments)
  );
};

export const exportEncryptedNotesBackup = async (): Promise<EncryptedNotesBackup> => {
  const db = getNotesDb();
  const [notes, folders, attachments] = await Promise.all([
    db.notes.toArray(),
    db.folders.toArray(),
    db.attachments.toArray(),
  ]);

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    notes,
    folders,
    attachments,
  };
};

export const exportEncryptedNotesBackupAsJson = async () => {
  const backup = await exportEncryptedNotesBackup();
  return JSON.stringify(backup, null, 2);
};

export const importEncryptedNotesBackup = async (
  backup: string | EncryptedNotesBackup
) => {
  const payload =
    typeof backup === 'string' ? (JSON.parse(backup) as Partial<EncryptedNotesBackup>) : backup;

  if (!assertValidBackup(payload)) {
    throw new Error('Invalid backup file format.');
  }

  const db = getNotesDb();
  await db.transaction('rw', db.notes, db.folders, db.attachments, async () => {
    await db.notes.clear();
    await db.folders.clear();
    await db.attachments.clear();

    await db.notes.bulkPut(
      payload.notes.map((note) => ({
        ...note,
        dirty: true,
      }))
    );

    await db.folders.bulkPut(
      payload.folders.map((folder) => ({
        ...folder,
        dirty: true,
      }))
    );

    await db.attachments.bulkPut(
      payload.attachments.map((attachment) => ({
        ...attachment,
        dirty: true,
      }))
    );
  });
};
