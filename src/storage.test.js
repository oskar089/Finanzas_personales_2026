// =====================================================================
// Tests para src/storage.js
// =====================================================================
// Corre con: npx vitest run
// =====================================================================

import 'fake-indexeddb/auto';
import { webcrypto, createHash } from 'node:crypto';
// jsdom solo expone un Crypto sin `subtle` (getReadOnly). Reemplazamos el global
// por el webcrypto de Node para que el envelope (crypto.subtle) funcione aquí.
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });

// --- Fast deterministic PBKDF2 for tests -------------------------------------
// PBKDF2 600k real vía Node webcrypto bajo jsdom tarda ~120s POR derivación, lo
// que convierte la suite de migración en un hang. Para que los tests sean viables
// mockeamos UNICAMENTE deriveBits del esquema PBKDF2: devolvemos 44 bytes
// (= KDF_DKLEN*8 bits) deterministas del salt, al instante. El resto del envelope
// (AES-GCM real, wrap/unwrap del DEK, salt fresco) queda intacto, y las aserciones
// de `meta.iterations === 600000` siguen valiendo (no tocamos la constante).
// Determinista por salt => wrap y unwrap del DEK coinciden; baseKey es irrelevante.
const _realDeriveBits = globalThis.crypto.subtle.deriveBits.bind(globalThis.crypto.subtle);
globalThis.crypto.subtle.deriveBits = async (algorithm, baseKey, length) => {
    if (!algorithm || algorithm.name !== 'PBKDF2') return _realDeriveBits(algorithm, baseKey, length);
    const saltBuf = algorithm.salt.buffer ? new Uint8Array(algorithm.salt.buffer, algorithm.salt.byteOffset, algorithm.salt.byteLength)
        : new Uint8Array(algorithm.salt);
    let h = createHash('sha256').update(saltBuf).update('fp-fake-kdf').digest(); // 32 bytes
    const n = length / 8;
    const out = Buffer.alloc(n);
    let offset = 0;
    while (offset < n) {
        const chunk = h.subarray(0, Math.min(32, n - offset));
        chunk.copy(out, offset);
        offset += chunk.length;
        h = createHash('sha256').update(h).digest();
    }
    return out;
};

import * as storage from './storage.js';
// rawGetAll rawPut rawClear se usan en los tests de migración para inspeccionar
// el estado crudo (sin descifrar) de los stores.
const { rawGetAll, rawPut, rawClear } = storage;

// Datos de prueba
const sampleEntries = [
    { id: 'abc123', tipo: 'expense', monto: 100, categoria: 'Comida', descripcion: 'Almuerzo', fecha: '2026-08-01' },
    { id: 'def456', tipo: 'income', monto: 2000, categoria: 'Sueldo', descripcion: 'Sueldo agosto', fecha: '2026-08-05' }
];

const TEST_PASSPHRASE = 'contraseña-de-prueba-2026';

function corruptCiphertext(envelope) {
    const firstChar = envelope.ct[0] === 'A' ? 'B' : 'A';
    return { ...envelope, ct: `${firstChar}${envelope.ct.slice(1)}` };
}

function abortWritesFor(storeName) {
    const originalPut = IDBObjectStore.prototype.put;
    return vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (record, key) {
        if (this.name === storeName) {
            this.transaction.abort();
            throw new DOMException('Injected write failure', 'AbortError');
        }
        return originalPut.call(this, record, key);
    });
}

// Limpiar entre tests (gate primero, luego clear: nunca borrar antes de resolver la clave)
beforeEach(async () => {
    // initKey es idempotente: la primera llamada deriva y persiste el meta; las
    // subsiguientes resuelven la misma clave sin re-derivar (~1 s solo la primera).
    await storage.initKey(TEST_PASSPHRASE);
    await storage.clear();
});

// -------------------------------------------------------------------
// storage.load()
// -------------------------------------------------------------------
describe('storage.load()', () => {
    it('devuelve array vacio cuando no hay datos', async () => {
        const result = await storage.load();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
    });

    it('devuelve entries guardadas', async () => {
        await storage.save(sampleEntries);
        const result = await storage.load();
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe('abc123');
        expect(result[1].id).toBe('def456');
    });

    it('normaliza entries sin tipo como expense', async () => {
        const legacy = [{ id: 'legacy1', monto: 50, categoria: 'Otro', descripcion: 'Viejo', fecha: '2026-01-01' }];
        await storage.save(legacy);
        const result = await storage.load();
        expect(result[0].tipo).toBe('expense');
    });

    it('rechaza un envelope IDB corrupto y conserva el ciphertext sin reemplazarlo', async () => {
        await storage.save(sampleEntries);
        const db = await openRawDb();
        const [envelope] = await idbGetAllRaw(db, 'entries');
        const corrupted = corruptCiphertext(envelope);
        await rawPut(db, 'entries', corrupted);
        const persistedCiphertext = JSON.stringify(corrupted);

        await expect(storage.load()).rejects.toBeInstanceOf(storage.EncryptedStorageReadError);

        const [afterFailure] = await idbGetAllRaw(db, 'entries');
        expect(JSON.stringify(afterFailure)).toBe(persistedCiphertext);
    });

    it('rechaza un envelope LS cifrado con otra clave y no lo reemplaza por un estado vacío', async () => {
        const originalIndexedDB = globalThis.indexedDB;
        globalThis.indexedDB = undefined;
        try {
            await storage.save(sampleEntries);
            const persistedCiphertext = localStorage.getItem('finanzas:gastos:v1');

            window.fpCrypto.reset();
            await window.fpCrypto.init('otra-contraseña-de-prueba');
            const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
            try {
                await expect(storage.load()).rejects.toBeInstanceOf(storage.EncryptedStorageReadError);
                expect(localStorage.getItem('finanzas:gastos:v1')).toBe(persistedCiphertext);
                expect(setItemSpy).not.toHaveBeenCalled();
            } finally {
                setItemSpy.mockRestore();
            }
        } finally {
            globalThis.indexedDB = originalIndexedDB;
        }
    });
});

// -------------------------------------------------------------------
// storage.save()
// -------------------------------------------------------------------
describe('storage.save()', () => {
    it('guarda entries y se recuperan', async () => {
        await storage.save(sampleEntries);
        const result = await storage.load();
        expect(result).toHaveLength(2);
    });

    it('reemplaza entries anteriores', async () => {
        await storage.save(sampleEntries);
        await storage.save([sampleEntries[0]]);
        const result = await storage.load();
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('abc123');
    });

    it('guarda array vacio', async () => {
        await storage.save(sampleEntries);
        await storage.save([]);
        const result = await storage.load();
        expect(result).toHaveLength(0);
    });

    it('retains the prior encrypted envelope when an entries replacement write aborts', async () => {
        await storage.save(sampleEntries);
        const db = await openRawDb();
        const [priorEnvelope] = await idbGetAllRaw(db, 'entries');
        const putSpy = abortWritesFor('entries');

        try {
            await storage.save([{ ...sampleEntries[0], id: 'replacement-entry' }]);
        } finally {
            putSpy.mockRestore();
        }

        const [persistedEnvelope] = await idbGetAllRaw(db, 'entries');
        expect(persistedEnvelope).toEqual(priorEnvelope);
        await expect(storage.load()).resolves.toEqual(sampleEntries);
    });
});

