// =====================================================================
// FINANZAS PERSONALES 2026 - Capa de persistencia
// =====================================================================
// Wrapper sobre IndexedDB con fallback a localStorage.
// API: load(), save(entries), clear()
// =====================================================================

const DB_NAME = 'finanzas_personales_2026';
const DB_VERSION = 7; // v3: añadido store recurring | v4: añadido store customCategories | v5: añadido store aiSettings | v6: añadido store settings | v7: añadido store cryptoMeta
const STORE_NAME = 'entries';
const BUDGETS_STORE = 'budgets';
const RECURRING_STORE = 'recurring';
const CUSTOM_CATEGORIES_STORE = 'customCategories';
const AI_SETTINGS_STORE = 'aiSettings';
const SETTINGS_STORE = 'settings';
const CRYPTO_META_STORE = 'cryptoMeta';
const LS_CRYPTO_META_KEY = 'finanzas:crypto-meta:v1';
const ENC_KEY = '__enc__'; // clave fija del envelope para stores con keyPath (no active)
const LS_KEY = 'finanzas:gastos:v1';
const LS_BUDGETS_KEY = 'finanzas:budgets:v1';
const LS_RECURRING_KEY = 'finanzas:recurring:v1';
const LS_CUSTOM_CATEGORIES_KEY = 'finanzas:custom-categories:v1';
const LS_AI_SETTINGS_KEY = 'finanzas:ai-settings:v1';
const LS_SETTINGS_KEY = 'finanzas:settings:v1';
const LS_MIGRATED_KEY = 'finanzas:migrated';

// crypto.js carga ANTES que storage.js en index.html (contracto de orden).
// En tests (Node) resolvemos ambos módulos vía require.
const fpCrypto = (typeof window !== 'undefined' && window.fpCrypto)
    ? window.fpCrypto
    : (typeof require === 'function' ? require('./crypto.js') : null);

// --- Envelope helpers -----------------------------------------------------

function isEnvelope(v) {
    return !!v && typeof v === 'object' && v.v === 1 && typeof v.alg === 'string'
        && typeof v.iv === 'string' && typeof v.ct === 'string';
}

class EncryptedStorageReadError extends Error {
    constructor(store) {
        super('No se pudieron verificar los datos cifrados.');
        this.name = 'EncryptedStorageReadError';
        this.store = store;
    }
}

async function decryptEncryptedPayload(store, envelope) {
    try {
        return await fpCrypto.decryptPayload(store, envelope);
    } catch {
        throw new EncryptedStorageReadError(store);
    }
}

function isObjectRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertKeyReady() {
    if (!fpCrypto || !fpCrypto.isEncryptionReady()) {
        throw new Error('Cifrado no inicializado: llamá storage.initKey(passphrase) primero.');
    }
}

// Los stores keyPath usan la clave fija '__enc__'; aiSettings/settings usan 'active'.
// Cada store tiene distinto campo de clave primaria (entries/recurring/... = 'id',
// budgets = 'categoria', customCategories = 'nombre'), así que el envelope debe
// portar el keyField correcto o el put de IDB falla (missing key).
const STORE_KEY_FIELD = {
    [STORE_NAME]: 'id',
    [BUDGETS_STORE]: 'categoria',
    [RECURRING_STORE]: 'id',
    [CUSTOM_CATEGORIES_STORE]: 'nombre',
    [AI_SETTINGS_STORE]: 'id',
    [SETTINGS_STORE]: 'id',
};

function storeKeyFor(store) {
    return (store === AI_SETTINGS_STORE || store === SETTINGS_STORE) ? 'active' : ENC_KEY;
}

function envelopeRecord(store, env) {
    const keyField = STORE_KEY_FIELD[store] || 'id';
    return { [keyField]: storeKeyFor(store), ...env };
}

// Cifra el payload una sola vez y devuelve el registro-envelope listo para persistir.
// Reutilizado por el dual-write (IDB + LS) para que ambos espejos sean BYTE-idénticos.
async function encryptAndRecord(store, payload) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(store, payload);
    return envelopeRecord(store, env);
}

function idbRequest(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// --- Detección de soporte -------------------------------------------

function isIDBAvailable() {
    try {
        return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
        return false;
    }
}

// --- IndexedDB helpers -----------------------------------------------

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(BUDGETS_STORE)) {
                db.createObjectStore(BUDGETS_STORE, { keyPath: 'categoria' });
            }
            if (!db.objectStoreNames.contains(RECURRING_STORE)) {
                db.createObjectStore(RECURRING_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(CUSTOM_CATEGORIES_STORE)) {
                db.createObjectStore(CUSTOM_CATEGORIES_STORE, { keyPath: 'nombre' });
            }
            if (!db.objectStoreNames.contains(AI_SETTINGS_STORE)) {
                db.createObjectStore(AI_SETTINGS_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
                db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(CRYPTO_META_STORE)) {
                db.createObjectStore(CRYPTO_META_STORE, { keyPath: 'id' });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function idbGetAll(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = async () => {
            const rows = request.result;
            if (rows.length === 1 && isEnvelope(rows[0])) {
                // Envelope de almacén: descifrar payload completo (DE11)
                try {
                    const payload = await decryptEncryptedPayload(STORE_NAME, rows[0]);
                    if (!Array.isArray(payload)) throw new EncryptedStorageReadError(STORE_NAME);
                    resolve(payload);
                } catch (err) {
                    reject(err);
                }
                return;
            }
            resolve(rows); // vacío o plaintext legacy pre-migración
        };
        request.onerror = () => reject(request.error);
    });
}

function idbClear(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function idbReplaceAll(db, storeName, payload) {
    const record = payload.length > 0 ? await encryptAndRecord(storeName, payload) : null;
    await idbReplaceAllRaw(db, storeName, record);
}

function idbReplaceAllRaw(db, storeName, record) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new DOMException('IndexedDB replacement aborted', 'AbortError'));

        try {
            const store = tx.objectStore(storeName);
            store.clear();
            if (record) store.put(record);
        } catch (err) {
            try { tx.abort(); } catch { /* Transaction already aborted. */ }
            reject(err);
        }
    });
}

