// =====================================================================
// FINANZAS PERSONALES 2026 - Funciones puras
// =====================================================================
// Este archivo contiene TODA la lógica de negocio como funciones puras.
// Se usa desde:
//   1. El navegador (via <script src="src/finance.js">) → window.*
//   2. Los tests (via vitest) → module.exports
// =====================================================================

// --- Constantes ---------------------------------------------------

const EXPENSE_CATEGORIES = [
    'Comida',
    'Transporte',
    'Hogar',
    'Ocio',
    'Salud',
    'Otro'
];

const INCOME_CATEGORIES = [
    'Sueldo',
    'Freelance',
    'Inversiones',
    'Varios'
];

// --- Funciones puras ----------------------------------------------

function getAllCategories() {
    // Unifica categorías de gasto e ingreso, sin duplicar 'Otro' y 'Varios'
    const set = new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]);
    return [...set];
}

function escapeHTML(str) {
    // Escapa caracteres que rompen innerHTML cuando vienen de input del usuario.
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatAmount(n) {
    // Formato europeo: separador de miles con punto, decimales con coma.
    const num = Number(n);
    if (isNaN(num)) return '€0,00';
    return '€' + num.toLocaleString('es-ES', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function todayISO() {
    // Devuelve la fecha de hoy en formato YYYY-MM-DD para el input date.
    // Usa UTC para evitar desfases cerca de medianoche según timezone.
    const d = new Date();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function generateId() {
    // Suficiente para una app personal: timestamp + random.
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function calculateBalance(entries) {
    const totalIncome = entries
        .filter(e => e.tipo === 'income')
        .reduce((acc, e) => acc + e.monto, 0);
    const totalExpenses = entries
        .filter(e => e.tipo !== 'income')
        .reduce((acc, e) => acc + e.monto, 0);
    const balance = totalIncome - totalExpenses;
    return { totalIncome, totalExpenses, balance };
}

function filterEntries(entries, { type, category, month, search } = {}) {
    const searchLower = search ? search.toLowerCase() : '';
    return entries.filter(e => {
        const passesType = !type || e.tipo === type;
        const passesCategory = !category || e.categoria === category;
        const passesMonth = !month || e.fecha.startsWith(month);
        const passesSearch = !searchLower ||
            (e.descripcion && e.descripcion.toLowerCase().includes(searchLower)) ||
            (e.categoria && e.categoria.toLowerCase().includes(searchLower));
        return passesType && passesCategory && passesMonth && passesSearch;
    });
}

function validateEntry({ tipo, amount, category, description } = {}) {
    const errors = [];
    if (!tipo || (tipo !== 'expense' && tipo !== 'income')) {
        errors.push('Seleccioná un tipo válido.');
    }
    if (amount === undefined || amount === null || amount === '' || Number(amount) <= 0) {
        errors.push('El monto tiene que ser mayor a 0.');
    }
    if (!category || !category.trim()) {
        errors.push('Seleccioná una categoría.');
    } else if (!getAllCategories().includes(category.trim())) {
        errors.push('Categoría no válida.');
    }
    if (!description || !description.trim()) {
        errors.push('Agregá una descripción.');
    }
    return errors;
}

// --- Dashboard: funciones de métricas --------------------------------

function getDaysInMonth(year, month) {
    // month es 1-12
    return new Date(year, month, 0).getDate();
}

function getDaysElapsedInMonth(year, month) {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    if (year !== currentYear || month !== currentMonth) {
        return getDaysInMonth(year, month);
    }
    return now.getUTCDate();
}

function calculateDailyAverage(entries, month) {
    // month formato "YYYY-MM"
    if (!month) return 0;
    const [year, mon] = month.split('-').map(Number);
    const expenses = entries
        .filter(e => e.tipo !== 'income' && e.fecha.startsWith(month))
        .reduce((acc, e) => acc + e.monto, 0);
    const days = getDaysElapsedInMonth(year, mon);
    return days > 0 ? expenses / days : 0;
}

function calculateProjection(entries, month) {
    if (!month) return 0;
    const [year, mon] = month.split('-').map(Number);
    const avg = calculateDailyAverage(entries, month);
    const totalDays = getDaysInMonth(year, mon);
    return avg * totalDays;
}

function calculateComparison(entries, month) {
    // month formato "YYYY-MM"
    if (!month) return { delta: 0, percent: 0, prevMonth: null };
    const [year, mon] = month.split('-').map(Number);

    // Mes anterior
    const prevDate = new Date(year, mon - 2, 1);
    const prevYear = prevDate.getFullYear();
    const prevMonth = String(prevDate.getMonth() + 1).padStart(2, '0');
    const prevKey = `${prevYear}-${prevMonth}`;

    const currentExpenses = entries
        .filter(e => e.tipo !== 'income' && e.fecha.startsWith(month))
        .reduce((acc, e) => acc + e.monto, 0);

    const prevExpenses = entries
        .filter(e => e.tipo !== 'income' && e.fecha.startsWith(prevKey))
        .reduce((acc, e) => acc + e.monto, 0);

    const delta = currentExpenses - prevExpenses;
    const percent = prevExpenses > 0 ? ((delta / prevExpenses) * 100) : 0;

    return { delta, percent, prevMonth: prevKey, prevExpenses, currentExpenses };
}

// --- Presupuestos ----------------------------------------------------

function calculateBudgetProgress(entries, budgets, month) {
    // budgets: { categoria: montoPresupuesto }
    // Devuelve array de { categoria, actual, presupuesto, porcentaje, estado }
    if (!month || !budgets || Object.keys(budgets).length === 0) {
        return [];
    }

    const gastosPorCategoria = entries
        .filter(e => e.tipo !== 'income' && e.fecha.startsWith(month))
        .reduce((acc, e) => {
            acc[e.categoria] = (acc[e.categoria] || 0) + e.monto;
            return acc;
        }, {});

    return Object.keys(budgets).map(categoria => {
        const presupuesto = budgets[categoria];
        const actual = gastosPorCategoria[categoria] || 0;
        const porcentaje = presupuesto > 0 ? (actual / presupuesto) * 100 : 0;
        let estado = 'ok';
        if (porcentaje >= 100) estado = 'excedido';
        else if (porcentaje >= 80) estado = 'advertencia';
        return { categoria, actual, presupuesto, porcentaje: Math.round(porcentaje * 10) / 10, estado };
    });
}

// --- Gráfico de tendencia ------------------------------------------

function calculateMonthlyTrend(entries, months = 12) {
    // Devuelve array de { mes: 'YYYY-MM', gastos, ingresos, balance } para los últimos N meses
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;

    const result = [];
    for (let i = months - 1; i >= 0; i--) {
        let y = currentYear;
        let m = currentMonth - i;
        while (m <= 0) { m += 12; y -= 1; }
        while (m > 12) { m -= 12; y += 1; }
        const key = `${y}-${String(m).padStart(2, '0')}`;
        const label = `${String(m).padStart(2, '0')}/${y}`;

        const monthEntries = entries.filter(e => e.fecha.startsWith(key));
        const gastos = monthEntries
            .filter(e => e.tipo !== 'income')
            .reduce((acc, e) => acc + e.monto, 0);
        const ingresos = monthEntries
            .filter(e => e.tipo === 'income')
            .reduce((acc, e) => acc + e.monto, 0);

        result.push({ mes: key, label, gastos, ingresos, balance: ingresos - gastos });
    }
    return result;
}

// --- Gastos recurrentes --------------------------------------------

function generateRecurringEntries(recurring, entries, month) {
    // recurring: array de { id, tipo, monto, categoria, descripcion, diaMes, fechaInicio, activo }
    // entries: array de entries existentes
    // month: 'YYYY-MM'
    // Devuelve array de entries a crear (sin id, se generan al guardar)

    if (!month || !recurring || recurring.length === 0) {
        return [];
    }

    const [year, mon] = month.split('-').map(Number);
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    const today = now.getUTCDate();

    // Solo generar para mes actual o pasado
    const isCurrentMonth = (year === currentYear && mon === currentMonth);
    const isPastMonth = (year < currentYear) || (year === currentYear && mon < currentMonth);
    if (!isCurrentMonth && !isPastMonth) {
        return [];
    }

    const result = [];

    recurring.forEach(r => {
        if (!r.activo) return;
        if (r.diaMes < 1 || r.diaMes > 28) return; // solo 1-28 para evitar problemas fin de mes

        // Verificar fecha inicio
        const [startYear, startMon] = r.fechaInicio.split('-').map(Number);
        if (year < startYear || (year === startYear && mon < startMon)) {
            return; // aún no empezó
        }

        // Verificar si ya existe entry para este recurrente en este mes
        const targetDate = `${year}-${String(mon).padStart(2, '0')}-${String(r.diaMes).padStart(2, '0')}`;
        const exists = entries.some(e =>
            e.tipo === r.tipo &&
            e.categoria === r.categoria &&
            e.monto === r.monto &&
            e.descripcion === r.descripcion &&
            e.fecha === targetDate
        );

        if (!exists) {
            result.push({
                tipo: r.tipo,
                monto: r.monto,
                categoria: r.categoria,
                descripcion: r.descripcion,
                fecha: targetDate
            });
        }
    });

    return result;
}

// --- Inline editing: parseo de datos desde inputs de fila -----------

function parseEntryFromRow(values) {
    // Extrae y valida los campos editables de una fila de la tabla.
    // values: { fecha, descripcion, monto }
    // Devuelve { fecha, descripcion, monto } o array de errores.
    const errors = [];
    const fecha = (values.fecha || '').trim();
    const descripcion = (values.descripcion || '').trim();
    const monto = values.monto;

    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(Date.parse(fecha))) {
        errors.push('Fecha no válida.');
    }
    if (monto === undefined || monto === null || monto === '' || Number(monto) <= 0 || !isFinite(Number(monto))) {
        errors.push('El monto tiene que ser mayor a 0.');
    }
    if (!descripcion) {
        errors.push('La descripción no puede estar vacía.');
    }

    if (errors.length > 0) {
        return { errors };
    }
    return { fecha, descripcion, monto: Number(monto) };
}

// --- Exports para vitest / Node.js --------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        EXPENSE_CATEGORIES,
        INCOME_CATEGORIES,
        getAllCategories,
        escapeHTML,
        formatAmount,
        todayISO,
        generateId,
        calculateBalance,
        filterEntries,
        validateEntry,
        getDaysInMonth,
        getDaysElapsedInMonth,
        calculateDailyAverage,
        calculateProjection,
        calculateComparison,
        calculateBudgetProgress,
        calculateMonthlyTrend,
        generateRecurringEntries,
        parseEntryFromRow
    };
}

// --- Backward compat para el navegador (window.*) -----------------

if (typeof window !== 'undefined') {
    window.EXPENSE_CATEGORIES = EXPENSE_CATEGORIES;
    window.INCOME_CATEGORIES = INCOME_CATEGORIES;
    window.getAllCategories = getAllCategories;
    window.escapeHTML = escapeHTML;
    window.formatAmount = formatAmount;
    window.todayISO = todayISO;
    window.generateId = generateId;
    window.calculateBalance = calculateBalance;
    window.filterEntries = filterEntries;
    window.validateEntry = validateEntry;
    window.getDaysInMonth = getDaysInMonth;
    window.getDaysElapsedInMonth = getDaysElapsedInMonth;
    window.calculateDailyAverage = calculateDailyAverage;
    window.calculateProjection = calculateProjection;
    window.calculateComparison = calculateComparison;
    window.calculateBudgetProgress = calculateBudgetProgress;
    window.calculateMonthlyTrend = calculateMonthlyTrend;
    window.generateRecurringEntries = generateRecurringEntries;
    window.parseEntryFromRow = parseEntryFromRow;
}
