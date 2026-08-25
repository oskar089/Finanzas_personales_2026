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

const DARK_MODE_KEY = 'finanzas:dark-mode';

// --- Estado -------------------------------------------------------

let entries = [];           // fuente de verdad en memoria
let filterType = '';        // '' | 'expense' | 'income'
let filterCategory = '';    // '' = todas
let filterMonthFrom = '';     // '' = sin límite inferior, formato YYYY-MM
let filterMonthTo = '';       // '' = sin límite superior, formato YYYY-MM
let filterSearch = '';      // búsqueda en descripción/categoría
let editingId = null;       // null = nuevo, string = editando
let inlineEditingId = null; // null = sin edición inline, string = ID de la fila en edición
let inlineEditField = null; // null = edición de fila completa, string = campo individual
let searchDebounceTimer = null;
let customCategories = [];  // [{ nombre, tipo: 'expense'|'income', createdAt }] definidas por el usuario
let aiSettings = null;      // configuración activa de IA (cargada desde storage)

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

// --- Categorías personalizadas ------------------------------------

function getCustomCategoryNames() {
    return customCategories.map(c => c.nombre);
}

// Single source for every category surface: defaults + user-defined.
function getMergedCategories() {
    return mergeCategories(getAllCategories(), getCustomCategoryNames());
}

async function loadCustomCategoriesFromStorage() {
    try {
        if (storage.loadCustomCategories) {
            customCategories = await storage.loadCustomCategories();
        }
    } catch (err) {
        console.error('No se pudieron leer las categorias personalizadas.', err);
        customCategories = [];
    }
}

async function persistCustomCategories() {
    if (storage.saveCustomCategories) {
        await storage.saveCustomCategories(customCategories);
    }
}

// --- AI Settings --------------------------------------------------

async function loadAiSettingsFromStorage() {
    try {
        aiSettings = await storage.loadAiSettings();
    } catch (err) {
        console.error('No se pudieron leer las configuraciones de IA.', err);
        aiSettings = null;
    }
}

// --- Modal gestionar categorías ------------------------------------

function renderCustomCategoryGroup(tipo) {
    const items = customCategories.filter(c => c.tipo === tipo);
    if (items.length === 0) {
        return '<p class="text-muted small mb-2">Sin categorías personalizadas.</p>';
    }
    return items.map(c => `
        <span class="badge text-bg-secondary me-1 mb-1 d-inline-flex align-items-center gap-1">
            ${escapeHTML(c.nombre)}
            <button type="button" class="btn-close btn-close-white btn-sm p-0"
                style="font-size:.55em" aria-label="Eliminar ${escapeHTML(c.nombre)}"
                data-delete-category="${escapeHTML(c.nombre)}"></button>
        </span>
    `).join('');
}

function renderManageCategoriesModal() {
    document.getElementById('customExpenseCats').innerHTML = renderCustomCategoryGroup('expense');
    document.getElementById('customIncomeCats').innerHTML = renderCustomCategoryGroup('income');

    const defaults = getAllCategories().map(c =>
        `<span class="badge text-bg-light border me-1 mb-1">${escapeHTML(c)}</span>`
    ).join('');
    document.getElementById('defaultCats').innerHTML = defaults;
}

async function addCustomCategory() {
    const tipoSelect = document.getElementById('newCatTipo');
    const nameInput = document.getElementById('newCatName');
    const nombre = nameInput.value.trim();

    if (!nombre) {
        toast.showError('Escribí el nombre de la categoría.');
        return;
    }

    const duplicate = getMergedCategories().some(
        c => c.toLowerCase() === nombre.toLowerCase()
    );
    if (duplicate) {
        toast.showWarning(`La categoría "${nombre}" ya existe.`);
        return;
    }

    customCategories = [...customCategories, {
        nombre,
        tipo: tipoSelect.value,
        createdAt: new Date().toISOString()
    }];

    nameInput.value = '';
    await persistCustomCategories();
    renderManageCategoriesModal();
    refreshAfterCategoryChange();
    toast.showSuccess(`Categoría "${nombre}" agregada.`);
}

async function deleteCustomCategory(nombre) {
    customCategories = customCategories.filter(
        c => c.nombre.toLowerCase() !== nombre.toLowerCase()
    );
    await persistCustomCategories();
    renderManageCategoriesModal();
    refreshAfterCategoryChange();
    toast.showSuccess(`Categoría "${nombre}" eliminada.`);
}

function refreshAfterCategoryChange() {
    // Repopulate every category surface (form datalist, filters, table inline datalists).
    renderCategories();
    render();
}

