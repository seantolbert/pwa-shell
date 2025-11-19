import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/notes/types';

type NotesTable = Database['public']['Tables']['notes'];
type FoldersTable = Database['public']['Tables']['folders'];
type AttachmentsTable = Database['public']['Tables']['attachments'];
type SyncLogTable = Database['public']['Tables']['sync_log'];

let cachedClient: SupabaseClient<Database> | null = null;

const getEnvVariable = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing Supabase environment variable: ${key}`);
  }
  return value;
};

/**
 * Returns a memoized Supabase client bound to the Notes schema definitions.
 * The wrapper keeps responsibility for injecting project URL/key and ensures
 * we never instantiate multiple clients in the browser.
 */
export const getSupabaseClient = (): SupabaseClient<Database> => {
  if (cachedClient) return cachedClient;

  const url = getEnvVariable('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = getEnvVariable('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  cachedClient = createClient<Database>(url, anonKey, {
    auth: {
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  return cachedClient;
};

/**
 * Uploads encrypted note payloads. All fields passed in must already be
 * encrypted and sanitized before calling this helper.
 */
export const uploadEncryptedNotes = async (
  notes: NotesTable['Insert'][]
) => {
  if (!notes.length) return { data: null, error: null };
  const client = getSupabaseClient();
  return client.from('notes').upsert(notes as never, { onConflict: 'id' });
};

/**
 * Downloads encrypted notes updated after the provided timestamp, allowing the
 * sync layer to reconcile differences without exposing decrypted content.
 */
export const downloadEncryptedNotes = async (updatedAfter?: string) => {
  const client = getSupabaseClient();
  let query = client.from('notes').select('*').order('updated_at', {
    ascending: false,
  });
  if (updatedAfter) {
    query = query.gt('updated_at', updatedAfter);
  }
  return query;
};

export const uploadEncryptedFolders = async (
  folders: FoldersTable['Insert'][]
) => {
  if (!folders.length) return { data: null, error: null };
  const client = getSupabaseClient();
  return client.from('folders').upsert(folders as never, { onConflict: 'id' });
};

export const downloadEncryptedFolders = async () => {
  const client = getSupabaseClient();
  return client.from('folders').select('*').order('created_at', {
    ascending: true,
  });
};

/**
 * Attachments are transferred as encrypted blobs (never decrypted server-side).
 */
export const uploadEncryptedAttachments = async (
  attachments: AttachmentsTable['Insert'][]
) => {
  if (!attachments.length) return { data: null, error: null };
  const client = getSupabaseClient();
  return client.from('attachments').upsert(attachments as never, { onConflict: 'id' });
};

type AttachmentDownloadOptions = {
  noteIds?: string[];
  createdAfter?: string;
};

export const downloadEncryptedAttachments = async (
  options: AttachmentDownloadOptions = {}
) => {
  const client = getSupabaseClient();
  let query = client.from('attachments').select('*');
  if (options.noteIds?.length) {
    query = query.in('note_id', options.noteIds);
  }
  if (options.createdAfter) {
    query = query.gt('created_at', options.createdAfter);
  }
  return query;
};

/**
 * Sync log helpers for recording the last time a note/folder/attachment was
 * reconciled with Supabase. Only metadata is stored remotely.
 */
export const upsertSyncLogEntries = async (
  entries: SyncLogTable['Insert'][]
) => {
  if (!entries.length) return { data: null, error: null };
  const client = getSupabaseClient();
  return client.from('sync_log').upsert(entries as never, { onConflict: 'id' });
};

export const fetchSyncLogEntries = async () => {
  const client = getSupabaseClient();
  return client.from('sync_log').select('*');
};
