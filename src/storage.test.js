// =====================================================================
// Tests para src/storage.js
// =====================================================================
// Corre con: npx vitest run
// =====================================================================

import 'fake-indexeddb/auto';
import * as storage from './storage.js';

// Datos de prueba
const sampleEntries = [
    { id: 'abc123', tipo: 'expense', monto: 100, categoria: 'Comida', descripcion: 'Almuerzo', fecha: '2026-08-01' },
    { id: 'def456', tipo: 'income', monto: 2000, categoria: 'Sueldo', descripcion: 'Sueldo agosto', fecha: '2026-08-05' }
];

// Limpiar entre tests
beforeEach(async () => {
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

            // Debe haberse escrito en localStorage, no en IndexedDB
            const raw = JSON.parse(localStorage.getItem('finanzas:custom-categories:v1'));
            expect(raw).toEqual(sampleCustomCategories);

            const loaded = await storage.loadCustomCategories();
            expect(loaded).toEqual(sampleCustomCategories);
        } finally {
            globalThis.indexedDB = original;
        }
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

            // Debe haberse escrito en localStorage, no en IndexedDB
            const raw = JSON.parse(localStorage.getItem('finanzas:ai-settings:v1'));
            expect(raw.provider).toBe('openai');
            expect(raw.model).toBe('gpt-4o');

            const loaded = await storage.loadAiSettings();
            expect(loaded.provider).toBe('openai');
            expect(loaded.apiKey).toBe('sk-test');
        } finally {
            globalThis.indexedDB = original;
        }
    });
});

// -------------------------------------------------------------------
// Ajustes de moneda (currency settings) — DB v6
// -------------------------------------------------------------------
const sampleCurrencySettings = { baseCurrency: 'EUR', displayCurrency: 'USD', rates: { USD: 1.1 } };

describe('storage: DB v6 expone el store settings (aditivo)', () => {
    it('abre la DB v6 y expone el store settings junto a los existentes', async () => {
        // Disparar la migración real a través del módulo storage (openDB con DB_VERSION)
        await storage.loadAiSettings();
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('finanzas_personales_2026');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        expect(db.version).toBe(6);
        expect(db.objectStoreNames.contains('settings')).toBe(true);
        // Migración aditiva: los stores existentes se preservan
        expect(db.objectStoreNames.contains('entries')).toBe(true);
        expect(db.objectStoreNames.contains('budgets')).toBe(true);
        expect(db.objectStoreNames.contains('recurring')).toBe(true);
        expect(db.objectStoreNames.contains('customCategories')).toBe(true);
        expect(db.objectStoreNames.contains('aiSettings')).toBe(true);
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
            // Debe haberse escrito en localStorage, no en IndexedDB
            const raw = JSON.parse(localStorage.getItem('finanzas:settings:v1'));
            expect(raw.displayCurrency).toBe('USD');
            expect(raw.rates.USD).toBe(1.1);

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
