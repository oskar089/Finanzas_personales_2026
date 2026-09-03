# Design: Cloud Sync Phase 1 — Manual .fpkg File Sync

## Technical Approach

Add `exportAll()` and `importAll()` to `src/storage.js` as additive-only functions that read/write raw encrypted envelopes via the existing `rawGetAll`/`rawPut`/`rawClear` helpers. New `src/cloud-sync.js` orchestrates download/upload. Bootstrap modal in `index.html` provides confirmation UX. No changes to existing public API, crypto layer, or init flow.

**Store naming note**: The spec references `currency` as a bundle key, but the actual IDB store is `settings` (aliased as `SETTINGS_STORE`). The bundle uses the key `settings` to match the real store name. The spec's `currency` requirement maps 1:1 to this store.

## Architecture Decisions

| Choice | Alternatives | Rationale |
|--------|-------------|-----------|
| Add functions to `storage.js` (not new module) | Separate `cloud-sync-storage.js` | Export/import are storage primitives. Keeping them in `storage.js` avoids circular imports and follows where `rawGetAll`/`rawPut`/`rawClear` already live. |
| Raw envelope passthrough (no decrypt in export) | Decrypt → re-encrypt on import | Passthrough is simpler, faster, and proves portability. Decrypt verification is a separate optional step. |
| Atomic single-transaction import | Per-store sequential writes | One `readwrite` transaction across all stores guarantees all-or-nothing. IDB supports multi-store transactions natively. |
| Partial bundle → stores not in bundle left intact | Clear all, then write present | Safer default: user may have newer data in untouched stores. A full bundle would overwrite all anyway. Partial is an edge case from older exports. |
| Blob + anchor click for download | FileSaver.js CDN | Zero dependencies. The `<a download>` pattern is universally supported. |
| Bootstrap modal for confirmation | Native `confirm()` | Follows existing modal pattern (currency, passphrase). Better UX with timestamp display and overwrite warning. |

## Data Flow

```
EXPORT:
  app.js handler → cloud-sync.downloadPackage()
    → storage.exportAll()
      → openDB()
      → rawGetAll(db, store) × 6 stores + idbGetCryptoMeta()
      → close DB
      → return { version, dbVersion, timestamp, cryptoMeta, stores }
    → JSON.stringify → Blob → <a download="finanzas-backup-YYYY-MM-DD.fpkg">

IMPORT:
  app.js handler → cloud-sync.uploadPackage()
    → <input type="file"> → FileReader.readAsText()
    → JSON.parse → validate bundle structure
    → show confirmation modal (timestamp, dbVersion, overwrite warning)
    → user confirms → storage.importAll(bundle)
      → validate (version, stores, cryptoMeta presence, isEnvelope per store)
      → openDB()
      → single readwrite transaction: clear present stores → rawPut × N
      → commit → close DB
      → return { ok, errors[] }
    → toast success/error → location.reload()
```

## data-bundle-export

### Implementation

**File**: `src/storage.js`

New function `exportAll()`:

```
async function exportAll()
```

- Opens DB via `openDB()`, reads raw envelopes with `idbGetAllRaw(db, storeName)` for each of the 6 data stores.
- Reads `cryptoMeta` via `idbGetAllRaw(db, CRYPTO_META_STORE)` and extracts the record with `id === 'meta'`.
- Closes DB.
- Returns a plain object (no encryption, no envelope wrapping — this IS the data to serialize).

### Bundle Structure

```json
{
  "version": 1,
  "dbVersion": 7,
  "timestamp": "2026-09-02T20:30:00.000Z",
  "cryptoMeta": { "id": "meta", "v": 1, "alg": "PBKDF2-SHA256", "iterations": 600000, "salt": "<b64>", "wrappedDek": "<b64>" },
  "stores": {
    "entries": [{ "id": "__enc__", "v": 1, "alg": "AES-GCM-256", "salt": "...", "iv": "...", "ct": "..." }],
    "budgets": [{ "id": "__enc__", "v": 1, ... }],
    "recurring": [{ "id": "__enc__", ... }],
    "customCategories": [{ "id": "__enc__", ... }],
    "aiSettings": [{ "id": "active", ... }],
    "settings": [{ "id": "active", ... }]
  }
}
```