// --- Budget helpers ----------------------------------------------------

function idbGetAllBudgets(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(BUDGETS_STORE, 'readonly');
        const store = tx.objectStore(BUDGETS_STORE);
        const request = store.getAll();
        request.onsuccess = async () => {
            const rows = request.result;
            if (rows.length === 1 && isEnvelope(rows[0])) {
                try {
                    const payload = await decryptEncryptedPayload(BUDGETS_STORE, rows[0]);
                    if (!Array.isArray(payload)) throw new EncryptedStorageReadError(BUDGETS_STORE);
                    resolve(payload);
                } catch (err) {
                    reject(err);
                }
                return;
            }
            resolve(rows);
        };
        request.onerror = () => reject(request.error);
    });
}

// --- Recurring helpers -------------------------------------------------

function idbGetAllRecurring(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(RECURRING_STORE, 'readonly');
        const store = tx.objectStore(RECURRING_STORE);
        const request = store.getAll();
        request.onsuccess = async () => {
            const rows = request.result;
            if (rows.length === 1 && isEnvelope(rows[0])) {
                try {
                    const payload = await decryptEncryptedPayload(RECURRING_STORE, rows[0]);
                    if (!Array.isArray(payload)) throw new EncryptedStorageReadError(RECURRING_STORE);
                    resolve(payload);
                } catch (err) {
                    reject(err);
                }
                return;
            }
            resolve(rows);
        };
        request.onerror = () => reject(request.error);
    });
}

// --- Custom categories helpers -----------------------------------------

function idbGetAllCustomCategories(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CUSTOM_CATEGORIES_STORE, 'readonly');
        const store = tx.objectStore(CUSTOM_CATEGORIES_STORE);
        const request = store.getAll();
        request.onsuccess = async () => {
            const rows = request.result;
            if (rows.length === 1 && isEnvelope(rows[0])) {
                try {
                    const payload = await decryptEncryptedPayload(CUSTOM_CATEGORIES_STORE, rows[0]);
                    if (!Array.isArray(payload)) throw new EncryptedStorageReadError(CUSTOM_CATEGORIES_STORE);
                    resolve(payload);
                } catch (err) {
                    reject(err);
                }
                return;
            }
            resolve(rows);
        };
        request.onerror = () => reject(request.error);
    });
}

// --- AI Settings helpers -----------------------------------------------

async function idbGetAiSettings(db) {
    const rec = await idbGetRaw(db, AI_SETTINGS_STORE, 'active');
    if (rec && isEnvelope(rec)) {
        const payload = await decryptEncryptedPayload(AI_SETTINGS_STORE, rec);
        if (payload === null) return null;
        if (!isObjectRecord(payload)) throw new EncryptedStorageReadError(AI_SETTINGS_STORE);
        return payload;
    }
    return rec || null; // legacy plaintext (pre-v7) o ausente
}

async function idbPutAiSettings(db, settings) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(AI_SETTINGS_STORE, settings);
    await idbPutRaw(db, AI_SETTINGS_STORE, envelopeRecord(AI_SETTINGS_STORE, env));
}

// --- Currency settings helpers -----------------------------------------

async function idbGetSettings(db) {
    const rec = await idbGetRaw(db, SETTINGS_STORE, 'active');
    if (rec && isEnvelope(rec)) {
        const payload = await decryptEncryptedPayload(SETTINGS_STORE, rec);
        if (payload === null) return null;
        if (!isObjectRecord(payload)) throw new EncryptedStorageReadError(SETTINGS_STORE);
        return payload;
    }
    return rec || null; // legacy plaintext (pre-v7) o ausente
}

async function idbPutSettings(db, settings) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(SETTINGS_STORE, settings);
    await idbPutRaw(db, SETTINGS_STORE, envelopeRecord(SETTINGS_STORE, env));
}

// --- localStorage fallback -------------------------------------------

async function lsLoad() {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (isEnvelope(parsed)) {
        const plain = await decryptEncryptedPayload(STORE_NAME, parsed);
        if (!Array.isArray(plain)) throw new EncryptedStorageReadError(STORE_NAME);
        return plain;
    }
    return Array.isArray(parsed) ? parsed : [];
}

