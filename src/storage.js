// =====================================================================
// FINANZAS PERSONALES 2026 - Capa de persistencia
// =====================================================================
// Wrapper sobre IndexedDB con fallback a localStorage.
// API: load(), save(entries), clear()
// =====================================================================

const DB_NAME = 'finanzas_personales_2026';
const DB_VERSION = 5; // v3: añadido store recurring | v4: añadido store customCategories | v5: añadido store aiSettings
const STORE_NAME = 'entries';
const BUDGETS_STORE = 'budgets';
const RECURRING_STORE = 'recurring';
const CUSTOM_CATEGORIES_STORE = 'customCategories';
const AI_SETTINGS_STORE = 'aiSettings';
const LS_KEY = 'finanzas:gastos:v1';
const LS_BUDGETS_KEY = 'finanzas:budgets:v1';
const LS_RECURRING_KEY = 'finanzas:recurring:v1';
const LS_CUSTOM_CATEGORIES_KEY = 'finanzas:custom-categories:v1';
const LS_AI_SETTINGS_KEY = 'finanzas:ai-settings:v1';
const LS_MIGRATED_KEY = 'finanzas:migrated';

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
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function idbPutAll(db, entries) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        entries.forEach(entry => store.put(entry));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
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

// --- Budget helpers ----------------------------------------------------

function idbGetAllBudgets(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(BUDGETS_STORE, 'readonly');
        const store = tx.objectStore(BUDGETS_STORE);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function idbPutAllBudgets(db, budgets) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(BUDGETS_STORE, 'readwrite');
        const store = tx.objectStore(BUDGETS_STORE);
        budgets.forEach(b => store.put(b));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
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
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function idbPutAllRecurring(db, recurring) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(RECURRING_STORE, 'readwrite');
        const store = tx.objectStore(RECURRING_STORE);
        recurring.forEach(r => store.put(r));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
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
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function idbPutAllCustomCategories(db, categories) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(CUSTOM_CATEGORIES_STORE, 'readwrite');
        const store = tx.objectStore(CUSTOM_CATEGORIES_STORE);
        categories.forEach(c => store.put(c));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
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

function idbGetAiSettings(db) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(AI_SETTINGS_STORE, 'readonly');
        const store = tx.objectStore(AI_SETTINGS_STORE);
        const request = store.get('active');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

function idbPutAiSettings(db, settings) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(AI_SETTINGS_STORE, 'readwrite');
        const store = tx.objectStore(AI_SETTINGS_STORE);
        store.put(settings);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// --- localStorage fallback -------------------------------------------

function lsLoad() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function lsSave(entries) {
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
}

function lsClear() {
    localStorage.removeItem(LS_KEY);
}

function lsLoadBudgets() {
    try {
        const raw = localStorage.getItem(LS_BUDGETS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function lsSaveBudgets(budgets) {
    localStorage.setItem(LS_BUDGETS_KEY, JSON.stringify(budgets));
}

function lsClearBudgets() {
    localStorage.removeItem(LS_BUDGETS_KEY);
}

function lsLoadRecurring() {
    try {
        const raw = localStorage.getItem(LS_RECURRING_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function lsSaveRecurring(recurring) {
    localStorage.setItem(LS_RECURRING_KEY, JSON.stringify(recurring));
}

function lsClearRecurring() {
    localStorage.removeItem(LS_RECURRING_KEY);
}

function lsLoadCustomCategories() {
    try {
        const raw = localStorage.getItem(LS_CUSTOM_CATEGORIES_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function lsSaveCustomCategories(categories) {
    localStorage.setItem(LS_CUSTOM_CATEGORIES_KEY, JSON.stringify(categories));
}

function lsLoadAiSettings() {
    try {
        const raw = localStorage.getItem(LS_AI_SETTINGS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function lsSaveAiSettings(settings) {
    localStorage.setItem(LS_AI_SETTINGS_KEY, JSON.stringify(settings));
}

// --- Migración localStorage → IndexedDB ----------------------------

async function migrateFromLS(db) {
    const lsData = lsLoad();
    if (lsData.length === 0) {
        localStorage.setItem(LS_MIGRATED_KEY, 'true');
        return;
    }

    await idbPutAll(db, lsData);
    localStorage.setItem(LS_MIGRATED_KEY, 'true');
    lsClear();
}

// --- API pública -----------------------------------------------------

async function load() {
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
    if (!isIDBAvailable()) {
        lsSave(entries);
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
        lsSave(entries);
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
        lsSaveBudgets(budgets);
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
        lsSaveBudgets(budgets);
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
        lsSaveRecurring(recurring);
        return;
    }

    try {
        const db = await openDB();
        await idbClearRecurring(db);
        if (recurring.length > 0) {
            await idbPutAllRecurring(db, recurring);
        }
    } catch {
        lsSaveRecurring(recurring);
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
        lsSaveCustomCategories(categories);
        return;
    }

    try {
        const db = await openDB();
        await idbClearCustomCategories(db);
        if (categories.length > 0) {
            await idbPutAllCustomCategories(db, categories);
        }
    } catch {
        lsSaveCustomCategories(categories);
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
        lsSaveAiSettings(record);
        return;
    }

    try {
        const db = await openDB();
        await idbPutAiSettings(db, record);
        lsSaveAiSettings(record);
    } catch {
        lsSaveAiSettings(record);
    }
}

// --- Exports ---------------------------------------------------------

// Soporte tanto para Node.js (vitest) como navegador
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { load, save, clear, loadBudgets, saveBudgets, loadRecurring, saveRecurring, loadCustomCategories, saveCustomCategories, loadAiSettings, saveAiSettings, isIDBAvailable };
}

if (typeof window !== 'undefined') {
    window.storage = { load, save, clear, loadBudgets, saveBudgets, loadRecurring, saveRecurring, loadCustomCategories, saveCustomCategories, loadAiSettings, saveAiSettings };
}
