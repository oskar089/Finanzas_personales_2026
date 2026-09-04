// Secure backup UI orchestration.

const ACCEPTED_BACKUP_TYPES = new Set(['', 'application/json', 'application/octet-stream']);

function createCloudSync(dependencies = {}) {
    const getDocument = () => dependencies.document || document;
    const getStorage = dependencies.storage || (() => window.storage);
    const getToast = dependencies.toast || (() => window.toast);
    const getModal = dependencies.modal || (() => {
        const modalEl = getDocument().getElementById('importConfirmModal');
        return window.bootstrap?.Modal?.getOrCreateInstance(modalEl);
    });
    const reload = dependencies.reload || (() => window.location.reload());

    function showError(message) {
        getToast()?.showError(message);
    }

    function backupFilename() {
        const now = new Date();
        const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
        return `finanzas-backup-${date}.fpkg`;
    }

    function isBackupFile(file) {
        return !!file
            && typeof file.name === 'string'
            && file.name.toLowerCase().endsWith('.fpkg')
            && ACCEPTED_BACKUP_TYPES.has(file.type || '');
    }

    function isCandidateBundle(bundle) {
        return !!bundle
            && typeof bundle === 'object'
            && !Array.isArray(bundle)
            && bundle.version === 1
            && bundle.cryptoMeta
            && typeof bundle.cryptoMeta === 'object'
            && bundle.stores
            && typeof bundle.stores === 'object'
            && !Array.isArray(bundle.stores);
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error('File read failed.'));
            reader.readAsText(file);
        });
    }

    function disableInteractiveControls() {
        getDocument().querySelectorAll('button, input, select, textarea').forEach((control) => {
            control.disabled = true;
        });
    }

    function setImportLock(message, canReload) {
        const page = getDocument();
        disableInteractiveControls();
        page.body.setAttribute('aria-busy', 'true');

        let overlay = page.getElementById('backupImportLock');
        if (!overlay) {
            overlay = page.createElement('div');
            overlay.id = 'backupImportLock';
            overlay.className = 'position-fixed top-0 start-0 end-0 bottom-0 bg-body-tertiary d-flex align-items-center justify-content-center text-center p-4';
            overlay.style.zIndex = '2090';
            page.body.appendChild(overlay);
        }

        overlay.replaceChildren();
        const panel = page.createElement('div');
        const title = page.createElement('h2');
        title.className = 'h4 mb-3';
        title.textContent = canReload ? '🔒 Backup import failed' : '🔒 Restoring backup';
        const detail = page.createElement('p');
        detail.className = 'text-muted mb-0';
        detail.textContent = message;
        panel.append(title, detail);

        if (canReload) {
            const reloadButton = page.createElement('button');
            reloadButton.type = 'button';
            reloadButton.className = 'btn btn-primary mt-3';
            reloadButton.textContent = 'Reload and unlock';
            reloadButton.addEventListener('click', reload);
            panel.appendChild(reloadButton);
        }

        overlay.appendChild(panel);
    }

    async function downloadPackage() {
        try {
            const bundle = await getStorage().exportAll();
            const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = getDocument().createElement('a');
            anchor.href = url;
            anchor.download = backupFilename();
            getDocument().body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            return { ok: true };
        } catch {
            showError('Could not create the backup file.');
            return { ok: false };
        }
    }

    async function confirmImport(bundle) {
        const page = getDocument();
        const passphraseInput = page.getElementById('importPassphrase');
        const errorEl = page.getElementById('importError');
        let passphrase = passphraseInput.value;

        if (!passphrase) {
            errorEl.textContent = 'Enter the backup passphrase.';
            return { ok: false };
        }

        passphraseInput.value = '';
        getModal()?.hide();
        setImportLock('Restoring backup. Please wait.', false);

        try {
            const result = await getStorage().importAll(bundle, passphrase);
            if (!result || !result.ok) {
                setImportLock('Backup import failed. Reload and unlock before continuing.', true);
                showError('Backup import failed. Reload and unlock before continuing.');
                return { ok: false };
            }

            setImportLock('Backup restored. Reloading...', false);
            getToast()?.showSuccess('Backup restored. Reloading...');
            reload();
            return { ok: true };
        } catch {
            setImportLock('Backup import failed. Reload and unlock before continuing.', true);
            showError('Backup import failed. Reload and unlock before continuing.');
            return { ok: false };
        } finally {
            passphrase = '';
        }
    }

    function showImportConfirmation(bundle) {
        const page = getDocument();
        const list = page.getElementById('importBundleInfo');
        const createdAt = new Date(bundle.timestamp);
        const details = [
            `Created: ${Number.isNaN(createdAt.getTime()) ? bundle.timestamp || 'unknown' : createdAt.toLocaleString()}`,
            `Database version: ${bundle.dbVersion ?? 'unknown'}`,
            `Encrypted stores: ${Object.keys(bundle.stores).length}`,
        ];
        list.replaceChildren(...details.map((detail) => {
            const item = page.createElement('li');
            item.textContent = detail;
            return item;
        }));
        page.getElementById('importPassphrase').value = '';
        page.getElementById('importError').textContent = '';
        page.getElementById('btnConfirmImport').onclick = () => confirmImport(bundle);
        getModal()?.show();
    }

    async function handlePickedFile(file) {
        if (!isBackupFile(file)) {
            showError('Choose a valid .fpkg backup file.');
            return { ok: false };
        }

        let text;
        try {
            text = await readFileAsText(file);
        } catch {
            showError('Could not read the backup file.');
            return { ok: false };
        }

        let bundle;
        try {
            bundle = JSON.parse(text);
        } catch {
            showError('The backup file is not valid JSON.');
            return { ok: false };
        }

        if (!isCandidateBundle(bundle)) {
            showError('The backup package has an unsupported format.');
            return { ok: false };
        }

        showImportConfirmation(bundle);
        return { ok: true };
    }

    async function uploadPackage() {
        const input = getDocument().getElementById('fileInputFPKG');
        if (!input) {
            showError('Backup file input is unavailable.');
            return { ok: false };
        }

        input.value = '';
        input.click();
        return new Promise((resolve) => {
            input.onchange = async (event) => {
                try {
                    resolve(await handlePickedFile(event.target.files?.[0]));
                } catch {
                    showError('Could not read the backup file.');
                    resolve({ ok: false });
                }
            };
        });
    }

    return { backupFilename, confirmImport, downloadPackage, handlePickedFile, isBackupFile, readFileAsText, uploadPackage };
}

const cloudSync = createCloudSync();

if (typeof window !== 'undefined') window.fpCloudSync = cloudSync;
if (typeof module !== 'undefined' && module.exports) module.exports = { ...cloudSync, createCloudSync };