- `version`: bundle format version (currently `1`).
- `dbVersion`: value of `DB_VERSION` constant — enables future migration logic.
- `timestamp`: `new Date().toISOString()` at export time.
- `cryptoMeta`: raw record from `cryptoMeta` store, or `null` if no passphrase set.
- `stores.<name>`: array of raw IDB records for that store. Empty array if store is empty. `null` if cryptoMeta is absent and store couldn't be read (edge case — won't happen in normal flow since `initKey` gates reads).

### Validations

Export has minimal validation: it reads whatever is in IDB. The raw records are pass-through; no envelope validation needed at export time (they were validated on write). If DB read fails, the function rejects.

## data-bundle-import

### Implementation

**File**: `src/storage.js`

New function `importAll(bundle)`:

```
async function importAll(bundle) → Promise<{ ok: boolean, errors: string[] }>
```

### Validations (pre-transaction)

Executed BEFORE opening any write transaction:

1. `bundle` is a non-null object → else `{ ok: false, errors: ["not an object"] }`
2. `bundle.version === 1` → else `{ ok: false, errors: ["Unsupported version: <v>"] }` or `["missing version"]`
3. `bundle.stores` is a non-null object → else `{ ok: false, errors: ["missing stores"] }`
4. `bundle.cryptoMeta` is present (non-null) → else `{ ok: false, errors: ["missing cryptoMeta"] }`
5. For each store key in the expected list (`entries`, `budgets`, `recurring`, `customCategories`, `aiSettings`, `settings`): if present, verify `Array.isArray(storeData)` → else skip that store with error. For each record in the array, check `isEnvelope(record)` → if invalid, skip that store, add error.
6. `cryptoMeta` record: verify it has `id === 'meta'` and `salt` and `wrappedDek` fields.

### Atomicity

All writes happen in a single IDB `readwrite` transaction opened across ALL 6 data stores + `cryptoMeta`:

```javascript
const storeNames = [STORE_NAME, BUDGETS_STORE, RECURRING_STORE,
    CUSTOM_CATEGORIES_STORE, AI_SETTINGS_STORE, SETTINGS_STORE, CRYPTO_META_STORE];
const tx = db.transaction(storeNames, 'readwrite');
```

For each store present in the bundle and passing validation:
1. Clear the store: `tx.objectStore(name).clear()`
2. Put each record: `tx.objectStore(name).put(record)`

If any `put` or `clear` fails, the transaction auto-aborts (IDB behavior). The function catches the error and returns `{ ok: false, errors: [...] }`. No partial writes survive.

### Partial Bundle Semantics

**Decision**: Stores NOT present in `bundle.stores` are left **intact** (not cleared, not touched).

**Rationale**: A partial bundle may come from an older export that didn't include all stores. Clearing untouched stores would silently destroy data the user didn't intend to replace. If the user wants a full replacement, they export a full bundle. The confirmation modal warns "will overwrite X stores" so the user knows the scope.

### Post-Import

After successful transaction commit, return `{ ok: true, errors: [] }`. The caller (`cloud-sync.js`) triggers `location.reload()` to re-initialize the app with the new data.

## cloud-sync-ui

### index.html

**Location**: After the existing Excel import/export buttons (line ~100), add:

```html
<button type="button" id="btnExportBackup" class="btn btn-outline-secondary ms-1">📦 Exportar Backup</button>
<input type="file" id="fileInputFPKG" accept=".fpkg" class="d-none">
<button type="button" id="btnImportBackup" class="btn btn-outline-secondary ms-1">📥 Importar Backup</button>
```

**Location**: Before the closing `</body>` (near other modals, after `changePassphraseModal`):

```html
<!-- Modal Confirmar Importación -->
<div class="modal fade" id="importConfirmModal" tabindex="-1" ...>
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">📥 Confirmar importación</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
      </div>
      <div class="modal-body">
        <p>Se importará un backup con los siguientes datos:</p>
        <ul id="importBundleInfo"><!-- populated by JS --></ul>
        <div class="alert alert-warning small">
          ⚠️ Esto reemplazará los datos actuales en los stores incluidos. Acción irreversible.
        </div>
        <div id="importError" class="text-danger small" role="alert"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancelar</button>
        <button type="button" class="btn btn-danger" id="btnConfirmImport">Confirmar importación</button>
      </div>
    </div>
  </div>
</div>
```

