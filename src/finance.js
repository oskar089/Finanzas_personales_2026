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

// --- Catálogo de monedas -------------------------------------------

const CURRENCIES = {
    EUR: { locale: 'es-ES', decimals: 2 },
    USD: { locale: 'en-US', decimals: 2 },
    GBP: { locale: 'en-GB', decimals: 2 },
    ARS: { locale: 'es-AR', decimals: 2 },
    MXN: { locale: 'es-MX', decimals: 2 },
    BRL: { locale: 'pt-BR', decimals: 2 },
    JPY: { locale: 'ja-JP', decimals: 0 },
    CHF: { locale: 'de-CH', decimals: 2 },
};

const BASE_CURRENCY = 'EUR';

// Config por defecto: sin ajustes ⇒ salida € + es-ES idéntica al legacy.
const DEFAULT_FORMAT = { displayCurrency: 'EUR', rate: 1, locale: 'es-ES', decimals: 2 };

// Cache de la config activa en memoria (lector síncrono para el formateador síncrono).
let activeFormat = { ...DEFAULT_FORMAT };

function setDisplayConfig(config) {
    // Normaliza contra el catálogo: código desconocido ⇒ EUR, rate ≤ 0 ⇒ 1.
    const cur = CURRENCIES[config?.displayCurrency] || CURRENCIES.EUR;
    activeFormat = {
        displayCurrency: CURRENCIES[config?.displayCurrency] ? config.displayCurrency : 'EUR',
        rate: Number(config?.rate) > 0 ? Number(config.rate) : 1,
        locale: cur.locale,
        decimals: cur.decimals,
    };
}

function getActiveFormat() {
    return activeFormat;
}

// Pura: amount * rate. rate ≤ 0 o NaN ⇒ passthrough (rate 1, equivale a EUR).
// Redondea a 9 decimales para eliminar el ruido de coma flotante (p. ej. 1500 * 1.1),
// sin afectar fracciones legítimas (nunca hay más de ~4 decimales en montos reales).
function convertAmount(amount, rate) {
    const r = Number(rate);
    return Math.round(Number(amount) * (r > 0 ? r : 1) * 1e9) / 1e9;
}

// Pura: valida el envoltorio JSON de Frankfurter ({ rates: { CAD: 1.5 } })
// para una moneda destino dada. Retorna la tasa como número si es finita y
// > 0; retorna null si el envoltorio es inválido o la tasa falta/es inválida.
function parseRateResponse(json, code) {
    if (!json || typeof json !== 'object' || !json.rates || typeof json.rates !== 'object') {
        return null;
    }
    const rate = Number(json.rates[code]);
    return (isFinite(rate) && rate > 0) ? rate : null;
}

// --- Funciones puras ----------------------------------------------

function getAllCategories() {
    // Unifica categorías de gasto e ingreso, sin duplicar 'Otro' y 'Varios'
    const set = new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]);
    return [...set];
}

function mergeCategories(baseList, customList) {
    // Unión deduplicada de categorías base y personalizadas del usuario.
    // Orden: base primero, luego personalizadas en orden de inserción.
    // Dedupe case-insensitive conservando el casing de la primera aparición.
    const result = [];
    const seen = new Set();
    [...(baseList || []), ...(customList || [])].forEach(cat => {
        const key = String(cat).toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(cat);
        }
    });
    return result;
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

