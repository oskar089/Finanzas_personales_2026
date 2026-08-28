# Design: Data Encryption at Rest (Passphrase Envelope)

## Technical Approach

A new `src/crypto.js` module (pure Web Crypto layer, no DOM, no persistence) implements a passphrase envelope: a random 256-bit data-encryption key (DEK) is wrapped by a passphrase-derived key-wrapping key (KEK, PBKDF2-SHA256 + fresh salt) and only the wrapped DEK + salt are persisted in a new `cryptoMeta` store (DB v7, additive). Every payload is AES-GCM-256 encrypted at the storage serialization boundary — `idbGetAll*/idbPutAll*` per store and `lsLoad*/lsSave*` per key — producing a **single versioned envelope record per store** `{ <keyfield>: <key>, v, alg, salt, iv, ct }`, identical across IndexedDB and its localStorage mirror, so a load decrypts from either source. `storage.initKey(passphrase)` resolves the DEK before the first `load()`; a migration pass on first v7 boot re-encrypts legacy plaintext in both backends with **purge only after a verified encrypted write**. Boot becomes passphrase-gated via a modal in `app.js`. Maps to spec DE1–DE15 (storage domain: modified `storage` capability; data-encryption: new capability).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ app.js (boot)                                                       │
│ init() → cryptoGate():                                              │
│   1. fpCrypto.assertSecureContext()   (refuse if subtle missing)    │
│   2. storage.hasEncryptionKey() → #passphraseModal (setup|unlock)   │
│   3. await storage.initKey(passphrase) → resolve DEK                │
│ then loadFromStorage() → storage.load() → migrateEncryption() → ... │
│ 🔐 Cambiar clave modal → storage.changePassphrase(cur,new)          │
└───────────────┬─────────────────────────────────────────────────────┘
                │ storage.initKey / changePassphrase / load*/save*
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│ src/storage.js  (owns persistence — single source of truth)         │
│ cryptoMeta store (DB v7) + LS key 'finanzas:crypto-meta:v1'         │
│ envelope-aware boundaries: idbGetAll*/idbPutAll*, lsLoad*/lsSave*   │
│ migrateEncryption(): plaintext → ciphertext → verify → purge        │
└───────┬──────────────────────────────┬──────────────────────────────┘
        │ encrypt/decrypt              │ raw wrapped DEK + salt
        ▼                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ src/crypto.js  (pure Web Crypto, dual export, loaded first)         │