async function lsSave(entries) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(STORE_NAME, entries);
    localStorage.setItem(LS_KEY, JSON.stringify(envelopeRecord(STORE_NAME, env)));
}

function lsClear() {
    localStorage.removeItem(LS_KEY);
}

async function lsLoadBudgets() {
    const raw = localStorage.getItem(LS_BUDGETS_KEY);
    if (!raw) return {};
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (isEnvelope(parsed)) {
        const plain = await decryptEncryptedPayload(BUDGETS_STORE, parsed);
        if (!isObjectRecord(plain)) throw new EncryptedStorageReadError(BUDGETS_STORE);
        return plain;
    }
    return isObjectRecord(parsed) ? parsed : {};
}

async function lsSaveBudgets(budgets) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(BUDGETS_STORE, budgets);
    localStorage.setItem(LS_BUDGETS_KEY, JSON.stringify(envelopeRecord(BUDGETS_STORE, env)));
}

async function lsLoadRecurring() {
    const raw = localStorage.getItem(LS_RECURRING_KEY);
    if (!raw) return [];
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (isEnvelope(parsed)) {
        const plain = await decryptEncryptedPayload(RECURRING_STORE, parsed);
        if (!Array.isArray(plain)) throw new EncryptedStorageReadError(RECURRING_STORE);
        return plain;
    }
    return Array.isArray(parsed) ? parsed : [];
}

async function lsSaveRecurring(recurring) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(RECURRING_STORE, recurring);
    localStorage.setItem(LS_RECURRING_KEY, JSON.stringify(envelopeRecord(RECURRING_STORE, env)));
}

async function lsLoadCustomCategories() {
    const raw = localStorage.getItem(LS_CUSTOM_CATEGORIES_KEY);
    if (!raw) return [];
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (isEnvelope(parsed)) {
        const plain = await decryptEncryptedPayload(CUSTOM_CATEGORIES_STORE, parsed);
        if (!Array.isArray(plain)) throw new EncryptedStorageReadError(CUSTOM_CATEGORIES_STORE);
        return plain;
    }
    return Array.isArray(parsed) ? parsed : [];
}

async function lsSaveCustomCategories(categories) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(CUSTOM_CATEGORIES_STORE, categories);
    localStorage.setItem(LS_CUSTOM_CATEGORIES_KEY, JSON.stringify(envelopeRecord(CUSTOM_CATEGORIES_STORE, env)));
}

async function lsLoadAiSettings() {
    const raw = localStorage.getItem(LS_AI_SETTINGS_KEY);
    if (!raw) return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (isEnvelope(parsed)) {
        const plain = await decryptEncryptedPayload(AI_SETTINGS_STORE, parsed);
        if (plain === null) return null;
        if (!isObjectRecord(plain)) throw new EncryptedStorageReadError(AI_SETTINGS_STORE);
        return plain;
    }
    return isObjectRecord(parsed) ? parsed : null;
}

async function lsSaveAiSettings(settings) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(AI_SETTINGS_STORE, settings);
    localStorage.setItem(LS_AI_SETTINGS_KEY, JSON.stringify(envelopeRecord(AI_SETTINGS_STORE, env)));
}

async function lsLoadSettings() {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (!raw) return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (isEnvelope(parsed)) {
        const plain = await decryptEncryptedPayload(SETTINGS_STORE, parsed);
        if (plain === null) return null;
        if (!isObjectRecord(plain)) throw new EncryptedStorageReadError(SETTINGS_STORE);
        return plain;
    }
    return isObjectRecord(parsed) ? parsed : null;
}

async function lsSaveSettings(settings) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(SETTINGS_STORE, settings);
    localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(envelopeRecord(SETTINGS_STORE, env)));
}

// --- Migración localStorage → IndexedDB (legacy v6) ----------------------------
// Restaura formato v6: records individuales con sus propios IDs (no envelope).
// migrateEncryption() luego leerá todo, cifrará el array completo, y reemplazará
// con un único envelope record (key='__enc__').

async function migrateFromLS(db) {
    const lsData = await lsLoad();
    if (lsData.length === 0) {
        localStorage.setItem(LS_MIGRATED_KEY, 'true');
        return;
    }

    // Escribir cada entry como record individual (formato v6 legacy)
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    lsData.forEach(entry => store.put(entry));
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    localStorage.setItem(LS_MIGRATED_KEY, 'true');
    // NO limpiar LS aquí: la migración es lossless. El fallback LS plaintext debe
    // sobrevivir hasta que migrateEncryption() cifre y verifique (DE12). Si el
    // cifrado falla, load() rechaza y LS sigue siendo el respaldo íntegro.
    // migrateEncryption() elimina/purga las claves LS por plan tras el verify.
}

// --- Migración v6→v7 (cifrado en reposo) -----------------------------------