function formatAmount(n, opts = {}) {
    // Formatea un monto en la moneda de visualización activa.
    // - Sin opts: usa la config cacheada (activeFormat). Sin ajustes guardados
    //   la salida es byte-idéntica al legacy '€' + es-ES.
    // - Con opts.currency: override explícito { currency, rate } (para tests / usos puntuales).
    const cfg = opts.currency
        ? { displayCurrency: opts.currency, rate: Number(opts.rate) > 0 ? Number(opts.rate) : 1, ...CURRENCIES[opts.currency] }
        : activeFormat;

    const num = Number(n);

    // Ruta legacy byte-idéntica: EUR + es-ES (fijada al string builder original).
    if (cfg.displayCurrency === 'EUR' && cfg.locale === 'es-ES') {
        if (isNaN(num)) return '€0,00';
        return '€' + num.toLocaleString('es-ES', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    // Ruta Intl para monedas no-EUR: convierte desde base (EUR) y aplica locale.
    const converted = convertAmount(isNaN(num) ? 0 : num, cfg.rate);
    return converted.toLocaleString(cfg.locale, {
        style: 'currency',
        currency: cfg.displayCurrency,
        minimumFractionDigits: cfg.decimals,
        maximumFractionDigits: cfg.decimals
    });
}

function todayISO() {
    // Devuelve la fecha de hoy en formato YYYY-MM-DD para el input date.
    // Usa hora local para que coincida con la zona horaria del usuario.
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
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
        .filter(e => e.tipo === 'expense')
        .reduce((acc, e) => acc + e.monto, 0);
    const totalSavings = entries
        .filter(e => e.tipo === 'savings')
        .reduce((acc, e) => acc + e.monto, 0);
    const balance = totalIncome - totalExpenses - totalSavings;
    return { totalIncome, totalExpenses, totalSavings, balance };
}

function filterEntries(entries, { type, category, monthFrom, monthTo, search } = {}) {
    const searchLower = search ? search.toLowerCase() : '';
    return entries.filter(e => {
        const passesType = !type || e.tipo === type;
        const passesCategory = !category || e.categoria === category;
        const passesMonthFrom = !monthFrom || e.fecha.substring(0, 7) >= monthFrom;
        const passesMonthTo = !monthTo || e.fecha.substring(0, 7) <= monthTo;
        const passesSearch = !searchLower ||
            (e.descripcion && e.descripcion.toLowerCase().includes(searchLower)) ||
            (e.categoria && e.categoria.toLowerCase().includes(searchLower));
        return passesType && passesCategory && passesMonthFrom && passesMonthTo && passesSearch;
    });
}

// Pura: convierte un string de monto con coma decimal (es-ES) a número.
// Normaliza ',' -> '.', trimea, y retorna Number(). Nunca lanza: retorna NaN si es inválido.
// Para string vacío retorna 0 (Number('') === 0), manteniendo el contrato actual de
// validateEntry/parseEntryFromRow que rechazan montos <= 0.
function parseAmount(value) {
    if (value === null || value === undefined) return NaN;
    const s = String(value).trim().replace(/,/g, '.');
    return Number(s);
}

function validateEntry({ tipo, amount, category, description } = {}) {
    const errors = [];
    if (!tipo || (tipo !== 'expense' && tipo !== 'income' && tipo !== 'savings')) {
        errors.push('Seleccioná un tipo válido.');
    }
    if (amount === undefined || amount === null || amount === '' || parseAmount(amount) <= 0) {
        errors.push('El monto tiene que ser mayor a 0.');
    }
    if (!category || !category.trim()) {
        errors.push('Ingresá una categoría.');
    }
    if (!description || !description.trim()) {
        errors.push('Agregá una descripción.');
    }
    return errors;
}

// --- Dashboard: funciones de métricas --------------------------------

function getDaysInMonth(year, month) {
    // month es 1-12 (usa UTC para consistencia con el resto del dashboard)
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
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

    // Mes anterior (usa UTC para consistencia)
    const prevDate = new Date(Date.UTC(year, mon - 2, 1));
    const prevYear = prevDate.getUTCFullYear();
    const prevMonth = String(prevDate.getUTCMonth() + 1).padStart(2, '0');
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
    // values: { fecha, tipo, categoria, subcategoria, descripcion, monto }
    // Devuelve los campos procesados o array de errores.
    const errors = [];
    const fecha = (values.fecha || '').trim();
    const tipo = (values.tipo || '').trim();
    const categoria = (values.categoria || '').trim();
    const subcategoria = (values.subcategoria || '').trim();
    const descripcion = (values.descripcion || '').trim();
    const monto = values.monto;

    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(Date.parse(fecha))) {
        errors.push('Fecha no válida.');
    }
    if (!tipo || (tipo !== 'expense' && tipo !== 'income' && tipo !== 'savings')) {
        errors.push('Tipo no válido.');
    }
    if (!categoria) {
        errors.push('La categoría no puede estar vacía.');
    }
    const montoParsed = parseAmount(monto);
    if (monto === undefined || monto === null || monto === '' || montoParsed <= 0 || !isFinite(montoParsed)) {
        errors.push('El monto tiene que ser mayor a 0.');
    }
    if (!descripcion) {
        errors.push('La descripción no puede estar vacía.');
    }

    if (errors.length > 0) {
        return { errors };
    }
    return { fecha, tipo, categoria, subcategoria, descripcion, monto: montoParsed };
}

// --- Exports para vitest / Node.js --------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        EXPENSE_CATEGORIES,
        INCOME_CATEGORIES,
        getAllCategories,
        mergeCategories,
        escapeHTML,
        formatAmount,
        todayISO,
        generateId,
        calculateBalance,
        filterEntries,
        validateEntry,
        parseAmount,
        getDaysInMonth,
        getDaysElapsedInMonth,
        calculateDailyAverage,
        calculateProjection,
        calculateComparison,
        calculateBudgetProgress,
        calculateMonthlyTrend,
        generateRecurringEntries,
        parseEntryFromRow,
        CURRENCIES,
        BASE_CURRENCY,
        DEFAULT_FORMAT,
        convertAmount,
        setDisplayConfig,
        getActiveFormat,
        parseRateResponse
    };
}

// --- Backward compat para el navegador (window.*) -----------------

if (typeof window !== 'undefined') {
    window.EXPENSE_CATEGORIES = EXPENSE_CATEGORIES;
    window.INCOME_CATEGORIES = INCOME_CATEGORIES;
    window.getAllCategories = getAllCategories;
    window.mergeCategories = mergeCategories;
    window.escapeHTML = escapeHTML;
    window.formatAmount = formatAmount;
    window.todayISO = todayISO;
    window.generateId = generateId;
    window.calculateBalance = calculateBalance;
    window.filterEntries = filterEntries;
    window.validateEntry = validateEntry;
    window.parseAmount = parseAmount;
    window.getDaysInMonth = getDaysInMonth;
    window.getDaysElapsedInMonth = getDaysElapsedInMonth;
    window.calculateDailyAverage = calculateDailyAverage;
    window.calculateProjection = calculateProjection;
    window.calculateComparison = calculateComparison;
    window.calculateBudgetProgress = calculateBudgetProgress;
    window.calculateMonthlyTrend = calculateMonthlyTrend;
    window.generateRecurringEntries = generateRecurringEntries;
    window.parseEntryFromRow = parseEntryFromRow;
    window.CURRENCIES = CURRENCIES;
    window.BASE_CURRENCY = BASE_CURRENCY;
    window.DEFAULT_FORMAT = DEFAULT_FORMAT;
    window.convertAmount = convertAmount;
    window.setDisplayConfig = setDisplayConfig;
    window.getActiveFormat = getActiveFormat;
    window.parseRateResponse = parseRateResponse;
}
