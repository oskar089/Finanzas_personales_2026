// =====================================================================
// FINANZAS PERSONALES 2026 - Lógica de la app
// =====================================================================
// Decisiones de diseño:
// - Una sola fuente de verdad: el array `entries` en memoria.
// - localStorage se sincroniza en cada cambio (alta, baja o modificación).
// - La UI se re-renderiza completa desde el array, no por parche.
// - Datos legacy sin `tipo` se tratan como 'expense' (backward compat).
// =====================================================================

// --- Constantes ---------------------------------------------------

const STORAGE_KEY = 'finanzas:gastos:v1';
const DARK_MODE_KEY = 'finanzas:dark-mode';

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

function getAllCategories() {
    // Unifica categorías de gasto e ingreso, sin duplicar 'Otro' y 'Varios'
    const set = new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]);
    return [...set];
}

// --- Estado -------------------------------------------------------

let entries = [];           // fuente de verdad en memoria
let filterType = '';        // '' | 'expense' | 'income'
let filterCategory = '';    // '' = todas
let filterMonth = '';       // '' = todos, formato YYYY-MM
let editingId = null;       // null = nuevo, string = editando

// --- Persistencia -------------------------------------------------

function loadFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        entries = raw ? JSON.parse(raw) : [];
        // Backward compat: entries sin `tipo` son 'expense'
        entries = entries.map(e => ({ ...e, tipo: e.tipo || 'expense' }));
    } catch (err) {
        console.error('No se pudo leer localStorage, arrancamos vacíos.', err);
        entries = [];
    }
}

function saveToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// --- Helpers ------------------------------------------------------

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

// --- Auto-categorización con IA local (Ollama) -------------------

async function autoCategorize() {
    const desc = document.getElementById('description').value.trim();
    if (!desc) {
        alert('Escribí una descripción primero.');
        return;
    }

    const btn = document.getElementById('btnAutoCat');
    btn.disabled = true;
    btn.textContent = '🤔 Pensando...';

    const categories = getAllCategories().map(c => `"${c}"`).join(', ');

    try {
        const res = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gemma4',
                prompt: `Sos un asistente financiero. Clasificá este gasto o ingreso en UNA de estas categorías: ${categories}.
Descripción: "${desc}"
Respondé SOLO con el nombre exacto de la categoría, sin puntos ni explicaciones.`,
                stream: false,
                options: { temperature: 0.1, max_tokens: 20 }
            })
        });

        if (!res.ok) throw new Error(`Ollama respondió ${res.status}`);

        const data = await res.json();
        let suggestion = data.response.trim()
            .replace(/^["'*]+|["'*.]+$/g, '')    // saca comillas/asteriscos al inicio/fin
            .replace(/[.,;:!?]+$/, '');            // saca puntuación al final
        console.log('🧠 Gemma 4 respondió:', data.response, '→ Limpiado:', suggestion);

        // Buscar coincidencia exacta (case insensitive)
        const allCats = getAllCategories();
        const match = allCats.find(
            c => c.toLowerCase() === suggestion.toLowerCase()
        );

        if (match) {
            document.getElementById('category').value = match;
        } else {
            // Coincidencia parcial
            const partial = allCats.find(
                c => suggestion.toLowerCase().includes(c.toLowerCase()) || c.toLowerCase().includes(suggestion.toLowerCase())
            );
            if (partial) {
                document.getElementById('category').value = partial;
            } else {
                alert(`Gemma 4 sugirió "${suggestion}" pero no coincide con ninguna categoría.\nCategorías: ${allCats.join(', ')}`);
            }
        }
    } catch (err) {
        console.error('Error con Ollama:', err);
        alert('No se pudo conectar con Gemma 4. ¿Está corriendo Ollama? (ollama serve)');
    } finally {
        btn.disabled = false;
        btn.textContent = '🧠 Auto';
    }
}

// --- CRUD ---------------------------------------------------------

function addEntry({ tipo, amount, category, description, date }) {
    const newEntry = {
        id: generateId(),
        tipo,
        monto: Number(amount),
        categoria: category,
        descripcion: description.trim(),
        fecha: date
    };
    entries = [...entries, newEntry];
    saveToStorage();
    render();
}