// Esquema de migración por store: { store, lsKey, aad, mode }
// mode: 'fallback' = solo LS legacy (se purga), 'dual' = dual-write IDB+LS (se migra espejo)
const MIGRATION_PLAN = [
    { store: STORE_NAME, lsKey: LS_KEY, aad: STORE_NAME, mode: 'fallback' },
    { store: BUDGETS_STORE, lsKey: LS_BUDGETS_KEY, aad: BUDGETS_STORE, mode: 'fallback' },
    { store: RECURRING_STORE, lsKey: LS_RECURRING_KEY, aad: RECURRING_STORE, mode: 'fallback' },
    { store: CUSTOM_CATEGORIES_STORE, lsKey: LS_CUSTOM_CATEGORIES_KEY, aad: CUSTOM_CATEGORIES_STORE, mode: 'fallback' },
    { store: AI_SETTINGS_STORE, lsKey: LS_AI_SETTINGS_KEY, aad: AI_SETTINGS_STORE, mode: 'dual' },
    { store: SETTINGS_STORE, lsKey: LS_SETTINGS_KEY, aad: SETTINGS_STORE, mode: 'dual' },
];

// Excepción de migración para propagar fallos de verificación
class MigrationVerifyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MigrationVerifyError';
    }
}

// Helpers raw genéricos para migración (bypass del límite de cifrado)
function rawGetAll(db, storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function rawPut(db, storeName, record) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function rawClear(db, storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const req = tx.objectStore(storeName).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// Re-escribe una clave LS legacy (plaintext) como envelope cifrado con read-back verify
// Solo para espejos dual-write (aiSettings, settings); fallback keys se purgan en su lugar
async function migrateLsKey(lsKey, aad) {
    const raw = localStorage.getItem(lsKey);
    if (!raw) return; // nada que migrar
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return; // malformed, ignorar
    }
    if (isEnvelope(parsed)) return; // ya es envelope, no tocar

    assertKeyReady();
    const env = await fpCrypto.encryptPayload(aad, parsed);
    const rec = envelopeRecord(aad, env); // usa storeKeyFor implícito via aad
    localStorage.setItem(lsKey, JSON.stringify(rec));

    // Read-back verify: descifrar y comparar byte a byte con el original
    const decrypted = await fpCrypto.decryptPayload(aad, rec);
    const origStr = JSON.stringify(parsed);
    const decStr = JSON.stringify(decrypted);
    if (origStr !== decStr) {
        throw new MigrationVerifyError(`migrateLsKey verify failed for ${lsKey}`);
    }
}

// Migración principal v6→v7: cifra todos los stores legacy y purga claves fallback
async function migrateEncryption(db) {
    for (const plan of MIGRATION_PLAN) {
        const { store, lsKey, aad, mode } = plan;

        // Leer estado raw actual (sin descifrar)
        const rows = await rawGetAll(db, store);

        // Saltar si ya está migrado (vacío o ya envelope)
        const hasEnvelope = rows.some(r => isEnvelope(r));
        if (rows.length === 0 || hasEnvelope) {
            // En modo dual, aun así migramos el espejo LS si existe
            if (mode === 'dual') {
                await migrateLsKey(lsKey, aad);
            }
            continue;
        }

        // Hay datos legacy plaintext: cifrar payload completo
        assertKeyReady();
        const payload = rows; // array completo para stores keyPath, objeto para key='active'
        const env = await fpCrypto.encryptPayload(aad, payload);
        const rec = envelopeRecord(store, env);

        // Write ciphertext + verify antes de purgar (verify-before-purge)
        await rawPut(db, store, rec);

        // Verify: read-back y comparar JSON serializado
        const back = await rawGetAll(db, store);
        const backEnv = back.find(r => isEnvelope(r));
        if (!backEnv || JSON.stringify(backEnv) !== JSON.stringify(rec)) {
            throw new MigrationVerifyError(`Migration verify failed for store ${store}`);
        }

        // Purga legacy: solo un envelope por store
        await rawClear(db, store);
        await rawPut(db, store, rec);

        // Modo dual: migrar espejo LS (read-back verify incluido en migrateLsKey)
        if (mode === 'dual') {
            await migrateLsKey(lsKey, aad);
        } else {
            // Modo fallback: purgar clave LS legacy
            localStorage.removeItem(lsKey);
        }
    }
}

// Migración de claves LS cuando IDB no está disponible (DE12-LS + DE15)
// Llama desde: (1) load() catch path ANTES de fallback reads, (2) migrateEncryption() defensivo
async function migrateLsKeysWhenIdbDown() {
    for (const plan of MIGRATION_PLAN) {
        const { lsKey, aad, mode } = plan;
        const raw = localStorage.getItem(lsKey);
        if (!raw) continue;
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            continue;
        }
        if (isEnvelope(parsed)) continue; // ya migrado

        // Cifrar in-place con read-back verify
        assertKeyReady();
        const env = await fpCrypto.encryptPayload(aad, parsed);
        const rec = envelopeRecord(aad, env);
        localStorage.setItem(lsKey, JSON.stringify(rec));

        // Verify
        const decrypted = await fpCrypto.decryptPayload(aad, rec);
        if (JSON.stringify(decrypted) !== JSON.stringify(parsed)) {
            throw new MigrationVerifyError(`migrateLsKeysWhenIdbDown verify failed for ${lsKey}`);
        }
    }
}

