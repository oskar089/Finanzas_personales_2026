// =====================================================================
// Tests para src/cloud-sync.js
// =====================================================================
// Corre con: npx vitest run src/cloud-sync.test.js
// Mocks URL.createObjectURL/revokeObjectURL y FileReader.
// NOTA: cloud-sync.js captura window.storage/toast al cargar (top-level),
// así que recargamos el módulo con vi.resetModules() + import dinámico
// DESPUÉS de montar los stubs (requiere ESM/EvalSync en este test file,
// que es el aserción de que el import estático no es usable aquí).
// =====================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Valores de retorno mockeados ------------------------------------

// Bundle .fpkg válido (estructura idéntica a la real exportAll())
const VALID_BUNDLE = {
    version: 1,
    dbVersion: 7,
    timestamp: '2026-09-02T20:30:00.000Z',
    cryptoMeta: { id: 'meta', v: 1, alg: 'PBKDF2-SHA256', iterations: 600000, salt: 'dGVzdA==', wrappedDek: 'dGVzdA==' },
    stores: {
        entries: [{ id: '__enc__', v: 1, alg: 'AES-GCM-256', salt: 'dGVzdA==', iv: 'dGVzdA==', ct: 'dGVzdA==' }],
        budgets: [{ categoria: '__enc__', v: 1, alg: 'AES-GCM-256', salt: 'dGVzdA==', iv: 'dGVzdA==', ct: 'dGVzdA==' }],
        recurring: [],
        customCategories: [],
        aiSettings: [],
        settings: []
    }
};

const VALID_BUNDLE_JSON = JSON.stringify(VALID_BUNDLE);

// Bundle con versión no soportada
const WRONG_VERSION_JSON = JSON.stringify({ ...VALID_BUNDLE, version: 99 });

// --- Mocks globales --------------------------------------------------

// Objeto que simula un File para FileReader
function fakeFile(text) {
    return { name: 'finanzas-backup-2026-09-02.fpkg', _text: text };
}

// FileReader mockeado
class FakeFileReader {
    static instances = [];
    result = null;
    onload = null;
    onerror = null;
    readAsText(file) {
        FakeFileReader.instances.push(file);
        if (typeof file._text === 'string') {
            this.result = file._text;
            if (this.onload) this.onload();
        } else if (file._error) {
            if (this.onerror) this.onerror();
        }
    }
}

let cloudSync; // módulo recargado por test

beforeEach(async () => {
    vi.resetModules();

    // Mockear los estáticos de URL (no reemplazar el constructor global)
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();

    // Storage mock
    window.storage = {
        exportAll: vi.fn().mockResolvedValue(VALID_BUNDLE),
        importAll: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
    };

    // Toast mock
    window.toast = {
        showError: vi.fn(),
        showSuccess: vi.fn(),
    };

    // Domario mínimo para los modales
    document.body.innerHTML = `
        <input type="file" id="fileInputFPKG" accept=".fpkg" class="d-none">
        <div class="modal fade" id="importConfirmModal"></div>
        <ul id="importBundleInfo"></ul>
        <div id="importError"></div>
        <button type="button" id="btnConfirmImport"></button>
    `;

    // Bootstrap Modal mock
    window.bootstrap = {
        Modal: class {
            static getOrCreateInstance() { return { show: vi.fn(), hide: vi.fn() }; }
            static getInstance() { return null; }
            constructor() {}
        },
    };

    // FileReader global
    FakeFileReader.instances = [];
    vi.stubGlobal('FileReader', FakeFileReader);

    // Importar cloud-sync.js AHORA que window.storage/toast existen
    cloudSync = await import('./cloud-sync.js');
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});describe('downloadPackage()', () => {
    it('creates a Blob and triggers a download via createObjectURL', async () => {
        const spyCreate = window.URL.createObjectURL;

        await cloudSync.downloadPackage();

        // exportAll fue llamado
        expect(window.storage.exportAll).toHaveBeenCalled();
        // createObjectURL fue llamado con un Blob
        expect(spyCreate).toHaveBeenCalledTimes(1);
        const blobArg = spyCreate.mock.calls[0][0];
        expect(blobArg).toBeInstanceOf(Blob);
        // El contenido del Blob es el JSON del bundle
        const text = await blobArg.text();
        const parsed = JSON.parse(text);
        expect(parsed.version).toBe(1);
        expect(parsed.stores.entries).toHaveLength(1);
    });

    it('names the download finanzas-backup-YYYY-MM-DD.fpkg', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-02T15:00:00Z'));

        let capturedDownload = null;
        const origCreate = document.createElement.bind(document);
        document.createElement = function (tag) {
            const el = origCreate(tag);
            if (tag.toLowerCase() === 'a') {
                el.download = '';
                const original = el.download;
                Object.defineProperty(el, 'download', {
                    get() { return this._download || original; },
                    set(v) { this._download = v; if (v) capturedDownload = v; },
                    configurable: true,
                });
                el.click = vi.fn();
            }
            return el;
        };

        await cloudSync.downloadPackage();

        expect(capturedDownload).toBe('finanzas-backup-2026-09-02.fpkg');
        vi.useRealTimers();
    });

    it('rejects when exportAll() fails', async () => {
        window.storage.exportAll.mockRejectedValue(new Error('IDB down'));
        await expect(cloudSync.downloadPackage()).rejects.toThrow('IDB down');
    });
});

