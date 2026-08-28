// =====================================================================
// FINANZAS PERSONALES 2026 — Capa criptográfica (envelope de contraseña)
// Módulo PURO de Web Crypto: sin DOM, sin persistencia (storage.js guarda el
// meta). Un DEK aleatorio se envuelve con una KEK derivada de la contraseña
// (PBKDF2-SHA256); solo wrappedDek + salt se persisten.
// =====================================================================

const ENVELOPE_VERSION = 1;
const CIPHER_ALG = 'AES-GCM-256';
const KDF_ALG = 'PBKDF2-SHA256';
const PBKDF2_ITERATIONS = 310000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const DEK_BYTES = 32;
const KDF_DKLEN = 44; // 32 bytes KEK + 12 bytes IV de wrap determinista
const B64_CHUNK = 0xFFFF; // chunks ~64 KB (límite de btoa/apply)

let state = { ready: false, dek: null, salt: null, iterations: PBKDF2_ITERATIONS };

// --- Errores de dominio ----------------------------------------------------

class SecureContextError extends Error {
    constructor(message = 'Cifrado requiere un contexto seguro (localhost o HTTPS).') {
        super(message);
        this.name = 'SecureContextError';
    }
}

class PassphraseTooShortError extends Error {
    constructor(message = 'La contraseña debe tener mínimo 8 caracteres.') {
        super(message);
        this.name = 'PassphraseTooShortError';
    }
}

class WrongPassphraseError extends Error {
    constructor(message = 'Contraseña incorrecta.') {
        super(message);
        this.name = 'WrongPassphraseError';
    }
}

class EncryptionNotReadyError extends Error {
    constructor(message = 'Cifrado no inicializado: ejecutá init(passphrase, meta) primero.') {
        super(message);
        this.name = 'EncryptionNotReadyError';
    }
}

class PayloadAuthError extends Error {
    constructor(message = 'Envoltorio corrupto o almacén incorrecto.') {
        super(message);
        this.name = 'PayloadAuthError';
    }
}

// --- Base64 por chunks (>64 KB, límite de btoa/apply) ----------------------

function toB64(bytes) {
    const view = ArrayBuffer.isView(bytes) ? bytes : new Uint8Array(bytes);
    let bin = '';
    for (let i = 0; i < view.length; i += B64_CHUNK) {
        bin += String.fromCharCode.apply(null, view.subarray(i, i + B64_CHUNK));
    }
    return btoa(bin);
}

function fromB64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

// --- Guarda de contexto seguro (DE3) ---------------------------------------

function assertSecureContext() {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (!subtle || typeof subtle.importKey !== 'function' || typeof subtle.deriveBits !== 'function'
        || typeof subtle.encrypt !== 'function' || typeof subtle.decrypt !== 'function') {
        throw new SecureContextError();
    }
    return true;
}

// --- Derivación de KEK: PBKDF2-SHA256, dkLen 44 = 32 KEK + 12 wrap IV ------

async function deriveKek(passphrase, salt, iterations) {
    assertSecureContext();
    const base = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
    const bits = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, KDF_DKLEN * 8);
    return {
        kek: await globalThis.crypto.subtle.importKey('raw', bits.slice(0, DEK_BYTES), 'AES-GCM', false, ['wrapKey', 'unwrapKey']),
        wrapIv: bits.slice(DEK_BYTES, KDF_DKLEN),
    };
}

async function wrapDek(passphrase) {
    const { kek, wrapIv } = await deriveKek(passphrase, state.salt, state.iterations);
    const wrapped = await globalThis.crypto.subtle.wrapKey('raw', state.dek, kek, { name: 'AES-GCM', iv: wrapIv, tagLength: 128 });
    return toB64(wrapped);
}

async function buildMeta(passphrase) {
    return {
        v: ENVELOPE_VERSION,
        alg: KDF_ALG,
        iterations: state.iterations,
        salt: toB64(state.salt),
        wrappedDek: await wrapDek(passphrase),
        updatedAt: Date.now(),
    };
}

// --- init: primer arranque (meta null) o desbloqueo (meta guardado) --------

async function init(passphrase, meta) {
    assertSecureContext();
    if (typeof passphrase !== 'string' || passphrase.length < 8) throw new PassphraseTooShortError();

    if (!meta) {
        // Primer arranque: salt fresco + DEK aleatorio; el caller persiste el meta.
        state.salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
        state.dek = await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        state.ready = true;
        return buildMeta(passphrase);
    }

    // Desbloqueo: la KEK desenvuelve el DEK guardado (GCM autenticado).
    const { kek, wrapIv } = await deriveKek(passphrase, fromB64(meta.salt), meta.iterations || PBKDF2_ITERATIONS);
    try {
        state.dek = await globalThis.crypto.subtle.unwrapKey('raw', fromB64(meta.wrappedDek), kek,
            { name: 'AES-GCM', iv: wrapIv, tagLength: 128 },
            { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    } catch {
        // El wrap GCM solo falla con una KEK equivocada => contraseña incorrecta (DE5).
        throw new WrongPassphraseError();
    }
    state.salt = fromB64(meta.salt);
    state.iterations = meta.iterations || PBKDF2_ITERATIONS;
    state.ready = true;
    return meta;
}

// --- changePassphrase: re-envuelve el MISMO DEK, nunca re-cifra (DE6) ------

async function changePassphrase(current, next) {
    if (typeof next !== 'string' || next.length < 8) throw new PassphraseTooShortError();
    if (!state.ready) throw new EncryptionNotReadyError();

    // Re-autenticar con la contraseña actual (el wrap GCM solo acepta la KEK correcta).
    const currentMeta = { salt: toB64(state.salt), wrappedDek: await wrapDek(current), iterations: state.iterations };
    await init(current, currentMeta); // WrongPassphraseError si current no coincide (DE5)

    // Re-envolver el mismo DEK con salt fresco + la nueva contraseña (DE6).
    state.salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    return buildMeta(next); // el caller persiste { salt, wrappedDek, iterations }
}

// --- Envelope de payload: AES-GCM-256, IV 12B aleatorio, AAD = store -------

async function encryptPayload(storeName, obj) {
    if (!state.ready) throw new EncryptionNotReadyError();
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const plain = new TextEncoder().encode(JSON.stringify(obj));
    const ct = await globalThis.crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv,
        tagLength: 128,
        additionalData: new TextEncoder().encode(storeName),
    }, state.dek, plain);
    return { v: ENVELOPE_VERSION, alg: CIPHER_ALG, salt: toB64(state.salt), iv: toB64(iv), ct: toB64(ct) };
}

async function decryptPayload(storeName, enc) {
    if (!state.ready) throw new EncryptionNotReadyError();
    try {
        const plain = await globalThis.crypto.subtle.decrypt({
            name: 'AES-GCM',
            iv: fromB64(enc.iv),
            tagLength: 128,
            additionalData: new TextEncoder().encode(storeName),
        }, state.dek, fromB64(enc.ct));
        return JSON.parse(new TextDecoder().decode(plain));
    } catch {
        throw new PayloadAuthError();
    }
}

function isEncryptionReady() {
    return state.ready;
}

// --- Exports: window.fpCrypto (NUNCA window.crypto) + module.exports --------

const publicApi = { init, changePassphrase, encryptPayload, decryptPayload, isEncryptionReady, assertSecureContext, toB64, fromB64 };

if (typeof module !== 'undefined' && module.exports) module.exports = publicApi;
if (typeof window !== 'undefined') window.fpCrypto = publicApi; // no usar window.crypto: colisiona con el global de Web Crypto