// --- Key material API (DB v7 cryptoMeta + espejo LS) -----------------------

async function idbGetCryptoMeta() {
    if (!isIDBAvailable()) return null;
    const db = await openDB();
    try {
        const rows = await idbGetAllRaw(db, CRYPTO_META_STORE);
        return rows.find(r => r.id === 'meta') || null;
    } finally {
        db.close();
    }
}

async function idbPutCryptoMeta(meta) {
    const db = await openDB();
    try {
        await idbPutRaw(db, CRYPTO_META_STORE, { id: 'meta', ...meta });
    } finally {
        db.close();
    }
}

function lsLoadCryptoMeta() {
    try {
        const raw = localStorage.getItem(LS_CRYPTO_META_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && parsed.id === 'meta' ? parsed : null;
    } catch {
        return null;
    }
}

function lsSaveCryptoMeta(meta) {
    localStorage.setItem(LS_CRYPTO_META_KEY, JSON.stringify({ id: 'meta', ...meta }));
}

// ¿Hay datos cifrados en cualquier store? Guarda contra meta ausente + ciphertext.
async function hasEncryptedData() {
    if (!isIDBAvailable()) {
        for (const key of [LS_KEY, LS_BUDGETS_KEY, LS_RECURRING_KEY, LS_CUSTOM_CATEGORIES_KEY, LS_AI_SETTINGS_KEY, LS_SETTINGS_KEY]) {
            const raw = localStorage.getItem(key);
            if (raw) {
                try {
                    if (isEnvelope(JSON.parse(raw))) return true;
                } catch { /* ignorar malformed */ }
            }
        }
        return false;
    }
    const db = await openDB();
    try {
        for (const store of [STORE_NAME, BUDGETS_STORE, RECURRING_STORE, CUSTOM_CATEGORIES_STORE, AI_SETTINGS_STORE, SETTINGS_STORE]) {
            const rows = await idbGetAllRaw(db, store);
            if (rows.some(isEnvelope)) return true;
        }
        return false;
    } finally {
        db.close();
    }
}

async function initKey(passphrase) {
    if (fpCrypto.isEncryptionReady()) return true; // ya resuelta en este arranque
    const meta = (await idbGetCryptoMeta()) || lsLoadCryptoMeta();
    if (!meta && (await hasEncryptedData())) {
        // ciphertext sin clave: rehusar, nunca re-envolver en silencio (corrompería todo)
        throw new Error('Faltan los materiales de clave para datos cifrados existentes.');
    }
    const result = await fpCrypto.init(passphrase, meta); // TooShort / WrongPassphrase / SecureContext
    await idbPutCryptoMeta(result);
    lsSaveCryptoMeta(result);
    return true;
}

async function changePassphrase(current, next) {
    const meta = await fpCrypto.changePassphrase(current, next);
    await idbPutCryptoMeta(meta);
    lsSaveCryptoMeta(meta);
}

async function hasEncryptionKey() {
    const m = await idbGetCryptoMeta().catch(() => null);
    return !!(m || lsLoadCryptoMeta());
}

// --- Accessores raw (bypass del límite) usados por el meta y la migración -----

function idbGetAllRaw(db, storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function idbPutRaw(db, storeName, record) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function idbGetRaw(db, storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

// --- API pública -----------------------------------------------------

async function load() {
    assertKeyReady(); // gate: sin clave resuelta no hay lectura (no fallback en claro)
    if (!isIDBAvailable()) {
        // IDB caído: migrar claves LS legacy ANTES de fallback reads (DE12-LS)
        await migrateLsKeysWhenIdbDown();
        return lsLoad();
    }

    // Solo un fallo REAL de apertura de IndexedDB cae al fallback LS. Un fallo de
    // MIGRACIÓN (p. ej. cifrado) must REJECTAR: la migración es lossless y aborta
    // sin purgar el plaintext legacy, nunca devolviéndolo en claro (DE12).
    let db;
    try {
        db = await openDB();
    } catch {
        // IDB no disponible de verdad: migrar claves LS y fallback
        await migrateLsKeysWhenIdbDown();
        return lsLoad();
    }

    try {
        // ¿Necesita migración legacy localStorage→IDB?
        const migrated = localStorage.getItem(LS_MIGRATED_KEY);
        if (!migrated) {
            await migrateFromLS(db);
        }

        // Migración v6→v7: cifrado en reposo
        await migrateEncryption(db);

        const entries = await idbGetAll(db);
        // Normalizar: entries sin `tipo` son 'expense' (backward compat)
        return entries.map(e => ({ ...e, tipo: e.tipo || 'expense' }));
    } finally {
        db.close(); // cerrar la conexión (los stores migrados ya están persistidos)
    }
}

async function save(entries) {
    assertKeyReady(); // gate: sin clave resuelta no hay escritura
    if (!isIDBAvailable()) {
        // Modo degradado intencional: sin IDB no hay espejo que diverja
        await lsSave(entries);
        return;
    }

    // Fail-closed: si el write a IDB falla, el save RECHAZA y LS no se toca,
    // para que ambos stores conserven el envelope consistente previo.
    const db = await openDB();
    try {
        await idbReplaceAll(db, STORE_NAME, entries);
    } finally {
        db.close();
    }
}

async function clear() {
    if (!isIDBAvailable()) {
        lsClear();
        return;
    }

    try {
        const db = await openDB();
        try {
            await idbClear(db);
        } finally {
            db.close();
        }
    } catch {
        lsClear();
    }
}

// --- Budget API ------------------------------------------------------

async function loadBudgets() {
    if (!isIDBAvailable()) {
        return lsLoadBudgets();
    }

    try {
        const db = await openDB();
        try {
            const budgets = await idbGetAllBudgets(db);
            // Convertir array de {categoria, monto} a objeto {categoria: monto}
            const result = {};
            budgets.forEach(b => { result[b.categoria] = b.monto; });
            return result;
        } finally {
            db.close();
        }
    } catch (err) {
        if (err instanceof EncryptedStorageReadError) throw err;
        return lsLoadBudgets();
    }
}

async function saveBudgets(budgets) {
    if (!isIDBAvailable()) {
        // Modo degradado intencional: sin IDB no hay espejo que diverja
        await lsSaveBudgets(budgets);
        return;
    }

    // Fail-closed: si el write a IDB falla, el save RECHAZA y LS no se toca
    const db = await openDB();
    try {
        // Convertir objeto {categoria: monto} a array de {categoria, monto}
        const arr = Object.entries(budgets).map(([categoria, monto]) => ({ categoria, monto }));
        await idbReplaceAll(db, BUDGETS_STORE, arr);
    } finally {
        db.close();
    }
}

// --- Recurring API -----------------------------------------------------

async function loadRecurring() {
    if (!isIDBAvailable()) {
        return lsLoadRecurring();
    }

    try {
        const db = await openDB();
        try {
            const recurring = await idbGetAllRecurring(db);
            return recurring;
        } finally {
            db.close();
        }
    } catch (err) {
        if (err instanceof EncryptedStorageReadError) throw err;
        return lsLoadRecurring();
    }
}

async function saveRecurring(recurring) {
    if (!isIDBAvailable()) {
        // Modo degradado intencional: sin IDB no hay espejo que diverja
        await lsSaveRecurring(recurring);
        return;
    }

    // Fail-closed: si el write a IDB falla, el save RECHAZA y LS no se toca
    const db = await openDB();
    try {
        await idbReplaceAll(db, RECURRING_STORE, recurring);
    } finally {
        db.close();
    }
}

// --- Custom categories API ---------------------------------------------

async function loadCustomCategories() {
    if (!isIDBAvailable()) {
        return lsLoadCustomCategories();
    }

    try {
        const db = await openDB();
        try {
            return await idbGetAllCustomCategories(db);
        } finally {
            db.close();
        }
    } catch (err) {
        if (err instanceof EncryptedStorageReadError) throw err;
        return lsLoadCustomCategories();
    }
}

async function saveCustomCategories(categories) {
    if (!isIDBAvailable()) {
        // Modo degradado intencional: sin IDB no hay espejo que diverja
        await lsSaveCustomCategories(categories);
        return;
    }

    // Fail-closed: si el write a IDB falla, el save RECHAZA y LS no se toca
    const db = await openDB();
    try {
        await idbReplaceAll(db, CUSTOM_CATEGORIES_STORE, categories);
    } finally {
        db.close();
    }
}

// --- AI Settings API ----------------------------------------------------

async function loadAiSettings() {
    if (!isIDBAvailable()) {
        return lsLoadAiSettings();
    }

    try {
        const db = await openDB();
        try {
            return await idbGetAiSettings(db);
        } finally {
            db.close();
        }
    } catch (err) {
        if (err instanceof EncryptedStorageReadError) throw err;
        return lsLoadAiSettings();
    }
}

async function saveAiSettings(settings) {
    if (!settings) {
        // Clear settings
        if (!isIDBAvailable()) {
            localStorage.removeItem(LS_AI_SETTINGS_KEY);
            return;
        }
        try {
            const db = await openDB();
            try {
                const tx = db.transaction(AI_SETTINGS_STORE, 'readwrite');
                tx.objectStore(AI_SETTINGS_STORE).delete('active');
                await new Promise((resolve, reject) => {
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error);
                });
            } finally {
                db.close();
            }
        } catch {
            // ignore
        }
        localStorage.removeItem(LS_AI_SETTINGS_KEY);
        return;
    }

    const record = { ...settings, id: 'active', updatedAt: Date.now() };

    if (!isIDBAvailable()) {
        // Modo degradado intencional: sin IDB no hay espejo que diverja
        const rec = await encryptAndRecord(AI_SETTINGS_STORE, record);
        localStorage.setItem(LS_AI_SETTINGS_KEY, JSON.stringify(rec));
        return;
    }

    // Fail-closed: si el write a IDB falla, el save RECHAZA y el espejo LS no
    // se toca: ambos stores conservan el envelope consistente previo (DE11).
    const db = await openDB();
    try {
        // Dual-write: un solo encrypt, el MISMO envelope a IDB y al espejo LS (DE11)
        const rec = await encryptAndRecord(AI_SETTINGS_STORE, record);
        await idbPutRaw(db, AI_SETTINGS_STORE, rec);
        localStorage.setItem(LS_AI_SETTINGS_KEY, JSON.stringify(rec));
    } finally {
        db.close();
    }
}

// --- Currency Settings API ---------------------------------------------

async function loadCurrencySettings() {
    if (!isIDBAvailable()) {
        return lsLoadSettings();
    }

    try {
        const db = await openDB();
        try {
            return await idbGetSettings(db);
        } finally {
            db.close();
        }
    } catch (err) {
        if (err instanceof EncryptedStorageReadError) throw err;
        return lsLoadSettings();
    }
}

async function saveCurrencySettings(settings) {
    if (!settings) {
        // Clear settings
        if (!isIDBAvailable()) {
            localStorage.removeItem(LS_SETTINGS_KEY);
            return;
        }
        try {
            const db = await openDB();
            try {
                const tx = db.transaction(SETTINGS_STORE, 'readwrite');
                tx.objectStore(SETTINGS_STORE).delete('active');
                await new Promise((resolve, reject) => {
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error);
                });
            } finally {
                db.close();
            }
        } catch {
            // ignore
        }
        localStorage.removeItem(LS_SETTINGS_KEY);
        return;
    }

    const record = { ...settings, id: 'active', updatedAt: Date.now() };

    if (!isIDBAvailable()) {
        // Modo degradado intencional: sin IDB no hay espejo que diverja
        const rec = await encryptAndRecord(SETTINGS_STORE, record);
        localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(rec));
        return;
    }

    // Fail-closed: si el write a IDB falla, el save RECHAZA y el espejo LS no
    // se toca: ambos stores conservan el envelope consistente previo (DE13).
    const db = await openDB();
    try {
        // Dual-write: un solo encrypt, el MISMO envelope a IDB y al espejo LS (DE13)
        const rec = await encryptAndRecord(SETTINGS_STORE, record);
        await idbPutRaw(db, SETTINGS_STORE, rec);
        localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(rec));
    } finally {
        db.close();
    }
}

