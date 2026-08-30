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
                    resolve(await fpCrypto.decryptPayload(STORE_NAME, rows[0]));
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

async function idbPutAll(db, payload) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(STORE_NAME, payload);
    await idbPutRaw(db, STORE_NAME, envelopeRecord(STORE_NAME, env));
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
                    resolve(await fpCrypto.decryptPayload(BUDGETS_STORE, rows[0]));
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

async function idbPutAllBudgets(db, payload) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(BUDGETS_STORE, payload);
    await idbPutRaw(db, BUDGETS_STORE, envelopeRecord(BUDGETS_STORE, env));
}

function idbClearBudgets(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(BUDGETS_STORE, 'readwrite');
        const store = tx.objectStore(BUDGETS_STORE);
        const request = store.clear();
        request.onsuccess = () => resolve();
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
                    resolve(await fpCrypto.decryptPayload(RECURRING_STORE, rows[0]));
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

async function idbPutAllRecurring(db, payload) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(RECURRING_STORE, payload);
    await idbPutRaw(db, RECURRING_STORE, envelopeRecord(RECURRING_STORE, env));
}

function idbClearRecurring(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(RECURRING_STORE, 'readwrite');
        const store = tx.objectStore(RECURRING_STORE);
        const request = store.clear();
        request.onsuccess = () => resolve();
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
                    resolve(await fpCrypto.decryptPayload(CUSTOM_CATEGORIES_STORE, rows[0]));
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

async function idbPutAllCustomCategories(db, payload) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(CUSTOM_CATEGORIES_STORE, payload);
    await idbPutRaw(db, CUSTOM_CATEGORIES_STORE, envelopeRecord(CUSTOM_CATEGORIES_STORE, env));
}

function idbClearCustomCategories(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CUSTOM_CATEGORIES_STORE, 'readwrite');
        const store = tx.objectStore(CUSTOM_CATEGORIES_STORE);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// --- AI Settings helpers -----------------------------------------------

