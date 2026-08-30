# Propuesta: Boot + UX de cifrado con passphrase (PR4 del cambio data-encryption)

> **Slice**: PR4 de la cadena `data-encryption` (PR1 primitivas ✓, PR2 envelope+key API ✓, PR3 migración v6→v7 ✓, **PR4 = integración de boot/UX — ESTE SLICE**). Corresponde a la Fase 4 del spec (tareas 4.1–4.6). Depende de la especificación, diseño y tareas de `openspec/changes/data-encryption/`.

## Intent (Problema)

Post-PR3, la app **no puede iniciar**: `storage.load()` lanza `assertKeyReady()` en `init()` (app.js:1655) porque la clave aún no se resuelve, y no existe ninguna UX de configuración/desbloqueo de passphrase. Sin resolver la clave en boot, nada de lo construido en PR1–PR3 es utilizable. Este slice cierra el ciclo entregando el gating de boot + la UX de passphrase (setup, unlock, cambio de clave, bloqueo de sesión), de modo que el cifrado E2E se convierta en la experiencia de usuario real.

## Scope (Fase 4 — tareas 4.1 a 4.6)

### In Scope
- `cryptoGate()` en `app.js` antes de `loadFromStorage()` (tarea 4.3): (1) `fpCrypto.assertSecureContext()` → rechazo de boot con panel `#secureContextError` (DE3); (2) `storage.hasEncryptionKey()` → decide modal setup vs unlock; (3) `await storage.initKey(pass)` → éxito oculta modal, genera toast DE10 único.
- Wires en `init()` (4.5): `if (!(await cryptoGate())) return;` antes de `loadFromStorage()` → `checkAndGenerateRecurring()` (escribe) corre solo post-clave, sin escrituras en claro.
- Markup `index.html` (4.2): `#passphraseModal` (setup/unlock, `backdrop="static"` no descartable), `#changePassphraseModal`, botón navbar `🔐 Bloquear` (`btnPassphrase` → `window.fpCrypto.reset()`), panel `#secureContextError`; aviso DE10 en ambos modales.
- Carga de `src/crypto.js` + precache (4.1): `<script src="src/crypto.js">` entre `finance.js` y `storage.js` (contrato de orden) + `'/src/crypto.js'` en el precache de `sw.js`.
- **Módulo testeable `src/boot.js`** (decisión abajo): exporta `determineBootState({hasKey, isReady, secureContext}) → 'setup'|'unlock'|'ready'|'secure-context-error'` y `errorToInlineMessage(err)` (mapeo `WrongPassphraseError`/`PassphraseTooShortError`/otros → mensajes inline). Patrón dual export (window + module.exports), jsdom-testable.
- Tests `src/boot.test.js` (TDD estricto) cubriendo la lógica de decisión y el mapeo de errores.
- Checklist manual 4.6 (gate final PR4).

### Out of Scope (no se hace aquí)
- **Sin botón destructivo reset/borrar en el flujo de unlock** (decisión 1 del producto): retry infinito + recordatorio de "exportar a Excel" para respaldo; el cifrado E2E no tiene recuperación — no se ofrece una puerta que lo burle silenciosamente.
- Sin test E2E de navegador automatizado (solo checklist manual 4.6).
- Sin cuenta de usuario / recuperación por email / mecanismo de recovery-reset de datos.
- Sin cambios en `crypto.js`, `storage.js` (primitivas y key API ya entregadas en PR1–PR3); este slice solo las **consume**.
- Sin cifrar `finanzas:dark-mode` (fuera de alcance, ya definido).

## Decisiones de producto (ya tomadas — se respetan)

1. **Passphrase olvidada**: retry infinito en el modal de unlock + recordatorio de backup "exportar a Excel" (incentivado en setup). Sin botón de reset/borrado destructivo en el flujo de unlock. E2E sin recuperación.
2. **Bloqueo de sesión**: SÍ. Botón navbar `🔐 Bloquear` que llama `window.fpCrypto.reset()` (dropea la DEK en memoria, vuelve a estado unlock; no toca datos persistidos).
3. **Gating global**: nada (ni AI/Ollama ni configuración de moneda) es usable hasta desbloquear. Todo el boot queda tras la clave.

## Decisión de testabilidad (a justificar)

**Extraer `src/boot.js`** (módulo puro de lógica de decisión, importable y jsdom-testable) en lugar de cubrir el boot solo con el checklist manual 4.6.

