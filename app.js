// =====================================================================
// FINANZAS PERSONALES 2026 - Lógica de la app
// =====================================================================
// Decisiones de diseño:
// - Una sola fuente de verdad: el array `gastos` en memoria.
// - localStorage se sincroniza en cada cambio (alta o baja).
// - La UI se re-renderiza completa desde el array, no por parche.
// - Categorías centralizadas en una constante para no hardcodear.
// =====================================================================

// --- Constantes ---------------------------------------------------

const STORAGE_KEY = 'finanzas:gastos:v1';

const CATEGORIAS = [
    'Comida',
    'Transporte',
    'Hogar',
    'Ocio',
    'Salud',
    'Otro'
];

// --- Estado -------------------------------------------------------

let gastos = [];          // fuente de verdad en memoria
let filtroCategoria = ''; // '' = todas
let filtroMes = '';       // '' = todos, formato YYYY-MM

// --- Persistencia -------------------------------------------------

function cargarDeStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        gastos = raw ? JSON.parse(raw) : [];
    } catch (err) {
        console.error('No se pudo leer localStorage, arrancamos vacíos.', err);
        gastos = [];
    }
}

function guardarEnStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(gastos));
}

// --- Helpers ------------------------------------------------------

function escaparHTML(str) {
    // Escapa caracteres que rompen innerHTML cuando vienen de input del usuario.
    // Importante si en el futuro se sincroniza con servicios externos o se importa CSV.
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatearMonto(n) {
    // Formato argentino: separador de miles con punto, decimales con coma.
    return '$' + n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function hoyISO() {
    // Devuelve la fecha de hoy en formato YYYY-MM-DD para el input date.
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function generarId() {
    // Suficiente para una app personal: timestamp + random.
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// --- Altas, bajas, modificaciones ---------------------------------

function agregarGasto({ monto, categoria, descripcion, fecha }) {
    const nuevoGasto = {
        id: generarId(),
        monto: Number(monto),
        categoria,
        descripcion: descripcion.trim(),
        fecha
    };
    gastos = [...gastos, nuevoGasto];
    guardarEnStorage();
    render();
}

function eliminarGasto(id) {
    if (!confirm('¿Borrar este gasto?')) return;
    gastos = gastos.filter(g => g.id !== id);
    guardarEnStorage();
    render();
}

// --- Filtros ------------------------------------------------------

function aplicarFiltros() {
    return gastos.filter(g => {
        const pasaCategoria = !filtroCategoria || g.categoria === filtroCategoria;
        const pasaMes = !filtroMes || g.fecha.startsWith(filtroMes);
        return pasaCategoria && pasaMes;
    });
}

// --- Render -------------------------------------------------------

function renderCategorias() {
    const select = document.getElementById('categoria');
    const filtro = document.getElementById('filtroCategoria');

    // Carga el <select> del formulario
    select.innerHTML = CATEGORIAS
        .map(c => `<option value="${c}">${c}</option>`)
        .join('');

    // Carga el <select> del filtro, agregando "Todas" como primera opción
    filtro.innerHTML =
        '<option value="">Todas</option>' +
        CATEGORIAS.map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderTabla() {
    const tbody = document.getElementById('tablaGastos');
    const mensajeVacio = document.getElementById('mensajeVacio');
    const filtrados = aplicarFiltros();

    if (filtrados.length === 0) {
        tbody.innerHTML = '';
        mensajeVacio.classList.remove('d-none');
        return;
    }

    mensajeVacio.classList.add('d-none');

    // Ordenamos por fecha descendente (más reciente arriba)
    const ordenados = [...filtrados].sort((a, b) => b.fecha.localeCompare(a.fecha));

    tbody.innerHTML = ordenados.map(g => `
        <tr>
            <td>${escaparHTML(g.fecha)}</td>
            <td><span class="badge bg-secondary">${escaparHTML(g.categoria)}</span></td>
            <td>${g.descripcion ? escaparHTML(g.descripcion) : '<span class="text-muted">—</span>'}</td>
            <td class="text-end monto">${formatearMonto(g.monto)}</td>
            <td class="text-end">
                <button class="btn btn-sm btn-outline-danger" data-id="${escaparHTML(g.id)}" data-action="borrar">
                    Borrar
                </button>
            </td>
        </tr>
    `).join('');
}

function renderResumen() {
    const filtrados = aplicarFiltros();
    const total = filtrados.reduce((acc, g) => acc + g.monto, 0);
    const cantidad = filtrados.length;
    const promedio = cantidad ? total / cantidad : 0;

    document.getElementById('totalMes').textContent = formatearMonto(total);
    document.getElementById('cantidadGastos').textContent = cantidad;
    document.getElementById('promedioGasto').textContent = formatearMonto(promedio);
    document.getElementById('totalHeader').textContent = 'Total: ' + formatearMonto(total);
}

function render() {
    renderTabla();
    renderResumen();
}

// --- Exportar a CSV ----------------------------------------------

function exportarCSV() {
    if (gastos.length === 0) {
        alert('No hay gastos para exportar.');
        return;
    }

    // Cabecera
    const lineas = ['Fecha,Categoria,Descripcion,Monto'];

    // Cuerpo: ordenamos por fecha para que el Excel quede prolijo
    const ordenados = [...gastos].sort((a, b) => a.fecha.localeCompare(b.fecha));
    ordenados.forEach(g => {
        // Escapamos comas y comillas en la descripción
        const desc = `"${(g.descripcion || '').replace(/"/g, '""')}"`;
        lineas.push(`${g.fecha},${g.categoria},${desc},${g.monto.toFixed(2)}`);
    });

    // Forzamos BOM al inicio para que Excel reconozca acentos
    const csv = '\ufeff' + lineas.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `gastos-${hoyISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- Eventos ------------------------------------------------------

function init() {
    cargarDeStorage();

    // Fecha de hoy por defecto en el input
    document.getElementById('fecha').value = hoyISO();

    // Cargar categorías en los <select>
    renderCategorias();

    // Render inicial
    render();

    // Submit del formulario
    document.getElementById('formGasto').addEventListener('submit', (e) => {
        e.preventDefault();
        const monto = document.getElementById('monto').value;
        const categoria = document.getElementById('categoria').value;
        const descripcion = document.getElementById('descripcion').value;
        const fecha = document.getElementById('fecha').value;

        if (!monto || Number(monto) <= 0) {
            alert('El monto tiene que ser mayor a 0.');
            return;
        }

        agregarGasto({ monto, categoria, descripcion, fecha });
        e.target.reset();
        document.getElementById('fecha').value = hoyISO();
    });

    // Filtros
    document.getElementById('filtroCategoria').addEventListener('change', (e) => {
        filtroCategoria = e.target.value;
        render();
    });
    document.getElementById('filtroMes').addEventListener('change', (e) => {
        filtroMes = e.target.value;
        render();
    });
    document.getElementById('btnLimpiarFiltros').addEventListener('click', () => {
        filtroCategoria = '';
        filtroMes = '';
        document.getElementById('filtroCategoria').value = '';
        document.getElementById('filtroMes').value = '';
        render();
    });

    // Borrar (delegación de eventos en la tabla)
    document.getElementById('tablaGastos').addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action="borrar"]');
        if (btn) eliminarGasto(btn.dataset.id);
    });

    // Exportar CSV
    document.getElementById('btnExportar').addEventListener('click', exportarCSV);
}

// Arranca cuando el DOM está listo
document.addEventListener('DOMContentLoaded', init);