function updateEntry({ id, tipo, amount, category, description, date }) {
    entries = entries.map(e =>
        e.id === id
            ? { ...e, tipo, monto: Number(amount), categoria: category, descripcion: description.trim(), fecha: date }
            : e
    );
    saveToStorage();
    render();
}

function deleteEntry(id) {
    if (!confirm('¿Borrar este movimiento?')) return;
    entries = entries.filter(e => e.id !== id);
    saveToStorage();
    render();
}

// --- Filtros ------------------------------------------------------

function applyFilters() {
    return entries.filter(e => {
        const passesType = !filterType || e.tipo === filterType;
        const passesCategory = !filterCategory || e.categoria === filterCategory;
        const passesMonth = !filterMonth || e.fecha.startsWith(filterMonth);
        return passesType && passesCategory && passesMonth;
    });
}

// --- Render: Formulario -------------------------------------------

function renderCategories() {
    const select = document.getElementById('category');
    const cats = getAllCategories();
    select.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
}

function enterEditMode(entry) {
    editingId = entry.id;
    document.getElementById('formTitle').textContent = 'Editar movimiento';
    document.getElementById('btnSubmit').textContent = 'Actualizar';
    document.getElementById('btnCancelEdit').classList.remove('d-none');

    // Setear tipo radio
    document.getElementById(entry.tipo === 'income' ? 'tipoIncome' : 'tipoExpense').checked = true;

    // Setear valores
    document.getElementById('amount').value = entry.monto;
    document.getElementById('category').value = entry.categoria;
    document.getElementById('description').value = entry.descripcion;
    document.getElementById('date').value = entry.fecha;

    // Scroll al formulario
    document.getElementById('expenseForm').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
    editingId = null;
    document.getElementById('formTitle').textContent = 'Cargar movimiento';
    document.getElementById('btnSubmit').textContent = 'Guardar';
    document.getElementById('btnCancelEdit').classList.add('d-none');
    document.getElementById('expenseForm').reset();
    document.getElementById('date').value = todayISO();
    document.getElementById('tipoExpense').checked = true;
}

// --- Render: Tabla ------------------------------------------------

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

    tbody.innerHTML = sorted.map(e => {
        const isIncome = e.tipo === 'income';
        const badgeClass = isIncome ? 'bg-success' : 'bg-danger';
        const badgeText = isIncome ? '💰 Ingreso' : '💸 Gasto';
        const montoClass = isIncome ? 'text-success fw-bold' : 'monto';

        return `
        <tr>
            <td>${escapeHTML(e.fecha)}</td>
            <td><span class="badge ${badgeClass}">${badgeText}</span></td>
            <td><span class="badge bg-secondary">${escapeHTML(e.categoria)}</span></td>
            <td>${e.descripcion ? escapeHTML(e.descripcion) : '<span class="text-muted">—</span>'}</td>
            <td class="text-end ${montoClass}">${isIncome ? '+' : '-'}${formatAmount(e.monto)}</td>
            <td class="text-end">
                <button class="btn btn-sm btn-outline-primary me-1" data-id="${escapeHTML(e.id)}" data-action="edit">
                    ✏️
                </button>
                <button class="btn btn-sm btn-outline-danger" data-id="${escapeHTML(e.id)}" data-action="delete">
                    🗑️
                </button>
            </td>
        </tr>`;
    }).join('');
}

// --- Render: Resumen ----------------------------------------------

function renderSummary() {
    const filtered = applyFilters();
    const totalIncome = filtered.filter(e => e.tipo === 'income').reduce((acc, e) => acc + e.monto, 0);
    const totalExpenses = filtered.filter(e => e.tipo !== 'income').reduce((acc, e) => acc + e.monto, 0);
    const balance = totalIncome - totalExpenses;

    document.getElementById('totalIncome').textContent = formatAmount(totalIncome);
    document.getElementById('totalExpenses').textContent = formatAmount(totalExpenses);

    const balanceEl = document.getElementById('totalBalance');
    balanceEl.textContent = formatAmount(Math.abs(balance));
    balanceEl.parentElement.className = 'card text-bg-' + (balance >= 0 ? 'success' : 'danger') + ' shadow-sm';

    document.getElementById('totalHeader').textContent =
        'Balance: ' + (balance >= 0 ? '' : '-') + formatAmount(Math.abs(balance));
}

