// =====================================================================
// FINANZAS PERSONALES 2026 - Lógica de la app
// =====================================================================
// Decisiones de diseño:
// - Una sola fuente de verdad: el array `expenses` en memoria.
// - localStorage se sincroniza en cada cambio (alta o baja).
// - La UI se re-renderiza completa desde el array, no por parche.
// - Categorías centralizadas en una constante para no hardcodear.
// =====================================================================

// --- Constantes ---------------------------------------------------

const STORAGE_KEY = 'finanzas:gastos:v1';

const CATEGORIES = [
    'Comida',
    'Transporte',
    'Hogar',
    'Ocio',
    'Salud',
    'Otro'
];

// --- Estado -------------------------------------------------------

let expenses = [];          // fuente de verdad en memoria
let filterCategory = '';    // '' = todas
let filterMonth = '';       // '' = todos, formato YYYY-MM

// --- Persistencia -------------------------------------------------

function loadFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        expenses = raw ? JSON.parse(raw) : [];
    } catch (err) {
        console.error('No se pudo leer localStorage, arrancamos vacíos.', err);
        expenses = [];
    }
}

function saveToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
}

// --- Helpers ------------------------------------------------------

function escapeHTML(str) {
    // Escapa caracteres que rompen innerHTML cuando vienen de input del usuario.
    // Importante si en el futuro se sincroniza con servicios externos o se importa CSV.
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatAmount(n) {
    // Formato argentino: separador de miles con punto, decimales con coma.
    // toLocaleString maneja locales y casos borde mejor que regex encadenadas.
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

// --- Altas, bajas, modificaciones ---------------------------------

function addExpense({ amount, category, description, date }) {
    const newExpense = {
        id: generateId(),
        monto: Number(amount),
        categoria: category,
        descripcion: description.trim(),
        fecha: date
    };
    expenses = [...expenses, newExpense];
    saveToStorage();
    render();
}

function deleteExpense(id) {
    if (!confirm('¿Borrar este gasto?')) return;
    expenses = expenses.filter(e => e.id !== id);
    saveToStorage();
    render();
}

// --- Filtros ------------------------------------------------------

function applyFilters() {
    return expenses.filter(e => {
        const passesCategory = !filterCategory || e.categoria === filterCategory;
        const passesMonth = !filterMonth || e.fecha.startsWith(filterMonth);
        return passesCategory && passesMonth;
    });
}

// --- Render -------------------------------------------------------

function renderCategories() {
    const select = document.getElementById('category');
    const filter = document.getElementById('filterCategory');

    // Carga el <select> del formulario
    select.innerHTML = CATEGORIES
        .map(c => `<option value="${c}">${c}</option>`)
        .join('');

    // Carga el <select> del filtro, agregando "Todas" como primera opción
    filter.innerHTML =
        '<option value="">Todas</option>' +
        CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderTable() {
    const tbody = document.getElementById('expensesTable');
    const emptyMessage = document.getElementById('emptyMessage');
    const filtered = applyFilters();

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        emptyMessage.classList.remove('d-none');
        return;
    }

    emptyMessage.classList.add('d-none');

    // Ordenamos por fecha descendente (más reciente arriba)
    const sorted = [...filtered].sort((a, b) => b.fecha.localeCompare(a.fecha));

    tbody.innerHTML = sorted.map(e => `
        <tr>
            <td>${escapeHTML(e.fecha)}</td>
            <td><span class="badge bg-secondary">${escapeHTML(e.categoria)}</span></td>
            <td>${e.descripcion ? escapeHTML(e.descripcion) : '<span class="text-muted">—</span>'}</td>
            <td class="text-end monto">${formatAmount(e.monto)}</td>
            <td class="text-end">
                <button class="btn btn-sm btn-outline-danger" data-id="${escapeHTML(e.id)}" data-action="delete">
                    Borrar
                </button>
            </td>
        </tr>
    `).join('');
}

function renderSummary() {
    const filtered = applyFilters();
    const total = filtered.reduce((acc, e) => acc + e.monto, 0);
    const count = filtered.length;
    const average = count ? total / count : 0;

    document.getElementById('totalMonth').textContent = formatAmount(total);
    document.getElementById('expenseCount').textContent = count;
    document.getElementById('expenseAverage').textContent = formatAmount(average);
    document.getElementById('totalHeader').textContent = 'Total: ' + formatAmount(total);
}

function render() {
    renderTable();
    renderSummary();
}

// --- Exportar a CSV ----------------------------------------------

function exportCSV() {
    if (expenses.length === 0) {
        alert('No hay gastos para exportar.');
        return;
    }

    // Cabecera
    const lines = ['Fecha,Categoria,Descripcion,Monto'];

    // Cuerpo: ordenamos por fecha para que el Excel quede prolijo
    const sorted = [...expenses].sort((a, b) => a.fecha.localeCompare(b.fecha));
    sorted.forEach(e => {
        // Escapamos comas y comillas en la descripción
        const desc = `"${(e.descripcion || '').replace(/"/g, '""')}"`;
        lines.push(`${e.fecha},${e.categoria},${desc},${e.monto.toFixed(2)}`);
    });

    // Forzamos BOM al inicio para que Excel reconozca acentos
    const csv = '\ufeff' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `gastos-${todayISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- Eventos ------------------------------------------------------

function init() {
    loadFromStorage();

    // Fecha de hoy por defecto en el input
    document.getElementById('date').value = todayISO();

    // Cargar categorías en los <select>
    renderCategories();

    // Render inicial
    render();

    // Submit del formulario
    document.getElementById('expenseForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = document.getElementById('amount').value;
        const category = document.getElementById('category').value;
        const description = document.getElementById('description').value;
        const date = document.getElementById('date').value;

        if (!amount || Number(amount) <= 0) {
            alert('El monto tiene que ser mayor a 0.');
            return;
        }

        addExpense({ amount, category, description, date });
        e.target.reset();
        document.getElementById('date').value = todayISO();
    });

    // Filtros
    document.getElementById('filterCategory').addEventListener('change', (e) => {
        filterCategory = e.target.value;
        render();
    });
    document.getElementById('filterMonth').addEventListener('change', (e) => {
        filterMonth = e.target.value;
        render();
    });
    document.getElementById('btnClearFilters').addEventListener('click', () => {
        filterCategory = '';
        filterMonth = '';
        document.getElementById('filterCategory').value = '';
        document.getElementById('filterMonth').value = '';
        render();
    });

    // Borrar (delegación de eventos en la tabla)
    document.getElementById('expensesTable').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action="delete"]');
        if (btn) deleteExpense(btn.dataset.id);
    });

    // Exportar CSV
    document.getElementById('btnExport').addEventListener('click', exportCSV);
}

// Arranca cuando el DOM está listo
document.addEventListener('DOMContentLoaded', init);