**Script tag**: Add `<script src="src/cloud-sync.js"></script>` between `src/storage.js` and `src/toast.js` (line ~602).

### src/cloud-sync.js (New File)

```
downloadPackage()
  → storage.exportAll()
  → JSON.stringify(bundle, null, 2)
  → new Blob([json], { type: 'application/json' })
  → URL.createObjectURL(blob)
  → create <a>, set download="finanzas-backup-YYYY-MM-DD.fpkg", click, revoke

uploadPackage()
  → <input type="file"> click
  → FileReader.readAsText()
  → JSON.parse()
  → Pre-validate (version, stores, cryptoMeta presence)
  → If invalid: toast.showError(), return
  → Populate modal #importBundleInfo with timestamp, dbVersion, store count
  → Show #importConfirmModal via Bootstrap Modal
  → On confirm: storage.importAll(bundle) → toast → location.reload()
  → On cancel: modal dismisses, no action
```

### Flujo de importación (paso a paso)

1. User clicks "📥 Importar Backup" → triggers hidden `<input type="file">` click
2. File picker opens, filtered to `.fpkg`
3. User selects file → `FileReader.readAsText()` → `JSON.parse()`
4. Pre-validate: `version`, `stores` presence, `cryptoMeta` presence
5. If invalid → `toast.showError("Archivo de backup inválido: <reason>")`, abort
6. Populate confirmation modal: backup timestamp, dbVersion, list of stores present
7. Show modal with overwrite warning
8. User clicks "Confirmar importación" → `storage.importAll(bundle)`
9. If `ok: true` → `toast.showSuccess("Backup importado correctamente. Recargando...")` → `location.reload()`
10. If `ok: false` → `toast.showError("Error al importar: <errors.join>")`, modal stays open for user to dismiss

### app.js

Add two event listeners in `init()` (after Excel export/import handlers, ~line 2132):

```javascript
document.getElementById('btnExportBackup').addEventListener('click', () => fpCloudSync.downloadPackage());
document.getElementById('btnImportBackup').addEventListener('click', () => fpCloudSync.uploadPackage());
```

Buttons are disabled when `hasEncryptionKey()` is false (passphrase not set). Check in the render/init function and apply `disabled` attribute.

## Testing Strategy

### Tests per Capability

**data-bundle-export** (add to `src/storage.test.js`):

| Test | What to verify | Mock |
|------|---------------|------|
| Export returns all 7 keys | `exportAll()` result has `version`, `dbVersion`, `timestamp`, `cryptoMeta`, `stores` with 6 store keys | None (fake-indexeddb) |
| Export with populated stores | Pre-save entries via `save()`, verify they appear in `bundle.stores.entries` as raw envelope | None |
| Export with empty stores | Fresh DB → all store arrays are empty | None |
| Export includes cryptoMeta | After `initKey()`, `bundle.cryptoMeta` has `salt`, `wrappedDek` | None |
| Export without cryptoMeta | No passphrase set → `bundle.cryptoMeta` is `null` | None |
| Export dbVersion matches constant | `bundle.dbVersion === 7` | None |
| Export timestamp is valid ISO | `!isNaN(Date.parse(bundle.timestamp))` | None |

**data-bundle-import** (add to `src/storage.test.js`):

| Test | What to verify | Mock |
|------|---------------|------|
| Valid bundle accepted | `{ version:1, stores:{...}, cryptoMeta:{...} }` → `{ ok: true }` | None |
| Null input rejected | `importAll(null)` → `{ ok: false, errors: [...] }` | None |
| Missing version rejected | No `version` field → error | None |
| Wrong version rejected | `version: 2` → error | None |
| Missing stores rejected | No `stores` field → error | None |
| Missing cryptoMeta rejected | `cryptoMeta: null` → error | None |
| Corrupted envelope skipped | Store record missing `alg/salt/iv/ct` → that store skipped, others written | Inject bad record via `rawPut` |
| Round-trip: export then import | `exportAll()` → `importAll()` → `load()` → data matches | None |
| Atomicity: partial write rolls back | Inject error during transaction → no stores modified | `rawPut` to corrupt a store before import |
| Partial bundle leaves untouched stores | Bundle with only `entries` → other stores retain previous data | Pre-save budgets, import entries-only bundle |

**cloud-sync-ui** (add to `src/cloud-sync.test.js` — new file):

