// =====================================================================
// Tests para src/crypto.js — primitivas criptográficas (envelope)
// Corre con: npx vitest run src/crypto.test.js
// Requiere entorno node: jsdom 29 no expone crypto.subtle (node >= 24 sí).
// =====================================================================

// @vitest-environment node

import { vi, describe, it, expect, afterEach } from 'vitest';
import * as fpCrypto from './crypto.js';

afterEach(() => { vi.unstubAllGlobals(); });

// Recarga el módulo desde cero (simula un nuevo boot/dispositivo: sin estado previo).
async function freshModule() {
    vi.resetModules();
    return import('./crypto.js');
}

// --- 1.1 Sanity del entorno: node expone crypto.subtle (jsdom no) ----------
describe('entorno node', () => {
    it('expone crypto.subtle y el módulo carga (motivo del @vitest-environment node)', () => {
        expect(globalThis.crypto.subtle).toBeTruthy();
        expect(typeof fpCrypto.init).toBe('function');
    });
});

// --- DE1: init() — política de contraseña ----------------------------------
describe('init() — passphrase policy (DE1)', () => {
    it('rechaza < 8 caracteres y no deriva nada', async () => {
        await expect(fpCrypto.init('corta', null)).rejects.toThrow(/mínimo 8 caracteres/i);
        expect(fpCrypto.isEncryptionReady()).toBe(false);
    });

    it('acepta débil pero válida (8+ caracteres)', async () => {
        await expect(fpCrypto.init('12345678', null)).resolves.toBeTruthy();
    });

    it('crea meta con salt fresco y DEK envuelto (nunca en claro)', async () => {
        const meta = await fpCrypto.init('contraseña-válida', null);
        expect(meta.salt).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        expect(meta.salt).toHaveLength(24); // base64(16B)
        expect(meta.wrappedDek).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        expect(meta.wrappedDek).toHaveLength(64); // base64(48B) = 32B DEK + tag GCM
        expect(meta.iterations).toBe(310000);
    });
});

// --- DE3: guarda de contexto seguro ----------------------------------------
describe('init() — secure-context guard (DE3)', () => {
    it('rechaza cuando crypto.subtle no existe y no inicia cifrado', async () => {
        vi.stubGlobal('crypto', undefined);
        const mod = await freshModule(); // arranque limpio: nada pudo haberse inicializado
        await expect(mod.init('contraseña-válida', null)).rejects.toThrow(/contexto seguro/i);
        expect(mod.isEncryptionReady()).toBe(false);
    });

    it('assertSecureContext() también lanza sin crypto.subtle', async () => {
        vi.stubGlobal('crypto', undefined);
        const mod = await freshModule();
        expect(() => mod.assertSecureContext()).toThrow(/contexto seguro/i);
    });
});

// --- DE4/DE5: re-prompt en cada boot y contraseña incorrecta ---------------
describe('init() — re-prompt y contraseña incorrecta (DE4/DE5)', () => {
    it('re-prompt (DE4): un módulo fresco desenvuelve con la contraseña correcta', async () => {
        const mod1 = await freshModule();
        const meta = await mod1.init('contraseña-correcta', null);

        const mod2 = await freshModule(); // "relanzar la app": sin estado recordado
        expect(mod2.isEncryptionReady()).toBe(false);
        await mod2.init('contraseña-correcta', meta);
        expect(mod2.isEncryptionReady()).toBe(true);
    });

    it('contraseña incorrecta (DE5): falla limpio y deja el estado intacto', async () => {
        const mod1 = await freshModule();
        const meta = await mod1.init('contraseña-correcta', null);

        const mod2 = await freshModule();
        await expect(mod2.init('contraseña-INCORRECTA', meta))
            .rejects.toMatchObject({ name: 'WrongPassphraseError' });
        expect(mod2.isEncryptionReady()).toBe(false);

        // El intento fallido no mutó nada: reintentar con la correcta sigue funcionando.
        await mod2.init('contraseña-correcta', meta);
        expect(mod2.isEncryptionReady()).toBe(true);
    });
});