// --- Render: Gráficos ---------------------------------------------

let chartExpenses = null;
let chartIncome = null;

function renderCharts() {
    const chartEmpty = document.getElementById('chartEmpty');
    const hasExpenses = entries.some(e => e.tipo !== 'income');
    const hasIncome = entries.some(e => e.tipo === 'income');

    if (entries.length === 0) {
        chartEmpty.classList.remove('d-none');
        document.getElementById('chartExpenses').classList.add('d-none');
        document.getElementById('chartIncome').classList.add('d-none');
        return;
    }

    chartEmpty.classList.add('d-none');
    document.getElementById('chartExpenses').classList.remove('d-none');
    document.getElementById('chartIncome').classList.remove('d-none');

    // Destruir charts anteriores
    if (chartExpenses) { chartExpenses.destroy(); chartExpenses = null; }
    if (chartIncome) { chartIncome.destroy(); chartIncome = null; }

    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--bs-border-color').trim() || '#dee2e6';

    function buildPieData(entries, tipo) {
        const filtered = entries.filter(e => e.tipo === tipo);
        const map = {};
        filtered.forEach(e => { map[e.categoria] = (map[e.categoria] || 0) + e.monto; });
        const labels = Object.keys(map);
        const data = Object.values(map);
        const colors = [
            '#dc3545', '#fd7e14', '#ffc107', '#198754', '#0d6efd', '#6f42c1',
            '#e83e8c', '#20c997', '#17a2b8', '#6610f2'
        ];
        return {
            labels,
            datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth: 1, borderColor: gridColor }]
        };
    }

    const ctxExpenses = document.getElementById('chartExpenses').getContext('2d');
    const ctxIncome = document.getElementById('chartIncome').getContext('2d');

    if (hasExpenses) {
        chartExpenses = new Chart(ctxExpenses, {
            type: 'doughnut',
            data: buildPieData(entries, 'expense'),
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom', labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--bs-body-color').trim() || '#212529' } }
                }
            }
        });
    }

    if (hasIncome) {
        chartIncome = new Chart(ctxIncome, {
            type: 'doughnut',
            data: buildPieData(entries, 'income'),
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'bottom', labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--bs-body-color').trim() || '#212529' } }
                }
            }
        });
    }
}

// --- Modo oscuro --------------------------------------------------

function loadDarkMode() {
    const saved = localStorage.getItem(DARK_MODE_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return saved !== null ? saved === 'dark' : prefersDark;
}

function applyDarkMode(dark) {
    document.documentElement.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
    document.getElementById('btnDarkMode').textContent = dark ? '☀️' : '🌙';
    localStorage.setItem(DARK_MODE_KEY, dark ? 'dark' : 'light');
}

function toggleDarkMode() {
    const current = document.documentElement.getAttribute('data-bs-theme');
    const dark = current !== 'dark';
    applyDarkMode(dark);
    // Re-render charts con nuevos colores
    renderCharts();
}

// --- Render principal ---------------------------------------------

function render() {
    renderTable();
    renderSummary();
    renderCharts();
}

// --- Exportar a CSV ----------------------------------------------

function exportCSV() {
    if (entries.length === 0) {
        alert('No hay movimientos para exportar.');
        return;
    }

    const lines = ['Fecha,Tipo,Categoria,Descripcion,Monto'];

    const sorted = [...entries].sort((a, b) => a.fecha.localeCompare(b.fecha));
    sorted.forEach(e => {
        const desc = `"${(e.descripcion || '').replace(/"/g, '""')}"`;
        const sign = e.tipo === 'income' ? '' : '-';
        lines.push(`${e.fecha},${e.tipo},${e.categoria},${desc},${sign}${e.monto.toFixed(2)}`);
    });

    const csv = '\ufeff' + lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `finanzas-${todayISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- Exportar / Importar JSON ------------------------------------

function exportJSON() {
    if (entries.length === 0) {
        alert('No hay movimientos para exportar.');
        return;
    }

    const data = {
        version: 2,
        exportedAt: todayISO(),
        entries
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `finanzas-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importJSON(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);

            // Validar estructura
            if (!data.entries || !Array.isArray(data.entries)) {
                alert('El archivo no tiene datos válidos. Tiene que ser un JSON exportado desde esta app.');
                return;
            }

            const incoming = data.entries.map(entry => ({
                ...entry,
                tipo: entry.tipo || 'expense'
            }));

            if (incoming.length === 0) {
                alert('El archivo no contiene movimientos.');
                return;
            }

            const msg = `¿Reemplazar todos los datos actuales (${entries.length} movimientos) con los del archivo (${incoming.length} movimientos)?`;
            if (!confirm(msg)) return;

            entries = incoming;
            saveToStorage();
            render();
            alert(`Importados ${incoming.length} movimientos correctamente.`);
        } catch (err) {
            alert('Error al leer el archivo. Asegurate de que sea un JSON válido exportado desde esta app.');
            console.error('Import error:', err);
        }
    };
    reader.readAsText(file);
}