- **Por qué**: Strict TDD está activo. La lógica de decisión de boot es el único código de este slice con ramificaciones reales (4 estados + mapeo de errores). `app.js` no exporta nada (script de navegador con `DOMContentLoaded`), así que no es testeable por unidad tal cual. Extraer la decisión pura en un módulo dual-export (patrón ya usado por `crypto.js`/`storage.js`) permite que RED-GREEN la cubra con asserts exactos de valor, dejando `cryptoGate()`/modales de `app.js` como pegamento fino que solo se verifica con 4.6.
- **Tradeoff**: agrega una capa (un archivo + su suite) y algo de indirección sobre los handlers de `app.js`. A cambio: la rama crítica de boot queda probada automáticamente y el checklist manual 4.6 se reduce a la parte de DOM/Bootstrap (apertura de modal, toasts) que no amerita suite. Coste bajo, cobertura alta → **preferir extracción**.
- Alternativa descartada: cubrir boot solo vía 4.6 (menos archivos, pero la lógica de decisión quedaría sin test automático — subóptimo con TDD estricto).

## Capabilities

### New Capabilities
- Ninguna nueva a nivel spec: la decisión de boot se entrega dentro de la capability `data-encryption` ya definida (DE1, DE3, DE4, DE5, DE6, DE10) y `storage` (modified). `src/boot.js` es una división interna de implementación, no un contrato de spec nuevo.

### Modified Capabilities
- Ninguna (este slice no modifica requisitos de spec; implementa la Fase 4 ya especificada).

## Approach

`src/boot.js` exporta `determineBootState` (función pura: `hasKey` → setup/unlock; `isReady` → ready; `secureContext:false` → secure-context-error) y `errorToInlineMessage` (mapea `WrongPassphraseError`/`PassphraseTooShortError`/genérico con `err.name` → mensajes inline en español). `app.js` inyecta el resultado de `determineBootState` al cablear `cryptoGate()` y modales de setup/cambio de clave (retry infinito en unlock). TDD estricto: `src/boot.test.js` primero (RED sobre `/mínimo 8 caracteres/i`, `Contraseña incorrecta`, estados), luego `src/boot.js` (GREEN) y el pegamento de `app.js`/`index.html`/`sw.js`.

## Áreas afectadas

| Área | Impacto | Descripción |
|------|---------|-------------|
| `src/boot.js` | Nuevo | Lógica pura de estado de boot + mapeo de errores (dual export) |
| `src/boot.test.js` | Nuevo | Suite TDD de `determineBootState`/`errorToInlineMessage` |
| `app.js` | Modificado | `cryptoGate()` + wires en `init()` (4.3, 4.5) + handlers de modales (4.4) + botón `🔐 Bloquear` (decisión 2) |
| `index.html` | Modificado | Modales, panel `#secureContextError`, carga de `crypto.js`, botón navbar (4.1, 4.2) |
| `sw.js` | Modificado | `'/src/crypto.js'` en precache (4.1, NFR offline) |

## Riesgos

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| Passphrase olvidada = pérdida permanente (no recuperable) | Media | Aviso DE10 + backup Excel incentivo; retry infinito; sin reset destructivo |
| Boot lento por PBKDF2 (~2 s) al desbloquear | Media | UX modal no-bloqueante; revisar en 4.6 en hardware bajo |
| `crypto.js` no cargado en orden → `fpCrypto` indefinido | Baja | 4.1 fija el orden + precache; 4.6 verifica offline |

## Plan de Rollback

Revertir `index.html` (quitar scripts/modales/botón), `app.js` (restaurar `init()` legacy sin `cryptoGate()`), `sw.js` (quitar `'/src/crypto.js'`), y eliminar `src/boot.js`+test. **Caución**: sin la passphrase, los datos ya son cifrado irrecuperable — el rollback restaura solo el código; los datos se recuperan del Excel exportado (camino DE10). Un dato parcialmente migrado (LS fuera de línea no migrado) no se pierde en rollback porque la migración es aditiva e idempotente.

## Dependencias

- PR1–PR3 ya fusionados/empujados: `window.fpCrypto` (init/reset/isEncryptionReady), `window.storage` (initKey/changePassphrase/hasEncryptionKey), DB v7, migración.
- Web Crypto en contexto seguro (localhost/HTTPS) para el flujo real.

## Criterios de Éxito

- [ ] La app **no bootea en claro**: antes de la clave no hay carga ni escritura; `checkAndGenerateRecurring()` corre solo post-clave.
- [ ] Primer boot → modal setup con aviso DE10; reload → re-prompt (DE4) en modal unlock; passphrase correcta → desbloquea.
- [ ] Passphrase incorrecta → error inline, modal permanece, datos intactos, retry infinito (DE5, decisión 1).
- [ ] `🔐 Bloquear` → `fpCrypto.reset()` → vuelve a estado unlock sin tocar datos (decisión 2).
- [ ] Cambio de passphrase → `storage.changePassphrase` re-envuelve DEK, payloads intactos (DE6).
- [ ] `crypto.subtle` ausente (file://, LAN HTTP) → `#secureContextError`, boot rechazado, sin plaintext (DE3).
- [ ] `src/boot.test.js` en verde (TDD) + `npx vitest run` full en verde.
- [ ] Checklist manual 4.6 verificado en navegador (incl. offline con crypto.js precacheado, byte-scan de IDB/LS solo envelopes).