│ state: { ready, dek, salt, iterations } — DEK only in memory        │
│ init(passphrase, meta) / changePassphrase / encryptPayload /        │
│ decryptPayload / isEncryptionReady / assertSecureContext            │
└─────────────────────────────────────────────────────────────────────┘
```

## Architecture Decisions

| Decision | Options | Tradeoff | Choice |
|----------|---------|----------|--------|
| Key model | Direct passphrase-derived key vs random DEK wrapped by KEK (envelope) | Direct: simpler, but passphrase change forces re-encrypting every payload (violates DE6). Envelope: re-wrap DEK only, data untouched; strongest confidentiality. | **Envelope (DEK + KEK)** — only wrapped DEK + salt persist |
| Who persists `cryptoMeta` | crypto.js opens its own IDB/LS vs storage.js owns it | crypto.js owning persistence duplicates storage.js and risks circular deps with load order. | **storage.js owns persistence**; crypto.js is fed `meta` via `init(passphrase, meta)` and returns the meta to persist — crypto.js stays DOM/IDB-free and purely testable |
| Envelope storage layout | Per-record envelopes vs one envelope per store (whole payload) | Per-record: preserves per-key queries, but app NEVER key-queries (only getAll/clear/putAll — exploration §2) and per-record adds envelope overhead per row. Whole-store: one record, replace-all semantics already assume full-array writes. | **One envelope record per store** — payload encrypted whole; record key `'__enc__'` for keyPath stores, `'active'` for aiSettings/settings (single-key upsert replaces plaintext atomically) |
| Envelope encoding | base64 strings vs Uint8Array | Uint8Array structured-clones fine in IDB but becomes `{}` through JSON in the LS mirror. Envelope must survive `JSON.stringify` for LS. | **base64 strings** (`v, alg, salt, iv, ct`) — single representation works identically in both backends; `toB64/fromB64` with 64 KB chunking |
| Key-wrapping IV | Store a wrap IV vs derive deterministically | Storing adds a field; deriving from the same PBKDF2 run (dkLen 44 = 32 KEK + 12 wrap IV) needs no extra storage and is unique per fresh salt (one wrap per salt ever). | **PBKDF2-SHA256 dkLen 44** → first 32 bytes KEK, last 12 bytes wrap IV (deterministic, no storage) |
| PBKDF2 cost | 310k vs 600k iterations | 310k ≈ ~1 s (spec-acceptable), 600k ≈ ~2 s on low-end. | **600,000 iterations, 16-byte salt** — constants in crypto.js; `iterations` also persisted in meta for future KDF evolution |
| Envelope `salt` field | Omit (meta-only) vs include per payload | Spec DE2/DE9 literally list `{v, alg, salt, iv, ct}` and DE9 names salt among what makes a blob portable. | **Include `salt`** = current key-material salt (KDF context stamp; ~44 base64 chars per store, negligible); cloud-sync blob = cryptoMeta + payload envelopes |
| AAD binding | Backend-specific (store name vs LS key) vs canonical store name | LS key differs per backend (`finanzas:gastos:v1` vs store `entries`); binding to it would make cross-backend decrypt fail (DE11 requires same envelope decryptable from either source). | **AAD = canonical store name** (e.g. `entries`), identical in both backends — DE8 still binds payload to its store, DE11 preserved |
| Wrong-passphrase detection | Try/decrypt payload vs KEK unwrap fails | GCM unwrap is authenticated — a wrong KEK makes unwrap fail inevitably. | **Unwrap failure = wrong passphrase** (DE5); no heuristic needed |
| Gate placement | Gate inside crypto.js vs storage.js public API | Loads/saves must refuse before any DB mutation. | **`assertKeyReady()` at the top of each public load*/save*`** — throws before `idbClear` runs (no partial writes) |
| Dual export name | `window.crypto` vs `window.fpCrypto` | `window.crypto` is the Web Crypto global — collision. | **`window.fpCrypto`** (+ `module.exports`) — loaded in index.html BEFORE `src/storage.js` |

## Data Model

### Envelope (payload record, one per store, both backends)

```js
// IDB: single record per store. aiSettings/settings reuse key 'active' (upsert replaces the
// v6 plaintext record atomically); keyPath stores use the fixed key '__enc__'.
{
  id: 'active' | '__enc__',      // <keyfield> per store — always the record's primary key
  v:   1,                        // envelope version
  alg: 'AES-GCM-256',
  salt: 'base64(16B)',           // KDF salt of the current key material (context stamp)
  iv:  'base64(12B)',            // fresh per encrypt call (crypto.getRandomValues)
  ct:  'base64(ciphertext)'      // AES-GCM-256(JSON.stringify(payload)), tagLength 128
}
```

- `isEnvelope(v)`: `v && typeof v === 'object' && v.v === 1 && typeof v.alg === 'string' && typeof v.iv === 'string' && typeof v.ct === 'string'`. No legacy record shape collides (entries/budgets/recurring/customCategories records and aiSettings/settings records have none of `v/iv/ct`).
- AAD (additional authenticated data) = UTF-8 bytes of the **canonical store name**: `entries`, `budgets`, `recurring`, `customCategories`, `aiSettings`, `settings` — same in IDB and LS, so either source decrypts (DE11) and wrong-store decryption fails auth (DE8).

### `cryptoMeta` store (DB v7) — single record `id: 'meta'`

```js
{ id: 'meta', v: 1, alg: 'PBKDF2-SHA256', iterations: 600000, salt: 'base64(16B)', wrappedDek: 'base64(48B)', updatedAt: number }
```

- `wrappedDek` = AES-GCM(wrapIv = last 12 bytes of the dkLen-44 derivation) wrapping the raw 32-byte DEK → 32 + 16 GCM tag = 48 bytes.
- Only the wrapped DEK + salt persist (DE2); the KEK and raw DEK exist only in memory.
- LS mirror key `finanzas:crypto-meta:v1` — dual-written (same pattern as aiSettings/settings) so key material loads even when IDB is down.

### localStorage keys after migration

