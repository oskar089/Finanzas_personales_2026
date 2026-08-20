// =====================================================================
// FINANZAS PERSONALES 2026 - Lógica de la app
// =====================================================================
// Decisiones de diseño:
// - Una sola fuente de verdad: el array `entries` en memoria.
// - localStorage se sincroniza en cada cambio (alta, baja o modificación).
// - La UI se re-renderiza completa desde el array, no por parche.
// - Datos legacy sin `tipo` se tratan como 'expense' (backward compat).
// - Las funciones puras viven en src/finance.js y se exponen via window.*.
// =====================================================================

// --- Constantes ---------------------------------------------------

const STORAGE_KEY = 'finanzas:gastos:v1';
const DARK_MODE_KEY = 'finanzas:dark-mode';

// --- Estado -------------------------------------------------------

let entries = [];           // fuente de verdad en memoria
let filterType = '';        // '' | 'expense' | 'income'
let filterCategory = '';    // '' = todas
let filterMonth = '';       // '' = todos, formato YYYY-MM
let filterSearch = '';      // búsqueda en descripción/categoría
let editingId = null;       // null = nuevo, string = editando
let inlineEditingId = null; // null = sin edición inline, string = ID de la fila en edición
let inlineEditField = null; // null = edición de fila completa, string = campo individual
let searchDebounceTimer = null;

// --- Persistencia -------------------------------------------------

async function loadFromStorage() {
    try {
        entries = await storage.load();
    } catch (err) {
        console.error('No se pudo leer storage, arrancamos vacíos.', err);
        entries = [];
    }
}

async function saveToStorage() {
    await storage.save(entries);
}

// --- Auto-categorización con IA local (Ollama) -------------------

async function autoCategorize() {
    const desc = document.getElementById('description').value.trim();
    if (!desc) {
        toast.showWarning('Escribí una descripción primero.');
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
                toast.showWarning(`Gemma 4 sugirió "${suggestion}" pero no coincide con ninguna categoría. Categorías: ${allCats.join(', ')}`);
            }
        }
    } catch (err) {
        console.error('Error con Ollama:', err);
        toast.showError('No se pudo conectar con Gemma 4. ¿Está corriendo Ollama? (ollama serve)');
    } finally {
        btn.disabled = false;
        btn.textContent = '🧠 Auto';
    }
}

// --- CRUD ---------------------------------------------------------

async function addEntry({ tipo, amount, category, description, date }) {
    const newEntry = {
        id: generateId(),
        tipo,
        monto: Number(amount),
        categoria: category,
        descripcion: description.trim(),
        fecha: date
    };
    entries = [...entries, newEntry];
    await saveToStorage();
    render();
}

async function updateEntry({ id, tipo, amount, category, description, date }) {
    entries = entries.map(e =>
        e.id === id
            ? { ...e, tipo, monto: Number(amount), categoria: category, descripcion: description.trim(), fecha: date }
            : e
    );
    await saveToStorage();
    render();
}

async function deleteEntry(id) {
    if (!confirm('¿Borrar este movimiento?')) return;
    entries = entries.filter(e => e.id !== id);
    await saveToStorage();
    render();
}

// --- Filtros ------------------------------------------------------

function getFilteredEntries() {
    return filterEntries(entries, {
        type: filterType,
        category: filterCategory,
        month: filterMonth,
        search: filterSearch
    });
}

// --- Render: Formulario -------------------------------------------

