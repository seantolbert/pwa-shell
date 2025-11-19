export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Supabase public schema definition extracted from product requirements.
 * This is referenced by the Supabase client wrapper to provide strict typing
 * for encrypted payload uploads/downloads.
 */
export interface Database {
  public: {
    Tables: {
      notes: {
        Row: {
          id: string;
          encrypted_title: string | null;
          encrypted_content: string | null;
          folder_id: string | null;
          updated_at: string;
          created_at: string;
          pinned: boolean;
          starred: boolean;
        };
        Insert: {
          id?: string;
          encrypted_title?: string | null;
          encrypted_content?: string | null;
          folder_id?: string | null;
          updated_at?: string;
          created_at?: string;
          pinned?: boolean;
          starred?: boolean;
        };
        Update: {
          id?: string;
          encrypted_title?: string | null;
          encrypted_content?: string | null;
          folder_id?: string | null;
          updated_at?: string;
          created_at?: string;
          pinned?: boolean;
          starred?: boolean;
        };
      };
      folders: {
        Row: {
          id: string;
          encrypted_name: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          encrypted_name?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          encrypted_name?: string | null;
          created_at?: string;
        };
      };
      attachments: {
        Row: {
          id: string;
          note_id: string;
          type: 'image' | 'audio';
          encrypted_blob: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          note_id: string;
          type: 'image' | 'audio';
          encrypted_blob: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          note_id?: string;
          type?: 'image' | 'audio';
          encrypted_blob?: string;
          created_at?: string;
        };
      };
      sync_log: {
        Row: {
          id: string;
          item_type: 'note' | 'folder' | 'attachment';
          item_id: string;
          last_synced_at: string;
        };
        Insert: {
          id?: string;
          item_type: 'note' | 'folder' | 'attachment';
          item_id: string;
          last_synced_at?: string;
        };
        Update: {
          id?: string;
          item_type?: 'note' | 'folder' | 'attachment';
          item_id?: string;
          last_synced_at?: string;
        };
      };
    };
    Views: never;
    Functions: never;
    Enums: never;
  };
}

export type NoteRow = Database['public']['Tables']['notes']['Row'];
export type FolderRow = Database['public']['Tables']['folders']['Row'];
export type AttachmentRow = Database['public']['Tables']['attachments']['Row'];
export type SyncLogRow = Database['public']['Tables']['sync_log']['Row'];

/* -------------------------------------------------------------------------- */
/* Local IndexedDB Schemas                                                    */
/* -------------------------------------------------------------------------- */

export type NoteId = string;
export type FolderId = string;
export type AttachmentId = string;

export interface LocalNoteRecord {
  id: NoteId;
  encrypted_title: string | null;
  encrypted_content: string | null;
  folderId: FolderId | null;
  pinned: boolean;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  attachments: AttachmentId[];
  dirty: boolean;
}

export interface LocalFolderRecord {
  id: FolderId;
  encrypted_name: string | null;
  createdAt: string;
  dirty: boolean;
}

export interface LocalAttachmentRecord {
  id: AttachmentId;
  noteId: NoteId;
  type: 'image' | 'audio';
  encrypted_blob: string;
  createdAt: string;
  dirty: boolean;
}

/* -------------------------------------------------------------------------- */
/* View Models                                                                */
/* -------------------------------------------------------------------------- */

export interface NoteViewModel {
  id: NoteId;
  title: string;
  content: string;
  folderId: FolderId | null;
  pinned: boolean;
  starred: boolean;
  createdAt: string;
  updatedAt: string;
  attachmentIds: AttachmentId[];
}

export interface FolderViewModel {
  id: FolderId;
  name: string;
  createdAt: string;
}

export interface AttachmentPreview {
  id: AttachmentId;
  noteId: NoteId;
  type: 'image' | 'audio';
  blob: Blob;
  objectUrl: string;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/* Sync + Backup                                                              */
/* -------------------------------------------------------------------------- */

export type SyncItemType = 'note' | 'folder' | 'attachment';

export interface SyncStatus {
  isSyncing: boolean;
  lastRun: string | null;
  lastError: string | null;
  offline: boolean;
}

export interface EncryptedNotesBackup {
  version: number;
  exportedAt: string;
  notes: LocalNoteRecord[];
  folders: LocalFolderRecord[];
  attachments: LocalAttachmentRecord[];
}
