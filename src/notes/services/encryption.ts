const KEY_STORAGE_KEY = 'notes_aes_key_v1';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;

let keyPromise: Promise<CryptoKey> | null = null;

const ensureClientCrypto = () => {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Encryption helpers are only available in the browser.');
  }
};

const arrayBufferToBase64 = (buffer: ArrayBuffer | Uint8Array) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const base64ToUint8Array = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const persistKey = async (key: CryptoKey) => {
  const raw = await window.crypto.subtle.exportKey('raw', key);
  const encoded = arrayBufferToBase64(raw);
  window.localStorage.setItem(KEY_STORAGE_KEY, encoded);
};

const importKeyFromStorage = async () => {
  const stored = window.localStorage.getItem(KEY_STORAGE_KEY);
  if (!stored) return null;
  const raw = base64ToUint8Array(stored);
  return window.crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
};

const generateAndStoreKey = async () => {
  const rawKey = window.crypto.getRandomValues(new Uint8Array(KEY_LENGTH_BYTES));
  const key = await window.crypto.subtle.importKey('raw', rawKey, 'AES-GCM', true, [
    'encrypt',
    'decrypt',
  ]);
  await persistKey(key);
  return window.crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
};

const getEncryptionKey = async () => {
  ensureClientCrypto();
  if (!keyPromise) {
    keyPromise = (async () => {
      const existing = await importKeyFromStorage();
      if (existing) return existing;
      return generateAndStoreKey();
    })();
  }
  return keyPromise;
};

const concatIvAndCipher = (iv: Uint8Array, cipher: ArrayBuffer) => {
  const encryptedBytes = new Uint8Array(cipher);
  const combined = new Uint8Array(iv.length + encryptedBytes.length);
  combined.set(iv, 0);
  combined.set(encryptedBytes, iv.length);
  return combined;
};

const splitIvAndCipher = (payload: Uint8Array) => {
  const iv = payload.slice(0, IV_LENGTH_BYTES);
  const cipher = payload.slice(IV_LENGTH_BYTES);
  return { iv, cipher };
};

const encryptBuffer = async (buffer: ArrayBuffer) => {
  const key = await getEncryptionKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const cipher = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    buffer
  );
  return concatIvAndCipher(iv, cipher);
};

const decryptBuffer = async (payload: Uint8Array) => {
  const key = await getEncryptionKey();
  const { iv, cipher } = splitIvAndCipher(payload);
  return window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    cipher
  );
};

/**
 * Encrypts arbitrary text into a base64 string suitable for local storage or
 * syncing to Supabase. The text never leaves memory unencrypted.
 */
export const encryptText = async (plainText: string) => {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(plainText);
  const encrypted = await encryptBuffer(buffer);
  return arrayBufferToBase64(encrypted);
};

export const decryptText = async (encryptedBase64: string) => {
  const payload = base64ToUint8Array(encryptedBase64);
  const decrypted = await decryptBuffer(payload);
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
};

export const encryptBlob = async (blob: Blob) => {
  const buffer = await blob.arrayBuffer();
  return encryptBuffer(buffer);
};

export const decryptBlob = async (payload: ArrayBuffer | Uint8Array, type = 'application/octet-stream') => {
  const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const decryptedBuffer = await decryptBuffer(bytes);
  return new Blob([decryptedBuffer], { type });
};
