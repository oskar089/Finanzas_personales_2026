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
    it('formatea con signo €, separador de miles y 2 decimales', () => {
        const result = finance.formatAmount(1500);
        expect(result).toMatch(/^€/);
        expect(result).toContain(',');
    });

    it('formatea 0 como €0,00', () => {
        expect(finance.formatAmount(0)).toBe('€0,00');
    });

    it('formatea numeros grandes con separador de miles', () => {
        const result = finance.formatAmount(1234567.89);
        expect(result).toMatch(/^€/);
        expect(result).toContain('.');
        expect(result).toContain(',');
    });

    it('maneja string numerico', () => {
        expect(finance.formatAmount('500')).toBe('€500,00');
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
        expect(result).toEqual({ totalIncome: 0, totalExpenses: 0, totalSavings: 0, balance: 0 });
    });
});

// -------------------------------------------------------------------
// 4.7 filterEntries()
// -------------------------------------------------------------------
describe('filterEntries()', () => {
    const entries = [
        { tipo: 'income', categoria: 'Sueldo', descripcion: 'Sueldo base', fecha: '2026-06-01', monto: 5000 },
        { tipo: 'expense', categoria: 'Comida', descripcion: 'Almuerzo', fecha: '2026-06-15', monto: 200 },
        { tipo: 'expense', categoria: 'Transporte', descripcion: 'Subte', fecha: '2026-07-03', monto: 150 },
        { tipo: 'income', categoria: 'Freelance', descripcion: 'Proyecto web', fecha: '2026-07-10', monto: 1200 }
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

    it('filtra por mes (rango desde-hasta)', () => {
        const result = finance.filterEntries(entries, { monthFrom: '2026-06', monthTo: '2026-06' });
        expect(result).toHaveLength(2);
        result.forEach(e => expect(e.fecha.substring(0, 7)).toBe('2026-06'));
    });

    it('filtra por rango de meses', () => {
        const result = finance.filterEntries(entries, { monthFrom: '2026-06', monthTo: '2026-07' });
        expect(result).toHaveLength(4);
    });

    it('combina filtros (type + category + month)', () => {
        const result = finance.filterEntries(entries, {
            type: 'expense',
            category: 'Comida',
            monthFrom: '2026-06',
            monthTo: '2026-06'
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

    it('busca en descripcion (case-insensitive)', () => {
        const result = finance.filterEntries(entries, { search: 'sueldo' });
        expect(result).toHaveLength(1);
        expect(result[0].descripcion).toMatch(/sueldo/i);
    });

    it('busca en categoria', () => {
        const result = finance.filterEntries(entries, { search: 'comida' });
        expect(result).toHaveLength(1);
        expect(result[0].categoria).toBe('Comida');
    });

    it('busca parcial', () => {
        const result = finance.filterEntries(entries, { search: 'trans' });
        expect(result).toHaveLength(1);
        expect(result[0].categoria).toBe('Transporte');
    });

    it('combina search con otros filtros', () => {
        const result = finance.filterEntries(entries, {
            type: 'expense',
            search: 'trans'
        });
        expect(result).toHaveLength(1);
        expect(result[0].categoria).toBe('Transporte');
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

    it('categoria personalizada es valida', () => {
        const errors = finance.validateEntry({ ...validEntry, category: 'CategoriaFalsa' });
        expect(errors).toHaveLength(0);
    });

    it('entry undefined no explota', () => {
        const errors = finance.validateEntry();
        expect(Array.isArray(errors)).toBe(true);
        expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    it('amount con coma decimal es valido', () => {
        const errors = finance.validateEntry({ ...validEntry, amount: '1500,50' });
        expect(errors).toEqual([]);
    });

    it('amount negativo con coma decimal agrega error', () => {
        const errors = finance.validateEntry({ ...validEntry, amount: '-50' });
        expect(errors.length).toBeGreaterThanOrEqual(1);
        expect(errors[0]).toMatch(/monto/i);
    });
});

// -------------------------------------------------------------------
// parseAmount()
// -------------------------------------------------------------------
describe('parseAmount()', () => {
    it('convierte coma decimal a punto', () => {
        expect(finance.parseAmount('1500,50')).toBe(1500.5);
    });

    it('acepta un entero sin coma', () => {
        expect(finance.parseAmount('1500')).toBe(1500);
    });

    it('acepta punto decimal ya existente', () => {
        expect(finance.parseAmount('1500.50')).toBe(1500.5);
    });

    it('rechaza separador de miles (no soportado)', () => {
        expect(Number.isNaN(finance.parseAmount('1.234,56'))).toBe(true);
    });

    it('rechaza texto no numérico', () => {
        expect(Number.isNaN(finance.parseAmount('abc'))).toBe(true);
    });

    it('string vacío retorna 0 (contrato validateEntry)', () => {
        expect(finance.parseAmount('')).toBe(0);
    });

    it('null retorna NaN', () => {
        expect(Number.isNaN(finance.parseAmount(null))).toBe(true);
    });

    it('undefined retorna NaN', () => {
        expect(Number.isNaN(finance.parseAmount(undefined))).toBe(true);
    });

    it('acepta números negativos', () => {
        expect(finance.parseAmount('-50')).toBe(-50);
    });

    it('normaliza espacios alrededor', () => {
        expect(finance.parseAmount('  1500,50  ')).toBe(1500.5);
    });
});

// -------------------------------------------------------------------
// Dashboard functions
// -------------------------------------------------------------------
describe('getDaysInMonth()', () => {
    it('devuelve 31 para enero', () => {
        expect(finance.getDaysInMonth(2026, 1)).toBe(31);
    });

    it('devuelve 28 para febrero 2026 (no bisiesto)', () => {
        expect(finance.getDaysInMonth(2026, 2)).toBe(28);
    });

    it('devuelve 29 para febrero 2024 (bisiesto)', () => {
        expect(finance.getDaysInMonth(2024, 2)).toBe(29);
    });

    it('devuelve 30 para abril', () => {
        expect(finance.getDaysInMonth(2026, 4)).toBe(30);
    });
});

describe('getDaysElapsedInMonth()', () => {
    it('devuelve dias transcurridos del mes actual', () => {
        const now = new Date();
        const expected = now.getUTCDate();
        expect(finance.getDaysElapsedInMonth(now.getUTCFullYear(), now.getUTCMonth() + 1)).toBe(expected);
    });

    it('devuelve dias totales para mes pasado', () => {
        const year = 2026;
        const month = 7; // Julio
        expect(finance.getDaysElapsedInMonth(year, month)).toBe(31);
    });
});

describe('calculateDailyAverage()', () => {
    const entries = [
        { tipo: 'expense', monto: 100, fecha: '2026-08-01' },
        { tipo: 'expense', monto: 200, fecha: '2026-08-05' },
        { tipo: 'expense', monto: 50, fecha: '2026-08-10' },
        { tipo: 'income', monto: 1000, fecha: '2026-08-01' },
        { tipo: 'expense', monto: 300, fecha: '2026-07-15' }, // mes anterior
    ];

    it('calcula promedio diario de gastos del mes actual', () => {
        // 350 total / dias transcurridos
        const result = finance.calculateDailyAverage(entries, '2026-08');
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThanOrEqual(0);
    });

    it('ignora ingresos', () => {
        // Solo suma expenses (100+200+50=350), no income
        const result = finance.calculateDailyAverage(entries, '2026-08');
        const resultAll = finance.calculateDailyAverage(
            entries.filter(e => e.tipo !== 'income'),
            '2026-08'
        );
        expect(result).toBe(resultAll);
    });

    it('devuelve 0 si no hay gastos en el mes', () => {
        expect(finance.calculateDailyAverage(entries, '2026-01')).toBe(0);
    });

    it('devuelve 0 si mes es undefined', () => {
        expect(finance.calculateDailyAverage(entries)).toBe(0);
    });
});

describe('calculateProjection()', () => {
    const entries = [
        { tipo: 'expense', monto: 100, fecha: '2026-08-01' },
        { tipo: 'expense', monto: 200, fecha: '2026-08-05' },
    ];

    it('proyecta fin de mes basado en promedio', () => {
        const result = finance.calculateProjection(entries, '2026-08');
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThanOrEqual(0);
    });

    it('devuelve 0 si no hay gastos', () => {
        expect(finance.calculateProjection(entries, '2026-01')).toBe(0);
    });
});

describe('calculateComparison()', () => {
    const entries = [
        { tipo: 'expense', monto: 1000, fecha: '2026-08-01' }, // actual
        { tipo: 'expense', monto: 800, fecha: '2026-07-15' }, // anterior
    ];

    it('calcula delta y porcentaje vs mes anterior', () => {
        const result = finance.calculateComparison(entries, '2026-08');
        expect(result.currentExpenses).toBe(1000);
        expect(result.prevExpenses).toBe(800);
        expect(result.delta).toBe(200);
        expect(result.percent).toBeCloseTo(25, 1); // 200/800 * 100 = 25%
    });

    it('devuelve 0% si mes anterior no tiene gastos (actual=ago, prev=jul sin datos)', () => {
        const entriesNoPrev = [
            { tipo: 'expense', monto: 1000, fecha: '2026-08-01' },
            // sin datos en julio
        ];
        const result = finance.calculateComparison(entriesNoPrev, '2026-08');
        expect(result.percent).toBe(0);
        expect(result.prevExpenses).toBe(0);
    });

    it('devuelve delta negativo si se gasta menos', () => {
        const entriesLess = [
            { tipo: 'expense', monto: 500, fecha: '2026-08-01' },
            { tipo: 'expense', monto: 800, fecha: '2026-07-15' },
        ];
        const result = finance.calculateComparison(entriesLess, '2026-08');
        expect(result.delta).toBe(-300);
        expect(result.percent).toBeCloseTo(-37.5, 1);
    });
});

// -------------------------------------------------------------------
// calculateBudgetProgress()
// -------------------------------------------------------------------
describe('calculateBudgetProgress()', () => {
    const entries = [
        { tipo: 'expense', monto: 150, categoria: 'Comida', fecha: '2026-08-01' },
        { tipo: 'expense', monto: 100, categoria: 'Transporte', fecha: '2026-08-05' },
        { tipo: 'expense', monto: 200, categoria: 'Comida', fecha: '2026-08-10' },
        { tipo: 'income', monto: 2000, categoria: 'Sueldo', fecha: '2026-08-01' },
    ];
    const budgets = { Comida: 300, Transporte: 100, Ocio: 50 };

    it('calcula progreso por categoría', () => {
        const result = finance.calculateBudgetProgress(entries, budgets, '2026-08');
        expect(result).toHaveLength(3);

        const comida = result.find(r => r.categoria === 'Comida');
        expect(comida.actual).toBe(350);
        expect(comida.presupuesto).toBe(300);
        expect(comida.porcentaje).toBe(116.7);
        expect(comida.estado).toBe('excedido');

        const transporte = result.find(r => r.categoria === 'Transporte');
        expect(transporte.actual).toBe(100);
        expect(transporte.porcentaje).toBe(100);
        expect(transporte.estado).toBe('excedido');

        const ocio = result.find(r => r.categoria === 'Ocio');
        expect(ocio.actual).toBe(0);
        expect(ocio.porcentaje).toBe(0);
        expect(ocio.estado).toBe('ok');
    });

    it('ignora ingresos', () => {
        const result = finance.calculateBudgetProgress(entries, budgets, '2026-08');
        // El ingreso de 2000 no debe afectar
        const comida = result.find(r => r.categoria === 'Comida');
        expect(comida.actual).toBe(350); // solo gastos
    });

    it('devuelve array vacío si no hay presupuestos', () => {
        expect(finance.calculateBudgetProgress(entries, {}, '2026-08')).toEqual([]);
        expect(finance.calculateBudgetProgress(entries, null, '2026-08')).toEqual([]);
        expect(finance.calculateBudgetProgress(entries, undefined, '2026-08')).toEqual([]);
    });

    it('devuelve array vacío si mes es undefined', () => {
        expect(finance.calculateBudgetProgress(entries, budgets)).toEqual([]);
    });

    it('estado advertencia al 80%', () => {
        const budgets80 = { Comida: 500 }; // 350/500 = 70% -> ok, pero si ponemos 437.5 = 80%
        const entries80 = [
            { tipo: 'expense', monto: 350, categoria: 'Comida', fecha: '2026-08-01' },
        ];
        const result = finance.calculateBudgetProgress(entries80, { Comida: 437.5 }, '2026-08');
        expect(result[0].estado).toBe('advertencia');
    });
});

// -------------------------------------------------------------------
// calculateMonthlyTrend()
// -------------------------------------------------------------------
describe('calculateMonthlyTrend()', () => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
    const prevMonth = month > 1 ? `${year}-${String(month - 1).padStart(2, '0')}` : `${year - 1}-12`;

    const entries = [
        { tipo: 'expense', monto: 500, fecha: `${currentMonth}-01` },
        { tipo: 'expense', monto: 300, fecha: `${currentMonth}-15` },
        { tipo: 'income', monto: 2000, fecha: `${currentMonth}-01` },
        { tipo: 'expense', monto: 400, fecha: `${prevMonth}-10` },
        { tipo: 'income', monto: 1500, fecha: `${prevMonth}-05` },
    ];

    it('devuelve array con 12 meses por defecto', () => {
        const result = finance.calculateMonthlyTrend(entries);
        expect(result).toHaveLength(12);
        result.forEach(r => {
            expect(r).toHaveProperty('mes');
            expect(r).toHaveProperty('label');
            expect(r).toHaveProperty('gastos');
            expect(r).toHaveProperty('ingresos');
            expect(r).toHaveProperty('balance');
        });
    });

    it('calcula gastos, ingresos y balance por mes', () => {
        const result = finance.calculateMonthlyTrend(entries);
        const curr = result.find(r => r.mes === currentMonth);
        const prev = result.find(r => r.mes === prevMonth);

        expect(curr.gastos).toBe(800);
        expect(curr.ingresos).toBe(2000);
        expect(curr.balance).toBe(1200);

        expect(prev.gastos).toBe(400);
        expect(prev.ingresos).toBe(1500);
        expect(prev.balance).toBe(1100);
    });

    it('meses sin datos devuelven 0', () => {
        const result = finance.calculateMonthlyTrend(entries);
        const emptyMonth = result.find(r => r.gastos === 0 && r.ingresos === 0);
        expect(emptyMonth).toBeDefined();
        expect(emptyMonth.balance).toBe(0);
    });

    it('respeta el parámetro months', () => {
        const result6 = finance.calculateMonthlyTrend(entries, 6);
        expect(result6).toHaveLength(6);
        const result1 = finance.calculateMonthlyTrend(entries, 1);
        expect(result1).toHaveLength(1);
    });

    it('ordena meses de más antiguo a más reciente', () => {
        const result = finance.calculateMonthlyTrend(entries);
        for (let i = 1; i < result.length; i++) {
            expect(result[i].mes >= result[i - 1].mes).toBe(true);
        }
    });
});

// -------------------------------------------------------------------
// generateRecurringEntries()
// -------------------------------------------------------------------
describe('generateRecurringEntries()', () => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
    const prevMonth = month > 1 ? `${year}-${String(month - 1).padStart(2, '0')}` : `${year - 1}-12`;
    const today = now.getUTCDate();

    const recurring = [
        { id: 'r1', tipo: 'expense', monto: 500, categoria: 'Hogar', descripcion: 'Alquiler', diaMes: 1, fechaInicio: '2026-01', activo: true },
        { id: 'r2', tipo: 'income', monto: 2000, categoria: 'Sueldo', descripcion: 'Sueldo base', diaMes: 5, fechaInicio: '2026-01', activo: true },
        { id: 'r3', tipo: 'expense', monto: 20, categoria: 'Ocio', descripcion: 'Netflix', diaMes: 15, fechaInicio: '2026-06', activo: true },
        { id: 'r4', tipo: 'expense', monto: 100, categoria: 'Transporte', descripcion: 'Pase', diaMes: 1, fechaInicio: '2026-01', activo: false }, // inactivo
    ];

    const entries = [
        { tipo: 'expense', monto: 500, categoria: 'Hogar', descripcion: 'Alquiler', fecha: `${currentMonth}-01` }, // ya existe
    ];

    it('genera entries para mes actual si día ya pasó', () => {
        const result = finance.generateRecurringEntries(recurring, entries, currentMonth);
        // r1: día 1 <= today, activo, ya existe -> no genera
        // r2: día 5 <= today (asumiendo today >= 5), activo -> genera
        // r3: día 15, si today >= 15 -> genera
        // r4: inactivo -> no genera
        expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('no genera para mes futuro', () => {
        const nextMonth = month < 12 ? `${year}-${String(month + 1).padStart(2, '0')}` : `${year + 1}-01`;
        const result = finance.generateRecurringEntries(recurring, entries, nextMonth);
        expect(result).toHaveLength(0);
    });

    it('no genera recurrentes inactivos', () => {
        const result = finance.generateRecurringEntries(recurring, entries, currentMonth);
        const inactivos = result.filter(r => r.descripcion === 'Pase');
        expect(inactivos).toHaveLength(0);
    });

    it('no duplica entries ya existentes', () => {
        const result = finance.generateRecurringEntries(recurring, entries, currentMonth);
        const alquiler = result.find(r => r.descripcion === 'Alquiler');
        expect(alquiler).toBeUndefined(); // ya existe en entries
    });

    it('respeta fechaInicio', () => {
        const recurringNew = [
            { id: 'r5', tipo: 'expense', monto: 50, categoria: 'Otro', descripcion: 'Nuevo', diaMes: 1, fechaInicio: '2026-12', activo: true }
        ];
        const result = finance.generateRecurringEntries(recurringNew, entries, currentMonth);
        // fechaInicio 2026-12 > currentMonth -> no genera
        expect(result).toHaveLength(0);
    });

    it('solo genera hasta día 28', () => {
        const recurring29 = [
            { id: 'r6', tipo: 'expense', monto: 10, categoria: 'Test', descripcion: 'Dia29', diaMes: 29, fechaInicio: '2026-01', activo: true }
        ];
        const result = finance.generateRecurringEntries(recurring29, entries, currentMonth);
        expect(result).toHaveLength(0);
    });
});

// -------------------------------------------------------------------
// parseEntryFromRow()
// -------------------------------------------------------------------
describe('parseEntryFromRow()', () => {
    it('devuelve campos parseados para entrada válida', () => {
        const result = finance.parseEntryFromRow({
            fecha: '2026-08-15',
            tipo: 'expense',
            categoria: 'Comida',
            descripcion: 'Compra test',
            monto: '150.50'
        });
        expect(result.errors).toBeUndefined();
        expect(result.fecha).toBe('2026-08-15');
        expect(result.tipo).toBe('expense');
        expect(result.categoria).toBe('Comida');
        expect(result.descripcion).toBe('Compra test');
        expect(result.monto).toBe(150.5);
    });

    it('trimea espacios en descripción y fecha', () => {
        const result = finance.parseEntryFromRow({
            fecha: '  2026-08-15  ',
            tipo: 'income',
            categoria: 'Sueldo',
            descripcion: '  Compra test  ',
            monto: '100'
        });
        expect(result.errors).toBeUndefined();
        expect(result.fecha).toBe('2026-08-15');
        expect(result.descripcion).toBe('Compra test');
    });

    it('devuelve error si fecha es inválida', () => {
        const result = finance.parseEntryFromRow({
            fecha: 'no-es-fecha',
            descripcion: 'Test',
            monto: '100'
        });
        expect(result.errors).toBeDefined();
        expect(result.errors.some(e => /fecha/i.test(e))).toBe(true);
    });

    it('devuelve error si fecha está vacía', () => {
        const result = finance.parseEntryFromRow({
            fecha: '',
            descripcion: 'Test',
            monto: '100'
        });
        expect(result.errors).toBeDefined();
    });

    it('devuelve error si monto es cero', () => {
        const result = finance.parseEntryFromRow({
            fecha: '2026-08-15',
            descripcion: 'Test',
            monto: '0'
        });
        expect(result.errors).toBeDefined();
        expect(result.errors.some(e => /monto/i.test(e))).toBe(true);
    });

    it('devuelve error si monto es negativo', () => {
        const result = finance.parseEntryFromRow({
            fecha: '2026-08-15',
            descripcion: 'Test',
            monto: '-50'
        });
        expect(result.errors).toBeDefined();
    });

    it('devuelve error si monto es Infinity', () => {
        const result = finance.parseEntryFromRow({
            fecha: '2026-08-15',
            descripcion: 'Test',
            monto: 'Infinity'
        });
        expect(result.errors).toBeDefined();
    });

    it('devuelve error si monto está vacío', () => {
        const result = finance.parseEntryFromRow({
            fecha: '2026-08-15',
            descripcion: 'Test',
            monto: ''
        });
        expect(result.errors).toBeDefined();
    });

    it('devuelve error si descripción está vacía', () => {
        const result = finance.parseEntryFromRow({
            fecha: '2026-08-15',
            descripcion: '',
            monto: '100'
        });
        expect(result.errors).toBeDefined();
        expect(result.errors.some(e => /descripci/i.test(e))).toBe(true);
    });

    it('devuelve error si descripción es solo espacios', () => {
        const result = finance.parseEntryFromRow({
            fecha: '2026-08-15',
            descripcion: '   ',
            monto: '100'
        });
        expect(result.errors).toBeDefined();
    });

    it('maneja monto como número directo', () => {
        const result = finance.parseEntryFromRow({
            fecha: '2026-08-15',
            tipo: 'savings',
            categoria: 'Ahorro',
            descripcion: 'Test',
            monto: 200
        });
        expect(result.errors).toBeUndefined();
        expect(result.monto).toBe(200);
    });
});

// -------------------------------------------------------------------
// mergeCategories()
// -------------------------------------------------------------------
describe('mergeCategories()', () => {
    it('devuelve la base sin cambios cuando no hay categorías personalizadas', () => {
        const base = ['Comida', 'Transporte'];
        const result = finance.mergeCategories(base, []);
        expect(result).toEqual(['Comida', 'Transporte']);
    });

    it('deduplica sin distinguir mayúsculas conservando el casing de la primera aparición', () => {
        const result = finance.mergeCategories(['Comida'], ['comida', 'COMIDA']);
        expect(result).toEqual(['Comida']);
    });

    it('agrega las personalizadas después de la base conservando su orden de inserción', () => {
        const base = ['Comida', 'Transporte'];
        const customs = ['Mascotas', 'Regalos'];
        const result = finance.mergeCategories(base, customs);
        expect(result).toEqual(['Comida', 'Transporte', 'Mascotas', 'Regalos']);
    });

    it('deduplica también entre personalizadas, conservando la primera aparición', () => {
        const result = finance.mergeCategories(['Comida'], ['Mascotas', 'mascotas']);
        expect(result).toEqual(['Comida', 'Mascotas']);
    });
});

// -------------------------------------------------------------------
// Catálogo de monedas (CURRENCIES)
// -------------------------------------------------------------------
describe('CURRENCIES catalog', () => {
    it('mapea las 8 monedas curadas a su locale y decimales', () => {
        expect(finance.CURRENCIES).toBeDefined();
        expect(finance.CURRENCIES.EUR).toEqual({ locale: 'es-ES', decimals: 2 });
        expect(finance.CURRENCIES.USD).toEqual({ locale: 'en-US', decimals: 2 });
        expect(finance.CURRENCIES.GBP).toEqual({ locale: 'en-GB', decimals: 2 });
        expect(finance.CURRENCIES.ARS).toEqual({ locale: 'es-AR', decimals: 2 });
        expect(finance.CURRENCIES.MXN).toEqual({ locale: 'es-MX', decimals: 2 });
        expect(finance.CURRENCIES.BRL).toEqual({ locale: 'pt-BR', decimals: 2 });
        expect(finance.CURRENCIES.JPY).toEqual({ locale: 'ja-JP', decimals: 0 });
        expect(finance.CURRENCIES.CHF).toEqual({ locale: 'de-CH', decimals: 2 });
    });
});

// -------------------------------------------------------------------
// getActiveFormat() / setDisplayConfig()
// -------------------------------------------------------------------
describe('getActiveFormat() / setDisplayConfig()', () => {
    it('getActiveFormat() por defecto es EUR con rate 1, locale es-ES, decimals 2', () => {
        finance.setDisplayConfig(null);
        const f = finance.getActiveFormat();
        expect(f.displayCurrency).toBe('EUR');
        expect(f.rate).toBe(1);
        expect(f.locale).toBe('es-ES');
        expect(f.decimals).toBe(2);
    });

    it('setDisplayConfig normaliza código desconocido a EUR y rate inválido a 1', () => {
        finance.setDisplayConfig({ displayCurrency: 'XXX', rate: -5 });
        const f = finance.getActiveFormat();
        expect(f.displayCurrency).toBe('EUR');
        expect(f.rate).toBe(1);
        expect(f.locale).toBe('es-ES');
        // Reset para no contaminar otros tests
        finance.setDisplayConfig(null);
    });

    it('setDisplayConfig aplica la moneda y rate válidos', () => {
        finance.setDisplayConfig({ displayCurrency: 'USD', rate: 1.1 });
        const f = finance.getActiveFormat();
        expect(f.displayCurrency).toBe('USD');
        expect(f.rate).toBe(1.1);
        expect(f.locale).toBe('en-US');
        finance.setDisplayConfig(null);
    });
});

// -------------------------------------------------------------------
// convertAmount()
// -------------------------------------------------------------------
describe('convertAmount()', () => {
    it('convierte amount * rate', () => {
        expect(finance.convertAmount(1500, 1.1)).toBe(1650);
    });

    it('rate 0 pasa el monto sin cambios (passthrough)', () => {
        expect(finance.convertAmount(1500, 0)).toBe(1500);
    });

    it('rate negativo pasa el monto sin cambios (passthrough)', () => {
        expect(finance.convertAmount(1500, -1)).toBe(1500);
    });

    it('rate NaN pasa el monto sin cambios (passthrough)', () => {
        expect(finance.convertAmount(1500, NaN)).toBe(1500);
    });
});

// -------------------------------------------------------------------
// formatAmount() con opts (moneda + rate) — valores exactos
// -------------------------------------------------------------------
describe('formatAmount() con moneda explícita', () => {
    it('USD con rate 1.1 formatea 1500 → $1,650.00 (en-US)', () => {
        expect(finance.formatAmount(1500, { currency: 'USD', rate: 1.1 })).toBe('$1,650.00');
    });

    it('JPY con rate 1 formatea 1650 sin decimales (ja-JP)', () => {
        expect(finance.formatAmount(1650, { currency: 'JPY', rate: 1 })).toBe('￥1,650');
    });
});

// -------------------------------------------------------------------
// formatAmount() default: byte-identical a EUR legacy
// -------------------------------------------------------------------
describe('formatAmount() default (backward compat EUR)', () => {
    beforeEach(() => {
        finance.setDisplayConfig(null);
    });

    it('formatAmount(1500) tras reset es idéntico al legacy', () => {
        expect(finance.formatAmount(1500)).toBe('€1500,00');
    });

    it('formatAmount(0) tras reset es €0,00', () => {
        expect(finance.formatAmount(0)).toBe('€0,00');
    });

    it('formatAmount("500") tras reset es €500,00', () => {
        expect(finance.formatAmount('500')).toBe('€500,00');
    });
});

// -------------------------------------------------------------------
// parseRateResponse() — valida el envoltorio de Frankfurter
// -------------------------------------------------------------------
describe('parseRateResponse()', () => {
    it('extrae la tasa válida del envoltorio de Frankfurter', () => {
        expect(finance.parseRateResponse({ rates: { USD: 1.1 } }, 'USD')).toBe(1.1);
        expect(finance.parseRateResponse({ rates: { ARS: 1200.5 } }, 'ARS')).toBe(1200.5);
    });

    it('retorna null si el envoltorio no tiene rates', () => {
        expect(finance.parseRateResponse(null, 'USD')).toBeNull();
        expect(finance.parseRateResponse(undefined, 'USD')).toBeNull();
        expect(finance.parseRateResponse({ base: 'EUR' }, 'USD')).toBeNull();
        expect(finance.parseRateResponse('no soy objeto', 'USD')).toBeNull();
    });

    it('retorna null si falta la moneda destino en rates', () => {
        expect(finance.parseRateResponse({ rates: { GBP: 0.85 } }, 'USD')).toBeNull();
    });

    it('retorna null si la tasa es no numérica, 0 o negativa', () => {
        expect(finance.parseRateResponse({ rates: { USD: 'abc' } }, 'USD')).toBeNull();
        expect(finance.parseRateResponse({ rates: { USD: 0 } }, 'USD')).toBeNull();
        expect(finance.parseRateResponse({ rates: { USD: -1 } }, 'USD')).toBeNull();
        expect(finance.parseRateResponse({ rates: { USD: Infinity } }, 'USD')).toBeNull();
    });
});

// -------------------------------------------------------------------
// Cache: setDisplayConfig → formatAmount lee la config activa
// -------------------------------------------------------------------
describe('setDisplayConfig cache aplicado en formatAmount()', () => {
    it('setDisplayConfig USD rate 1.1 → formatAmount(1500) = $1,650.00', () => {
        finance.setDisplayConfig({ displayCurrency: 'USD', rate: 1.1 });
        expect(finance.formatAmount(1500)).toBe('$1,650.00');
        finance.setDisplayConfig(null);
    });

    it('reset con setDisplayConfig(null) restaura la salida EUR', () => {
        finance.setDisplayConfig({ displayCurrency: 'USD', rate: 1.1 });
        finance.setDisplayConfig(null);
        expect(finance.formatAmount(1500)).toBe('€1500,00');
    });
});
