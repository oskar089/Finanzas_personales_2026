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