| Key | After migration |
|-----|-----------------|
| `finanzas:gastos:v1`, `finanzas:budgets:v1`, `finanzas:recurring:v1`, `finanzas:custom-categories:v1` | Purged (IDB is authoritative for fallback stores) |
| `finanzas:ai-settings:v1`, `finanzas:settings:v1` | Ciphertext envelope (dual-write, never purged) |
| `finanzas:crypto-meta:v1` | Wrapped DEK + salt (dual-write) |
| `finanzas:migrated`, `finanzas:dark-mode` | Plaintext metadata/UI pref — unchanged, out of scope |

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/crypto.js` | **Create** | Pure Web Crypto envelope layer: `init`, `changePassphrase`, `encryptPayload`, `decryptPayload`, `isEncryptionReady`, `assertSecureContext`; `window.fpCrypto` + `module.exports` |
| `src/storage.js` | **Modify** | `DB_VERSION` 6→7 + `cryptoMeta` store; envelope-aware `idbGetAll*/idbPutAll*` + `lsLoad*/lsSave*`; `initKey`, `changePassphrase`, `hasEncryptionKey`, `migrateEncryption`; `assertKeyReady()` gate on every public load/save; key-aware `migrateFromLS` |
| `src/crypto.test.js` | **Create** | `// @vitest-environment node` — DE1–DE9 unit suite |
| `src/storage.test.js` | **Modify** | Inject `node:crypto` subtle; `initKey` in beforeEach; ciphertext-at-rest asserts; DB v7 assert; dual-write + fallback encryption; seeded v6→v7 migration suite (DE11–DE15) |
| `app.js` | **Modify** | `cryptoGate()` before `loadFromStorage()` in `init()`; passphrase modal handlers; change-passphrase handler; secure-context block panel; no-recovery warning + Excel-export reminder |
| `index.html` | **Modify** | `<script src="src/crypto.js">` before `src/storage.js`; `🔐 Clave` navbar button; `#passphraseModal` (static backdrop, not dismissible), `#changePassphraseModal`, `#secureContextError` panel |

`sw.js`, `server.js`, `src/finance.js`, `src/ai-providers.js` untouched (static-asset cache; data never flows through Cache API).

## Key Functions — Pseudocode

### `src/crypto.js`