async function clearCurrencySettings() {
    if (!isIDBAvailable()) {
        localStorage.removeItem(LS_SETTINGS_KEY);
        return;
    }

    try {
        const db = await openDB();
        try {
            const tx = db.transaction(SETTINGS_STORE, 'readwrite');
            tx.objectStore(SETTINGS_STORE).delete('active');
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        } finally {
            db.close();
        }
    } catch {
        // ignore
    }
    localStorage.removeItem(LS_SETTINGS_KEY);
}

// --- Secure backup packages -----------------------------------------------

const BACKUP_STORES = [STORE_NAME, BUDGETS_STORE, RECURRING_STORE, CUSTOM_CATEGORIES_STORE, AI_SETTINGS_STORE, SETTINGS_STORE];
const BACKUP_VERSION = 1;
const BACKUP_TOP_LEVEL_KEYS = ['version', 'dbVersion', 'timestamp', 'cryptoMeta', 'stores'];
const CRYPTO_META_KEYS = ['id', 'v', 'alg', 'iterations', 'salt', 'wrappedDek', 'updatedAt'];
const ENVELOPE_KEYS = ['v', 'alg', 'salt', 'iv', 'ct'];
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function hasExactKeys(record, keys) {
    return isObjectRecord(record) && Object.keys(record).length === keys.length
        && keys.every(key => Object.prototype.hasOwnProperty.call(record, key));
}

