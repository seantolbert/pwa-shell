# Notes Module

An offline-first, end-to-end encrypted Notes experience designed to replace Apple Notes while running entirely inside a Next.js PWA shell. This document explains the architecture, sync strategy, encryption rules, and how to extend or deploy the module.

## Architecture Overview

- **App Router integration** – `/app/notes` composes `NotesShell`, route-level components, and hooks.
- **Stateful hooks** – `useNotes`, `useFolders`, `useSearch`, and `useSync` encapsulate CRUD, search, and sync behaviors.
- **IndexedDB (Dexie)** – `src/notes/db` implements the primary data store with schema migrations, CRUD utilities, and dirty flags.
- **Supabase sync** – `src/notes/sync` coordinates bidirectional sync using `supabase-client.ts`, `syncOut`, `syncIn`, and periodic monitoring.
- **Services** – `services/encryption`, `services/attachments`, and `services/utilities` provide AES helpers, attachment pipelines, and backup tooling.
- **UI layer** – `components/NotesShell` provides status indicators, offline badges, and space for list/editor screens (to be implemented).

## Local-First Model

- IndexedDB holds the entire dataset (notes, folders, attachments) and is the source of truth.
- Hooks read/write exclusively from Dexie regardless of network status.
- Every mutation marks the affected entities as `dirty`, triggering eventual sync without blocking UI.
- Export/import utilities work purely on encrypted IndexedDB data, enabling private backups without leaving the device.

## Supabase Sync Rules

1. Sync runs automatically whenever the device is online (`useSync()` + `watchOnlineStatus`) and every 30 seconds via `periodicSync`.
2. `syncOut()` uploads dirty notes/folders/attachments with `upsert` semantics; records are marked clean once confirmed.
3. `syncIn()` fetches remote updates newer than the latest local timestamps (newest timestamp wins on conflicts).
4. Attachments fetch through both timestamp-based queries and targeted note IDs to avoid missed blobs.
5. `sync_log` is updated for every item processed, creating an audit trail and aiding troubleshooting.

## AES Encryption Rules

- AES-GCM keys are generated client-side, stored only in `localStorage`, and never transmitted.
- `encryptText`/`decryptText` handle strings, while `encryptBlob`/`decryptBlob` process attachments.
- IV bytes are prepended to every encrypted payload so decryption can occur after persistence or sync.
- All IndexedDB rows and Supabase payloads remain encrypted; decryption happens only in-memory during rendering or search indexing.

## File Structure

```
src/notes/
├── components/           # UI building blocks (e.g., NotesShell)
├── db/                   # Dexie database, schema, CRUD helpers
├── hooks/                # useNotes/useFolders/useSearch/useSync
├── routes/               # App Router entry points for /notes
├── services/
│   ├── attachments.ts    # Capture/compress/encrypt attachments
│   ├── encryption.ts     # AES key + payload helpers
│   └── utilities.ts      # Backup import/export, shared tools
├── sync/
│   ├── index.ts          # Sync engine, status tracker, timers
│   └── supabase-client.ts# Typed Supabase wrapper/helpers
├── types/                # Centralized domain + Supabase types
├── utils/                # Base64 helpers, ID generators, etc.
└── README.md             # This document
```

## Screens Overview

- **Notes list** – consumes `useNotes()` for decrypted titles/snippets, shows pinned/starred badges, and surfaces offline status via `NotesShell`.
- **Editor** – binds to `useNotes().getNoteById` for seamless offline editing, attachments, and manual sync triggers.
- **Folders panel** – uses `useFolders()` to display decrypted folder names and counts.
- **Search** – `useSearch()` provides fuzzy results entirely offline with optional scoring metadata.
- **Attachment viewer** – uses `getAttachmentPreviews`/`getAttachmentForViewer` to display inline thumbnails and modal previews.

## Extending the Module

- **Tags** – add a `tags` store/table, associate IDs on notes, and update hooks + sync to treat tag metadata like folders.
- **Templates** – store encrypted template blobs locally, surface via hooks, and optionally sync via Supabase for multi-device reuse.
- **OCR** – run on-device OCR (e.g., WebAssembly) when attachments are added, encrypt the text, and use it inside `useSearch`.
- **AI assistance** – pipe decrypted content into on-device models or user-provided APIs, but only after explicit user action to maintain privacy.

## Known Limitations

- No UI yet for final list/editor/search screens (only scaffolding exists).
- Attachments currently support images (JPEG) only.
- Conflict resolution is “last updated wins”; more nuanced merges are not implemented.
- Encryption key remains in `localStorage`; rotating keys or multi-device key sharing is outside current scope.
- ESLint config not yet initialized, so lint scripts will prompt for setup.

## Deployment Notes (Vercel + PWA)

- The module lives inside a standard Next.js App Router project, so deployment to Vercel works out of the box.
- Ensure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are configured in Vercel environment variables.
- PWA behavior (service worker, offline caching) is already wired via the existing shell; `/app/notes` benefits automatically.
- Because IndexedDB is the source of truth, no server-side rendering is required for notes pages—render them as client components.
- When shipping to production, remind users to export encrypted backups periodically, especially before reinstalling the PWA or clearing storage.