```js
const ENVELOPE_VERSION = 1, CIPHER_ALG = 'AES-GCM-256', KDF_ALG = 'PBKDF2-SHA256';
const PBKDF2_ITERATIONS = 600000, SALT_BYTES = 16, IV_BYTES = 12, DEK_BYTES = 32;
const KDF_DKLEN = 44; // 32 KEK + 12 deterministic wrap IV
let state = { ready: false, dek: null, salt: null, iterations: PBKDF2_ITERATIONS };

function assertSecureContext() {
  const s = globalThis.crypto?.subtle;
  if (!s || typeof s.importKey !== 'function' || typeof s.deriveBits !== 'function'
      || typeof s.encrypt !== 'function' || typeof s.decrypt !== 'function') {
    throw new SecureContextError('Cifrado requiere un contexto seguro (localhost o HTTPS).');
  }
  return true;
}

// meta: { salt, wrappedDek, iterations } | null (null = fresh install). Returns meta to persist.
async function init(passphrase, meta) {
  assertSecureContext();
  if (typeof passphrase !== 'string' || passphrase.length < 8) throw new PassphraseTooShortError();
  if (!meta) { // first boot: create DEK + salt, wrap, caller persists
    state.salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    state.dek = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    state.ready = true;
    return await buildMeta();
  }
  const { kek, wrapIv } = await deriveKek(passphrase, fromB64(meta.salt), meta.iterations);
  try {
    state.dek = await subtle.unwrapKey('raw', fromB64(meta.wrappedDek), kek,
      { name: 'AES-GCM', iv: wrapIv, tagLength: 128 },
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  } catch { throw new WrongPassphraseError(); } // GCM auth failure ⇒ wrong passphrase (DE5)
  state.salt = fromB64(meta.salt); state.iterations = meta.iterations; state.ready = true;
  return meta;
}

// Re-wrap the SAME DEK with a new KEK (DE6) — payload ciphertext is never touched.
async function changePassphrase(current, next) {
  if (typeof next !== 'string' || next.length < 8) throw new PassphraseTooShortError();
  if (!state.ready) throw new EncryptionNotReadyError();
  await init(current, { salt: toB64(state.salt), wrappedDek: await wrapDek(), iterations: state.iterations }); // auth check
  const oldDek = state.dek;
  state.salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  state.dek = oldDek;
  return await buildMeta(); // caller persists { salt, wrappedDek, iterations }
}

async function deriveKek(passphrase, salt, iterations) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, KDF_DKLEN * 8);
  return { kek: await subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['wrapKey', 'unwrapKey']),
           wrapIv: bits.slice(32, 44) };
}
async function wrapDek() {
  const { kek, wrapIv } = await deriveKekFromCurrentState();
  return toB64(await subtle.wrapKey('raw', state.dek, kek, { name: 'AES-GCM', iv: wrapIv, tagLength: 128 }));
}
async function encryptPayload(storeName, obj) { // throws EncryptionNotReadyError if !state.ready
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128,
    additionalData: new TextEncoder().encode(storeName) }, state.dek, plain);
  return { v: ENVELOPE_VERSION, alg: CIPHER_ALG, salt: toB64(state.salt), iv: toB64(iv), ct: toB64(ct) };
}
async function decryptPayload(storeName, enc) { // throws PayloadAuthError on OperationError
  try {
    const plain = await subtle.decrypt({ name: 'AES-GCM',
      iv: fromB64(enc.iv), tagLength: 128, additionalData: new TextEncoder().encode(storeName) },
      state.dek, fromB64(enc.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch { throw new PayloadAuthError('Envoltorio corrupto o almacén incorrecto.'); }
}
function isEncryptionReady() { return state.ready; }

// Dual export — window.fpCrypto (NOT window.crypto: collides with the Web Crypto global).
if (typeof module !== 'undefined' && module.exports) module.exports = { init, changePassphrase, encryptPayload, decryptPayload, isEncryptionReady, assertSecureContext };
if (typeof window !== 'undefined') window.fpCrypto = { init, changePassphrase, encryptPayload, decryptPayload, isEncryptionReady, assertSecureContext };
```

### `src/storage.js` (DB v7)

