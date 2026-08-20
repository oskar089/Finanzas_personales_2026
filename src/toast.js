// =====================================================================
// FINANZAS PERSONALES 2026 - Sistema de Toasts
// =====================================================================
// Notificaciones no intrusivas que reemplazan alert()
// =====================================================================

let toastContainer = null;
let toastId = 0;

// --- Inicialización ---------------------------------------------------

function initToastContainer() {
    if (toastContainer) return;

    toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
    toastContainer.style.zIndex = '1080'; // arriba de modals
    document.body.appendChild(toastContainer);
}

// --- API pública ------------------------------------------------------

function showToast(message, type = 'info', duration = 3000) {
    initToastContainer();

    const id = ++toastId;
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    const bgClass = {
        success: 'bg-success',
        error: 'bg-danger',
        warning: 'bg-warning text-dark',
        info: 'bg-info text-dark'
    };

    const toast = document.createElement('div');
    toast.id = `toast-${id}`;
    toast.className = `toast ${bgClass[type] || 'bg-info'} text-white`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = `
        <div class="toast-header ${bgClass[type] || 'bg-info'} text-white">
            <strong class="me-auto">${icons[type] || 'ℹ️'} Notificación</strong>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Cerrar"></button>
        </div>
        <div class="toast-body">${escapeHTML(message)}</div>
    `;

    toastContainer.appendChild(toast);

    // Bootstrap toast
    const bsToast = new bootstrap.Toast(toast, {
        delay: duration,
        autohide: true
    });
    bsToast.show();

    // Limpiar del DOM al ocultar
    toast.addEventListener('hidden.bs.toast', () => {
        toast.remove();
    });

    return id;
}

// --- Helpers de conveniencia ------------------------------------------

function showSuccess(message, duration = 3000) {
    return showToast(message, 'success', duration);
}

function showError(message, duration = 5000) {
    return showToast(message, 'error', duration);
}

function showWarning(message, duration = 4000) {
    return showToast(message, 'warning', duration);
}

function showInfo(message, duration = 3000) {
    return showToast(message, 'info', duration);
}

// --- Exports ----------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { showToast, showSuccess, showError, showWarning, showInfo, initToastContainer };
}

if (typeof window !== 'undefined') {
    window.toast = { showToast, showSuccess, showError, showWarning, showInfo, initToastContainer };
}