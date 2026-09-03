// =====================================================================
// FINANZAS PERSONALES 2026 - Cloud sync (manual .fpkg file sync)
// =====================================================================
// Orchestration layer between the app UI and storage export/import.
// downloadPackage(): exports all stores to a .fpkg JSON file download.
// uploadPackage():   opens the hidden file picker, then reads + validates
//                    the picked .fpkg, shows a confirmation modal, and on
//                    confirm runs importAll + reload.
// =====================================================================

// Storage deps resolved lazily from globals. cloud-sync.js loads BETWEEN
// storage.js and toast.js in index.html, so window.toast may not exist yet
// at module load time — resolve both on first use instead of capturing.
function storage() {
    return (typeof window !== 'undefined') ? window.storage : null;
}
function toast() {
    return (typeof window !== 'undefined') ? window.toast : null;
}

// Pre-validate a parsed bundle before showing the confirmation modal.
// Mirrors the subset of importAll() checks that gate the UX, so a clearly
// malformed file never reaches the "Confirm" dialog.
function prevalidate(bundle) {
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
        return 'No es un archivo de backup válido.';
    }
    if (!('version' in bundle)) {
        return 'El backup no tiene versión.';
    }
    if (bundle.version !== 1) {
        return `Versión de backup no soportada: ${bundle.version}`;
    }
    if (!bundle.stores || typeof bundle.stores !== 'object' || Array.isArray(bundle.stores)) {
        return 'El backup no contiene stores.';
    }
    if (!bundle.cryptoMeta || typeof bundle.cryptoMeta !== 'object' || Array.isArray(bundle.cryptoMeta)) {
        return 'El backup no contiene los datos de cifrado.';
    }
    return null;
}

// Builds the local-date filename: finanzas-backup-YYYY-MM-DD.fpkg
function backupFilename() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `finanzas-backup-${yyyy}-${mm}-${dd}.fpkg`;
}

// Orchestrates a .fpkg export → browser download.
// Rejects if exportAll() fails.
async function downloadPackage() {
    const bundle = await storage().exportAll();
    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: 'application/json' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Read a File's text content via FileReader (the API we mock in tests).
function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('read failed'));
        reader.readAsText(file);
    });
}

// Parse + validate a picked file, populate the confirmation modal, and
// wire the confirm button. Returns { ok } reflecting the validation stage;
// the actual import result surfaces via the modal's confirm handler.
async function handlePickedFile(file) {
    if (!file) {
        return { ok: false, errors: ['No se seleccionó ningún archivo.'] };
    }

    let bundle;
    try {
        const text = await readFileAsText(file);
        bundle = JSON.parse(text);
    } catch (err) {
        toast().showError('Archivo de backup inválido: no es JSON válido.');
        return { ok: false, errors: ['invalid JSON', err && err.message ? err.message : String(err)] };
    }

    const invalid = prevalidate(bundle);
    if (invalid) {
        toast().showError(`Archivo de backup inválido: ${invalid}`);
        return { ok: false, errors: ['Pre-validation failed', invalid] };
    }

    // Fill the confirmation modal with bundle metadata.
    const list = document.getElementById('importBundleInfo');
    list.innerHTML = '';
    const createdAt = new Date(bundle.timestamp);
    const items = [
        `Creado: ${isNaN(createdAt) ? bundle.timestamp : createdAt.toLocaleString()}`,
        `Versión de base de datos: ${bundle.dbVersion ?? 'desconocida'}`,
        `Stores incluidos: ${Object.keys(bundle.stores || {}).length}`,
    ];
    items.forEach((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        list.appendChild(li);
    });
    document.getElementById('importError').textContent = '';

    // Wire the confirm button for this flow.
    document.getElementById('btnConfirmImport').onclick = async () => {
        const result = await storage().importAll(bundle);
        if (!result.ok) {
            const errEl = document.getElementById('importError');
            errEl.textContent = `Error al importar: ${(result.errors || []).join('; ')}`;
            return result;
        }
        const modalEl = document.getElementById('importConfirmModal');
        if (window.bootstrap && bootstrap.Modal) {
            bootstrap.Modal.getInstance(modalEl)?.hide();
        }
        toast().showSuccess('Backup importado correctamente. Recargando...');
        setTimeout(() => location.reload(), 1200);
        return result;
    };

    // Show the confirmation modal.
    const modalEl = document.getElementById('importConfirmModal');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
    return { ok: true, errors: [], modal: true, bundle };
}

// Opens the hidden file picker; the picked file flows through
// handlePickedFile() via the input's change event. Resolves once the flow
// reaches a terminal state (validation done / modal shown / cancelled).
// Never throws.
async function uploadPackage() {
    const fileInput = document.getElementById('fileInputFPKG');
    if (!fileInput) {
        return { ok: false, errors: ['File input not found.'] };
    }

    fileInput.value = '';
    fileInput.click();
    return new Promise((resolve) => {
        fileInput.onchange = (e) => {
            const file = e.target.files && e.target.files[0];
            handlePickedFile(file).then(resolve);
        };
    });
}

// --- Event wiring --------------------------------------------------

// NOTE: The picked-file handling lives exclusively inside uploadPackage()
// (which reassigns fileInput.onchange per flow). No module-level 'change'
// listener is added here, to avoid double-handling when a file is picked:
// both an addEventListener fallback and uploadPackage's onchange would
// otherwise fire handlePickedFile() twice.

// --- Exports -----------------------------------------------------

if (typeof window !== 'undefined') {
    window.fpCloudSync = { downloadPackage, uploadPackage };
}
// Node (vitest) exports for tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        downloadPackage,
        uploadPackage,
        handlePickedFile,
        prevalidate,
        backupFilename,
        readFileAsText,
    };
}