```js
const DB_VERSION = 7; // v7: añadido store cryptoMeta
const CRYPTO_META_STORE = 'cryptoMeta';
const LS_CRYPTO_META_KEY = 'finanzas:crypto-meta:v1';
const ENC_KEY = '__enc__'; // fixed record key for keyPath stores
// crypto.js loaded BEFORE storage.js (index.html). Node tests import both modules.
const fpCrypto = (typeof window !== 'undefined' && window.fpCrypto)
  ? window.fpCrypto
  : (typeof require === 'function' ? require('./crypto.js') : null);

function isEnvelope(v) { return v && typeof v === 'object' && v.v === 1 && typeof v.alg === 'string'
  && typeof v.iv === 'string' && typeof v.ct === 'string'; }
function assertKeyReady() { if (!fpCrypto || !fpCrypto.isEncryptionReady()) throw new Error('Cifrado no inicializado: llamá storage.initKey(passphrase) primero.'); }

// onupgradeneeded — additive, guarded like storage.js:38-55:
if (!db.objectStoreNames.contains(CRYPTO_META_STORE)) db.createObjectStore(CRYPTO_META_STORE, { keyPath: 'id' });

// --- Key material API ---
async function initKey(passphrase) { // gates boot; caller = app.js cryptoGate
  if (fpCrypto.isEncryptionReady()) return true;
  const meta = (await idbGetCryptoMeta()) || lsLoadCryptoMeta();
  if (!meta && (await hasEncryptedData())) throw new KeyMaterialMissingError(); // ciphertext but no key ⇒ refuse, never re-wrap silently
  const result = await fpCrypto.init(passphrase, meta); // throws TooShort / WrongPassphrase / SecureContext
  await idbPutCryptoMeta(result); lsSaveCryptoMeta(result); // dual-write meta (IDB + LS)
  return true;
}
async function changePassphrase(current, next) {
  const meta = await fpCrypto.changePassphrase(current, next);
  await idbPutCryptoMeta(meta); lsSaveCryptoMeta(meta);
}
async function hasEncryptionKey() { const m = await idbGetCryptoMeta().catch(() => null); return !!(m || lsLoadCryptoMeta()); }

// --- Envelope-aware boundaries (store/domain examples; all 6 follow this shape) ---
async function idbGetAll(db) {      // entries
  const rows = await idbGetAllRaw(db);
  if (rows.length === 1 && isEnvelope(rows[0])) return fpCrypto.decryptPayload('entries', rows[0]); // → array
  return rows;                      // empty, or legacy plaintext pre-migration
}
async function idbPutAll(db, payload) { // payload = plaintext array/object; whole-payload encrypt
  assertKeyReady();
  const rec = { id: ENC_KEY, ...(await fpCrypto.encryptPayload('entries', payload)) };
  await idbPutAllRaw(db, [rec]);
}
// idbGetAiSettings: get('active') → isEnvelope ? decryptPayload('aiSettings', rec) : rec;
// idbPutAiSettings: put({ id: 'active', ...envelope }) — same-key upsert replaces v6 plaintext atomically.
// lsLoad*/lsSave* per key: lsSaveX = localStorage.setItem(KEY, JSON.stringify({ id: ENC_KEY, ...envelope }));
// lsLoadX = raw → isEnvelope ? fpCrypto.decryptPayload(STORE, raw) : raw (legacy passthrough).

// --- Migration (v6 plaintext → v7 ciphertext, purge only after verified write) ---
async function migrateEncryption(db) { // called from load(); idempotent per store/key
  for (const { store, lsKey, aad, mode } of MIGRATION_PLAN) { // mode: 'fallback' | 'dual'
    const rows = await rawGetAll(db, store);
    if (rows.length === 0 || isEnvelope(rows[0])) { // already encrypted (or empty) → LS mirror still needs it
      if (mode === 'dual') await migrateLsKey(lsKey, aad); // rewrite legacy plaintext LS mirror as ciphertext
      continue;
    }
    assertKeyReady();
    const env = { id: storeKeyFor(store), ...(await fpCrypto.encryptPayload(aad, rows.length === 1 ? rows[0] : rows)) };
    await rawPut(db, store, env);                      // 1. write ciphertext (plaintext still present)
    const back = await rawGetAll(db, store);           // 2. read back
    if (!back.some(isEnvelope) || JSON.stringify(back) !== JSON.stringify([env])) {
      throw new MigrationVerifyError(store);           // 3. verify — abort BEFORE any purge
    }
    await rawClear(db, store);                         // 4. purge plaintext (verified write exists)
    await rawPut(db, store, env);                      // 5. final clean state (same verified op)
    if (mode === 'dual') await migrateLsKey(lsKey, aad); // dual: LS mirror = ciphertext
    else localStorage.removeItem(lsKey);               // fallback: LS remnant purged (IDB authoritative)
  }
  await migrateLsKeysWhenIdbDown(); // if a later load hits LS-only, encrypt-in-place + verify (DE15)
}
```

- `MIGRATION_PLAN`: `entries/gastos/fallback`, `budgets/fallback`, `recurring/fallback`, `customCategories/fallback`, `aiSettings/dual`, `settings/dual` — AAD = canonical store name in both backends.
- `migrateFromLS(db)` (existing) becomes: `idbPutAll` (now encrypts whole payload) → read-back-decrypt verify vs `lsData` → only then `lsClear()` (its existing `finanzas:migrated` flag behavior unchanged).
- **`load()` order (v7)**: `assertKeyReady()` → `openDB()` → `migrateFromLS` (if `finanzas:migrated` absent) → `migrateEncryption(db)` → `idbGetAll` (decrypt) → normalize (`tipo || 'expense'`). `save*` = `assertKeyReady()` → clear → `idbPutAll` (ciphertext) → LS fallback/dual-write via envelope-aware `lsSave*`.
- Exports append: `initKey, changePassphrase, hasEncryptionKey` to `module.exports` and `window.storage`.

## Boot UX & Modal Wiring (`app.js`, `index.html`)