function setupManageCategoriesModal() {
    const modalEl = document.getElementById('categoriesModal');
    if (!modalEl) return;

    modalEl.addEventListener('shown.bs.modal', renderManageCategoriesModal);

    document.getElementById('btnAddCustomCat').addEventListener('click', () => {
        addCustomCategory();
    });

    // Enter en el input también agrega
    document.getElementById('newCatName').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addCustomCategory();
        }
    });

    // Delegación de eventos para los botones eliminar
    ['customExpenseCats', 'customIncomeCats'].forEach(id => {
        document.getElementById(id).addEventListener('click', (e) => {
            const btn = e.target.closest('[data-delete-category]');
            if (btn) {
                deleteCustomCategory(btn.getAttribute('data-delete-category'));
            }
        });
    });
}

// --- Modal configurar IA -------------------------------------------

function setupAiSettingsModal() {
    const modalEl = document.getElementById('aiSettingsModal');
    if (!modalEl) return;

    const providerSelect = document.getElementById('aiProvider');
    const baseUrlGroup = document.getElementById('aiBaseUrlGroup');
    const baseUrlInput = document.getElementById('aiBaseUrl');
    const apiKeyGroup = document.getElementById('aiApiKeyGroup');
    const apiKeyInput = document.getElementById('aiApiKey');
    const modelInput = document.getElementById('aiModel');
    const modelListEl = document.getElementById('aiModelList');
    const statusEl = document.getElementById('aiConnectionStatus');
    const btnDiscover = document.getElementById('btnDiscoverModels');
    const btnTest = document.getElementById('btnTestConnection');
    const btnSave = document.getElementById('btnSaveAiSettings');
    const btnToggleKey = document.getElementById('btnToggleApiKey');

    // Default values per provider
    const PROVIDER_DEFAULTS = {
        local: { baseUrl: 'http://localhost:11434', apiKey: '', model: 'gemma3:4b' },
        openai: { baseUrl: 'https://api.openai.com', apiKey: '', model: 'gpt-4o' },
        gemini: { baseUrl: 'https://generativelanguage.googleapis.com', apiKey: '', model: 'gemini-2.0-flash' },
        claude: { baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-sonnet-4-20250514' }
    };

    function updateFieldVisibility() {
        const provider = providerSelect.value;
        const isLocal = provider === 'local';
        const needsKey = provider !== 'local';
        const hasModelsEndpoint = provider === 'local' || provider === 'openai';

        baseUrlGroup.classList.toggle('d-none', !isLocal);
        apiKeyGroup.classList.toggle('d-none', !needsKey);
        btnDiscover.classList.toggle('d-none', !hasModelsEndpoint);
    }

    // Populate modal from saved settings
    modalEl.addEventListener('shown.bs.modal', async () => {
        statusEl.textContent = '';
        modelListEl.innerHTML = '';

        const settings = aiSettings || {};
        const provider = settings.provider || 'local';
        providerSelect.value = provider;
        baseUrlInput.value = settings.baseUrl || PROVIDER_DEFAULTS[provider].baseUrl || '';
        apiKeyInput.value = settings.apiKey || '';
        modelInput.value = settings.model || PROVIDER_DEFAULTS[provider].model || '';

        updateFieldVisibility();
    });

    // Provider change: update defaults and visibility
    providerSelect.addEventListener('change', () => {
        const provider = providerSelect.value;
        const defaults = PROVIDER_DEFAULTS[provider];
        baseUrlInput.value = defaults.baseUrl;
        apiKeyInput.value = defaults.apiKey;
        modelInput.value = defaults.model;
        modelListEl.innerHTML = '';
        statusEl.textContent = '';
        updateFieldVisibility();
    });

    // Toggle API key visibility
    btnToggleKey.addEventListener('click', () => {
        const isPassword = apiKeyInput.type === 'password';
        apiKeyInput.type = isPassword ? 'text' : 'password';
        btnToggleKey.textContent = isPassword ? '🙈' : '👁️';
    });

    // Discover models
    btnDiscover.addEventListener('click', async () => {
        const settings = {
            provider: providerSelect.value,
            baseUrl: baseUrlInput.value.trim(),
            apiKey: apiKeyInput.value.trim()
        };

        btnDiscover.disabled = true;
        btnDiscover.textContent = '⏳';
        modelListEl.innerHTML = '';

        try {
            const models = await aiProviders.discoverModels(settings);
            if (models.length === 0) {
                modelListEl.innerHTML = '<small class="text-muted">No se encontraron modelos. Ingresá el nombre manualmente.</small>';
            } else {
                modelListEl.innerHTML = models.map(m =>
                    `<button type="button" class="btn btn-outline-secondary btn-sm me-1 mb-1 btn-select-model" data-model="${escapeHTML(m)}">${escapeHTML(m)}</button>`
                ).join('');
            }
        } catch {
            modelListEl.innerHTML = '<small class="text-muted">Error al descubrir modelos. Ingresá el nombre manualmente.</small>';
        } finally {
            btnDiscover.disabled = false;
            btnDiscover.textContent = '🔍';
        }
    });

    // Delegate model selection clicks
    modelListEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-select-model');
        if (btn) {
            modelInput.value = btn.dataset.model;
        }
    });

    // Test connection
    btnTest.addEventListener('click', async () => {
        const settings = {
            provider: providerSelect.value,
            baseUrl: baseUrlInput.value.trim(),
            apiKey: apiKeyInput.value.trim(),
            model: modelInput.value.trim()
        };

        btnTest.disabled = true;
        statusEl.textContent = 'Probando...';
        statusEl.className = 'small text-muted';

        try {
            const result = await aiProviders.testConnection(settings);
            if (result.ok) {
                statusEl.textContent = '✓ Conectado';
                statusEl.className = 'small text-success';
            } else {
                statusEl.textContent = `✗ Error: ${result.error}`;
                statusEl.className = 'small text-danger';
            }
        } catch (err) {
            statusEl.textContent = `✗ Error: ${err.message}`;
            statusEl.className = 'small text-danger';
        } finally {
            btnTest.disabled = false;
        }
    });

    // Save settings
    btnSave.addEventListener('click', async () => {
        const settings = {
            provider: providerSelect.value,
            baseUrl: baseUrlInput.value.trim(),
            apiKey: apiKeyInput.value.trim(),
            model: modelInput.value.trim()
        };

        if (!settings.model) {
            toast.showWarning('Ingresá un nombre de modelo.');
            return;
        }

        await storage.saveAiSettings(settings);
        aiSettings = settings;
        bootstrap.Modal.getInstance(modalEl).hide();
        toast.showSuccess('Configuración de IA guardada.');
    });
}