function renderCategories() {
    const select = document.getElementById('category');
    const filterSelect = document.getElementById('filterCategory');
    const cats = getAllCategories();
    const options = cats.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
    select.innerHTML = options;
    // El filtro de categoría arranca con la opción "Todas"
    filterSelect.innerHTML = '<option value="">Todas</option>' + options;
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

// --- Edición inline en la tabla ------------------------------------

// Cancela la edición inline y re-renderiza la tabla
function cancelInlineEdit() {
    inlineEditingId = null;
    inlineEditField = null;
    renderTable();
}

// Guarda los valores de los inputs inline en la entry correspondiente
async function saveInlineEdit(entryId) {
    const row = document.querySelector(`tr[data-entry-id="${entryId}"]`);
    if (!row) return;

    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;

    // Extraer valores de los inputs de la fila
    const fechaInput = row.querySelector('.inline-edit-fecha');
    const descInput = row.querySelector('.inline-edit-descripcion');
    const montoInput = row.querySelector('.inline-edit-monto');

    const values = {
        fecha: fechaInput ? fechaInput.value : entry.fecha,
        descripcion: descInput ? descInput.value : entry.descripcion,
        monto: montoInput ? montoInput.value : entry.monto
    };

    const result = parseEntryFromRow(values);

    if (result.errors) {
        toast.showError(result.errors[0]);
        return;
    }

    // Actualizar entry de forma inmutable
    entries = entries.map(e =>
        e.id === entryId
            ? { ...e, fecha: result.fecha, descripcion: result.descripcion, monto: result.monto }
            : e
    );

    inlineEditingId = null;
    inlineEditField = null;

    await saveToStorage();
    render();
}

// Genera el HTML para una celda editable (input inline)
function renderEditableCell(entry, field, value) {
    const inputType = field === 'fecha' ? 'date' : field === 'monto' ? 'number' : 'text';
    const stepAttr = field === 'monto' ? ' step="0.01" min="0"' : '';
    const maxlengthAttr = field === 'descripcion' ? ' maxlength="100"' : '';
    const inputClass = field === 'monto' ? 'form-control form-control-sm text-end' : 'form-control form-control-sm';
    return `<input type="${inputType}" class="${inputClass} inline-edit-${field}" value="${field === 'monto' ? entry.monto : escapeHTML(value || '')}"${stepAttr}${maxlengthAttr} data-field="${field}" data-entry-id="${entry.id}">`;
}

// Inicia edición inline de una celda individual
function startInlineCellEdit(entryId, field) {
    inlineEditingId = entryId;
    inlineEditField = field;
    renderTable();
    // Enfocar el input recién creado
    const input = document.querySelector(`.inline-edit-${field}[data-entry-id="${entryId}"]`);
    if (input) {
        input.focus();
        input.select();
    }
}

// Inicia edición inline de toda la fila
function startInlineRowEdit(entryId) {
    inlineEditingId = entryId;
    inlineEditField = null;
    renderTable();
    // Enfocar el primer input (fecha)
    const firstInput = document.querySelector(`tr[data-entry-id="${entryId}"] .inline-edit-fecha`);
    if (firstInput) firstInput.focus();
}

// --- Render: Tabla ------------------------------------------------

function renderTable() {
    const tbody = document.getElementById('expensesTable');
    const emptyMessage = document.getElementById('emptyMessage');
    const filtered = getFilteredEntries();

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        emptyMessage.classList.remove('d-none');
        return;
    }

    emptyMessage.classList.add('d-none');

    // Ordenamos por fecha descendente (más reciente arriba)
    const sorted = [...filtered].sort((a, b) => b.fecha.localeCompare(a.fecha));

    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const budgetProgress = calculateBudgetProgress(entries, budgets, currentMonth);
    const budgetMap = Object.fromEntries(budgetProgress.map(p => [p.categoria, p]));

    tbody.innerHTML = sorted.map(e => {
        const isIncome = e.tipo === 'income';
        const badgeClass = isIncome ? 'bg-success' : 'bg-danger';
        const badgeText = isIncome ? '💰 Ingreso' : '💸 Gasto';
        const montoClass = isIncome ? 'text-success fw-bold' : 'monto';

        // Determinar si esta fila está en modo edición inline
        const isInlineEditing = inlineEditingId === e.id;
        const isSingleField = isInlineEditing && inlineEditField !== null;
        const isRowEdit = isInlineEditing && inlineEditField === null;

        // Budget badge para gastos
        let catBadge = `<span class="badge bg-secondary">${escapeHTML(e.categoria)}</span>`;
        if (!isIncome && budgetMap[e.categoria]) {
            const bp = budgetMap[e.categoria];
            let badgeCls = 'bg-success';
            if (bp.estado === 'advertencia') badgeCls = 'bg-warning text-dark';
            else if (bp.estado === 'excedido') badgeCls = 'bg-danger';
            catBadge = `<span class="badge ${badgeCls}" title="${bp.porcentaje}% usado">${escapeHTML(e.categoria)}</span>`;
        }

        // Celda de fecha: editable si edición inline activa
        const fechaCell = isRowEdit || (isSingleField && inlineEditField === 'fecha')
            ? renderEditableCell(e, 'fecha', e.fecha)
            : escapeHTML(e.fecha);

        // Celda de descripción: editable si edición inline activa
        const descCell = isRowEdit || (isSingleField && inlineEditField === 'descripcion')
            ? renderEditableCell(e, 'descripcion', e.descripcion)
            : (e.descripcion ? escapeHTML(e.descripcion) : '<span class="text-muted">—</span>');

        // Celda de monto: editable si edición inline activa
        const montoCell = isRowEdit || (isSingleField && inlineEditField === 'monto')
            ? renderEditableCell(e, 'monto', e.monto)
            : `${isIncome ? '+' : '-'}${formatAmount(e.monto)}`;

        // Clases para celdas en modo edición inline
        const editCls = isInlineEditing ? ' inline-editing' : '';

        return `
        <tr data-entry-id="${escapeHTML(e.id)}">
            <td class="${isInlineEditing ? 'inline-editing' : ''}">${fechaCell}</td>
            <td><span class="badge ${badgeClass}">${badgeText}</span></td>
            <td>${catBadge}</td>
            <td>${descCell}</td>
            <td class="text-end ${montoClass}${editCls}">${montoCell}</td>
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
    const filtered = getFilteredEntries();
    const { totalIncome, totalExpenses, balance } = calculateBalance(filtered);

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

// --- Render: Dashboard ----------------------------------------------

function renderDashboard() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const currentMonth = `${year}-${String(month).padStart(2, '0')}`;
    const daysLeft = getDaysInMonth(year, month) - now.getUTCDate();

    const avg = calculateDailyAverage(entries, currentMonth);
    const projection = calculateProjection(entries, currentMonth);
    const comparison = calculateComparison(entries, currentMonth);

    document.getElementById('dashAvgDaily').textContent = formatAmount(avg);
    document.getElementById('dashProjection').textContent = formatAmount(projection);

    // Comparativa
    const compEl = document.getElementById('dashComparison');
    if (comparison.prevExpenses === 0 && comparison.currentExpenses === 0) {
        compEl.textContent = '—';
        compEl.className = 'h4 mb-0 text-muted';
    } else if (comparison.prevExpenses === 0) {
        compEl.textContent = formatAmount(comparison.currentExpenses);
        compEl.className = 'h4 mb-0 text-danger';
    } else {
        const sign = comparison.delta >= 0 ? '+' : '';
        const pct = comparison.percent.toFixed(1);
        compEl.textContent = `${sign}${pct}%`;
        compEl.className = 'h4 mb-0 ' + (comparison.delta <= 0 ? 'text-success' : 'text-danger');
    }

    document.getElementById('dashDaysLeft').textContent = daysLeft;
}

// --- Render: Gráfico de tendencia -----------------------------------

let chartTrend = null;

function renderTrendChart() {
    const canvas = document.getElementById('chartTrend');
    const emptyEl = document.getElementById('trendEmpty');
    const trend = calculateMonthlyTrend(entries, 12);

    const hasData = trend.some(t => t.gastos > 0 || t.ingresos > 0);

    if (!hasData) {
        canvas.classList.add('d-none');
        emptyEl.classList.remove('d-none');
        if (chartTrend) { chartTrend.destroy(); chartTrend = null; }
        return;
    }

    emptyEl.classList.add('d-none');
    canvas.classList.remove('d-none');

    const gridColor = getComputedStyle(document.documentElement).getPropertyValue('--bs-border-color').trim() || '#dee2e6';
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--bs-body-color').trim() || '#212529';

    const labels = trend.map(t => t.label);
    const gastos = trend.map(t => t.gastos);
    const ingresos = trend.map(t => t.ingresos);

    if (chartTrend) { chartTrend.destroy(); chartTrend = null; }

    const ctx = canvas.getContext('2d');
    chartTrend = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Gastos',
                    data: gastos,
                    borderColor: '#dc3545',
                    backgroundColor: 'rgba(220, 53, 69, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointHoverRadius: 6
                },
                {
                    label: 'Ingresos',
                    data: ingresos,
                    borderColor: '#198754',
                    backgroundColor: 'rgba(25, 135, 84, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 4,
                    pointHoverRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { color: textColor } },
                tooltip: {
                    callbacks: {
                        label: (context) => `${context.dataset.label}: ${formatAmount(context.raw)}`
                    }
                }
            },
            scales: {
                x: { grid: { color: gridColor }, ticks: { color: textColor } },
                y: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, callback: v => formatAmount(v) },
                    beginAtZero: true
                }
            }
        }
    });
}

let budgets = {}; // { categoria: monto }

async function loadBudgets() {
    try {
        budgets = await storage.loadBudgets() || {};
    } catch {
        budgets = {};
    }
}

function renderBudgets() {
    const container = document.getElementById('budgetsContainer');
    const emptyEl = document.getElementById('budgetsEmpty');
    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    const progress = calculateBudgetProgress(entries, budgets, currentMonth);

    if (progress.length === 0) {
        container.innerHTML = '';
        emptyEl.classList.remove('d-none');
        return;
    }

    emptyEl.classList.add('d-none');
    container.innerHTML = progress.map(p => {
        const pct = p.porcentaje;
        let badgeClass = 'bg-success';
        if (p.estado === 'advertencia') badgeClass = 'bg-warning text-dark';
        else if (p.estado === 'excedido') badgeClass = 'bg-danger';
        return `
        <div class="col-md-4 col-6">
            <div class="card">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="badge bg-secondary">${escapeHTML(p.categoria)}</span>
                        <span class="badge ${badgeClass}">${p.estado.toUpperCase()}</span>
                    </div>
                    <div class="progress mb-1" style="height: 8px;">
                        <div class="progress-bar ${badgeClass}" role="progressbar" style="width: ${Math.min(pct, 100)}%"></div>
                    </div>
                    <small class="text-muted">${formatAmount(p.actual)} / ${formatAmount(p.presupuesto)} (${pct}%)</small>
                </div>
            </div>
        </div>`;
    }).join('');
}

function setupBudgetModal() {
    const formFields = document.getElementById('budgetFormFields');
    const saveBtn = document.getElementById('btnSaveBudgets');

    // Llenar formulario con todas las categorías
    const allCats = getAllCategories();
    formFields.innerHTML = allCats.map(cat => {
        const value = budgets[cat] || '';
        return `
        <div class="col-md-6">
            <label class="form-label">${escapeHTML(cat)}</label>
            <div class="input-group">
                <span class="input-group-text">€</span>
                <input type="number" class="form-control budget-input" data-category="${escapeHTML(cat)}" step="0.01" min="0" value="${value}" placeholder="Sin límite">
            </div>
        </div>`;
    }).join('');

    // Guardar
    saveBtn.onclick = async () => {
        const inputs = document.querySelectorAll('.budget-input');
        const newBudgets = {};
        inputs.forEach(input => {
            const cat = input.dataset.category;
            const val = input.value;
            if (val && Number(val) > 0) {
                newBudgets[cat] = Number(val);
            }
        });
        budgets = newBudgets;
        await storage.saveBudgets(budgets);
        renderBudgets();
        render(); // actualiza badges en tabla
        bootstrap.Modal.getInstance(document.getElementById('budgetModal')).hide();
    };
}

// --- Recurrentes ----------------------------------------------------

let recurring = []; // array de { id, tipo, monto, categoria, descripcion, diaMes, fechaInicio, activo }

async function loadRecurring() {
    try {
        recurring = await storage.loadRecurring() || [];
    } catch {
        recurring = [];
    }
}

// Verificar y generar recurrentes para el mes actual
async function checkAndGenerateRecurring() {
    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    const toCreate = generateRecurringEntries(recurring, entries, currentMonth);

    for (const entry of toCreate) {
        addEntry(entry);
    }

    if (toCreate.length > 0) {
        console.log(`Generados ${toCreate.length} movimientos recurrentes para ${currentMonth}`);
    }
}

function renderRecurring() {
    const container = document.getElementById('recurringContainer');
    const emptyEl = document.getElementById('recurringEmpty');

    if (recurring.length === 0) {
        container.innerHTML = '';
        emptyEl.classList.remove('d-none');
        return;
    }

    emptyEl.classList.add('d-none');
    container.innerHTML = recurring.map(r => {
        const tipoBadge = r.tipo === 'income' ? 'bg-success' : 'bg-danger';
        const tipoText = r.tipo === 'income' ? '💰 Ingreso' : '💸 Gasto';
        const activoBadge = r.activo ? 'bg-success' : 'bg-secondary';
        const activoText = r.activo ? 'Activo' : 'Inactivo';

        return `
        <div class="col-md-6 col-lg-4">
            <div class="card">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <span class="badge ${tipoBadge}">${tipoText}</span>
                        <span class="badge ${activoBadge}">${activoText}</span>
                    </div>
                    <h6 class="mb-1">${escapeHTML(r.descripcion)}</h6>
                    <small class="text-muted">${escapeHTML(r.categoria)} • Día ${r.diaMes} • ${formatAmount(r.monto)}</small>
                    <div class="btn-group btn-group-sm mt-2 w-100">
                        <button type="button" class="btn btn-outline-secondary toggle-recurring" data-id="${r.id}" data-activo="${r.activo}">
                            ${r.activo ? 'Pausar' : 'Activar'}
                        </button>
                        <button type="button" class="btn btn-outline-danger delete-recurring" data-id="${r.id}">
                            Eliminar
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');

    // Event listeners
    document.querySelectorAll('.toggle-recurring').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.dataset.id;
            const r = recurring.find(x => x.id === id);
            if (r) {
                recurring = recurring.map(x =>
                    x.id === id ? { ...x, activo: !x.activo } : x
                );
                await storage.saveRecurring(recurring);
                renderRecurring();
            }
        });
    });

    document.querySelectorAll('.delete-recurring').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.dataset.id;
            if (confirm('¿Eliminar este recurrente?')) {
                recurring = recurring.filter(x => x.id !== id);
                await storage.saveRecurring(recurring);
                renderRecurring();
            }
        });
    });
}