function isBase64(value, byteLength) {
    if (typeof value !== 'string' || !BASE64_RE.test(value)) return false;
    try {
        const decoded = atob(value);
        return byteLength === undefined || decoded.length === byteLength;
    } catch {
        return false;
    }
}

function isValidCryptoMeta(meta) {
    return hasExactKeys(meta, CRYPTO_META_KEYS)
        && meta.id === 'meta'
        && meta.v === 1
        && meta.alg === 'PBKDF2-SHA256'
        && meta.iterations === 600000
        && isBase64(meta.salt, 16)
        && isBase64(meta.wrappedDek, 48)
        && Number.isFinite(meta.updatedAt);
}

function isValidEnvelopeRecord(store, record, meta) {
    const keyField = STORE_KEY_FIELD[store];
    return hasExactKeys(record, [keyField, ...ENVELOPE_KEYS])
        && record[keyField] === storeKeyFor(store)
        && record.v === 1
        && record.alg === 'AES-GCM-256'
        && record.salt === meta.salt
        && isBase64(record.salt, 16)
        && isBase64(record.iv, 12)
        && isBase64(record.ct)
        && atob(record.ct).length >= 16;
}

function isValidBackupTimestamp(timestamp) {
    try {
        return typeof timestamp === 'string' && new Date(timestamp).toISOString() === timestamp;
    } catch {
        return false;
    }
}

