// =====================================================================
// Tests para src/boot.js — lógica pura de arranque (boot) del cifrado
// =====================================================================
// Se corre con: npx vitest run src/boot.test.js (jsdom default)
// Cubre tasks PR4 1.1 (determineBootState) y 1.2 (errorToInlineMessage).
// =====================================================================

// La colección de import falla hasta que src/boot.js exista (RED garantizado).
import { determineBootState, errorToInlineMessage, shouldBlockOnStorageReadError } from './boot.js';

// -------------------------------------------------------------------
// determineBootState({ hasKey, isReady, secureContext })
// Orden de precedencia: secure-context-error → ready → setup/unlock.
// -------------------------------------------------------------------
describe('determineBootState()', () => {
    it('sin clave y sin desbloquear en contexto seguro → setup', () => {
        expect(determineBootState({ hasKey: false, isReady: false, secureContext: true })).toBe('setup');
    });

    it('con clave guardada y sin desbloquear → unlock', () => {
        expect(determineBootState({ hasKey: true, isReady: false, secureContext: true })).toBe('unlock');
    });

    it('ya desbloqueada en este arranque → ready', () => {
        expect(determineBootState({ hasKey: true, isReady: true, secureContext: true })).toBe('ready');
    });

    it('desbloqueada sin clave persistida también → ready (isReady gana a hasKey)', () => {
        expect(determineBootState({ hasKey: false, isReady: true, secureContext: true })).toBe('ready');
    });

    it('contexto inseguro y sin clave → secure-context-error', () => {
        expect(determineBootState({ hasKey: false, isReady: false, secureContext: false })).toBe('secure-context-error');
    });

    it('contexto inseguro anula clave guardada (refuse gana)', () => {
        expect(determineBootState({ hasKey: true, isReady: false, secureContext: false })).toBe('secure-context-error');
    });

    it('contexto inseguro anula incluso el estado desbloqueado (refuse gana)', () => {
        expect(determineBootState({ hasKey: true, isReady: true, secureContext: false })).toBe('secure-context-error');
    });
});

// -------------------------------------------------------------------
// errorToInlineMessage(err) — mapea errores del dominio de cifrado a
// mensajes inline; nunca filtra el mensaje interno del error.
// -------------------------------------------------------------------
describe('errorToInlineMessage()', () => {
    function namedError(name, message) {
        const err = new Error(message || 'error interno');
        err.name = name;
        return err;
    }

    it('WrongPassphraseError → /Contraseña incorrecta/i', () => {
        expect(errorToInlineMessage(namedError('WrongPassphraseError'))).toMatch(/Contraseña incorrecta/i);
    });

    it('PassphraseTooShortError → /mínimo 8 caracteres/i', () => {
        expect(errorToInlineMessage(namedError('PassphraseTooShortError'))).toMatch(/mínimo 8 caracteres/i);
    });

    it('SecureContextError → /contexto seguro/i', () => {
        expect(errorToInlineMessage(namedError('SecureContextError'))).toMatch(/contexto seguro/i);
    });

    it('KeyMaterialMissingError → mensaje de rechazo que no filtra el error', () => {
        const err = namedError('KeyMaterialMissingError', 'Faltan los materiales de clave para datos cifrados existentes.');
        const msg = errorToInlineMessage(err);
        expect(msg).toMatch(/No se pudo inicializar el cifrado/i);
        expect(msg).not.toMatch(/materiales de clave/i);
        expect(msg).not.toContain(err.message);
    });

    it('error genérico (sin nombre de dominio) → mensaje de rechazo que no filtra el error', () => {
        const err = new Error('detalle interno sensible: DERIVE_FAIL_0x7F');
        const msg = errorToInlineMessage(err);
        expect(msg).toMatch(/No se pudo inicializar el cifrado/i);
        expect(msg).not.toContain('DERIVE_FAIL_0x7F');
        expect(msg).not.toContain(err.message);
    });
});

describe('shouldBlockOnStorageReadError()', () => {
    it('bloquea el boot cuando storage rechaza un envelope cifrado', () => {
        expect(shouldBlockOnStorageReadError({ name: 'EncryptedStorageReadError' })).toBe(true);
    });

    it('no bloquea por errores ajenos a la lectura cifrada', () => {
        expect(shouldBlockOnStorageReadError(new Error('IndexedDB unavailable'))).toBe(false);
    });
});
