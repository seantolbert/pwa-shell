import Dexie, { type Table } from 'dexie';
import type {
  LocalAttachmentRecord,
  LocalFolderRecord,
  LocalNoteRecord,
} from '@/notes/types';

const DB_NAME = 'notes_app_db';
const DB_VERSION = 1;

class NotesDexieDatabase extends Dexie {
  notes!: Table<LocalNoteRecord, string>;
  folders!: Table<LocalFolderRecord, string>;
  attachments!: Table<LocalAttachmentRecord, string>;

  constructor() {
    super(DB_NAME);
    this.version(DB_VERSION).stores({
      notes: 'id, folderId, updatedAt, dirty',
      folders: 'id, createdAt, dirty',
      attachments: 'id, noteId, createdAt, dirty',
    });
  }
}

let dbInstance: NotesDexieDatabase | null = null;

export const getNotesDb = () => {
  if (!dbInstance) {
    dbInstance = new NotesDexieDatabase();
  }
  return dbInstance;
};

type OptionalDirty<T extends { dirty: boolean }> = Omit<T, 'dirty'> & {
  dirty?: boolean;
};

const withDirtyDefault = <T extends { dirty: boolean }>(payload: OptionalDirty<T>) => {
  return {
    ...payload,
    dirty: payload.dirty ?? true,
  };
};

/* Notes CRUD -------------------------------------------------------------- */

export const createNote = async (note: OptionalDirty<LocalNoteRecord>) => {
  const db = getNotesDb();
  await db.notes.put(withDirtyDefault({ attachments: [], ...note }));
};

export const getNoteById = (id: string) => getNotesDb().notes.get(id);

export const listNotes = () => getNotesDb().notes.toArray();

export const updateNote = async (
  id: string,
  updates: Partial<OptionalDirty<LocalNoteRecord>>
) => {
  const db = getNotesDb();
  const changes = withDirtyDefault({
    ...updates,
  } as OptionalDirty<LocalNoteRecord>);
  await db.notes.update(id, changes);
};

export const deleteNote = async (id: string) => {
  const db = getNotesDb();
  await db.transaction('rw', db.notes, db.attachments, async () => {
    await db.notes.delete(id);
    await db.attachments.where('noteId').equals(id).delete();
  });
};

export const markNoteDirty = (id: string) =>
  getNotesDb().notes.update(id, { dirty: true });

/* Folder CRUD ------------------------------------------------------------ */

export const createFolder = async (folder: OptionalDirty<LocalFolderRecord>) => {
  const db = getNotesDb();
  await db.folders.put(withDirtyDefault(folder));
};

export const getFolderById = (id: string) => getNotesDb().folders.get(id);

export const listFolders = () => getNotesDb().folders.toArray();

export const updateFolder = (id: string, updates: Partial<OptionalDirty<LocalFolderRecord>>) =>
  getNotesDb().folders.update(id, withDirtyDefault(updates as OptionalDirty<LocalFolderRecord>));

export const deleteFolder = (id: string) => getNotesDb().folders.delete(id);

export const markFolderDirty = (id: string) =>
  getNotesDb().folders.update(id, { dirty: true });

/* Attachment CRUD -------------------------------------------------------- */

export const createAttachment = async (
  attachment: OptionalDirty<LocalAttachmentRecord>
) => {
  const db = getNotesDb();
  await db.attachments.put(withDirtyDefault(attachment));
};

export const getAttachmentById = (id: string) => getNotesDb().attachments.get(id);

export const listAttachmentsByNote = (noteId: string) =>
  getNotesDb().attachments.where('noteId').equals(noteId).toArray();

export const deleteAttachment = async (id: string) => {
  const db = getNotesDb();
  await db.attachments.delete(id);
};

export const updateAttachment = (
  id: string,
  updates: Partial<OptionalDirty<LocalAttachmentRecord>>
) =>
  getNotesDb().attachments.update(
    id,
    withDirtyDefault(updates as OptionalDirty<LocalAttachmentRecord>)
  );

export const markAttachmentDirty = (id: string) =>
  getNotesDb().attachments.update(id, { dirty: true });

/**
 * Backwards-compatible alias for code that previously consumed the placeholder.
 */
export const createNotesDb = () => getNotesDb();

/**
 * Placeholder stream helper. Consumers can hook into Dexie live queries later.
 */
export const watchNotesCollection = () => getNotesDb().notes;