describe('storage.loadBudgets()', () => {
    it('rechaza un envelope IDB corrupto en lugar de usar un presupuesto vacío de fallback', async () => {
        await storage.saveBudgets({ Comida: 500 });
        const db = await openRawDb();
        const [envelope] = await idbGetAllRaw(db, 'budgets');
        const corrupted = corruptCiphertext(envelope);
        await rawPut(db, 'budgets', corrupted);
        const persistedCiphertext = JSON.stringify(corrupted);

        await expect(storage.loadBudgets()).rejects.toBeInstanceOf(storage.EncryptedStorageReadError);

        const [afterFailure] = await idbGetAllRaw(db, 'budgets');
        expect(JSON.stringify(afterFailure)).toBe(persistedCiphertext);
    });
});

describe('storage.saveBudgets()', () => {
    it('retains the prior encrypted envelope when a budgets replacement write aborts', async () => {
        const priorBudgets = { Comida: 500 };
        await storage.saveBudgets(priorBudgets);
        const db = await openRawDb();
        const [priorEnvelope] = await idbGetAllRaw(db, 'budgets');
        const putSpy = abortWritesFor('budgets');

        try {
            await storage.saveBudgets({ Transporte: 300 });
        } finally {
            putSpy.mockRestore();
        }

        const [persistedEnvelope] = await idbGetAllRaw(db, 'budgets');
        expect(persistedEnvelope).toEqual(priorEnvelope);
        await expect(storage.loadBudgets()).resolves.toEqual(priorBudgets);
    });
});

describe('storage.saveRecurring()', () => {
    it('retains the prior encrypted envelope when a recurring replacement write aborts', async () => {
        const priorRecurring = [{ id: 'monthly-rent', nombre: 'Rent', monto: 900, frecuencia: 'monthly' }];
        await storage.saveRecurring(priorRecurring);
        const db = await openRawDb();
        const [priorEnvelope] = await idbGetAllRaw(db, 'recurring');
        const putSpy = abortWritesFor('recurring');

        try {
            await storage.saveRecurring([{ id: 'music-plan', nombre: 'Music', monto: 10, frecuencia: 'monthly' }]);
        } finally {
            putSpy.mockRestore();
        }

        const [persistedEnvelope] = await idbGetAllRaw(db, 'recurring');
        expect(persistedEnvelope).toEqual(priorEnvelope);
        await expect(storage.loadRecurring()).resolves.toEqual(priorRecurring);
    });
});

// -------------------------------------------------------------------
// storage.clear()
// -------------------------------------------------------------------
describe('storage.clear()', () => {
    it('elimina todos los datos', async () => {
        await storage.save(sampleEntries);
        await storage.clear();
        const result = await storage.load();
        expect(result).toHaveLength(0);
    });

    it('no explota si esta vacio', async () => {
        await expect(storage.clear()).resolves.toBeUndefined();
    });
});

// -------------------------------------------------------------------
// storage.isIDBAvailable()
// -------------------------------------------------------------------
describe('storage.isIDBAvailable()', () => {
    it('devuelve true en entorno con IndexedDB (fake-indexeddb)', () => {
        expect(storage.isIDBAvailable()).toBe(true);
    });
});

// -------------------------------------------------------------------
// Compatibilidad con datos legacy
// -------------------------------------------------------------------
describe('Compatibilidad backward compat', () => {
    it('entries sin campo tipo se tratan como expense', async () => {
        const legacy = [
            { id: 'old1', monto: 200, categoria: 'Hogar', descripcion: 'Alquiler', fecha: '2026-07-01' },
            { id: 'old2', tipo: 'income', monto: 1500, categoria: 'Freelance', descripcion: 'Trabajo', fecha: '2026-07-10' }
        ];
        await storage.save(legacy);
        const result = await storage.load();
        expect(result[0].tipo).toBe('expense');
        expect(result[1].tipo).toBe('income');
    });
});

// -------------------------------------------------------------------
// Categorías personalizadas (customCategories)
// -------------------------------------------------------------------
const sampleCustomCategories = [
    { nombre: 'Mascotas', tipo: 'expense', createdAt: '2026-08-01T10:00:00.000Z' },
    { nombre: 'Regalos', tipo: 'income', createdAt: '2026-08-02T10:00:00.000Z' }
];

describe('storage.saveCustomCategories() / loadCustomCategories()', () => {
    beforeEach(async () => {
        await storage.saveCustomCategories([]);
        localStorage.removeItem('finanzas:custom-categories:v1');
    });

    afterEach(() => {
        localStorage.removeItem('finanzas:custom-categories:v1');
    });

    it('guarda y recupera categorías personalizadas (roundtrip)', async () => {
        await storage.saveCustomCategories(sampleCustomCategories);
        const result = await storage.loadCustomCategories();
        expect(result).toEqual(sampleCustomCategories);
    });

    it('reemplaza las categorías anteriores (patrón replace-all)', async () => {
        await storage.saveCustomCategories(sampleCustomCategories);
        await storage.saveCustomCategories([sampleCustomCategories[0]]);
        const result = await storage.loadCustomCategories();
        expect(result).toHaveLength(1);
        expect(result[0].nombre).toBe('Mascotas');
    });

    it('devuelve array vacío cuando no hay datos', async () => {
        const result = await storage.loadCustomCategories();
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
    });

    it('usa localStorage como fallback cuando IndexedDB no está disponible', async () => {
        const original = globalThis.indexedDB;
        globalThis.indexedDB = undefined;
        try {
            await storage.saveCustomCategories(sampleCustomCategories);

            // El espejo LS es un envelope cifrado, no plaintext (DE11)
            const raw = JSON.parse(localStorage.getItem('finanzas:custom-categories:v1'));
            expect(isEnvelopeLike(raw)).toBe(true);
            expect(JSON.stringify(raw)).not.toContain('Mascotas');

            const loaded = await storage.loadCustomCategories();
            expect(loaded).toEqual(sampleCustomCategories);
        } finally {
            globalThis.indexedDB = original;
        }
    });
});