| Test | What to verify | Mock |
|------|---------------|------|
| downloadPackage creates Blob | Call `downloadPackage()` → verify `URL.createObjectURL` called | Mock `URL.createObjectURL` |
| uploadPackage parses valid JSON | Provide valid JSON blob → verify `importAll` called | Mock FileReader |
| uploadPackage rejects invalid JSON | Provide non-JSON → verify `showError` called, no import | Mock FileReader |
| uploadPackage rejects wrong version | Provide `{ version: 99 }` → verify pre-validation error | Mock FileReader |

### Fixtures

Create in each test file as inline constants:

```javascript
// Valid bundle fixture
const VALID_BUNDLE = {
    version: 1,
    dbVersion: 7,
    timestamp: '2026-09-02T20:30:00.000Z',
    cryptoMeta: { id: 'meta', v: 1, alg: 'PBKDF2-SHA256', iterations: 600000, salt: 'dGVzdA==', wrappedDek: 'dGVzdA==' },
    stores: {
        entries: [{ id: '__enc__', v: 1, alg: 'AES-GCM-256', salt: 'dGVzdA==', iv: 'dGVzdA==', ct: 'dGVzdA==' }],
        budgets: [],
        recurring: [],
        customCategories: [],
        aiSettings: [],
        settings: []
    }
};

// Corrupt envelope (missing alg)
const CORRUPT_BUNDLE = { ...VALID_BUNDLE, stores: { ...VALID_BUNDLE.stores, entries: [{ id: '__enc__', v: 1 }] } };

// Partial bundle (only entries)
const PARTIAL_BUNDLE = { ...VALID_BUNDLE, stores: { entries: VALID_BUNDLE.stores.entries } };
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/storage.js` | Modify | Add `exportAll()` (~30 lines), `importAll()` (~60 lines). Add both to `module.exports` and `window.storage`. |
| `src/cloud-sync.js` | Create | ~70 lines. `downloadPackage()`, `uploadPackage()`, modal wiring. Exposed as `window.fpCloudSync`. |
| `index.html` | Modify | Add 2 buttons + 1 hidden file input (~3 lines). Add import confirmation modal (~25 lines). Add `<script>` tag for `cloud-sync.js` (~1 line). |
| `app.js` | Modify | Add 2 event listeners in `init()` (~6 lines). Button enable/disable logic (~4 lines). |
| `src/storage.test.js` | Modify | Add ~150 lines: export tests (7), import tests (10). |
| `src/cloud-sync.test.js` | Create | ~80 lines: download/upload unit tests with mocked FileReader and URL. |

## Interfaces / Contracts

```javascript
// src/storage.js — new exports
exportAll() → Promise<{ version: number, dbVersion: number, timestamp: string, cryptoMeta: Object|null, stores: Object }>
importAll(bundle: Object) → Promise<{ ok: boolean, errors: string[] }>

// src/cloud-sync.js — exposed on window
window.fpCloudSync = { downloadPackage, uploadPackage }
downloadPackage() → Promise<void>  // rejects on export failure
uploadPackage() → Promise<{ ok: boolean, errors: string[] }>  // never throws
```

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration required. Entirely additive: new functions and UI elements. No existing data flow or API changes.

## Estimation

| File | Lines Added | Lines Modified |
|------|------------|----------------|
| `src/storage.js` | ~90 | ~6 (exports) |
| `src/cloud-sync.js` | ~70 (new) | — |
| `index.html` | ~30 | — |
| `app.js` | ~10 | — |
| `src/storage.test.js` | ~150 | — |
| `src/cloud-sync.test.js` | ~80 (new) | — |
| **Total** | **~430** | **~6** |

**400-line budget risk: MEDIUM.** The core logic (storage + cloud-sync + HTML) is ~200 lines. Tests add ~230. Consider splitting: PR 1 = storage + cloud-sync + HTML + app.js (~200 lines), PR 2 = tests (~230 lines). Or ship as single PR if tests are clearly scoped.

## Open Questions

- [ ] Should the import confirmation modal also show the number of entries in each store? (Nice-to-have, not blocking.)
- [ ] Should `importAll` also update the localStorage mirrors for dual-write stores (`aiSettings`, `settings`)? Current design writes IDB only; after `location.reload()` the app re-reads from IDB anyway. Adding LS sync is defense-in-depth but increases scope.