function validateBackupPackage(bundle) {
    if (!hasExactKeys(bundle, BACKUP_TOP_LEVEL_KEYS)
        || bundle.version !== BACKUP_VERSION
        || bundle.dbVersion !== DB_VERSION
        || !isValidBackupTimestamp(bundle.timestamp)
        || !isValidCryptoMeta(bundle.cryptoMeta)
        || !hasExactKeys(bundle.stores, BACKUP_STORES)) {
        return false;
    }

    return BACKUP_STORES.every(store => {
        const records = bundle.stores[store];
        return Array.isArray(records) && records.length === 1
            && isValidEnvelopeRecord(store, records[0], bundle.cryptoMeta);
    });
}

function isValidBackupPayload(store, payload) {
    return (store === AI_SETTINGS_STORE || store === SETTINGS_STORE)
        ? payload === null || (isObjectRecord(payload) && payload.id === 'active')
        : Array.isArray(payload);
}

function emptyBackupPayload(store) {
    return (store === AI_SETTINGS_STORE || store === SETTINGS_STORE) ? null : [];
}

async function authenticateBackupPackage(bundle) {
    for (const store of BACKUP_STORES) {
        const payload = await fpCrypto.decryptPayload(store, bundle.stores[store][0]);
        if (!isValidBackupPayload(store, payload)) throw new Error(`Invalid ${store} payload`);
    }
}

function commitBackupPackage(db, bundle) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([...BACKUP_STORES, CRYPTO_META_STORE], 'readwrite');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('Backup replacement failed'));
        tx.onabort = () => reject(tx.error || new Error('Backup replacement aborted'));

        try {
            for (const store of BACKUP_STORES) {
                const objectStore = tx.objectStore(store);
                objectStore.clear();
                objectStore.put(bundle.stores[store][0]);
            }
            const metaStore = tx.objectStore(CRYPTO_META_STORE);
            metaStore.clear();
            metaStore.put(bundle.cryptoMeta);
        } catch (err) {
            try { tx.abort(); } catch { /* Transaction already aborted. */ }
            reject(err);
        }
    });
}

function mirrorImportedBackup(bundle) {
    localStorage.setItem(LS_AI_SETTINGS_KEY, JSON.stringify(bundle.stores[AI_SETTINGS_STORE][0]));
    localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(bundle.stores[SETTINGS_STORE][0]));
    localStorage.setItem(LS_CRYPTO_META_KEY, JSON.stringify(bundle.cryptoMeta));
}

async function exportAll() {
    assertKeyReady();
    const db = await openDB();
    try {
        const stores = {};
        for (const store of BACKUP_STORES) {
            const records = await idbGetAllRaw(db, store);
            stores[store] = records.length === 0
                ? [await encryptAndRecord(store, emptyBackupPayload(store))]
                : records;
        }
        const metaRecords = await idbGetAllRaw(db, CRYPTO_META_STORE);
        const cryptoMeta = metaRecords.length === 1 && metaRecords[0].id === 'meta' ? metaRecords[0] : null;
        const bundle = {
            version: BACKUP_VERSION,
            dbVersion: DB_VERSION,
            timestamp: new Date().toISOString(),
            cryptoMeta,
            stores,
        };
        if (!validateBackupPackage(bundle)) throw new Error('Cannot export an incomplete encrypted snapshot.');
        await authenticateBackupPackage(bundle);
        return bundle;
    } finally {
        db.close();
    }
}

async function importAll(bundle, passphrase) {
    if (!validateBackupPackage(bundle)) return { ok: false, errors: ['Invalid backup package.'] };

    try {
        await fpCrypto.init(passphrase, bundle.cryptoMeta);
        await authenticateBackupPackage(bundle);
    } catch {
        // A candidate key that authenticated metadata but not every store is unsafe.
        // Lock rather than leaving a candidate key able to write existing ciphertext.
        fpCrypto.reset();
        return { ok: false, errors: ['Backup authentication failed.'] };
    }

    let db;
    try {
        db = await openDB();
        await commitBackupPackage(db, bundle);
    } catch {
        fpCrypto.reset();
        return { ok: false, errors: ['Backup replacement failed.'] };
    } finally {
        if (db) db.close();
    }

    mirrorImportedBackup(bundle);
    return { ok: true, errors: [] };
}

// --- Exports ---------------------------------------------------------

// Soporte tanto para Node.js (vitest) como navegador
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { load, save, clear, loadBudgets, saveBudgets, loadRecurring, saveRecurring, loadCustomCategories, saveCustomCategories, loadAiSettings, saveAiSettings, loadCurrencySettings, saveCurrencySettings, clearCurrencySettings, isIDBAvailable, initKey, changePassphrase, hasEncryptionKey, migrateEncryption, migrateLsKeysWhenIdbDown, MigrationVerifyError, EncryptedStorageReadError, rawGetAll, rawPut, rawClear, exportAll, importAll, MIGRATION_PLAN };
}

if (typeof window !== 'undefined') {
    window.storage = { load, save, clear, loadBudgets, saveBudgets, loadRecurring, saveRecurring, loadCustomCategories, saveCustomCategories, loadAiSettings, saveAiSettings, loadCurrencySettings, saveCurrencySettings, clearCurrencySettings, initKey, changePassphrase, hasEncryptionKey, exportAll, importAll };
}