describe('handlePickedFile() (valid bundle flow, exposed via module)', () => {
    it('parses valid JSON and shows the confirmation modal', async () => {
        const showSpy = vi.fn();
        window.bootstrap.Modal = class {
            static getOrCreateInstance() { return { show: showSpy, hide: vi.fn() }; }
        };

        const result = await cloudSync.handlePickedFile(fakeFile(VALID_BUNDLE_JSON));

        expect(result.ok).toBe(true);
        expect(showSpy).toHaveBeenCalledTimes(1);
        // El modal pobló el resumen con metadata del bundle
        const infoText = document.getElementById('importBundleInfo').textContent;
        expect(infoText).toContain('Creado:');
        expect(infoText).toContain('Versión de base de datos: 7');
    });

    it('calls importAll and shows success on confirm', async () => {
        await cloudSync.handlePickedFile(fakeFile(VALID_BUNDLE_JSON));
        const confirmBtn = document.getElementById('btnConfirmImport');
        expect(confirmBtn.onclick).toBeTypeOf('function');

        const result = await confirmBtn.onclick();

        expect(window.storage.importAll).toHaveBeenCalledWith(VALID_BUNDLE);
        expect(result.ok).toBe(true);
        expect(window.toast.showSuccess).toHaveBeenCalled();
    });

    it('rejects invalid JSON without showing modal or calling importAll', async () => {
        const result = await cloudSync.handlePickedFile(fakeFile('not json {{{'));

        expect(result.ok).toBe(false);
        expect(window.toast.showError).toHaveBeenCalled();
        expect(window.storage.importAll).not.toHaveBeenCalled();
    });

    it('rejects wrong version without showing modal', async () => {
        const result = await cloudSync.handlePickedFile(fakeFile(WRONG_VERSION_JSON));

        expect(result.ok).toBe(false);
        expect(window.toast.showError).toHaveBeenCalledWith(
            expect.stringContaining('no soportada')
        );
        expect(window.storage.importAll).not.toHaveBeenCalled();
    });
});

describe('uploadPackage() (picker orchestration)', () => {
    it('opens the file picker (input.click) and handles the picked file', async () => {
        const input = document.getElementById('fileInputFPKG');
        const clickSpy = vi.fn();
        input.click = clickSpy;

        const promise = cloudSync.uploadPackage();

        // Simular que el usuario eligió un archivo válido
        input.onchange({ target: { files: [fakeFile(VALID_BUNDLE_JSON)] } });
        await new Promise((r) => setTimeout(r, 0));

        expect(clickSpy).toHaveBeenCalledTimes(1);
        await expect(promise).resolves.toMatchObject({ ok: true });
    });

    it('handles cancelled file picker (no file) with no import', async () => {
        const input = document.getElementById('fileInputFPKG');
        input.click = vi.fn();

        const promise = cloudSync.uploadPackage();

        // Cancelar: sin archivo seleccionado
        input.onchange({ target: { files: [] } });
        await new Promise((r) => setTimeout(r, 0));

        const result = await promise;
        expect(result.ok).toBe(false);
        expect(window.storage.importAll).not.toHaveBeenCalled();
    });
});