// --- Auto-categorización con IA --------------------------------------

function getActiveModelName() {
    if (aiSettings && aiSettings.model) return aiSettings.model;
    return 'IA';
}

async function autoCategorize() {
    const desc = document.getElementById('description').value.trim();
    if (!desc) {
        toast.showWarning('Escribí una descripción primero.');
        return;
    }

    const btn = document.getElementById('btnAutoCat');
    btn.disabled = true;
    btn.textContent = '🤔 Pensando...';

    const categories = getMergedCategories().map(c => `"${c}"`).join(', ');

    try {
        const response = await aiProviders.chatCompletion([
            {
                role: 'system',
                content: 'Sos un asistente financiero. Respondé SOLO con el nombre exacto de la categoría, sin puntos ni explicaciones.'
            },
            {
                role: 'user',
                content: `Clasificá este gasto o ingreso en UNA de estas categorías: ${categories}.\nDescripción: "${desc}"`
            }
        ], { temperature: 0.1, max_tokens: 20 });

        let suggestion = response.text.trim()
            .replace(/^["'*]+|["'*.]+$/g, '')    // saca comillas/asteriscos al inicio/fin
            .replace(/[.,;:!?]+$/, '');            // saca puntuación al final

        // Buscar coincidencia exacta (case insensitive)
        const allCats = getMergedCategories();
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
                toast.showWarning(`La IA sugirió "${suggestion}" pero no coincide con ninguna categoría. Categorías: ${allCats.join(', ')}`);
            }
        }
    } catch (err) {
        const msg = err.name === 'AbortError'
            ? `La IA tardó demasiado (30s). Verificá la conexión al proveedor.`
            : `No se pudo conectar con la IA. Verificá la configuración del proveedor.`;
        toast.showError(msg);
    } finally {
        btn.disabled = false;
        btn.textContent = '🧠 Auto';
    }
}

// --- CRUD ---------------------------------------------------------

async function addEntry({ tipo, amount, category, subcategory, description, date }) {
    const newEntry = {
        id: generateId(),
        tipo,
        monto: Number(amount),
        categoria: category,
        subcategoria: subcategory || '',
        descripcion: description.trim(),
        fecha: date
    };
    entries = [...entries, newEntry];
    await saveToStorage();
    render();
}

async function updateEntry({ id, tipo, amount, category, subcategory, description, date }) {
    entries = entries.map(e =>
        e.id === id
            ? { ...e, tipo, monto: Number(amount), categoria: category, subcategoria: subcategory || '', descripcion: description.trim(), fecha: date }
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
        monthFrom: filterMonthFrom,
        monthTo: filterMonthTo,
        search: filterSearch
    });
}

// --- Render: Formulario -------------------------------------------

function renderCategories() {
    const datalist = document.getElementById('categoryList');
    const filterSelect = document.getElementById('filterCategory');
    const cats = getMergedCategories();
    const options = cats.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
    datalist.innerHTML = options;
    // El filtro de categoría arranca con la opción "Todas"
    filterSelect.innerHTML = '<option value="">Todas</option>' + options;
}