async function idbGetAiSettings(db) {
    const rec = await idbGetRaw(db, AI_SETTINGS_STORE, 'active');
    if (rec && isEnvelope(rec)) {
        return fpCrypto.decryptPayload(AI_SETTINGS_STORE, rec);
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
        return fpCrypto.decryptPayload(SETTINGS_STORE, rec);
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
    try {
        const parsed = JSON.parse(raw);
        if (isEnvelope(parsed)) {
            const plain = await fpCrypto.decryptPayload(STORE_NAME, parsed);
            return Array.isArray(plain) ? plain : [];
        }
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
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
    try {
        const parsed = JSON.parse(raw);
        if (isEnvelope(parsed)) {
            const plain = await fpCrypto.decryptPayload(BUDGETS_STORE, parsed);
            return plain && typeof plain === 'object' ? plain : {};
        }
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

async function lsSaveBudgets(budgets) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(BUDGETS_STORE, budgets);
    localStorage.setItem(LS_BUDGETS_KEY, JSON.stringify(envelopeRecord(BUDGETS_STORE, env)));
}

async function lsLoadRecurring() {
    const raw = localStorage.getItem(LS_RECURRING_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (isEnvelope(parsed)) {
            const plain = await fpCrypto.decryptPayload(RECURRING_STORE, parsed);
            return Array.isArray(plain) ? plain : [];
        }
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function lsSaveRecurring(recurring) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(RECURRING_STORE, recurring);
    localStorage.setItem(LS_RECURRING_KEY, JSON.stringify(envelopeRecord(RECURRING_STORE, env)));
}

async function lsLoadCustomCategories() {
    const raw = localStorage.getItem(LS_CUSTOM_CATEGORIES_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (isEnvelope(parsed)) {
            const plain = await fpCrypto.decryptPayload(CUSTOM_CATEGORIES_STORE, parsed);
            return Array.isArray(plain) ? plain : [];
        }
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function lsSaveCustomCategories(categories) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(CUSTOM_CATEGORIES_STORE, categories);
    localStorage.setItem(LS_CUSTOM_CATEGORIES_KEY, JSON.stringify(envelopeRecord(CUSTOM_CATEGORIES_STORE, env)));
}

async function lsLoadAiSettings() {
    const raw = localStorage.getItem(LS_AI_SETTINGS_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (isEnvelope(parsed)) {
            return fpCrypto.decryptPayload(AI_SETTINGS_STORE, parsed);
        }
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

async function lsSaveAiSettings(settings) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(AI_SETTINGS_STORE, settings);
    localStorage.setItem(LS_AI_SETTINGS_KEY, JSON.stringify(envelopeRecord(AI_SETTINGS_STORE, env)));
}

async function lsLoadSettings() {
    const raw = localStorage.getItem(LS_SETTINGS_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (isEnvelope(parsed)) {
            return fpCrypto.decryptPayload(SETTINGS_STORE, parsed);
        }
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

async function lsSaveSettings(settings) {
    assertKeyReady();
    const env = await fpCrypto.encryptPayload(SETTINGS_STORE, settings);
    localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(envelopeRecord(SETTINGS_STORE, env)));
}

// --- Migración localStorage → IndexedDB ----------------------------

async function migrateFromLS(db) {
    const lsData = await lsLoad();
    if (lsData.length === 0) {
        localStorage.setItem(LS_MIGRATED_KEY, 'true');
        return;
    }

    await idbPutAll(db, lsData);
    localStorage.setItem(LS_MIGRATED_KEY, 'true');
    lsClear();
}

// --- Key material API (DB v7 cryptoMeta + espejo LS) -----------------------

async function idbGetCryptoMeta() {
    if (!isIDBAvailable()) return null;
    const db = await openDB();
    const rows = await idbGetAllRaw(db, CRYPTO_META_STORE);
    return rows.find(r => r.id === 'meta') || null;
}

async function idbPutCryptoMeta(meta) {
    const db = await openDB();
    await idbPutRaw(db, CRYPTO_META_STORE, { id: 'meta', ...meta });
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
    for (const store of [STORE_NAME, BUDGETS_STORE, RECURRING_STORE, CUSTOM_CATEGORIES_STORE, AI_SETTINGS_STORE, SETTINGS_STORE]) {
        const rows = await idbGetAllRaw(db, store);
        if (rows.some(isEnvelope)) return true;
    }
    return false;
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
        return lsLoad();
    }

    try {
        const db = await openDB();

        // ¿Necesita migración?
        const migrated = localStorage.getItem(LS_MIGRATED_KEY);
        if (!migrated) {
            await migrateFromLS(db);
        }

        const entries = await idbGetAll(db);
        // Normalizar: entries sin `tipo` son 'expense' (backward compat)
        return entries.map(e => ({ ...e, tipo: e.tipo || 'expense' }));
    } catch {
        // Si IndexedDB falla, usar localStorage
        return lsLoad();
    }
}

async function save(entries) {
    assertKeyReady(); // gate: sin clave resuelta no hay escritura
    if (!isIDBAvailable()) {
        await lsSave(entries);
        return;
    }

    try {
        const db = await openDB();
        await idbClear(db);
        if (entries.length > 0) {
            await idbPutAll(db, entries);
        }
    } catch {
        // Fallback a localStorage si IndexedDB falla
        await lsSave(entries);
    }
}

async function clear() {
    if (!isIDBAvailable()) {
        lsClear();
        return;
    }

    try {
        const db = await openDB();
        await idbClear(db);
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
        const budgets = await idbGetAllBudgets(db);
        // Convertir array de {categoria, monto} a objeto {categoria: monto}
        const result = {};
        budgets.forEach(b => { result[b.categoria] = b.monto; });
        return result;
    } catch {
        return lsLoadBudgets();
    }
}

async function saveBudgets(budgets) {
    if (!isIDBAvailable()) {
        await lsSaveBudgets(budgets);
        return;
    }

    try {
        const db = await openDB();
        // Convertir objeto {categoria: monto} a array de {categoria, monto}
        const arr = Object.entries(budgets).map(([categoria, monto]) => ({ categoria, monto }));
        await idbClearBudgets(db);
        if (arr.length > 0) {
            await idbPutAllBudgets(db, arr);
        }
    } catch {
        await lsSaveBudgets(budgets);
    }
}

// --- Recurring API -----------------------------------------------------

async function loadRecurring() {
    if (!isIDBAvailable()) {
        return lsLoadRecurring();
    }

    try {
        const db = await openDB();
        const recurring = await idbGetAllRecurring(db);
        return recurring;
    } catch {
        return lsLoadRecurring();
    }
}

async function saveRecurring(recurring) {
    if (!isIDBAvailable()) {
        await lsSaveRecurring(recurring);
        return;
    }

    try {
        const db = await openDB();
        await idbClearRecurring(db);
        if (recurring.length > 0) {
            await idbPutAllRecurring(db, recurring);
        }
    } catch {
        await lsSaveRecurring(recurring);
    }
}

// --- Custom categories API ---------------------------------------------

async function loadCustomCategories() {
    if (!isIDBAvailable()) {
        return lsLoadCustomCategories();
    }

    try {
        const db = await openDB();
        return await idbGetAllCustomCategories(db);
    } catch {
        return lsLoadCustomCategories();
    }
}

async function saveCustomCategories(categories) {
    if (!isIDBAvailable()) {
        await lsSaveCustomCategories(categories);
        return;
    }

    try {
        const db = await openDB();
        await idbClearCustomCategories(db);
        if (categories.length > 0) {
            await idbPutAllCustomCategories(db, categories);
        }
    } catch {
        await lsSaveCustomCategories(categories);
    }
}

// --- AI Settings API ----------------------------------------------------

async function loadAiSettings() {
    if (!isIDBAvailable()) {
        return lsLoadAiSettings();
    }

    try {
        const db = await openDB();
        return await idbGetAiSettings(db);
    } catch {
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
            const tx = db.transaction(AI_SETTINGS_STORE, 'readwrite');
            tx.objectStore(AI_SETTINGS_STORE).delete('active');
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        } catch {
            // ignore
        }
        localStorage.removeItem(LS_AI_SETTINGS_KEY);
        return;
    }

    const record = { ...settings, id: 'active', updatedAt: Date.now() };

    if (!isIDBAvailable()) {
        const rec = await encryptAndRecord(AI_SETTINGS_STORE, record);
        localStorage.setItem(LS_AI_SETTINGS_KEY, JSON.stringify(rec));
        return;
    }

    try {
        const db = await openDB();
        // Dual-write: un solo encrypt, el MISMO envelope a IDB y al espejo LS (DE11)
        const rec = await encryptAndRecord(AI_SETTINGS_STORE, record);
        await idbPutRaw(db, AI_SETTINGS_STORE, rec);
        localStorage.setItem(LS_AI_SETTINGS_KEY, JSON.stringify(rec));
    } catch {
        const rec = await encryptAndRecord(AI_SETTINGS_STORE, record);
        localStorage.setItem(LS_AI_SETTINGS_KEY, JSON.stringify(rec));
    }
}

// --- Currency Settings API ---------------------------------------------

async function loadCurrencySettings() {
    if (!isIDBAvailable()) {
        return lsLoadSettings();
    }

    try {
        const db = await openDB();
        return await idbGetSettings(db);
    } catch {
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
            const tx = db.transaction(SETTINGS_STORE, 'readwrite');
            tx.objectStore(SETTINGS_STORE).delete('active');
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        } catch {
            // ignore
        }
        localStorage.removeItem(LS_SETTINGS_KEY);
        return;
    }

    const record = { ...settings, id: 'active', updatedAt: Date.now() };

    if (!isIDBAvailable()) {
        const rec = await encryptAndRecord(SETTINGS_STORE, record);
        localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(rec));
        return;
    }

    try {
        const db = await openDB();
        // Dual-write: un solo encrypt, el MISMO envelope a IDB y al espejo LS (DE13)
        const rec = await encryptAndRecord(SETTINGS_STORE, record);
        await idbPutRaw(db, SETTINGS_STORE, rec);
        localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(rec));
    } catch {
        const rec = await encryptAndRecord(SETTINGS_STORE, record);
        localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(rec));
    }
}

async function clearCurrencySettings() {
    if (!isIDBAvailable()) {
        localStorage.removeItem(LS_SETTINGS_KEY);
        return;
    }

    try {
        const db = await openDB();
        const tx = db.transaction(SETTINGS_STORE, 'readwrite');
        tx.objectStore(SETTINGS_STORE).delete('active');
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // ignore
    }
    localStorage.removeItem(LS_SETTINGS_KEY);
}

// --- Exports ---------------------------------------------------------

// Soporte tanto para Node.js (vitest) como navegador
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { load, save, clear, loadBudgets, saveBudgets, loadRecurring, saveRecurring, loadCustomCategories, saveCustomCategories, loadAiSettings, saveAiSettings, loadCurrencySettings, saveCurrencySettings, clearCurrencySettings, isIDBAvailable, initKey, changePassphrase, hasEncryptionKey };
}

if (typeof window !== 'undefined') {
    window.storage = { load, save, clear, loadBudgets, saveBudgets, loadRecurring, saveRecurring, loadCustomCategories, saveCustomCategories, loadAiSettings, saveAiSettings, loadCurrencySettings, saveCurrencySettings, clearCurrencySettings, initKey, changePassphrase, hasEncryptionKey };
}