function setupRecurringModal() {
    const addBtn = document.getElementById('btnAddRecurring');
    const list = document.getElementById('recurringList');

    addBtn.onclick = () => {
        const div = document.createElement('div');
        div.className = 'col-12 recurring-form';
        div.innerHTML = `
            <div class="card p-3">
                <h6 class="mb-3">Nuevo recurrente</h6>
                <div class="row g-3">
                    <div class="col-md-6">
                        <label class="form-label">Tipo</label>
                        <select class="form-select rec-tipo">
                            <option value="expense">💸 Gasto</option>
                            <option value="income">💰 Ingreso</option>
                        </select>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">Monto</label>
                        <div class="input-group">
                            <span class="input-group-text">€</span>
                            <input type="number" class="form-control rec-monto" step="0.01" min="0" required>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">Categoría</label>
                        <select class="form-select rec-categoria" required>
                            <option value="">Seleccioná...</option>
                            ${getAllCategories().map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">Descripción</label>
                        <input type="text" class="form-control rec-descripcion" maxlength="100" required placeholder="Ej: Alquiler, Netflix, Sueldo">
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">Día del mes (1-28)</label>
                        <input type="number" class="form-control rec-diaMes" min="1" max="28" value="1" required>
                    </div>
                    <div class="col-md-6">
                        <label class="form-label">Fecha inicio</label>
                        <input type="month" class="form-control rec-fechaInicio" value="${todayISO().slice(0, 7)}" required>
                    </div>
                    <div class="col-12">
                        <button type="button" class="btn btn-primary save-recurring">Guardar</button>
                        <button type="button" class="btn btn-secondary cancel-recurring">Cancelar</button>
                    </div>
                </div>
            </div>`;
        list.prepend(div);

        div.querySelector('.save-recurring').onclick = async () => {
            const tipo = div.querySelector('.rec-tipo').value;
            const monto = Number(div.querySelector('.rec-monto').value);
            const categoria = div.querySelector('.rec-categoria').value;
            const descripcion = div.querySelector('.rec-descripcion').value.trim();
            const diaMes = Number(div.querySelector('.rec-diaMes').value);
            const fechaInicio = div.querySelector('.rec-fechaInicio').value;

            if (!categoria || !descripcion || !monto || !diaMes || !fechaInicio) {
                toast.showWarning('Completá todos los campos.');
                return;
            }
            if (diaMes < 1 || diaMes > 28) {
                toast.showWarning('El día debe ser entre 1 y 28.');
                return;
            }

            const newRecurring = {
                id: generateId(),
                tipo,
                monto,
                categoria,
                descripcion,
                diaMes,
                fechaInicio,
                activo: true
            };

            recurring = [...recurring, newRecurring];
            await storage.saveRecurring(recurring);
            renderRecurring();
            div.remove();
        };

        div.querySelector('.cancel-recurring').onclick = () => div.remove();
    };

    renderRecurring();
}