function enterEditMode(entry) {
    editingId = entry.id;
    document.getElementById('formTitle').textContent = 'Editar movimiento';
    document.getElementById('btnSubmit').textContent = 'Actualizar';
    document.getElementById('btnCancelEdit').classList.remove('d-none');

    // Setear tipo radio
    if (entry.tipo === 'income') {
        document.getElementById('tipoIncome').checked = true;
    } else if (entry.tipo === 'savings') {
        document.getElementById('tipoAhorro').checked = true;
    } else {
        document.getElementById('tipoExpense').checked = true;
    }

    // Setear valores
    document.getElementById('amount').value = entry.monto;
    document.getElementById('category').value = entry.categoria;
    document.getElementById('subcategory').value = entry.subcategoria || '';
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
    const tipoInput = row.querySelector('.inline-edit-tipo');
    const catInput = row.querySelector('.inline-edit-categoria');
    const subInput = row.querySelector('.inline-edit-subcategoria');
    const descInput = row.querySelector('.inline-edit-descripcion');
    const montoInput = row.querySelector('.inline-edit-monto');

    const values = {
        fecha: fechaInput ? fechaInput.value : entry.fecha,
        tipo: tipoInput ? tipoInput.value : entry.tipo,
        categoria: catInput ? catInput.value : entry.categoria,
        subcategoria: subInput ? subInput.value : entry.subcategoria,
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
            ? { ...e, fecha: result.fecha, tipo: result.tipo, categoria: result.categoria, subcategoria: result.subcategoria, descripcion: result.descripcion, monto: result.monto }
            : e
    );

    inlineEditingId = null;
    inlineEditField = null;

    await saveToStorage();
    render();
}

