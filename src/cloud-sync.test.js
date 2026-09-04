import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const VALID_BUNDLE = {
    version: 1,
    dbVersion: 7,
    timestamp: '2026-09-04T20:30:00.000Z',
    cryptoMeta: { id: 'meta' },
    stores: { entries: [] },
};

function createFile({ name = 'finanzas-backup.fpkg', type = 'application/json', text = JSON.stringify(VALID_BUNDLE) } = {}) {
    return { name, type, text };
}

function createDeferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

class FakeFileReader {
    readAsText(file) {
        if (file.text instanceof Error) {
            this.error = file.text;
            this.onerror();
            return;
        }
        this.result = file.text;
        this.onload();
    }
}

describe('secure backup UI orchestration', () => {
    let cloudSync;
    let storage;
    let toast;
    let reload;
    let modal;

    beforeEach(async () => {
        vi.resetModules();
        vi.stubGlobal('FileReader', FakeFileReader);
        document.body.innerHTML = `
            <input id="fileInputFPKG" type="file">
            <button id="writeControl">Save</button>
            <div id="importConfirmModal"></div>
            <ul id="importBundleInfo"></ul>
            <input id="importPassphrase" type="password">
            <div id="importError"></div>
            <button id="btnConfirmImport">Import</button>
        `;
        storage = {
            exportAll: vi.fn().mockResolvedValue(VALID_BUNDLE),
            importAll: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
        };
        toast = { showError: vi.fn(), showSuccess: vi.fn() };
        reload = vi.fn();
        modal = { show: vi.fn(), hide: vi.fn() };

        const module = await import('./cloud-sync.js');
        cloudSync = module.createCloudSync({
            document,
            storage: () => storage,
            toast: () => toast,
            modal: () => modal,
            reload,
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('reports export failures without leaking the underlying error', async () => {
        storage.exportAll.mockRejectedValue(new Error('storage internals'));

        await expect(cloudSync.downloadPackage()).resolves.toEqual({ ok: false });

        expect(toast.showError).toHaveBeenCalledWith('Could not create the backup file.');
    });

    it.each([
        ['a.txt', 'application/json'],
        ['a.fpkg', 'image/png'],
    ])('rejects an unsupported backup file type: %s', async (name, type) => {
        const result = await cloudSync.handlePickedFile(createFile({ name, type }));

        expect(result).toEqual({ ok: false });
        expect(toast.showError).toHaveBeenCalledWith('Choose a valid .fpkg backup file.');
        expect(storage.importAll).not.toHaveBeenCalled();
    });

    it('reports JSON parsing failures without opening the confirmation modal', async () => {
        const result = await cloudSync.handlePickedFile(createFile({ text: 'not valid JSON' }));

        expect(result).toEqual({ ok: false });
        expect(toast.showError).toHaveBeenCalledWith('The backup file is not valid JSON.');
        expect(modal.show).not.toHaveBeenCalled();
    });

    it('reports file read failures without opening the confirmation modal', async () => {
        const result = await cloudSync.handlePickedFile(createFile({ text: new Error('read failed') }));

        expect(result).toEqual({ ok: false });
        expect(toast.showError).toHaveBeenCalledWith('Could not read the backup file.');
        expect(modal.show).not.toHaveBeenCalled();
    });

    it('forwards the explicitly-entered passphrase and clears it before import', async () => {
        await cloudSync.handlePickedFile(createFile());
        document.getElementById('importPassphrase').value = 'backup passphrase';
        storage.importAll.mockImplementation(async (_bundle, passphrase) => {
            expect(passphrase).toBe('backup passphrase');
            expect(document.getElementById('importPassphrase').value).toBe('');
            return { ok: true, errors: [] };
        });

        await document.getElementById('btnConfirmImport').onclick();

        expect(storage.importAll).toHaveBeenCalledWith(VALID_BUNDLE, 'backup passphrase');
        expect(reload).toHaveBeenCalledOnce();
    });

    it('does not start the import without a passphrase', async () => {
        await cloudSync.handlePickedFile(createFile());

        await document.getElementById('btnConfirmImport').onclick();

        expect(storage.importAll).not.toHaveBeenCalled();
        expect(document.getElementById('importError').textContent).toBe('Enter the backup passphrase.');
    });

    it('blocks interactions before an in-progress import can alter crypto state', async () => {
        const pending = createDeferred();
        storage.importAll.mockReturnValue(pending.promise);
        await cloudSync.handlePickedFile(createFile());
        document.getElementById('importPassphrase').value = 'backup passphrase';

        const importPromise = document.getElementById('btnConfirmImport').onclick();

        expect(document.getElementById('writeControl').disabled).toBe(true);
        expect(document.getElementById('backupImportLock')).not.toBeNull();
        expect(document.getElementById('backupImportLock').textContent).toContain('Restoring backup');
        pending.resolve({ ok: false, errors: ['Backup authentication failed.'] });
        await importPromise;
    });

    it('keeps the application locked after a failed import result', async () => {
        storage.importAll.mockResolvedValue({ ok: false, errors: ['Backup authentication failed.'] });
        await cloudSync.handlePickedFile(createFile());
        document.getElementById('importPassphrase').value = 'wrong passphrase';

        await document.getElementById('btnConfirmImport').onclick();

        expect(document.getElementById('writeControl').disabled).toBe(true);
        expect(document.getElementById('backupImportLock').textContent).toContain('Reload and unlock');
        expect(reload).not.toHaveBeenCalled();
        expect(toast.showError).toHaveBeenCalledWith('Backup import failed. Reload and unlock before continuing.');
    });

    it('keeps the application locked when importAll throws', async () => {
        storage.importAll.mockRejectedValue(new Error('storage internals'));
        await cloudSync.handlePickedFile(createFile());
        document.getElementById('importPassphrase').value = 'backup passphrase';

        await document.getElementById('btnConfirmImport').onclick();

        expect(document.getElementById('writeControl').disabled).toBe(true);
        expect(document.getElementById('backupImportLock').textContent).toContain('Reload and unlock');
        expect(reload).not.toHaveBeenCalled();
    });

    it('transitions immediately to a non-interactive reload state after a successful import', async () => {
        await cloudSync.handlePickedFile(createFile());
        document.getElementById('importPassphrase').value = 'backup passphrase';

        await document.getElementById('btnConfirmImport').onclick();

        expect(document.getElementById('writeControl').disabled).toBe(true);
        expect(document.getElementById('backupImportLock').textContent).toContain('Reloading');
        expect(modal.hide).toHaveBeenCalledOnce();
        expect(reload).toHaveBeenCalledOnce();
    });
});