describe('storage.saveCustomCategories()', () => {
    it('retains the prior encrypted envelope when a categories replacement write aborts', async () => {
        const priorCategories = [sampleCustomCategories[0]];
        await storage.saveCustomCategories(priorCategories);
        const db = await openRawDb();
        const [priorEnvelope] = await idbGetAllRaw(db, 'customCategories');
        const putSpy = abortWritesFor('customCategories');

        try {
            await storage.saveCustomCategories([sampleCustomCategories[1]]);
        } finally {
            putSpy.mockRestore();
        }

        const [persistedEnvelope] = await idbGetAllRaw(db, 'customCategories');
        expect(persistedEnvelope).toEqual(priorEnvelope);
        await expect(storage.loadCustomCategories()).resolves.toEqual(priorCategories);
    });
});

// -------------------------------------------------------------------
// Ajustes de IA (aiSettings)
// -------------------------------------------------------------------
const sampleAiSettings = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o' };

describe('storage.saveAiSettings() / loadAiSettings()', () => {
    beforeEach(() => {
        localStorage.removeItem('finanzas:ai-settings:v1');
    });

    afterEach(() => {
        localStorage.removeItem('finanzas:ai-settings:v1');
    });

    it('guarda y recupera los ajustes de IA (roundtrip)', async () => {
        await storage.saveAiSettings(sampleAiSettings);
        const result = await storage.loadAiSettings();
        expect(result.provider).toBe('openai');
        expect(result.baseUrl).toBe('https://api.openai.com/v1');
        expect(result.apiKey).toBe('sk-test');
        expect(result.model).toBe('gpt-4o');
        expect(result.id).toBe('active');
        expect(typeof result.updatedAt).toBe('number');
    });

    it('usa localStorage como fallback cuando IndexedDB no está disponible', async () => {
        const original = globalThis.indexedDB;
        globalThis.indexedDB = undefined;
        try {
            await storage.saveAiSettings(sampleAiSettings);

            // El espejo LS es un envelope cifrado; la apiKey nunca aparece en claro (DE7)
            const raw = JSON.parse(localStorage.getItem('finanzas:ai-settings:v1'));
            expect(isEnvelopeLike(raw)).toBe(true);
            expect(JSON.stringify(raw)).not.toContain('sk-test');

            const loaded = await storage.loadAiSettings();
            expect(loaded.provider).toBe('openai');
            expect(loaded.apiKey).toBe('sk-test');
        } finally {
            globalThis.indexedDB = original;
        }
    });
});

// -------------------------------------------------------------------
// Ajustes de moneda (currency settings) — DB v7
// -------------------------------------------------------------------
const sampleCurrencySettings = { baseCurrency: 'EUR', displayCurrency: 'USD', rates: { USD: 1.1 } };

describe('storage: DB v7 expone el store cryptoMeta + los stores legacy (aditivo)', () => {
    it('abre la DB v7 y expone cryptoMeta junto a los 6 stores legacy', async () => {
        // Disparar la migración real a través del módulo storage (openDB con DB_VERSION)
        await storage.loadAiSettings();
        const db = await openRawDb();
        expect(db.version).toBe(7);
        expect(db.objectStoreNames.contains('cryptoMeta')).toBe(true);
        // Migración aditiva: los stores existentes se preservan
        expect(db.objectStoreNames.contains('entries')).toBe(true);
        expect(db.objectStoreNames.contains('budgets')).toBe(true);
        expect(db.objectStoreNames.contains('recurring')).toBe(true);
        expect(db.objectStoreNames.contains('customCategories')).toBe(true);
        expect(db.objectStoreNames.contains('aiSettings')).toBe(true);
        expect(db.objectStoreNames.contains('settings')).toBe(true);
    });
});

describe('storage.saveCurrencySettings() / loadCurrencySettings()', () => {
    beforeEach(() => {
        localStorage.removeItem('finanzas:settings:v1');
    });

    afterEach(async () => {
        localStorage.removeItem('finanzas:settings:v1');
        await storage.clearCurrencySettings();
    });

    it('guarda y recupera los ajustes de moneda (roundtrip)', async () => {
        await storage.saveCurrencySettings(sampleCurrencySettings);
        const result = await storage.loadCurrencySettings();
        expect(result.baseCurrency).toBe('EUR');
        expect(result.displayCurrency).toBe('USD');
        expect(result.rates.USD).toBe(1.1);
        expect(result.id).toBe('active');
        expect(typeof result.updatedAt).toBe('number');
    });

    it('usa localStorage como fallback cuando IndexedDB no está disponible', async () => {
        const original = globalThis.indexedDB;
        globalThis.indexedDB = undefined;
        try {
            await storage.saveCurrencySettings(sampleCurrencySettings);
            // El espejo LS es un envelope cifrado (DE13 dual-write)
            const raw = JSON.parse(localStorage.getItem('finanzas:settings:v1'));
            expect(isEnvelopeLike(raw)).toBe(true);
            expect(JSON.stringify(raw)).not.toContain('USD');

            const loaded = await storage.loadCurrencySettings();
            expect(loaded.displayCurrency).toBe('USD');
            expect(loaded.rates.USD).toBe(1.1);
        } finally {
            globalThis.indexedDB = original;
        }
    });

    it('clear elimina del store y de localStorage', async () => {
        await storage.saveCurrencySettings(sampleCurrencySettings);
        await storage.clearCurrencySettings();
        const loaded = await storage.loadCurrencySettings();
        expect(loaded).toBeNull();
        expect(localStorage.getItem('finanzas:settings:v1')).toBeNull();
    });
});

// -------------------------------------------------------------------
// API de clave + cryptoMeta al reposo (DE1/DE2 a nivel storage, DB v7)
// -------------------------------------------------------------------
// Conexiones abiertas explícitamente por helpers de test: se cierran en
// afterEach para que fake-indexeddb no bloquee deleteDatabase ni el version
// change de openDB() por conexiones abiertas al mismo nombre de DB.
const _openTestConns = [];
function trackOpen(conn) { _openTestConns.push(conn); return conn; }
afterEach(() => {
    _openTestConns.forEach(c => { try { c.close(); } catch { /* ya cerrada */ } });
    _openTestConns.length = 0;
});

function openRawDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('finanzas_personales_2026');
        req.onsuccess = () => resolve(trackOpen(req.result));
        req.onerror = () => reject(req.error);
    });
}

