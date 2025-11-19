import { useCallback, useEffect, useMemo, useState } from 'react';
import { liveQuery } from 'dexie';
import {
  createNote as createNoteRecord,
  deleteNote as deleteNoteRecord,
  getNoteById as getNoteRecordById,
  listNotes,
  updateNote as updateNoteRecord,
} from '@/notes/db';
import { decryptText, encryptText } from '@/notes/services/encryption';
import {
  addImageAttachment as addImageAttachmentService,
  getAttachmentPreviews,
  removeAttachment as removeAttachmentService,
} from '@/notes/services/attachments';
import { markDirty } from '@/notes/sync';
import { generateId, isoNow } from '@/notes/utils';
import { exportEncryptedNotesBackupAsJson, importEncryptedNotesBackup } from '@/notes/services/utilities';
import type {
  AttachmentPreview,
  EncryptedNotesBackup,
  LocalNoteRecord,
  NoteViewModel,
} from '@/notes/types';

export type NoteAttachment = AttachmentPreview;

export interface UseNotesState {
  notes: NoteViewModel[];
  loading: boolean;
  error: string | null;
  getNoteById: (id: string) => Promise<(NoteViewModel & { attachments: NoteAttachment[] }) | null>;
  createNote: (payload: {
    title?: string;
    content?: string;
    folderId?: string | null;
    pinned?: boolean;
    starred?: boolean;
  }) => Promise<string>;
  updateNote: (
    id: string,
    payload: Partial<{
      title: string;
      content: string;
      folderId: string | null;
      pinned: boolean;
      starred: boolean;
      attachments: string[];
    }>
  ) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  toggleStar: (id: string) => Promise<void>;
  addAttachment: (noteId: string, file: Blob | File, type: 'image' | 'audio') => Promise<string>;
  removeAttachment: (noteId: string, attachmentId: string) => Promise<void>;
  getAttachments: (noteId: string) => Promise<NoteAttachment[]>;
  exportBackup: () => Promise<string>;
  importBackup: (backup: string | EncryptedNotesBackup) => Promise<void>;
}

const decryptMaybe = async (value: string | null) => {
  if (!value) return '';
  return decryptText(value);
};

const decryptNoteRecord = async (record: LocalNoteRecord): Promise<NoteViewModel> => {
  const [title, content] = await Promise.all([
    decryptMaybe(record.encrypted_title),
    decryptMaybe(record.encrypted_content),
  ]);

  return {
    id: record.id,
    title,
    content,
    folderId: record.folderId,
    pinned: record.pinned,
    starred: record.starred,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    attachmentIds: record.attachments ?? [],
  };
};

const encryptNoteFields = async (payload: {
  title?: string;
  content?: string;
}) => {
  const [encryptedTitle, encryptedContent] = await Promise.all([
    payload.title !== undefined ? encryptText(payload.title) : Promise.resolve(undefined),
    payload.content !== undefined ? encryptText(payload.content) : Promise.resolve(undefined),
  ]);

  return {
    encryptedTitle,
    encryptedContent,
  };
};

export const useNotes = (): UseNotesState => {
  const [notes, setNotes] = useState<NoteView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const subscription = liveQuery(async () => {
      const records = await listNotes();
      const decrypted = await Promise.all(records.map(decryptNoteRecord));
      return decrypted;
    }).subscribe({
      next: (value) => {
        if (!isMounted) return;
        setNotes(value);
        setLoading(false);
      },
      error: (err) => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load notes');
        setLoading(false);
      },
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const getNoteById = useCallback(
    async (id: string) => {
      const record = await getNoteRecordById(id);
      if (!record) return null;
      const note = await decryptNoteRecord(record);
      const attachments = await getAttachmentPreviews(id);
      return { ...note, attachments };
    },
    []
  );

  const createNote = useCallback(
    async ({
      title = '',
      content = '',
      folderId = null,
      pinned = false,
      starred = false,
    }) => {
      const id = generateId();
      const now = isoNow();
      const { encryptedTitle, encryptedContent } = await encryptNoteFields({ title, content });
      await createNoteRecord({
        id,
        encrypted_title: encryptedTitle ?? null,
        encrypted_content: encryptedContent ?? null,
        folderId,
        pinned,
        starred,
        createdAt: now,
        updatedAt: now,
        attachments: [],
      });
      return id;
    },
    []
  );

  const updateNote = useCallback(
    async (
      id: string,
      payload: Partial<{
        title: string;
        content: string;
        folderId: string | null;
        pinned: boolean;
        starred: boolean;
        attachments: string[];
      }>
    ) => {
      const now = isoNow();
      const encryptedPayload = await encryptNoteFields({
        title: payload.title,
        content: payload.content,
      });

      await updateNoteRecord(id, {
        encrypted_title:
          encryptedPayload.encryptedTitle !== undefined
            ? encryptedPayload.encryptedTitle
            : undefined,
        encrypted_content:
          encryptedPayload.encryptedContent !== undefined
            ? encryptedPayload.encryptedContent
            : undefined,
        folderId: payload.folderId,
        pinned: payload.pinned,
        starred: payload.starred,
        attachments: payload.attachments,
        updatedAt: now,
      });
    },
    []
  );

  const deleteNote = useCallback(async (id: string) => {
    await markDirty.note(id);
    await deleteNoteRecord(id);
  }, []);

  const togglePin = useCallback(
    async (id: string) => {
      const target = notes.find((note) => note.id === id);
      if (!target) return;
      await updateNote(id, { pinned: !target.pinned });
    },
    [notes, updateNote]
  );

  const toggleStar = useCallback(
    async (id: string) => {
      const target = notes.find((note) => note.id === id);
      if (!target) return;
      await updateNote(id, { starred: !target.starred });
    },
    [notes, updateNote]
  );

  const addAttachment = useCallback(
    async (noteId: string, file: Blob | File, type: 'image' | 'audio') => {
      if (type !== 'image') {
        throw new Error('Only image attachments are supported at this time.');
      }
      return addImageAttachmentService(noteId, file);
    },
    []
  );

  const removeAttachment = useCallback(
    async (noteId: string, attachmentId: string) => {
      await removeAttachmentService(noteId, attachmentId);
    },
    []
  );

  const getAttachments = useCallback(async (noteId: string) => {
    return getAttachmentPreviews(noteId);
  }, []);

  const exportBackup = useCallback(() => exportEncryptedNotesBackupAsJson(), []);

  const importBackup = useCallback(
    async (backup: string | EncryptedNotesBackup) => {
      await importEncryptedNotesBackup(backup);
    },
    []
  );

  return useMemo(
    () => ({
      notes,
      loading,
      error,
      getNoteById,
      createNote,
      updateNote,
      deleteNote,
      togglePin,
      toggleStar,
      addAttachment,
      removeAttachment,
      getAttachments,
      exportBackup,
      importBackup,
    }),
    [
      notes,
      loading,
      error,
      getNoteById,
      createNote,
      updateNote,
      deleteNote,
      togglePin,
      toggleStar,
      addAttachment,
      removeAttachment,
      getAttachments,
      exportBackup,
      importBackup,
    ]
  );
};
