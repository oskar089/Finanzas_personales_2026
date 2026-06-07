// =====================================================================
// Tests para src/finance.js
// =====================================================================
// Se corre con: npx vitest run
// =====================================================================

import * as finance from './finance.js';

// -------------------------------------------------------------------
// 4.1 getAllCategories()
// -------------------------------------------------------------------
describe('getAllCategories()', () => {
    it('devuelve union de EXPENSE_CATEGORIES e INCOME_CATEGORIES', () => {
        const cats = finance.getAllCategories();
        expect(cats).toEqual(
            expect.arrayContaining(finance.EXPENSE_CATEGORIES)
        );
        expect(cats).toEqual(
            expect.arrayContaining(finance.INCOME_CATEGORIES)
        );
    });

    it('no contiene duplicados', () => {
        const cats = finance.getAllCategories();
        const unicos = new Set(cats);
        expect(unicos.size).toBe(cats.length);
    });

    it('incluye categorias esperadas', () => {
        const cats = finance.getAllCategories();
        expect(cats).toContain('Comida');
        expect(cats).toContain('Sueldo');
        expect(cats).toContain('Otro');
        expect(cats).toContain('Varios');
    });
});

// -------------------------------------------------------------------
// 4.2 formatAmount()
// -------------------------------------------------------------------
describe('formatAmount()', () => {
    it('formatea con signo $, separador de miles y 2 decimales', () => {
        const result = finance.formatAmount(1500);
        expect(result).toMatch(/^\$/);
        expect(result).toContain(',');
    });

    it('formatea 0 como $0,00', () => {
        expect(finance.formatAmount(0)).toBe('$0,00');
    });

    it('formatea numeros grandes con separador de miles', () => {
        const result = finance.formatAmount(1234567.89);
        expect(result).toMatch(/^\$/);
        expect(result).toContain('.');
        expect(result).toContain(',');
    });

    it('maneja string numerico', () => {
        expect(finance.formatAmount('500')).toBe('$500,00');
    });
});