function idbGetAllRaw(db, storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// Mismo predicado que storage.isEnvelope (envelope de almacén, v1).
function isEnvelopeLike(v) {
    return !!v && typeof v === 'object' && v.v === 1 && typeof v.alg === 'string'
        && typeof v.iv === 'string' && typeof v.ct === 'string';
}

describe('storage: key API + cryptoMeta al reposo', () => {
    it('hasEncryptionKey() true después de initKey, e initKey es idempotente con la misma clave', async () => {
        // beforeEach ya llamó initKey(TEST_PASSPHRASE)
        expect(await storage.hasEncryptionKey()).toBe(true);
        // Segunda llamada con la misma clave no rechaza (re-resuelve el mismo meta)
        await expect(storage.initKey(TEST_PASSPHRASE)).resolves.toBe(true);
    });

    it('el record cryptoMeta raw guarda SOLO wrappedDek + salt, sin kek/dek en claro', async () => {
        const db = await openRawDb();
        const rows = await idbGetAllRaw(db, 'cryptoMeta');
        const meta = rows.find(r => r.id === 'meta');
        expect(meta).toBeTruthy();
        expect(typeof meta.salt).toBe('string');
        // wrappedDek es un DEK de 32B envuelto + tag GCM 16B = 48 bytes => base64 64 chars
        expect(meta.wrappedDek).toMatch(/^[A-Za-z0-9+/]{64}$/);
        expect(meta.iterations).toBe(600000);
        // Ni la KEK ni el DEK crudo aparecen en ningún string del meta
        expect(JSON.stringify(meta)).not.toMatch(/AES-GCM/);
        expect(JSON.stringify(meta)).not.toContain('keyData');
    });

    it('el espejo LS finanzas:crypto-meta:v1 solo contiene wrappedDek + salt', async () => {
        const raw = JSON.parse(localStorage.getItem('finanzas:crypto-meta:v1'));
        expect(raw).toBeTruthy();
        expect(raw.id).toBe('meta');
        expect(typeof raw.wrappedDek).toBe('string');
        expect(raw.wrappedDek.length).toBe(64);
        expect(typeof raw.salt).toBe('string');
        expect(JSON.stringify(raw)).not.toContain('dek');
        expect(JSON.stringify(raw)).not.toContain('keyData');
    });
});

// -------------------------------------------------------------------
// Gate antes de escribir (sin initKey no hay escritura ni lectura)
// -------------------------------------------------------------------
describe('storage: gate sin clave antes de escribir', () => {
    let originalFpCrypto;
    let fresh;
    beforeEach(async () => {
        // storage.js resuelve fpCrypto vía window.fpCrypto si está presente (contracto
        // de carga). Inyectamos un stub "no inicializado" y re-importamos storage para
        // que capture ese stub => assertKeyReady() debe rechazar sin tocar datos.
        originalFpCrypto = window.fpCrypto;
        window.fpCrypto = {
            isEncryptionReady: () => false,
            encryptPayload: async () => ({}),
            decryptPayload: async () => ({}),
            init: async () => null,
            changePassphrase: async () => null,
        };
        vi.resetModules();
        fresh = await import('./storage.js');
    });
    afterEach(() => {
        window.fpCrypto = originalFpCrypto;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('save() sin initKey rechaza /no inicializado/ y no toca datos previos', async () => {
        // Sembrar datos CON clave (módulo principal ya resuelto en el beforeEach global)
        await storage.clear();
        await storage.save(sampleEntries);
        // Ahora con un fpCrypto SIN clave: save() debe rechazar sin borrar lo sembrado
        await expect(fresh.save([{ id: 'nuevo1', tipo: 'expense', monto: 5, categoria: 'X' }]))
            .rejects.toThrow(/no inicializado/i);
        // El store no fue limpiado: el dato previo sigue intacto (sin escritura parcial)
        const db = await openRawDb();
        const rows = await idbGetAllRaw(db, 'entries');
        expect(rows.length).toBeGreaterThan(0);
    });

    it('load() sin initKey rechaza /no inicializado/ y no devuelve fallback en claro', async () => {
        localStorage.setItem('finanzas:gastos:v1', '[]');
        await expect(fresh.load()).rejects.toThrow(/no inicializado/i);
        localStorage.removeItem('finanzas:gastos:v1');
    });
});

// -------------------------------------------------------------------
// Entries como envelope de almacén (DE11: un solo envelope por store)
// -------------------------------------------------------------------
describe('storage: save() escribe UN envelope de almacén y load() descifra', () => {
    it('save(sampleEntries) produce exactamente un registro envelope en el store entries', async () => {
        await storage.save(sampleEntries);
        const db = await openRawDb();
        const rows = await idbGetAllRaw(db, 'entries');
        expect(rows).toHaveLength(1);
        const rec = rows[0];
        expect(rec.id).toBe('__enc__');
        expect(rec.v).toBe(1);
        expect(rec.alg).toBe('AES-GCM-256');
        expect(typeof rec.iv).toBe('string');
        expect(typeof rec.ct).toBe('string');
    });

    it('load() descifra el envelope y devuelve deep-equal a sampleEntries (tipo normalizado)', async () => {
        await storage.save(sampleEntries);
        const loaded = await storage.load();
        expect(loaded).toEqual(sampleEntries);
    });
});

// -------------------------------------------------------------------
// DE7/DE13/DE14: aiSettings, settings y customCategories cifrados al reposo
// -------------------------------------------------------------------
function idbGetRaw(db, storeName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

describe('storage: cifrado al reposo en todos los stores sensibles (DE7/DE13/DE14)', () => {
    afterEach(() => {
        localStorage.removeItem('finanzas:ai-settings:v1');
        localStorage.removeItem('finanzas:settings:v1');
        localStorage.removeItem('finanzas:custom-categories:v1');
    });

    it('apiKey nunca aparece en claro en IDB ni en LS (DE7)', async () => {
        await storage.saveAiSettings({ provider: 'openai', apiKey: 'sk-test-123', model: 'gpt-4o' });
        const db = await openRawDb();
        const idbRec = await idbGetRaw(db, 'aiSettings', 'active');
        expect(idbRec).toBeTruthy();
        expect(isEnvelopeLike(idbRec)).toBe(true);
        expect(idbRec.id).toBe('active');
        expect(JSON.stringify(idbRec)).not.toContain('sk-test-123');

        const lsRaw = JSON.parse(localStorage.getItem('finanzas:ai-settings:v1'));
        expect(isEnvelopeLike(lsRaw)).toBe(true);
        expect(JSON.stringify(lsRaw)).not.toContain('sk-test-123');
        // El path normal de carga sigue devolviendo la apiKey en claro en memoria
        const loaded = await storage.loadAiSettings();
        expect(loaded.apiKey).toBe('sk-test-123');
    });

    it('dual-write settings cifrado en ambos lados (DE13)', async () => {
        await storage.saveCurrencySettings({ baseCurrency: 'EUR', displayCurrency: 'USD', rates: { USD: 1.1 } });
        const db = await openRawDb();
        const idbRec = await idbGetRaw(db, 'settings', 'active');
        expect(isEnvelopeLike(idbRec)).toBe(true);
        const lsRaw = JSON.parse(localStorage.getItem('finanzas:settings:v1'));
        expect(isEnvelopeLike(lsRaw)).toBe(true);
        // Ambos espejos descifran al mismo record plaintext a través del boot path
        const loaded = await storage.loadCurrencySettings();
        expect(loaded.baseCurrency).toBe('EUR');
        expect(loaded.displayCurrency).toBe('USD');
        expect(loaded.rates.USD).toBe(1.1);
    });

    it('customCategories cifrado y sin pérdida en IDB (DE14, fallback store)', async () => {
        const cats = [
            { nombre: 'Mascotas', tipo: 'expense', createdAt: '2026-08-01T10:00:00.000Z' },
            { nombre: 'Regalos', tipo: 'income', createdAt: '2026-08-02T10:00:00.000Z' },
        ];
        await storage.saveCustomCategories(cats);
        const db = await openRawDb();
        const rows = await idbGetAllRaw(db, 'customCategories');
        expect(rows).toHaveLength(1);
        expect(isEnvelopeLike(rows[0])).toBe(true);
        // Round-trip sin pérdida descifrando el envelope de almacén
        const loaded = await storage.loadCustomCategories();
        expect(loaded).toEqual(cats);
    });
});

// -------------------------------------------------------------------
// DE11/DE15: espejos idénticos en ambos backends + round-trip LS puro
// -------------------------------------------------------------------
describe('storage: DE11/DE15 espejos idénticos y fallback LS puro', () => {
    afterEach(() => {
        localStorage.removeItem('finanzas:ai-settings:v1');
        localStorage.removeItem('finanzas:gastos:v1');
        localStorage.removeItem('finanzas:dark-mode');
    });

    it('dual-write: el envelope IDB y el espejo LS son idénticos y ambos descifran (DE11)', async () => {
        const settings = { provider: 'openai', apiKey: 'sk-x', model: 'gpt-4o' };
        await storage.saveAiSettings(settings);
        const db = await openRawDb();
        const idbEnv = await idbGetRaw(db, 'aiSettings', 'active');
        const lsEnv = JSON.parse(localStorage.getItem('finanzas:ai-settings:v1'));
        // Mismo salt/iv/ct: un solo encrypt compartido por ambos backends
        expect(idbEnv).toEqual(lsEnv);

        // IDB caído: el espejo LS descifra al mismo plaintext (DE11 "cualquiera descifra")
        const original = globalThis.indexedDB;
        globalThis.indexedDB = undefined;
        try {
            const loaded = await storage.loadAiSettings();
            expect(loaded.provider).toBe('openai');
            expect(loaded.apiKey).toBe('sk-x');
            expect(loaded.id).toBe('active');
            expect(typeof loaded.updatedAt).toBe('number');
        } finally {
            globalThis.indexedDB = original;
        }
    });

    it('round-trip LS puro (IDB caído): envelope en LS y load descifra el original (DE15)', async () => {
        const original = globalThis.indexedDB;
        globalThis.indexedDB = undefined;
        try {
            await storage.save(sampleEntries);
            const raw = JSON.parse(localStorage.getItem('finanzas:gastos:v1'));
            expect(isEnvelopeLike(raw)).toBe(true);
            expect(JSON.stringify(raw)).not.toContain('abc123');
            const loaded = await storage.load();
            expect(loaded).toEqual(sampleEntries);
        } finally {
            globalThis.indexedDB = original;
        }
    });

    it('passthrough legacy: LS plaintext legacy se devuelve tal cual (IDB caído)', async () => {
        const legacy = [{ id: 'l1', monto: 5, categoria: 'X', fecha: '2026-01-01' }];
        localStorage.setItem('finanzas:gastos:v1', JSON.stringify(legacy));
        const original = globalThis.indexedDB;
        globalThis.indexedDB = undefined;
        try {
            const loaded = await storage.load();
            expect(loaded).toEqual(legacy);
        } finally {
            globalThis.indexedDB = original;
        }
    });

    it('finanzas:dark-mode sigue en claro y no es tocado por el ciclo save/load', async () => {
        localStorage.setItem('finanzas:dark-mode', 'true');
        await storage.save(sampleEntries);
        await storage.load();
        expect(localStorage.getItem('finanzas:dark-mode')).toBe('true');
    });
});

// ============================================================================
// Phase 3: Migración v6→v7 (seeded legacy suite)
// ============================================================================

// Helper para sembrar DB v6 legacy: crea DB v6 con 6 stores y datos plaintext
async function seedLegacyV6() {
    // Reiniciar el estado criptográfico EN MEMORIA: un usuario legacy v6 real aún
    // no definió passphrase, así que initKey() posterior debe re-establecer y
    // persistir el meta (el beforeEach global ya lo había dejado "ready").
    window.fpCrypto.reset();
    localStorage.removeItem('finanzas:crypto-meta:v1');

    // Borrar DB existente y abrir v6
    await indexedDB.deleteDatabase('finanzas_personales_2026');
    const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('finanzas_personales_2026', 6);
        req.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('entries')) {
                db.createObjectStore('entries', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('budgets')) {
                db.createObjectStore('budgets', { keyPath: 'categoria' });
            }
            if (!db.objectStoreNames.contains('recurring')) {
                db.createObjectStore('recurring', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('customCategories')) {
                db.createObjectStore('customCategories', { keyPath: 'nombre' });
            }
            if (!db.objectStoreNames.contains('aiSettings')) {
                db.createObjectStore('aiSettings', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    // Sembrar plaintext en TODOS los stores (incluyendo dual-write mirrors)
    const tx = db.transaction(['entries', 'budgets', 'recurring', 'customCategories', 'aiSettings', 'settings'], 'readwrite');
    tx.objectStore('entries').put({ id: 'e1', tipo: 'expense', monto: 100, categoria: 'Comida', descripcion: 'Almuerzo', fecha: '2026-08-01' });
    tx.objectStore('entries').put({ id: 'e2', tipo: 'income', monto: 2000, categoria: 'Sueldo', descripcion: 'Sueldo agosto', fecha: '2026-08-05' });
    tx.objectStore('budgets').put({ categoria: 'Comida', monto: 500 });
    tx.objectStore('recurring').put({ id: 'r1', nombre: 'Suscripción', monto: 50, categoria: 'Servicios', frecuencia: 'monthly', fechaInicio: '2026-01-01' });
    tx.objectStore('customCategories').put({ nombre: 'Mascotas', tipo: 'expense', createdAt: '2026-08-01T10:00:00.000Z' });
    tx.objectStore('aiSettings').put({ id: 'active', provider: 'openai', apiKey: 'sk-legacy-123', model: 'gpt-4o', updatedAt: Date.now() });
    tx.objectStore('settings').put({ id: 'active', baseCurrency: 'EUR', displayCurrency: 'USD', rates: { USD: 1.1 }, updatedAt: Date.now() });
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    // Sembrar LS mirrors para los 6 stores (incluyendo fallback keys)
    localStorage.setItem('finanzas:gastos:v1', JSON.stringify([
        { id: 'e1', tipo: 'expense', monto: 100, categoria: 'Comida', descripcion: 'Almuerzo', fecha: '2026-08-01' },
        { id: 'e2', tipo: 'income', monto: 2000, categoria: 'Sueldo', descripcion: 'Sueldo agosto', fecha: '2026-08-05' }
    ]));
    localStorage.setItem('finanzas:budgets:v1', JSON.stringify({ categoria: 'Comida', monto: 500 }));
    localStorage.setItem('finanzas:recurring:v1', JSON.stringify([{ id: 'r1', nombre: 'Suscripción', monto: 50, categoria: 'Servicios', frecuencia: 'monthly', fechaInicio: '2026-01-01' }]));
    localStorage.setItem('finanzas:custom-categories:v1', JSON.stringify([{ nombre: 'Mascotas', tipo: 'expense', createdAt: '2026-08-01T10:00:00.000Z' }]));
    localStorage.setItem('finanzas:ai-settings:v1', JSON.stringify({ id: 'active', provider: 'openai', apiKey: 'sk-legacy-123', model: 'gpt-4o', updatedAt: Date.now() }));
    localStorage.setItem('finanzas:settings:v1', JSON.stringify({ id: 'active', baseCurrency: 'EUR', displayCurrency: 'USD', rates: { USD: 1.1 }, updatedAt: Date.now() }));
    // Fallback keys (pre-migration window) - duplicates overwritten by last setItem
    localStorage.setItem('finanzas:gastos:v1', JSON.stringify([
        { id: 'e1', tipo: 'expense', monto: 100, categoria: 'Comida', descripcion: 'Almuerzo', fecha: '2026-08-01' }
    ]));
    localStorage.setItem('finanzas:budgets:v1', JSON.stringify({ categoria: 'Comida', monto: 500 }));
    localStorage.setItem('finanzas:recurring:v1', JSON.stringify([{ id: 'r1', nombre: 'Suscripción', monto: 50, categoria: 'Servicios', frecuencia: 'monthly', fechaInicio: '2026-01-01' }]));
    localStorage.setItem('finanzas:custom-categories:v1', JSON.stringify([{ nombre: 'Mascotas', tipo: 'expense', createdAt: '2026-08-01T10:00:00.000Z' }]));
    // finanzas:migrated NO está seteado (simula primera migración)
    localStorage.removeItem('finanzas:migrated');

    // Cerrar la conexión: la transacción ya completó y ningún caller usa `db`.
    // Si quedara abierta, el upgrade v6→v7 de openDB() en load() se bloquearía
    // (IndexedDB exige cerrar las demás conexiones antes de un version change).
    db.close();

    return db;
}

// --- 3.1 RED: seedLegacyV6 + initKey + load() → DB v7, cryptoMeta, envelopes, lossless ---
describe('storage: migración v6→v7 (DE12 lossless)', () => {
    it('seedLegacyV6 + initKey + load() produce DB v7 con cryptoMeta y todos los stores como envelopes', { timeout: 30000 }, async () => {
        await seedLegacyV6();
        await storage.initKey(TEST_PASSPHRASE);
        const loaded = await storage.load();

        // DB version upgraded to 7
        const db = await openRawDb();
        expect(db.version).toBe(7);
        expect(db.objectStoreNames.contains('cryptoMeta')).toBe(true);

        // cryptoMeta store + record
        const metaRows = await rawGetAll(db, 'cryptoMeta');
        const meta = metaRows.find(r => r.id === 'meta');
        expect(meta).toBeTruthy();
        expect(typeof meta.salt).toBe('string');
        expect(meta.wrappedDek).toMatch(/^[A-Za-z0-9+/]{64}$/);
        expect(meta.iterations).toBe(600000);

        // Cada raw store = exactamente UN envelope record
        for (const store of ['entries', 'budgets', 'recurring', 'customCategories', 'aiSettings', 'settings']) {
            const rows = await rawGetAll(db, store);
            expect(rows).toHaveLength(1);
            expect(isEnvelopeLike(rows[0])).toBe(true);
        }

        // Dual LS keys (aiSettings, settings) son envelopes
        const aiLs = JSON.parse(localStorage.getItem('finanzas:ai-settings:v1'));
        expect(isEnvelopeLike(aiLs)).toBe(true);
        const settingsLs = JSON.parse(localStorage.getItem('finanzas:settings:v1'));
        expect(isEnvelopeLike(settingsLs)).toBe(true);

        // Fallback LS keys (entries, budgets, recurring, customCategories) REMOVIDOS
        expect(localStorage.getItem('finanzas:gastos:v1')).toBeNull();
        expect(localStorage.getItem('finanzas:budgets:v1')).toBeNull();
        expect(localStorage.getItem('finanzas:recurring:v1')).toBeNull();
        expect(localStorage.getItem('finanzas:custom-categories:v1')).toBeNull();

        // load() deep-equals al plaintext original (zero loss)
        expect(loaded).toEqual([
            { id: 'e1', tipo: 'expense', monto: 100, categoria: 'Comida', descripcion: 'Almuerzo', fecha: '2026-08-01' },
            { id: 'e2', tipo: 'income', monto: 2000, categoria: 'Sueldo', descripcion: 'Sueldo agosto', fecha: '2026-08-05' }
        ]);
    });
});

// --- 3.2 GREEN: migrateEncryption ya implementado (verificado por test anterior) ---

// --- 3.3 RED: purge-after-verify - encryptPayload mock rejection ---
describe('storage: migración v6→v7 purge-after-verify (DE12)', () => {
    it('si encryptPayload falla durante migración, load() RECHAZA con error de migración y NO purga plaintext', { timeout: 30000 }, async () => {
        await seedLegacyV6();
        await storage.initKey(TEST_PASSPHRASE);

        // Spy que falla en el PRIMER store (entries)
        // vi.spyOn sobre window.fpCrypto (el mismo objeto que storage capturó en carga)
        const spy = vi.spyOn(window.fpCrypto, 'encryptPayload').mockRejectedValueOnce(new Error('boom'));

        // load() debe RECHAZAR con error de migración (no "starts empty")
        await expect(storage.load()).rejects.toThrow();

        // Raw store entries sigue siendo plaintext legacy (rawClear NO llamado)
        const db = await openRawDb();
        const rows = await rawGetAll(db, 'entries');
        expect(rows.length).toBe(2); // 2 entries legacy
        expect(rows[0].id).toBe('e1');

        // Plaintext LS keys retenidas
        expect(localStorage.getItem('finanzas:gastos:v1')).toBeTruthy();

        spy.mockRestore();
    });

    it('tras fallo, retry sin mock succeed y purga legacy', { timeout: 30000 }, async () => {
        await seedLegacyV6();
        await storage.initKey(TEST_PASSPHRASE);

        // Primer intento falla
        const spy = vi.spyOn(window.fpCrypto, 'encryptPayload').mockRejectedValueOnce(new Error('boom'));
        await expect(storage.load()).rejects.toThrow();
        spy.mockRestore();

        // Segundo intento: sin mock, debe tener éxito y migrar
        const loaded = await storage.load();
        expect(loaded).toHaveLength(2);

        // Legacy purgado
        const db = await openRawDb();
        const rows = await rawGetAll(db, 'entries');
        expect(rows).toHaveLength(1);
        expect(isEnvelopeLike(rows[0])).toBe(true);
    });
});

// --- 3.4 GREEN: verify-before-purge ya implementado (read-back antes de rawClear) ---

// --- 3.5 RED: migrateLsKeysWhenIdbDown (IDB unavailable + legacy LS) ---
describe('storage: migrateLsKeysWhenIdbDown (DE12-LS + DE15)', () => {
    it('IDB unavailable + legacy LS + initKey → load() cifra TODAS las claves LS in-place y descifra', { timeout: 30000 }, async () => {
        // Sembrar solo LS legacy (sin IDB)
        await indexedDB.deleteDatabase('finanzas_personales_2026');
        localStorage.setItem('finanzas:gastos:v1', JSON.stringify([
            { id: 'e1', tipo: 'expense', monto: 100, categoria: 'Comida', descripcion: 'Almuerzo', fecha: '2026-08-01' }
        ]));
        localStorage.setItem('finanzas:budgets:v1', JSON.stringify({ categoria: 'Comida', monto: 500 }));
        localStorage.setItem('finanzas:recurring:v1', JSON.stringify([{ id: 'r1', nombre: 'Suscripción', monto: 50, categoria: 'Servicios', frecuencia: 'monthly', fechaInicio: '2026-01-01' }]));
        localStorage.setItem('finanzas:custom-categories:v1', JSON.stringify([{ nombre: 'Mascotas', tipo: 'expense', createdAt: '2026-08-01T10:00:00.000Z' }]));
        localStorage.setItem('finanzas:ai-settings:v1', JSON.stringify({ id: 'active', provider: 'openai', apiKey: 'sk-ls-only', model: 'gpt-4o', updatedAt: Date.now() }));
        localStorage.setItem('finanzas:settings:v1', JSON.stringify({ id: 'active', baseCurrency: 'EUR', displayCurrency: 'USD', rates: { USD: 1.1 }, updatedAt: Date.now() }));
        localStorage.removeItem('finanzas:migrated');

        const original = globalThis.indexedDB;
        globalThis.indexedDB = undefined;
        try {
            await storage.initKey(TEST_PASSPHRASE);
            const loaded = await storage.load();

            // TODAS las claves LS ahora son envelopes cifrados
            for (const key of ['finanzas:gastos:v1', 'finanzas:budgets:v1', 'finanzas:recurring:v1', 'finanzas:custom-categories:v1', 'finanzas:ai-settings:v1', 'finanzas:settings:v1']) {
                const raw = JSON.parse(localStorage.getItem(key));
                expect(isEnvelopeLike(raw)).toBe(true);
            }

            // load() devuelve el plaintext original
            expect(loaded).toHaveLength(1);
            expect(loaded[0].id).toBe('e1');
            expect(loaded[0].monto).toBe(100);
        } finally {
            globalThis.indexedDB = original;
        }
    });

    it('LS-only v6 (finanzas:migrated ausente, IDB vacío) → load() migra entries a IDB ciphertext, lsClear solo tras verify', { timeout: 30000 }, async () => {
        await indexedDB.deleteDatabase('finanzas_personales_2026');
        localStorage.setItem('finanzas:gastos:v1', JSON.stringify([
            { id: 'e1', tipo: 'expense', monto: 100, categoria: 'Comida', descripcion: 'Almuerzo', fecha: '2026-08-01' }
        ]));
        localStorage.removeItem('finanzas:migrated');

        await storage.initKey(TEST_PASSPHRASE);
        const loaded = await storage.load();

        // IDB tiene envelope
        const db = await openRawDb();
        const rows = await rawGetAll(db, 'entries');
        expect(rows).toHaveLength(1);
        expect(isEnvelopeLike(rows[0])).toBe(true);

        // LS legacy purgado (lsClear después de decrypt-verify)
        expect(localStorage.getItem('finanzas:gastos:v1')).toBeNull();
        expect(localStorage.getItem('finanzas:migrated')).toBe('true');

        // load() devuelve datos
        expect(loaded).toHaveLength(1);
    });
});

// --- 3.6 GREEN: migrateLsKeysWhenIdbDown implementado ---
describe('storage: migrateLsKeysWhenIdbDown implementado', () => {
    it('migrateLsKeysWhenIdbDown() cifra cada LS key legacy y verifica read-back', { timeout: 30000 }, async () => {
        await indexedDB.deleteDatabase('finanzas_personales_2026');
        localStorage.setItem('finanzas:gastos:v1', JSON.stringify([{ id: 'x1', monto: 10 }]));
        localStorage.setItem('finanzas:budgets:v1', JSON.stringify({ cat: 20 }));
        localStorage.setItem('finanzas:ai-settings:v1', JSON.stringify({ id: 'active', apiKey: 'sk-test' }));

        await storage.initKey(TEST_PASSPHRASE);
        await storage.migrateLsKeysWhenIdbDown();

        // Todas las claves son ahora envelopes
        for (const key of ['finanzas:gastos:v1', 'finanzas:budgets:v1', 'finanzas:ai-settings:v1']) {
            const raw = JSON.parse(localStorage.getItem(key));
            expect(isEnvelopeLike(raw)).toBe(true);
        }

        // Llamada idempotente: segunda vez no re-cifra (ya son envelopes)
        await storage.migrateLsKeysWhenIdbDown();
        for (const key of ['finanzas:gastos:v1', 'finanzas:budgets:v1', 'finanzas:ai-settings:v1']) {
            const raw = JSON.parse(localStorage.getItem(key));
            expect(isEnvelopeLike(raw)).toBe(true);
        }
    });

    it('migrateLsKeysWhenIdbDown() no toca finanzas:dark-mode ni claves ya envelope', { timeout: 30000 }, async () => {
        localStorage.setItem('finanzas:dark-mode', 'true');
        localStorage.setItem('finanzas:gastos:v1', JSON.stringify({ v: 1, alg: 'AES-GCM-256', iv: 'a', ct: 'b', salt: 'c' })); // ya envelope

        await storage.initKey(TEST_PASSPHRASE);
        await storage.migrateLsKeysWhenIdbDown();

        expect(localStorage.getItem('finanzas:dark-mode')).toBe('true');
        // La clave ya envelope se mantiene igual
        expect(localStorage.getItem('finanzas:gastos:v1')).toContain('AES-GCM-256');
    });
});

// -------------------------------------------------------------------
// Secure complete backup packages
// -------------------------------------------------------------------
const BACKUP_STORES = ['entries', 'budgets', 'recurring', 'customCategories', 'aiSettings', 'settings'];

function cloneBundle(bundle) {
    return JSON.parse(JSON.stringify(bundle));
}

async function seedCompleteBackupState(marker) {
    window.fpCrypto.reset();
    await storage.initKey(TEST_PASSPHRASE);
    await storage.save([{ ...sampleEntries[0], id: `entry-${marker}`, descripcion: marker }]);
    await storage.saveBudgets({ [`Budget-${marker}`]: marker.length });
    await storage.saveRecurring([{ id: `recurring-${marker}`, nombre: marker, monto: marker.length, frecuencia: 'monthly' }]);
    await storage.saveCustomCategories([{ nombre: `Category-${marker}`, tipo: 'expense' }]);
    await storage.saveAiSettings({ provider: marker, apiKey: `key-${marker}`, model: 'test' });
    await storage.saveCurrencySettings({ baseCurrency: 'USD', displayCurrency: marker, rates: { USD: 1 } });
}

async function rawBackupSnapshot() {
    const db = await openRawDb();
    const idb = {};
    for (const store of [...BACKUP_STORES, 'cryptoMeta']) {
        idb[store] = JSON.stringify(await idbGetAllRaw(db, store));
    }
    return {
        idb,
        aiSettingsMirror: localStorage.getItem('finanzas:ai-settings:v1'),
        settingsMirror: localStorage.getItem('finanzas:settings:v1'),
        cryptoMetaMirror: localStorage.getItem('finanzas:crypto-meta:v1'),
        fallbackMirrors: ['finanzas:gastos:v1', 'finanzas:budgets:v1', 'finanzas:recurring:v1', 'finanzas:custom-categories:v1']
            .map(key => localStorage.getItem(key)),
    };
}

describe('storage secure complete backup packages', () => {
    it('exports absent encrypted stores as authenticated empty values that restore as absent', async () => {
        await seedCompleteBackupState('source');
        await storage.saveRecurring([]);
        await storage.saveAiSettings(null);
        await storage.clearCurrencySettings();

        const bundle = await storage.exportAll();
        await seedCompleteBackupState('destination');
        const result = await storage.importAll(bundle, TEST_PASSPHRASE);

        expect(bundle.stores.recurring).toHaveLength(1);
        expect(bundle.stores.aiSettings).toHaveLength(1);
        expect(bundle.stores.settings).toHaveLength(1);
        expect(result).toEqual({ ok: true, errors: [] });
        expect(await storage.loadRecurring()).toEqual([]);
        expect(await storage.loadAiSettings()).toBeNull();
        expect(await storage.loadCurrencySettings()).toBeNull();
    });

    it('round-trips one authenticated envelope for every encrypted store', async () => {
        await seedCompleteBackupState('source');
        const bundle = await storage.exportAll();
        await seedCompleteBackupState('destination');

        const result = await storage.importAll(bundle, TEST_PASSPHRASE);

        expect(result).toEqual({ ok: true, errors: [] });
        expect(await storage.load()).toEqual([{ ...sampleEntries[0], id: 'entry-source', descripcion: 'source' }]);
        expect(await storage.loadBudgets()).toEqual({ 'Budget-source': 6 });
        expect(await storage.loadRecurring()).toEqual([{ id: 'recurring-source', nombre: 'source', monto: 6, frecuencia: 'monthly' }]);
        expect(await storage.loadCustomCategories()).toEqual([{ nombre: 'Category-source', tipo: 'expense' }]);
        expect((await storage.loadAiSettings()).apiKey).toBe('key-source');
        expect((await storage.loadCurrencySettings()).displayCurrency).toBe('source');
    });

    it('rejects corrupt but well-formed ciphertext before changing any persisted bytes', async () => {
        await seedCompleteBackupState('source');
        const bundle = cloneBundle(await storage.exportAll());
        bundle.stores.entries[0] = corruptCiphertext(bundle.stores.entries[0]);
        await seedCompleteBackupState('destination');
        const before = await rawBackupSnapshot();

        expect(await storage.importAll(bundle, TEST_PASSPHRASE)).toMatchObject({ ok: false });
        expect(await rawBackupSnapshot()).toEqual(before);
    });

    it('rejects candidate metadata for a different key before changing persisted bytes', async () => {
        await seedCompleteBackupState('source');
        const bundle = cloneBundle(await storage.exportAll());
        window.fpCrypto.reset();
        bundle.cryptoMeta = { id: 'meta', ...await window.fpCrypto.init('different-passphrase') };
        await storage.initKey(TEST_PASSPHRASE);
        await seedCompleteBackupState('destination');
        const before = await rawBackupSnapshot();

        expect(await storage.importAll(bundle, 'different-passphrase')).toMatchObject({ ok: false });
        expect(await rawBackupSnapshot()).toEqual(before);
    });

    it('rejects partial and duplicate-envelope packages without changing persisted bytes', async () => {
        await seedCompleteBackupState('source');
        const source = await storage.exportAll();
        await seedCompleteBackupState('destination');
        const before = await rawBackupSnapshot();
        const partial = cloneBundle(source);
        delete partial.stores.settings;
        const duplicate = cloneBundle(source);
        duplicate.stores.entries.push(cloneBundle(duplicate.stores.entries[0]));

        expect(await storage.importAll(partial, TEST_PASSPHRASE)).toMatchObject({ ok: false });
        expect(await storage.importAll(duplicate, TEST_PASSPHRASE)).toMatchObject({ ok: false });
        expect(await rawBackupSnapshot()).toEqual(before);
    });

    it('rejects unknown fields, unsupported algorithms, and invalid base64 without changing persisted bytes', async () => {
        await seedCompleteBackupState('source');
        const source = await storage.exportAll();
        await seedCompleteBackupState('destination');
        const before = await rawBackupSnapshot();
        const unknownField = cloneBundle(source);
        unknownField.extra = true;
        const unsupportedAlgorithm = cloneBundle(source);
        unsupportedAlgorithm.stores.entries[0].alg = 'AES-GCM-128';
        const invalidBase64 = cloneBundle(source);
        invalidBase64.stores.entries[0].iv = 'not-base64!';

        for (const invalidBundle of [unknownField, unsupportedAlgorithm, invalidBase64]) {
            expect(await storage.importAll(invalidBundle, TEST_PASSPHRASE)).toMatchObject({ ok: false });
        }
        expect(await rawBackupSnapshot()).toEqual(before);
    });

    it('rolls back every store and metadata record when the replacement transaction aborts', async () => {
        await seedCompleteBackupState('source');
        const bundle = await storage.exportAll();
        await seedCompleteBackupState('destination');
        const before = await rawBackupSnapshot();
        const putSpy = abortWritesFor('recurring');

        try {
            expect(await storage.importAll(bundle, TEST_PASSPHRASE)).toMatchObject({ ok: false });
        } finally {
            putSpy.mockRestore();
        }
        expect(await rawBackupSnapshot()).toEqual(before);
    });
});