// Genera el HTML para una celda editable (input inline)
function renderEditableCell(entry, field, value) {
    const inputClass = 'form-control form-control-sm';

    if (field === 'tipo') {
        const options = [
            { val: 'expense', label: '💸 Gasto', sel: entry.tipo === 'expense' ? ' selected' : '' },
            { val: 'income', label: '💰 Ingreso', sel: entry.tipo === 'income' ? ' selected' : '' },
            { val: 'savings', label: '🏦 Ahorro', sel: entry.tipo === 'savings' ? ' selected' : '' }
        ];
        const opts = options.map(o => `<option value="${o.val}"${o.sel}>${o.label}</option>`).join('');
        return `<select class="${inputClass} inline-edit-${field}" data-field="${field}" data-entry-id="${entry.id}">${opts}</select>`;
    }

    if (field === 'categoria') {
        const cats = getMergedCategories().map(c => `<option value="${escapeHTML(c)}">`).join('');
        return `<input type="text" class="${inputClass} inline-edit-${field}" value="${escapeHTML(value || '')}" list="inlineCatList-${entry.id}" data-field="${field}" data-entry-id="${entry.id}"><datalist id="inlineCatList-${entry.id}">${cats}</datalist>`;
    }

    if (field === 'subcategoria') {
        return `<input type="text" class="${inputClass} inline-edit-${field}" value="${escapeHTML(value || '')}" data-field="${field}" data-entry-id="${entry.id}">`;
    }

    const inputType = field === 'fecha' ? 'date' : field === 'monto' ? 'number' : 'text';
    const stepAttr = field === 'monto' ? ' step="0.01" min="0"' : '';
    const maxlengthAttr = field === 'descripcion' ? ' maxlength="100"' : '';
    const inputTypeClass = field === 'monto' ? 'form-control form-control-sm text-end' : inputClass;
    return `<input type="${inputType}" class="${inputTypeClass} inline-edit-${field}" value="${field === 'monto' ? entry.monto : escapeHTML(value || '')}"${stepAttr}${maxlengthAttr} data-field="${field}" data-entry-id="${entry.id}">`;
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
        const badgeClass = isIncome ? 'bg-success' : e.tipo === 'savings' ? 'bg-warning text-dark' : 'bg-danger';
        const badgeText = isIncome ? '💰 Ingreso' : e.tipo === 'savings' ? '🏦 Ahorro' : '💸 Gasto';
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

        // Subcategoría badge
        const subBadge = e.subcategoria ? `<span class="badge bg-info text-dark ms-1">${escapeHTML(e.subcategoria)}</span>` : '';

        // Celda de fecha: editable si edición inline activa
        const fechaCell = isRowEdit || (isSingleField && inlineEditField === 'fecha')
            ? renderEditableCell(e, 'fecha', e.fecha)
            : escapeHTML(e.fecha);

        // Celda de tipo: editable si edición inline activa
        const tipoCell = isRowEdit || (isSingleField && inlineEditField === 'tipo')
            ? renderEditableCell(e, 'tipo', e.tipo)
            : `<span class="badge ${badgeClass}">${badgeText}</span>`;

        // Celda de categoría: editable si edición inline activa
        const catCell = isRowEdit || (isSingleField && inlineEditField === 'categoria')
            ? renderEditableCell(e, 'categoria', e.categoria)
            : `${catBadge}${subBadge}`;

        // Celda de subcategoría: editable solo en edición de fila completa
        const subCell = isRowEdit
            ? renderEditableCell(e, 'subcategoria', e.subcategoria)
            : '';

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
            <td>${tipoCell}</td>
            <td>${catCell}${subCell ? ' ' + subCell : ''}</td>
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
    const { totalIncome, totalExpenses, totalSavings, balance } = calculateBalance(filtered);

    document.getElementById('totalIncome').textContent = formatAmount(totalIncome);
    document.getElementById('totalExpenses').textContent = formatAmount(totalExpenses);
    document.getElementById('totalSavings').textContent = formatAmount(totalSavings);

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
        const colors = generateColors(labels.length, tipo);
        return {
            labels,
            datasets: [{ data, backgroundColor: colors, borderWidth: 1, borderColor: gridColor }]
        };
    }

    function generateColors(count, tipo) {
        // Ángulo dorado (~137.5°) — distribuye colores con máxima distancia visual
        const hueStart = tipo === 'income' ? 140 : 0;
        const goldenAngle = 137.508;
        const results = [];
        for (let i = 0; i < count; i++) {
            const hue = (hueStart + i * goldenAngle) % 360;
            const sat = 65 + (i % 2) * 12;
            const light = 43 + (i % 3) * 7;
            results.push(`hsl(${Math.round(hue)}, ${sat}%, ${light}%)`);
        }
        return results;
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

// --- Recomendaciones financieras (IA) --------------------------------

async function renderRecommendations() {
    const emptyEl = document.getElementById('recommendationsEmpty');
    const loadingEl = document.getElementById('recommendationsLoading');
    const noDataEl = document.getElementById('recommendationsNoData');
    const resultEl = document.getElementById('recommendationsResult');
    const listEl = document.getElementById('recommendationsList');
    const btn = document.getElementById('btnAnalyzeFinance');

    // Verificar si hay datos
    if (entries.length === 0) {
        emptyEl.classList.add('d-none');
        loadingEl.classList.add('d-none');
        noDataEl.classList.remove('d-none');
        resultEl.classList.add('d-none');
        return;
    }

    // Mostrar loading, ocultar otros
    emptyEl.classList.add('d-none');
    noDataEl.classList.add('d-none');
    resultEl.classList.add('d-none');
    loadingEl.classList.remove('d-none');
    document.getElementById('recommendationsLoadingText').textContent =
        `Analizando tus finanzas con ${getActiveModelName()}...`;
    btn.disabled = true;

    // Calcular datos financieros del mes actual
    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    const monthEntries = entries.filter(e => e.fecha.startsWith(currentMonth));
    const { totalIncome, totalExpenses, balance } = calculateBalance(monthEntries);
    const dailyAvg = calculateDailyAverage(entries, currentMonth);
    const comparison = calculateComparison(entries, currentMonth);
    const budgetProgress = calculateBudgetProgress(entries, budgets, currentMonth);

    // Top 5 categorías de gasto (con subcategorías)
    const expensesByCategory = monthEntries
        .filter(e => e.tipo !== 'income')
        .reduce((acc, e) => {
            acc[e.categoria] = (acc[e.categoria] || { total: 0, subs: {} });
            acc[e.categoria].total += e.monto;
            if (e.subcategoria) {
                acc[e.categoria].subs[e.subcategoria] = (acc[e.categoria].subs[e.subcategoria] || 0) + e.monto;
            }
            return acc;
        }, {});
    const topCategories = Object.entries(expensesByCategory)
        .sort(([, a], [, b]) => b.total - a.total)
        .slice(0, 5)
        .map(([cat, data]) => {
            const subList = Object.entries(data.subs)
                .sort(([, a], [, b]) => b - a)
                .map(([sub, amt]) => `${sub}: ${formatAmount(amt)}`)
                .join('; ');
            return subList
                ? `${cat} (${formatAmount(data.total)}): ${subList}`
                : `${cat}: ${formatAmount(data.total)}`;
        }).join('\n  ') || 'Sin datos';

    // Estado de presupuestos
    const budgetStatus = budgetProgress.length > 0
        ? budgetProgress.map(p => {
            const icon = p.estado === 'excedido' ? '❌' : p.estado === 'advertencia' ? '⚠️' : '✅';
            return `${p.categoria}: ${p.porcentaje}% (${icon} ${p.estado})`;
        }).join(', ')
        : 'Sin presupuestos configurados';

    // Comparativa mes anterior
    const comparisonText = comparison.prevExpenses > 0
        ? `Gastos actuales: ${formatAmount(comparison.currentExpenses)}, mes anterior: ${formatAmount(comparison.prevExpenses)} (${comparison.delta >= 0 ? '+' : ''}${comparison.percent.toFixed(1)}%)`
        : 'Sin datos del mes anterior';

    // Construir prompt
    const prompt = `Sos un asistente financiero personal. Analizá estos datos y dale 3-5 consejos concretos y accionables para mejorar las finanzas del usuario. Sé directo, usa números reales, y priorizá el consejo más impactante primero.

Datos del mes:
- Ingresos: ${formatAmount(totalIncome)}
- Gastos: ${formatAmount(totalExpenses)}
- Balance: ${formatAmount(balance)}
- Promedio diario: ${formatAmount(dailyAvg)}
- Top categorías de gasto (con desglose por subcategoría):
  ${topCategories}
- Presupuestos: ${budgetStatus}
- ${comparisonText}

Respondé en español, formato:
1. [Consejo concreto con número]
2. [Consejo concreto con número]
...`;

    try {
        const response = await aiProviders.chatCompletion([
            { role: 'system', content: 'Sos un asistente financiero personal experto.' },
            { role: 'user', content: prompt }
        ], { temperature: 0.3, max_tokens: 500 });

        const text = response.text;

        // Parsear consejos numerados (1. ... 2. ... etc.)
        const recommendations = text
            .split(/\n/)
            .map(line => line.replace(/^\d+[\.\)]\s*/, '').trim())
            .filter(line => line.length > 0);

        if (recommendations.length === 0) {
            toast.showWarning('La IA no devolvió recomendaciones. Intentá de nuevo.');
            loadingEl.classList.add('d-none');
            emptyEl.classList.remove('d-none');
            return;
        }

        // Renderizar recomendaciones
        listEl.innerHTML = recommendations
            .map(rec => `<li class="mb-2">${escapeHTML(rec)}</li>`)
            .join('');

        loadingEl.classList.add('d-none');
        resultEl.classList.remove('d-none');
        toast.showSuccess('Recomendaciones generadas correctamente.');
    } catch (err) {
        console.error('Error con IA:', err);
        const msg = err.name === 'AbortError'
            ? `La IA tardó demasiado (60s). Verificá la conexión al proveedor.`
            : `No se pudo conectar con la IA. Verificá la configuración del proveedor.`;
        toast.showError(msg);
        loadingEl.classList.add('d-none');
        emptyEl.classList.remove('d-none');
    } finally {
        btn.disabled = false;
    }
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
    const allCats = getMergedCategories();
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
        await addEntry(entry);
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
                            ${getMergedCategories().map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('')}
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

function exportXLSX() {
    if (entries.length === 0) {
        toast.showWarning('No hay movimientos para exportar.');
        return;
    }
    if (typeof XLSX === 'undefined') {
        toast.showError('No se pudo cargar la librería de Excel. Recargá la página.');
        return;
    }

    // Sanitize: prefix dangerous chars to prevent formula injection
    const sanitize = (val) => {
        if (typeof val !== 'string') return val;
        return /^[=+\-@\t\r]/.test(val) ? "'" + val : val;
    };

    const sorted = [...entries].sort((a, b) => a.fecha.localeCompare(b.fecha));

    // Mapear tipo a texto legible
    const tipoLabel = { expense: 'Gasto', income: 'Ingreso', savings: 'Ahorro' };

    // Preparar datos para la hoja
    const rows = sorted.map(e => ({
        'Fecha': e.fecha,
        'Tipo': tipoLabel[e.tipo] || e.tipo,
        'Categoría': sanitize(e.categoria),
        'Subcategoría': sanitize(e.subcategoria || ''),
        'Descripción': sanitize(e.descripcion),
        'Monto': Number(e.monto)
    }));

    // Agregar fila de totales
    const totals = calculateBalance(sorted);
    rows.push({});
    rows.push({
        'Fecha': '',
        'Tipo': '',
        'Categoría': 'TOTALES',
        'Subcategoría': '',
        'Descripción': `Ingresos: ${formatAmount(totals.totalIncome)} | Gastos: ${formatAmount(totals.totalExpenses)} | Ahorros: ${formatAmount(totals.totalSavings)}`,
        'Monto': totals.balance
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    // Anchos de columna
    ws['!cols'] = [
        { wch: 12 },  // Fecha
        { wch: 10 },  // Tipo
        { wch: 18 },  // Categoría
        { wch: 18 },  // Subcategoría
        { wch: 30 },  // Descripción
        { wch: 14 }   // Monto
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');

    XLSX.writeFile(wb, `finanzas-${todayISO()}.xlsx`);
}

// --- Exportar / Importar JSON ------------------------------------

function importXLSX(file) {
    if (typeof XLSX === 'undefined') {
        toast.showError('No se pudo cargar la librería de Excel. Recargá la página.');
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const wb = XLSX.read(e.target.result, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws);

            if (rows.length === 0) {
                toast.showWarning('El archivo no contiene datos.');
                return;
            }

            if (rows.length > 10000) {
                toast.showError('El archivo contiene demasiados movimientos (máximo 10.000).');
                return;
            }

            // Mapear tipo legible a código
            const tipoMap = { 'Gasto': 'expense', 'Ingreso': 'income', 'Ahorro': 'savings' };

            const incoming = [];
            let skipped = 0;
            rows.forEach(row => {
                // Saltar filas vacías o de totales
                if (!row.Fecha && !row.Tipo) return;

                const tipo = tipoMap[row.Tipo] || row.Tipo || 'expense';
                const normalized = {
                    id: crypto.randomUUID(),
                    fecha: String(row.Fecha || ''),
                    tipo: tipo,
                    categoria: String(row['Categoría'] || row.Categoria || ''),
                    subcategoria: String(row['Subcategoría'] || row.Subcategoria || ''),
                    descripcion: String(row['Descripción'] || row.Descripcion || ''),
                    monto: Number(row.Monto || row.monto || 0)
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

            const skipNote = skipped > 0 ? ` Se descartaron ${skipped} fila(s) inválida(s).` : '';
            const msg = `¿Reemplazar todos los datos actuales (${entries.length} movimientos) con los del archivo (${incoming.length} movimientos)?${skipNote}`;
            if (!confirm(msg)) return;

            entries = incoming;
            await saveToStorage();
            render();
            toast.showSuccess(`Importados ${incoming.length} movimientos correctamente.${skipNote}`);
        } catch (err) {
            toast.showError('Error al leer el archivo. Asegurate de que sea un .xlsx válido.');
            console.error('Import error:', err);
        }
    };
    reader.readAsArrayBuffer(file);
}

// --- Eventos ------------------------------------------------------

async function init() {
    await loadFromStorage();
    await loadBudgets();
    await loadRecurring();
    await loadCustomCategoriesFromStorage();
    await loadAiSettingsFromStorage();
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
    setupManageCategoriesModal();
    setupAiSettingsModal();

    // Submit del formulario (alta o edición)
    document.getElementById('expenseForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const tipo = document.querySelector('input[name="tipo"]:checked').value;
        const amount = document.getElementById('amount').value;
        const category = document.getElementById('category').value;
        const subcategory = document.getElementById('subcategory').value;
        const description = document.getElementById('description').value;
        const date = document.getElementById('date').value;

        const errors = validateEntry({ tipo, amount, category, description });
        if (errors.length > 0) {
            toast.showError(errors[0]);
            return;
        }

        if (editingId) {
            updateEntry({ id: editingId, tipo, amount, category, subcategory, description, date });
            cancelEdit();
        } else {
            addEntry({ tipo, amount, category, subcategory, description, date });
        }

        e.target.reset();
        document.getElementById('date').value = todayISO();
        document.getElementById('tipoExpense').checked = true;
    });

    // Cancelar edición
    document.getElementById('btnCancelEdit').addEventListener('click', cancelEdit);

    // Auto-categorizar con IA
    document.getElementById('btnAutoCat').addEventListener('click', autoCategorize);

    // Recomendaciones financieras
    document.getElementById('btnAnalyzeFinance').addEventListener('click', renderRecommendations);
    document.getElementById('btnReAnalyze').addEventListener('click', renderRecommendations);

    // Filtros
    document.getElementById('filterType').addEventListener('change', (e) => {
        filterType = e.target.value;
        render();
    });
    document.getElementById('filterCategory').addEventListener('change', (e) => {
        filterCategory = e.target.value;
        render();
    });
    document.getElementById('filterMonthFrom').addEventListener('change', (e) => {
        filterMonthFrom = e.target.value;
        render();
    });
    document.getElementById('filterMonthTo').addEventListener('change', (e) => {
        filterMonthTo = e.target.value;
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
        filterMonthFrom = '';
        filterMonthTo = '';
        filterSearch = '';
        document.getElementById('filterType').value = '';
        document.getElementById('filterCategory').value = '';
        document.getElementById('filterMonthFrom').value = '';
        document.getElementById('filterMonthTo').value = '';
        document.getElementById('filterSearch').value = '';
        render();
    });

    // Acciones en la tabla (editar, borrar)
    document.getElementById('expensesTable').addEventListener('click', (e) => {
        const editBtn = e.target.closest('button[data-action="edit"]');
        const deleteBtn = e.target.closest('button[data-action="delete"]');
        const inlineInput = e.target.closest('.inline-edit-fecha, .inline-edit-tipo, .inline-edit-categoria, .inline-edit-subcategoria, .inline-edit-descripcion, .inline-edit-monto');

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

    // Acciones en gastos recurrentes (delegación — un solo listener)
    document.getElementById('recurringList').addEventListener('click', async (e) => {
        const toggleBtn = e.target.closest('.toggle-recurring');
        const deleteBtn = e.target.closest('.delete-recurring');

        if (toggleBtn) {
            const id = toggleBtn.dataset.id;
            const r = recurring.find(x => x.id === id);
            if (r) {
                recurring = recurring.map(x =>
                    x.id === id ? { ...x, activo: !x.activo } : x
                );
                await storage.saveRecurring(recurring);
                renderRecurring();
            }
        }

        if (deleteBtn) {
            const id = deleteBtn.dataset.id;
            if (confirm('¿Eliminar este recurrente?')) {
                recurring = recurring.filter(x => x.id !== id);
                await storage.saveRecurring(recurring);
                renderRecurring();
            }
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
        const fieldMap = { 0: 'fecha', 1: 'tipo', 2: 'categoria', 3: 'descripcion', 4: 'monto' };
        const field = fieldMap[cellIndex];

        if (field) {
            startInlineCellEdit(entryId, field);
        }
    });

    // Eventos de teclado y blur en inputs inline (delegación en tbody)
    const inlineSelector = '.inline-edit-fecha, .inline-edit-tipo, .inline-edit-categoria, .inline-edit-subcategoria, .inline-edit-descripcion, .inline-edit-monto';

    document.getElementById('expensesTable').addEventListener('keydown', (e) => {
        const input = e.target.closest(inlineSelector);
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

            const nextFieldOrder = ['fecha', 'tipo', 'categoria', 'subcategoria', 'descripcion', 'monto'];
            const currentIdx = nextFieldOrder.indexOf(field);
            const nextIdx = e.shiftKey ? currentIdx - 1 : currentIdx + 1;

            if (nextIdx >= 0 && nextIdx < nextFieldOrder.length) {
                const nextField = nextFieldOrder[nextIdx];
                const nextInput = tr.querySelector(`.inline-edit-${nextField}`);
                if (nextInput) {
                    e.preventDefault();
                    nextInput.focus();
                    if (nextInput.select) nextInput.select();
                }
            }
        }
    });

    // Guardar al perder foco (blur) en inputs inline
    document.getElementById('expensesTable').addEventListener('focusout', (e) => {
        const input = e.target.closest(inlineSelector);
        if (!input) return;

        const entryId = input.dataset.entryId;
        // Usar setTimeout para permitir que otros eventos se procesen y detectar adónde fue el foco
        setTimeout(() => {
            // Si el foco se movió a otro input inline de la misma fila, no guardar (el usuario está navegando)
            const tr = document.querySelector(`tr[data-entry-id="${entryId}"]`);
            if (tr && tr.contains(document.activeElement)) return;
            // Solo guardar si seguimos en modo edición inline para esta fila
            if (inlineEditingId === entryId) {
                saveInlineEdit(entryId);
            }
        }, 150);
    });

    // Guardar al cambiar select inline (tipo)
    document.getElementById('expensesTable').addEventListener('change', (e) => {
        const input = e.target.closest('.inline-edit-tipo');
        if (!input) return;
        saveInlineEdit(input.dataset.entryId);
    });

    // Modo oscuro
    document.getElementById('btnDarkMode').addEventListener('click', toggleDarkMode);

    // Exportar Excel
    document.getElementById('btnExportCSV').addEventListener('click', exportXLSX);

    // Importar Excel
    document.getElementById('btnImportXLSX').addEventListener('click', () => {
        document.getElementById('fileInputXLSX').click();
    });
    document.getElementById('fileInputXLSX').addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            importXLSX(e.target.files[0]);
            e.target.value = '';
        }
    });

    // PWA Install Prompt
    let deferredPrompt = null;
    const btnInstall = document.getElementById('btnInstallPWA');

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        btnInstall.classList.remove('d-none');
    });

    btnInstall.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            toast.showSuccess('¡App instalada! La encontrás en tu escritorio o menú de apps.');
        }
        deferredPrompt = null;
        btnInstall.classList.add('d-none');
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        btnInstall.classList.add('d-none');
    });
}

// Arranca cuando el DOM está listo
document.addEventListener('DOMContentLoaded', init);