// --- Eventos ------------------------------------------------------

function init() {
    loadFromStorage();

    // Fecha de hoy por defecto
    document.getElementById('date').value = todayISO();

    // Cargar categorías en los <select>
    renderCategories();

    // Modo oscuro inicial
    applyDarkMode(loadDarkMode());

    // Render inicial
    render();

    // Submit del formulario (alta o edición)
    document.getElementById('expenseForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const tipo = document.querySelector('input[name="tipo"]:checked').value;
        const amount = document.getElementById('amount').value;
        const category = document.getElementById('category').value;
        const description = document.getElementById('description').value;
        const date = document.getElementById('date').value;

        if (!amount || Number(amount) <= 0) {
            alert('El monto tiene que ser mayor a 0.');
            return;
        }

        if (editingId) {
            updateEntry({ id: editingId, tipo, amount, category, description, date });
            cancelEdit();
        } else {
            addEntry({ tipo, amount, category, description, date });
        }

        e.target.reset();
        document.getElementById('date').value = todayISO();
        document.getElementById('tipoExpense').checked = true;
    });

    // Cancelar edición
    document.getElementById('btnCancelEdit').addEventListener('click', cancelEdit);

    // Auto-categorizar con IA
    document.getElementById('btnAutoCat').addEventListener('click', autoCategorize);

    // Filtros
    document.getElementById('filterType').addEventListener('change', (e) => {
        filterType = e.target.value;
        render();
    });
    document.getElementById('filterCategory').addEventListener('change', (e) => {
        filterCategory = e.target.value;
        render();
    });
    document.getElementById('filterMonth').addEventListener('change', (e) => {
        filterMonth = e.target.value;
        render();
    });
    document.getElementById('btnClearFilters').addEventListener('click', () => {
        filterType = '';
        filterCategory = '';
        filterMonth = '';
        document.getElementById('filterType').value = '';
        document.getElementById('filterCategory').value = '';
        document.getElementById('filterMonth').value = '';
        render();
    });

    // Acciones en la tabla (editar, borrar)
    document.getElementById('expensesTable').addEventListener('click', (e) => {
        const editBtn = e.target.closest('button[data-action="edit"]');
        const deleteBtn = e.target.closest('button[data-action="delete"]');

        if (editBtn) {
            const entry = entries.find(entry => entry.id === editBtn.dataset.id);
            if (entry) enterEditMode(entry);
        }
        if (deleteBtn) {
            deleteEntry(deleteBtn.dataset.id);
        }
    });

    // Modo oscuro
    document.getElementById('btnDarkMode').addEventListener('click', toggleDarkMode);

    // Exportar CSV
    document.getElementById('btnExportCSV').addEventListener('click', exportCSV);

    // Exportar JSON
    document.getElementById('btnExportJSON').addEventListener('click', exportJSON);

    // Importar JSON
    document.getElementById('btnImportJSON').addEventListener('click', () => {
        document.getElementById('fileInputJSON').click();
    });
    document.getElementById('fileInputJSON').addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            importJSON(e.target.files[0]);
            e.target.value = ''; // permitir re-importar el mismo archivo
        }
    });
}

// Arranca cuando el DOM está listo
document.addEventListener('DOMContentLoaded', init);
