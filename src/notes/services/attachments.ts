import {
  createAttachment,
  deleteAttachment,
  getAttachmentById,
  getNoteById,
  listAttachmentsByNote,
  updateNote,
} from '@/notes/db';
import { decryptBlob, encryptBlob } from '@/notes/services/encryption';
import { markDirty } from '@/notes/sync';
import { base64ToUint8Array, bufferToBase64, generateId, isoNow } from '@/notes/utils';
import type { AttachmentPreview, LocalAttachmentRecord } from '@/notes/types';

export interface ImageAttachmentOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  mimeType?: string;
}

const DEFAULT_IMAGE_OPTIONS: Required<ImageAttachmentOptions> = {
  maxWidth: 2048,
  maxHeight: 2048,
  quality: 0.82,
  mimeType: 'image/jpeg',
};

const ensureBrowser = () => {
  if (typeof window === 'undefined') {
    throw new Error('Attachment services are only available in the browser.');
  }
};

const readBlobAsDataURL = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });

const loadImageElement = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });

const computeDimensions = (width: number, height: number, opts: Required<ImageAttachmentOptions>) => {
  const ratio = Math.min(opts.maxWidth / width, opts.maxHeight / height, 1);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
};

const toProcessedImageBlob = async (
  file: File | Blob,
  opts: ImageAttachmentOptions = {}
): Promise<Blob> => {
  ensureBrowser();
  const merged = { ...DEFAULT_IMAGE_OPTIONS, ...opts };
  const dataUrl = await readBlobAsDataURL(file);
  const image = await loadImageElement(dataUrl);
  const { width, height } = computeDimensions(image.width, image.height, merged);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to initialize canvas context for image compression.');
  }
  ctx.drawImage(image, 0, 0, width, height);
  const processedBlob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Unable to convert canvas to blob.'));
          return;
        }
        resolve(blob);
      },
      merged.mimeType,
      merged.quality
    );
  });
  return processedBlob;
};

const storeEncryptedAttachment = async (
  noteId: string,
  encryptedBase64: string,
  type: 'image' | 'audio',
  metadata?: Partial<Pick<LocalAttachmentRecord, 'id' | 'createdAt'>>
) => {
  const id = metadata?.id ?? generateId();
  const createdAt = metadata?.createdAt ?? isoNow();
  await createAttachment({
    id,
    noteId,
    type,
    encrypted_blob: encryptedBase64,
    createdAt,
  });
  await markDirty.attachment(id);
  return { id, createdAt };
};

const updateNoteAttachmentList = async (noteId: string, attachmentId: string, remove = false) => {
  const noteRecord = await getNoteById(noteId);
  const nextAttachmentIds = (() => {
    const current = noteRecord?.attachments ?? [];
    if (remove) {
      return current.filter((id) => id !== attachmentId);
    }
    return Array.from(new Set([...current, attachmentId]));
  })();

  await updateNote(noteId, {
    attachments: nextAttachmentIds,
    updatedAt: isoNow(),
  });
  await markDirty.note(noteId);
};

/**
 * Compresses, encrypts, and persists an image attachment for the given note.
 * Returns the attachment ID so callers can reference it in UI components.
 */
export const addImageAttachment = async (
  noteId: string,
  file: File | Blob,
  opts?: ImageAttachmentOptions
) => {
  const processedBlob = await toProcessedImageBlob(file, opts);
  const encryptedBytes = await encryptBlob(processedBlob);
  const encryptedBase64 = bufferToBase64(encryptedBytes);
  const { id } = await storeEncryptedAttachment(noteId, encryptedBase64, 'image');
  await updateNoteAttachmentList(noteId, id);
  return id;
};

/**
 * Convenient alias when capturing a fresh photo via camera APIs.
 */
export const captureImageAttachment = (noteId: string, file: File | Blob) =>
  addImageAttachment(noteId, file);

export const removeAttachment = async (noteId: string, attachmentId: string) => {
  await markDirty.attachment(attachmentId);
  await deleteAttachment(attachmentId);
  await updateNoteAttachmentList(noteId, attachmentId, true);
};

const decryptAttachmentBlob = async (record: LocalAttachmentRecord) => {
  const payload = base64ToUint8Array(record.encrypted_blob);
  const mimeType = record.type === 'image' ? 'image/jpeg' : 'application/octet-stream';
  return decryptBlob(payload, mimeType);
};

const createPreview = async (record: LocalAttachmentRecord): Promise<AttachmentPreview> => {
  const blob = await decryptAttachmentBlob(record);
  const objectUrl = URL.createObjectURL(blob);
  return {
    id: record.id,
    noteId: record.noteId,
    type: record.type,
    blob,
    objectUrl,
    createdAt: record.createdAt,
  };
};

/**
 * Returns decrypted blobs + object URLs for inline previews (e.g., gallery
 * thumbnails). Call `releaseAttachmentPreview` when previews are no longer
 * needed to free memory.
 */
export const getAttachmentPreviews = async (noteId: string) => {
  const records = await listAttachmentsByNote(noteId);
  return Promise.all(records.map((record) => createPreview(record)));
};

export const getAttachmentPreview = async (attachmentId: string) => {
  const record = await getAttachmentById(attachmentId);
  if (!record) return null;
  return createPreview(record);
};

export const releaseAttachmentPreview = (preview: Pick<AttachmentPreview, 'objectUrl'>) => {
  URL.revokeObjectURL(preview.objectUrl);
};

/**
 * Helper for attachment viewer modals: decrypts and returns a single Blob that
 * can be rendered full-screen when the user taps an inline image.
 */
export const getAttachmentForViewer = async (attachmentId: string) => {
  const preview = await getAttachmentPreview(attachmentId);
  return preview;
};
