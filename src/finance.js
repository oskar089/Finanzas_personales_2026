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
    // Formato argentino: separador de miles con punto, decimales con coma.
    return '$' + Number(n).toLocaleString('es-AR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function todayISO() {
    // Devuelve la fecha de hoy en formato YYYY-MM-DD para el input date.
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
        .filter(e => e.tipo !== 'income')
        .reduce((acc, e) => acc + e.monto, 0);
    const balance = totalIncome - totalExpenses;
    return { totalIncome, totalExpenses, balance };
}

function filterEntries(entries, { type, category, month } = {}) {
    return entries.filter(e => {
        const passesType = !type || e.tipo === type;
        const passesCategory = !category || e.categoria === category;
        const passesMonth = !month || e.fecha.startsWith(month);
        return passesType && passesCategory && passesMonth;
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
    }
    if (!description || !description.trim()) {
        errors.push('Agregá una descripción.');
    }
    return errors;
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
        validateEntry
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
}