- `init()` (app.js:1655) gains `if (!(await cryptoGate())) return;` before `loadFromStorage()` (line 1656). `checkAndGenerateRecurring()` (writes at boot) therefore runs only after key resolution — no plaintext write.
- `cryptoGate()`: (1) `fpCrypto.assertSecureContext()` fails → show `#secureContextError` block panel (DE3: refuse to start, no loads, no silent plaintext); (2) `storage.hasEncryptionKey()` → open `#passphraseModal` in *setup* (first boot: passphrase + confirm + warning) or *unlock* mode (passphrase only); (3) submit → `await storage.initKey(pass)`; on `WrongPassphraseError` show "Contraseña incorrecta" inline and stay open (DE5, data untouched); on success hide modal and proceed.
- Modal markup: `#passphraseModal` with `data-bs-backdrop="static" data-bs-keyboard="false"` (boot cannot proceed without it); placed after `#currencySettingsModal` (index.html:512). Navbar: `🔐 Clave` button (`btnPassphrase`, after `btnCurrencySettings`, line 26) opening `#changePassphraseModal` (current + new + confirm; `await storage.changePassphrase(cur, next)` → success toast; payloads untouched — DE6).
- DE10 warning in BOTH modals and as a one-time toast after first-boot setup: "Si perdés la contraseña, tus datos son irrecuperables. Exportá regularmente a Excel (📥 Exportar) como respaldo." `finanzas:dark-mode` stays plaintext and synchronous (untouched).

## Testing Strategy (STRICT TDD — RED first per file)

| File | Environment | Approach |
|------|-------------|----------|
| `src/crypto.test.js` (new) | `// @vitest-environment node` (Node ≥24 global `crypto.subtle`) | Pure crypto suite, no DOM, no fake-indexeddb |
| `src/storage.test.js` (modified) | jsdom (default) + `import 'fake-indexeddb/auto'` + **inject subtle**: `import { webcrypto } from 'node:crypto'; globalThis.crypto.subtle = webcrypto.subtle;` at top (jsdom 29 exposes only getRandomValues/randomUUID) | Round-trips, ciphertext-at-rest, migration. `beforeEach: await storage.initKey(TEST_PASSPHRASE)` (first call creates meta; later calls unwrap the same key) |
| Boot/UX flow | Manual (Playwright available) | Modal gate, wrong-passphrase retry, change-passphrase modal |

Mapping (all 15 requirements covered):

- DE1 — `init('short')` rejects with no derivation; `init('valid-pass')` builds meta with fresh 16-byte salt; weak-but-valid accepted.
- DE2 — envelope has exactly `{v, alg, salt, iv, ct}`; round-trip equality; per-call unique 12-byte IVs; `meta` contains only wrappedDek + salt (raw DEK never in meta).
- DE3 — stub `globalThis.crypto = undefined` → `init` throws `SecureContextError`; `assertSecureContext()` also guards.
- DE4/DE5 — `init(pass1, meta)` then `init('wrong-password', meta)` on a fresh module ⇒ `WrongPassphraseError`, `isEncryptionReady()` stays false; storage: unlock flow leaves stored data untouched.
- DE6 — capture envelopes, `changePassphrase`, stored envelopes byte-identical; decrypt still works after re-init with the new passphrase.
- DE7 — `saveAiSettings` with `apiKey: 'sk-test'` → raw IDB record and raw LS JSON contain NO `sk-test` (byte-scan) and `isEnvelope` is true.
- DE8 — `decryptPayload('entries', env)` with AAD `'budgets'` (or omitted) ⇒ `PayloadAuthError`, no plaintext returned.
- DE9 — portability: `vi.resetModules()` + fresh `import('./crypto.js')` → `init(pass, capturedMeta)` → `decryptPayload` of a captured envelope equals the original (simulates a second device).
- DE11 — save → raw IDB + raw LS are envelopes; decrypt-from-IDB and decrypt-from-LS mirror (IDB down) yield identical plaintext; `finanzas:dark-mode` untouched by storage ops.
- DE12 — seeded v6 suite: `indexedDB.deleteDatabase` → manual `indexedDB.open(name, 6)` creating the 6 stores → seed plaintext rows in IDB AND plaintext LS keys (incl. dual-write mirrors) → close → `initKey` → `storage.load()` → assert `db.version === 7`, `cryptoMeta` present, every raw store is one envelope, dual-write LS keys are envelopes, fallback LS keys purged, `load()` returns the exact seeded data (lossless).
- DE12 (purge-after-verify) — `vi.spyOn(window.fpCrypto, 'encryptPayload').mockRejectedValueOnce(...)` → `load()` rejects with `MigrationVerifyError`-family error, plaintext LS retained, store NOT purged.
- DE13 — aiSettings + currency settings: after save, BOTH backends hold ciphertext; boot path loads them (existing round-trip tests extended).
- DE14 — customCategories store + LS: envelopes; lossless round-trip on load.
- DE15 — `globalThis.indexedDB = undefined` → save through LS mirror → load decrypts exact original; envelope-aware `lsLoad` on legacy plaintext returns it as-is.