// -------------------------------------------------------------------
// 4.3 escapeHTML()
// -------------------------------------------------------------------
describe('escapeHTML()', () => {
    it('escapa &', () => {
        expect(finance.escapeHTML('a & b')).toBe('a &amp; b');
    });

    it('escapa < y >', () => {
        expect(finance.escapeHTML('<script>alert("xss")</script>'))
            .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('escapa comillas dobles y simples', () => {
        expect(finance.escapeHTML('"hola" \'mundo\'')).toBe('&quot;hola&quot; &#39;mundo&#39;');
    });

    it('devuelve string vacio para string vacio', () => {
        expect(finance.escapeHTML('')).toBe('');
    });

    it('devuelve string vacio para null', () => {
        expect(finance.escapeHTML(null)).toBe('');
    });

    it('devuelve string vacio para undefined', () => {
        expect(finance.escapeHTML(undefined)).toBe('');
    });

    it('no escapa texto normal', () => {
        expect(finance.escapeHTML('Hola mundo 2026')).toBe('Hola mundo 2026');
    });
});

// -------------------------------------------------------------------
// 4.4 todayISO()
// -------------------------------------------------------------------
describe('todayISO()', () => {
    it('devuelve string con formato YYYY-MM-DD', () => {
        const result = finance.todayISO();
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('coincide con el año actual', () => {
        const result = finance.todayISO();
        const year = result.slice(0, 4);
        expect(year).toBe(String(new Date().getFullYear()));
    });
});

// -------------------------------------------------------------------
// 4.5 generateId()
// -------------------------------------------------------------------
describe('generateId()', () => {
    it('devuelve un string', () => {
        expect(typeof finance.generateId()).toBe('string');
    });

    it('no vacio', () => {
        expect(finance.generateId().length).toBeGreaterThan(0);
    });

    it('genera IDs unicos en multiples llamadas', () => {
        const ids = new Set();
        for (let i = 0; i < 100; i++) {
            ids.add(finance.generateId());
        }
        expect(ids.size).toBe(100);
    });
});

// -------------------------------------------------------------------
// 4.6 calculateBalance()
// -------------------------------------------------------------------
describe('calculateBalance()', () => {
    it('calcula balance mixto correctamente', () => {
        const entries = [
            { tipo: 'income', monto: 1000 },
            { tipo: 'expense', monto: 300 },
            { tipo: 'expense', monto: 200 }
        ];
        const result = finance.calculateBalance(entries);
        expect(result.totalIncome).toBe(1000);
        expect(result.totalExpenses).toBe(500);
        expect(result.balance).toBe(500);
    });

    it('solo expenses devuelve balance negativo', () => {
        const entries = [
            { tipo: 'expense', monto: 500 },
            { tipo: 'expense', monto: 300 }
        ];
        const result = finance.calculateBalance(entries);
        expect(result.totalIncome).toBe(0);
        expect(result.totalExpenses).toBe(800);
        expect(result.balance).toBe(-800);
    });

    it('solo income devuelve balance positivo', () => {
        const entries = [
            { tipo: 'income', monto: 2000 },
            { tipo: 'income', monto: 500 }
        ];
        const result = finance.calculateBalance(entries);
        expect(result.totalIncome).toBe(2500);
        expect(result.totalExpenses).toBe(0);
        expect(result.balance).toBe(2500);
    });

    it('array vacio devuelve ceros', () => {
        const result = finance.calculateBalance([]);
        expect(result).toEqual({ totalIncome: 0, totalExpenses: 0, balance: 0 });
    });
});

// -------------------------------------------------------------------
// 4.7 filterEntries()
// -------------------------------------------------------------------
describe('filterEntries()', () => {
    const entries = [
        { tipo: 'income', categoria: 'Sueldo', fecha: '2026-06-01', monto: 5000 },
        { tipo: 'expense', categoria: 'Comida', fecha: '2026-06-15', monto: 200 },
        { tipo: 'expense', categoria: 'Transporte', fecha: '2026-07-03', monto: 150 },
        { tipo: 'income', categoria: 'Freelance', fecha: '2026-07-10', monto: 1200 }
    ];

    it('filtra por tipo expense', () => {
        const result = finance.filterEntries(entries, { type: 'expense' });
        expect(result).toHaveLength(2);
        result.forEach(e => expect(e.tipo).toBe('expense'));
    });

    it('filtra por tipo income', () => {
        const result = finance.filterEntries(entries, { type: 'income' });
        expect(result).toHaveLength(2);
        result.forEach(e => expect(e.tipo).toBe('income'));
    });

    it('filtra por categoria', () => {
        const result = finance.filterEntries(entries, { category: 'Comida' });
        expect(result).toHaveLength(1);
        expect(result[0].categoria).toBe('Comida');
    });

    it('filtra por mes', () => {
        const result = finance.filterEntries(entries, { month: '2026-06' });
        expect(result).toHaveLength(2);
        result.forEach(e => expect(e.fecha.startsWith('2026-06')).toBe(true));
    });

    it('combina filtros (type + category + month)', () => {
        const result = finance.filterEntries(entries, {
            type: 'expense',
            category: 'Comida',
            month: '2026-06'
        });
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(entries[1]);
    });

    it('sin filtros devuelve todos', () => {
        const result = finance.filterEntries(entries);
        expect(result).toHaveLength(4);
    });

    it('resultado vacio si no hay match', () => {
        const result = finance.filterEntries(entries, { category: 'Inexistente' });
        expect(result).toHaveLength(0);
    });
});

// -------------------------------------------------------------------
// 4.8 validateEntry()
// -------------------------------------------------------------------
describe('validateEntry()', () => {
    const validEntry = {
        tipo: 'expense',
        amount: '100',
        category: 'Comida',
        description: 'Compra de prueba'
    };

    it('entrada valida devuelve array vacio', () => {
        expect(finance.validateEntry(validEntry)).toEqual([]);
    });

    it('tipo invalido agrega error', () => {
        const errors = finance.validateEntry({ ...validEntry, tipo: 'invalido' });
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors[0]).toMatch(/tipo/i);
    });

    it('tipo vacio agrega error', () => {
        const errors = finance.validateEntry({ ...validEntry, tipo: '' });
        expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    it('amount negativo agrega error', () => {
        const errors = finance.validateEntry({ ...validEntry, amount: '-50' });
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors[0]).toMatch(/monto/i);
    });

    it('amount cero agrega error', () => {
        const errors = finance.validateEntry({ ...validEntry, amount: '0' });
        expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    it('amount vacio agrega error', () => {
        const errors = finance.validateEntry({ ...validEntry, amount: '' });
        expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    it('category vacia agrega error', () => {
        const errors = finance.validateEntry({ ...validEntry, category: '' });
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors[0]).toMatch(/categor/i);
    });

    it('description vacia agrega error', () => {
        const errors = finance.validateEntry({ ...validEntry, description: '' });
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors[0]).toMatch(/descripci/i);
    });

    it('entry undefined no explota', () => {
        const errors = finance.validateEntry();
        expect(Array.isArray(errors)).toBe(true);
        expect(errors.length).toBeGreaterThanOrEqual(1);
    });
});
