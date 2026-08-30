// =====================================================================
// FINANZAS PERSONALES 2026 — Lógica pura de arranque (boot)
// ---------------------------------------------------------------------
// Decide el estado de boot del cifrado (setup/unlock/ready/error) y
// mapea errores del dominio de cifrado a mensajes inline para la UX.
// Módulo puro: sin DOM, sin Web Crypto, sin persistencia — testable en
// jsdom. Dual export: window.FPBoot + module.exports (patrón de
// crypto.js/storage.js).
// =====================================================================

// Determina el estado de arranque de la app a partir de:
//   hasKey         — existe material de clave persistido (cryptoMeta)
//   isReady        — la DEK ya está resuelta en memoria en este arranque
//   secureContext  — crypto.subtle disponible (localhost/HTTPS)
// Precedencia: secure-context-error (refuse gana, DE3) → ready →
// hasKey ? unlock : setup (DE4).
function determineBootState({ hasKey, isReady, secureContext } = {}) {
    if (secureContext === false) return 'secure-context-error';
    if (isReady) return 'ready';
    return hasKey ? 'unlock' : 'setup';
}

// Mapea errores del dominio de cifrado a mensajes inline legibles.
// El mensaje del error original NUNCA se filtra al usuario: puede
// contener detalles internos sensibles. Los errores no mapeados caen
// en el mensaje de rechazo genérico.
function errorToInlineMessage(err) {
    switch (err && err.name) {
        case 'WrongPassphraseError':
            return 'Contraseña incorrecta';
        case 'PassphraseTooShortError':
            return 'La contraseña debe tener mínimo 8 caracteres.';
        case 'SecureContextError':
            return 'Se requiere un contexto seguro (localhost o HTTPS).';
        default:
            return 'No se pudo inicializar el cifrado. Cerra y volvé a abrir la app.';
    }
}

// --- Exports: window.FPBoot + module.exports ------------------------
// Ojo: el binding debe ser único (const top-level compartido entre scripts
// clásicos); crypto.js ya usa `publicApi` y redeclararlo rompería el parseo.

const bootApi = { determineBootState, errorToInlineMessage };

if (typeof module !== 'undefined' && module.exports) module.exports = bootApi;
if (typeof window !== 'undefined') window.FPBoot = bootApi;