Existing storage round-trip/fallback tests keep their assertions (gate satisfied via `initKey` in beforeEach); the DB v6 presence test becomes v7 (adds `cryptoMeta`, keeps all 6 legacy stores).

## Secure-Context Guard & Cloud-Sync Readiness

- **Guard (DE3)**: `assertSecureContext()` checks `crypto.subtle` capabilities at call time (never at import). Missing → `cryptoGate()` shows `#secureContextError` and returns false; `loadFromStorage()` never runs; zero plaintext reads/writes (dark-mode pref excluded by spec). App contexts verified viable: `http://localhost:3000` (potentially-trustworthy) and GitHub Pages HTTPS (exploration §5); Safari `file://` and LAN-IP HTTP refuse.
- **Cloud-sync readiness (DE9)**: the envelope needs no device/browser-specific state. A syncable blob = `cryptoMeta` record (wrapped DEK + salt) + payload envelopes; any device with `crypto.subtle` and the passphrase derives the KEK, unwraps the DEK, and decrypts every payload. Envelope `v`/`alg`/`salt` let a future change evolve KDF params without breaking old blobs. Cloud sync itself is out of scope.

## Migration Strategy (v6 → v7)

Additive + zero data loss. `DB_VERSION` 6→7 adds only the `cryptoMeta` store (guarded `contains()`). First v7 boot: passphrase gate → `initKey` (creates/wraps DEK, persists meta to IDB + LS) → `load()` runs `migrateFromLS` then `migrateEncryption`: per store, write ciphertext → read-back-verify (deep equal) → only then purge plaintext (fallback LS keys removed; dual-write LS mirrors rewritten as ciphertext). Idempotent — re-runs skip stores already holding envelopes; LS-only migration covered by the same loop's LS phase (IDB down). Rollback per proposal: revert code to v6 (orphan `cryptoMeta` ignored); ciphertext is unrecoverable without the passphrase — Excel export is the recovery path.

## Error Handling Strategy

| Scenario | Handling |
|----------|----------|
| Passphrase < 8 chars (setup/change) | Modal inline error; no derivation, nothing persisted |
| Wrong passphrase at boot (DE5) | `WrongPassphraseError` → inline "Contraseña incorrecta", modal stays open, data untouched |
| `crypto.subtle` missing (DE3) | `#secureContextError` block panel; boot refuses |
| meta missing but ciphertext present | `KeyMaterialMissingError` — refuse, never silently re-wrap (would corrupt all data) |
| Migration write/verify failure (DE12) | `MigrationVerifyError` before any purge; plaintext retained; next boot retries |
| Corrupt envelope / wrong AAD (DE8) | `PayloadAuthError` → load fails cleanly (surfaces as existing load catch → starts empty is NOT acceptable for ciphertext: app.js gate surfaces the error) |
| IDB down | Existing LS fallback preserved — LS envelope-aware reads/writes; dual-write stores keep mirrors in ciphertext |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Fully offline/local client-side Web Crypto.

## Open Questions

- [x] RESOLVED: spec DE2/DE9 list `salt` inside the payload envelope while DE2 also puts salt in `cryptoMeta` — resolved by including the current key-material salt in every envelope (context stamp; negligible 44-char overhead per store, one envelope per store, not per row).
- [x] RESOLVED: cryptoMeta persistence ownership — storage.js (single persistence owner); crypto.js receives/persists meta via init return.
- [x] RESOLVED: jsdom `crypto.subtle` gap — storage.test.js injects `node:crypto` webcrypto subtle; crypto.test.js runs under `// @vitest-environment node`.
- [ ] PBKDF2 iteration count is a documented constant (600k per OWASP 2026); revisit if the ~2 s boot cost regresses on low-end hardware during manual testing.