// --- DE2: envelope versionado { v, alg, salt, iv, ct } ---------------------
describe('encryptPayload() — envelope (DE2)', () => {
    it('produce un envelope con EXACTAMENTE { v, alg, salt, iv, ct }', async () => {
        await fpCrypto.init('contraseña-envelope', null);
        const env = await fpCrypto.encryptPayload('entries', { monto: 100 });
        expect(Object.keys(env).sort()).toEqual(['alg', 'ct', 'iv', 'salt', 'v']);
        expect(env.v).toBe(1);
        expect(env.alg).toBe('AES-GCM-256');
        expect(env.iv).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        expect(env.iv).toHaveLength(16); // base64(12B)
        expect(env.ct).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        expect(env.salt).toHaveLength(24); // base64(16B): stamp del key material
    });

    it('genera un IV aleatorio de 12 bytes distinto por llamada', async () => {
        await fpCrypto.init('contraseña-envelope', null);
        const env1 = await fpCrypto.encryptPayload('entries', { a: 1 });
        const env2 = await fpCrypto.encryptPayload('entries', { a: 1 });
        expect(env1.iv).not.toBe(env2.iv);
        expect(env1.ct).not.toBe(env2.ct);
    });

    it('round-trip: descifra al payload original (payload pequeño)', async () => {
        const obj = { id: 'abc123', tipo: 'expense', monto: 123.45, fecha: '2026-08-01' };
        const env = await fpCrypto.encryptPayload('entries', obj);
        await expect(fpCrypto.decryptPayload('entries', env)).resolves.toEqual(obj);
    });

    it('round-trip con payload > 64 KB (ejercita el base64 por chunks)', async () => {
        const big = { lista: Array.from({ length: 2000 }, (_, i) => ({ i, texto: 'x'.repeat(40) })) };
        expect(JSON.stringify(big).length).toBeGreaterThan(64 * 1024);
        const env = await fpCrypto.encryptPayload('entries', big);
        await expect(fpCrypto.decryptPayload('entries', env)).resolves.toEqual(big);
    });

    it('meta contiene solo wrappedDek + salt (+ versionado), nunca el DEK/KEK en claro', async () => {
        const meta = await fpCrypto.init('contraseña-envelope', null);
        expect(Object.keys(meta).sort()).toEqual(['alg', 'iterations', 'salt', 'updatedAt', 'v', 'wrappedDek']);
        expect(meta.wrappedDek).toHaveLength(64); // envuelto: 32B DEK + tag GCM
        expect(JSON.stringify(meta)).not.toMatch(/CryptoKey|\[object/);
    });
});

// --- DE6: changePassphrase() re-envuelve el MISMO DEK, no re-cifra ---------
describe('changePassphrase() — re-wrap (DE6)', () => {
    it('re-envuelve con salt nuevo, payloads byte-idénticos, descifrable con la nueva', async () => {
        const mod = await freshModule();
        const meta1 = await mod.init('contraseña-actual', null);
        const env1 = await mod.encryptPayload('entries', { monto: 111 });
        const env2 = await mod.encryptPayload('budgets', { nombre: 'Comida', monto: 222 });
        const snapshot1 = JSON.stringify(env1);
        const snapshot2 = JSON.stringify(env2);

        const meta2 = await mod.changePassphrase('contraseña-actual', 'contraseña-nueva-9');
        expect(meta2.salt).not.toBe(meta1.salt);
        expect(meta2.wrappedDek).not.toBe(meta1.wrappedDek);
        // El ciphertext de los payloads NO cambia (DE6: nunca se re-cifran).
        expect(JSON.stringify(env1)).toBe(snapshot1);
        expect(JSON.stringify(env2)).toBe(snapshot2);

        // Relanzar con la NUEVA contraseña desenrolla el mismo DEK y descifra todo.
        const mod2 = await freshModule();
        await mod2.init('contraseña-nueva-9', meta2);
        await expect(mod2.decryptPayload('entries', env1)).resolves.toEqual({ monto: 111 });
        await expect(mod2.decryptPayload('budgets', env2)).resolves.toEqual({ nombre: 'Comida', monto: 222 });
    });
});

// --- DE8: AAD — el payload queda vinculado al almacén (store canónico) -----
describe('decryptPayload() — AAD (DE8)', () => {
    it('descifra con el AAD correcto (nombre canónico del store)', async () => {
        await fpCrypto.init('contraseña-aad', null);
        const obj = { id: 'e1', monto: 77 };
        const env = await fpCrypto.encryptPayload('entries', obj);
        await expect(fpCrypto.decryptPayload('entries', env)).resolves.toEqual(obj);
    });

    it('falla con AAD de otro store y con AAD vacío (PayloadAuthError, sin plaintext)', async () => {
        await fpCrypto.init('contraseña-aad', null);
        const env = await fpCrypto.encryptPayload('entries', { monto: 77 });
        await expect(fpCrypto.decryptPayload('budgets', env))
            .rejects.toMatchObject({ name: 'PayloadAuthError' });
        await expect(fpCrypto.decryptPayload('budgets', env)).rejects.toThrow(/almacén incorrecto/i);
        await expect(fpCrypto.decryptPayload('', env))
            .rejects.toMatchObject({ name: 'PayloadAuthError' }); // AAD omitido
    });
});

// --- DE9: portabilidad — envelope + contraseña bastan en otro dispositivo --
describe('Portabilidad (DE9)', () => {
    it('un módulo fresco (segundo dispositivo) descifra con solo el envelope y la contraseña', async () => {
        const original = { id: 'p1', monto: 500.5, tags: ['a', 'b'] };
        const mod1 = await freshModule();
        const meta = await mod1.init('contraseña-portable', null);
        const env = await mod1.encryptPayload('entries', original);

        // Sin estado de dispositivo: campos 100% JSON (nada no-serializable / no portable).
        const metaJson = JSON.parse(JSON.stringify(meta));
        const envJson = JSON.parse(JSON.stringify(env));
        expect(metaJson).toEqual(meta);
        expect(envJson).toEqual(env);
        expect(Object.keys(envJson).sort()).toEqual(['alg', 'ct', 'iv', 'salt', 'v']);

        const mod2 = await freshModule(); // "otro dispositivo": sin estado previo
        await mod2.init('contraseña-portable', metaJson);
        await expect(mod2.decryptPayload('entries', envJson)).resolves.toEqual(original);
    });
});

// --- Exports: module.exports (node) y window.fpCrypto (navegador) ----------
describe('Exports', () => {
    const SURFACE = ['assertSecureContext', 'changePassphrase', 'decryptPayload', 'encryptPayload', 'fromB64', 'init', 'isEncryptionReady', 'toB64'];

    it('module.exports expone las 6 funciones públicas + toB64/fromB64', async () => {
        const mod = await freshModule();
        for (const name of SURFACE) {
            expect(typeof mod[name]).toBe('function');
        }
    });

    it('registra window.fpCrypto con la misma superficie y NO pisa window.crypto', async () => {
        globalThis.window = {};
        try {
            vi.resetModules();
            await import('./crypto.js');
            expect(Object.keys(globalThis.window.fpCrypto).sort()).toEqual(SURFACE.sort());
            expect(typeof globalThis.window.fpCrypto.init).toBe('function');
            expect(globalThis.window.crypto).toBeUndefined(); // nunca window.crypto
        } finally {
            delete globalThis.window;
        }
    });
});