// --- Render principal ---------------------------------------------

function render() {
    renderTable();
    renderSummary();
    renderDashboard();
    renderBudgets();
    renderTrendChart();
    renderRecurring();
    renderCharts();
}

// --- Exportar a CSV ----------------------------------------------

function exportCSV() {
    if (entries.length === 0) {
        toast.showWarning('No hay movimientos para exportar.');
        return;
    }

    // CSV safe: neutraliza formulas (=, +, -, @) y comilla campos con separadores.
    function csvSafe(value) {
        let out = String(value ?? '');
        if (/^[=+\-@]/.test(out)) out = "'" + out;
        if (/[",\n\r]/.test(out)) out = '"' + out.replace(/"/g, '""') + '"';
        return out;
    }

    const lines = ['Fecha,Tipo,Categoria,Descripcion,Monto'];

    const sorted = [...entries].sort((a, b) => a.fecha.localeCompare(b.fecha));
    sorted.forEach(e => {
        const sign = e.tipo === 'income' ? '' : '-';
        const monto = `${sign}${Number(e.monto).toFixed(2)}`;
        lines.push([e.fecha, e.tipo, e.categoria, e.descripcion, monto]
            .map(csvSafe).join(','));
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
        toast.showWarning('No hay movimientos para exportar.');
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
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);

            // Validar estructura
            if (!data.entries || !Array.isArray(data.entries)) {
                toast.showError('El archivo no tiene datos válidos. Tiene que ser un JSON exportado desde esta app.');
                return;
            }

            if (data.entries.length > 10000) {
                toast.showError('El archivo contiene demasiados movimientos (máximo 10.000). Dividilo en partes más chicas.');
                return;
            }

            // Normalizar y validar entrada por entrada; descartar las inválidas.
            const incoming = [];
            let skipped = 0;
            data.entries.forEach(entry => {
                const normalized = {
                    ...entry,
                    tipo: entry.tipo || 'expense',
                    monto: Number(entry.monto)
                };
                const errors = validateEntry({
                    tipo: normalized.tipo,
                    amount: normalized.monto,
                    category: normalized.categoria,
                    description: normalized.descripcion
                });
                const fechaValida = typeof normalized.fecha === 'string' &&
                    /^\d{4}-\d{2}-\d{2}$/.test(normalized.fecha) &&
                    !isNaN(Date.parse(normalized.fecha));
                if (errors.length === 0 && fechaValida && isFinite(normalized.monto)) {
                    incoming.push(normalized);
                } else {
                    skipped++;
                }
            });

            if (incoming.length === 0) {
                toast.showWarning('El archivo no contiene movimientos válidos.');
                return;
            }

            const skipNote = skipped > 0 ? ` Se descartaron ${skipped} movimiento(s) inválido(s).` : '';
            const msg = `¿Reemplazar todos los datos actuales (${entries.length} movimientos) con los del archivo (${incoming.length} movimientos)?${skipNote}`;
            if (!confirm(msg)) return;

            entries = incoming;
            await saveToStorage();
            render();
            toast.showSuccess(`Importados ${incoming.length} movimientos correctamente.${skipNote}`);
        } catch (err) {
            toast.showError('Error al leer el archivo. Asegurate de que sea un JSON válido exportado desde esta app.');
            console.error('Import error:', err);
        }
    };
    reader.readAsText(file);
}

// --- Eventos ------------------------------------------------------

async function init() {
    await loadFromStorage();
    await loadBudgets();
    await loadRecurring();
    await checkAndGenerateRecurring();

    // Fecha de hoy por defecto
    document.getElementById('date').value = todayISO();

    // Cargar categorías en los <select>
    renderCategories();

    // Modo oscuro inicial
    applyDarkMode(loadDarkMode());

    // Render inicial
    render();

    // Budget modal
    setupBudgetModal();
    setupRecurringModal();

    // Submit del formulario (alta o edición)
    document.getElementById('expenseForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const tipo = document.querySelector('input[name="tipo"]:checked').value;
        const amount = document.getElementById('amount').value;
        const category = document.getElementById('category').value;
        const description = document.getElementById('description').value;
        const date = document.getElementById('date').value;

        const errors = validateEntry({ tipo, amount, category, description });
        if (errors.length > 0) {
            toast.showError(errors[0]);
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

    // Búsqueda con debounce
    document.getElementById('filterSearch').addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            filterSearch = e.target.value;
            render();
        }, 300);
    });

    document.getElementById('btnClearSearch').addEventListener('click', () => {
        filterSearch = '';
        document.getElementById('filterSearch').value = '';
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
        const inlineInput = e.target.closest('.inline-edit-fecha, .inline-edit-descripcion, .inline-edit-monto');

        if (inlineInput) return; // no procesar clicks en inputs inline

        if (editBtn) {
            const entryId = editBtn.dataset.id;
            // Si ya estamos editando esta fila, cancelar
            if (inlineEditingId === entryId) {
                cancelInlineEdit();
            } else {
                startInlineRowEdit(entryId);
            }
        }
        if (deleteBtn) {
            deleteEntry(deleteBtn.dataset.id);
        }
    });

    // Doble clic en celdas para edición individual
    document.getElementById('expensesTable').addEventListener('dblclick', (e) => {
        const td = e.target.closest('td');
        if (!td) return;

        const tr = td.closest('tr');
        if (!tr || !tr.dataset.entryId) return;

        const entryId = tr.dataset.entryId;
        const entry = entries.find(en => en.id === entryId);
        if (!entry) return;

        // Determinar qué campo se hizo doble clic
        const cellIndex = Array.from(tr.children).indexOf(td);
        // Índices: 0=fecha, 1=tipo, 2=categoría, 3=descripción, 4=monto, 5=acción
        const fieldMap = { 0: 'fecha', 3: 'descripcion', 4: 'monto' };
        const field = fieldMap[cellIndex];

        if (field) {
            startInlineCellEdit(entryId, field);
        }
    });

    // Eventos de teclado y blur en inputs inline (delegación en tbody)
    document.getElementById('expensesTable').addEventListener('keydown', (e) => {
        const input = e.target.closest('.inline-edit-fecha, .inline-edit-descripcion, .inline-edit-monto');
        if (!input) return;

        const entryId = input.dataset.entryId;

        if (e.key === 'Enter') {
            e.preventDefault();
            saveInlineEdit(entryId);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelInlineEdit();
        } else if (e.key === 'Tab') {
            // Tab mueve al siguiente campo editable de la misma fila
            const field = input.dataset.field;
            const tr = input.closest('tr');
            if (!tr) return;

            const nextFieldOrder = ['fecha', 'descripcion', 'monto'];
            const currentIdx = nextFieldOrder.indexOf(field);
            const nextIdx = e.shiftKey ? currentIdx - 1 : currentIdx + 1;

            if (nextIdx >= 0 && nextIdx < nextFieldOrder.length) {
                const nextField = nextFieldOrder[nextIdx];
                const nextInput = tr.querySelector(`.inline-edit-${nextField}`);
                if (nextInput) {
                    e.preventDefault();
                    nextInput.focus();
                    nextInput.select();
                }
            }
        }
    });

    // Guardar al perder foco (blur) en inputs inline
    document.getElementById('expensesTable').addEventListener('focusout', (e) => {
        const input = e.target.closest('.inline-edit-fecha, .inline-edit-descripcion, .inline-edit-monto');
        if (!input) return;

        const entryId = input.dataset.entryId;
        // Usar setTimeout para permitir que otros eventos (como Enter/Escape) se procesen primero
        setTimeout(() => {
            // Solo guardar si seguimos en modo edición inline para esta fila
            if (inlineEditingId === entryId) {
                saveInlineEdit(entryId);
            }
        }, 150);
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
