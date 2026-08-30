# Tasks: Boot + Passphrase UX (PR4 de data-encryption)

> Slice PR4 (Fase 4, tareas 4.1–4.6) + nuevo módulo testeable `src/boot.js`. Alinea con el parent
> `openspec/changes/data-encryption/` (design §Boot UX, tasks Phase 4) y extiende con `determineBootState`/
> `errorToInlineMessage`, botón `🔐 Bloquear` y testabilidad. Decisiones de producto respetadas: retry infinito
> sin reset destructivo en unlock; gating global; `fpCrypto.reset()` para bloqueo de sesión.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 385–455 |
| 400-line budget risk | Medium (borderline) |
| Chained PRs recommended | No (ya es la última ranura de cadena stacked-to-main PR4/4) |
| Suggested split | 1 PR, fallback: unidad boot.js+test separada si >400 al aplicar |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Medium

Líneas: `src/boot.js` ≈70 (nuevo) + `boot.test.js` ≈110 (nuevo) + `app.js` ≈ +135 + `index.html` ≈80 + `sw.js` +1 → ≈400. Borderline; si el diff crece sobre 400 en apply, partir `src/boot.js`+test en primer commit (RED+GREEN) y el pegamento `index.html`/`app.js`/`sw.js` en el segundo, ambos dentro de la misma PR. No se recomienda cadena extra: PR4 ya es la ranura final y separarla añade churn a una secuencia que ya se mergea a main en orden.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `src/boot.js` + `src/boot.test.js` (jsdom): `determineBootState` + `errorToInlineMessage`, dual export | PR 4 (primer commit) | `npx vitest run src/boot.test.js` | Vitest jsdom (default); asserts de valor exacto sobre estados y `err.name` | `src/boot.js` + `src/boot.test.js` — independiente, sin tocar boot aún |
| 2 | Pegamento `index.html` + `app.js` + `sw.js`: cryptoGate, modales, `🔐 Bloquear`, precache | PR 4 (segundo commit) | `npx vitest run` (regresión) + checklist manual 4.6 | Browser: `python -m http.server` localhost:3000; setup/unlock/change/lock; offline precache; DevTools byte-scan IDB+LS solo envelopes | `index.html` + `app.js` + `sw.js` — revert restaura boot legacy (datos: cifrado irrecuperable sin passphrase; Excel = recuperación DE10) |

---

## Phase 1: Módulo testeable boot (RED→GREEN)

- [x] 1.1 RED `src/boot.test.js` (nuevo, jsdom default): `import { determineBootState, errorToInlineMessage } from './boot.js'` (colección de import = RED hasta existir el archivo); `describe('determineBootState')` — `{hasKey:false,isReady:false,secureContext:true}→'setup'`; `{hasKey:true,...}→'unlock'`; `{isReady:true,...}→'ready'`; `{secureContext:false}→'secure-context-error'`; `secureContext:false` anula a hasKey/isReady (refuse gana).
- [x] 1.2 RED `describe('errorToInlineMessage')`: `new Error(); err.name='WrongPassphraseError'`→`/Contraseña incorrecta/i`; `'PassphraseTooShortError'`→`/mínimo 8 caracteres/i`; `'SecureContextError'`→`/contexto seguro/i`; `'KeyMaterialMissingError'` y genérico→mensaje de rechazo que no filtra el error.
- [x] 1.3 GREEN `src/boot.js` (nuevo, dual export): `determineBootState({hasKey,isReady,secureContext})` puro (orden: secure-context-error → ready → hasKey? setup:unlock); `errorToInlineMessage(err){switch(err.name){WrongPassphraseError→'Contraseña incorrecta';PassphraseTooShortError→'La contraseña debe tener mínimo 8 caracteres.';SecureContextError→'Se requiere un contexto seguro (localhost o HTTPS).';default→'No se pudo inicializar el cifrado. Cerra y volvé a abrir la app.'}}`; `window.FPBoot` + `module.exports`. Gate: `npx vitest run src/boot.test.js` verde.

## Phase 2: Markup y carga — `index.html` + `sw.js`

- [x] 2.1 `index.html` scripts (516–517): insertar `<script src="src/crypto.js"></script>` entre `finance.js` (516) y `storage.js` (517) — el orden es el contrato (storage lee `window.fpCrypto`). Red: grep/none — verificado en 4.5.
- [x] 2.2 `sw.js` ASSETS (14–15): añadir `'/src/crypto.js'` al precache (NFR offline; sin él, offline sirve storage.js sin `fpCrypto`). Red: none — 4.5 offline.
- [x] 2.3 `index.html` markup: `#passphraseModal` tras `#currencySettingsModal` (~512) con `data-bs-backdrop="static" data-bs-keyboard="false"` (boot no sigue sin él); setup (tras `determineBootState==='setup'`): `#newPassphrase`+`#confirmPassphrase`+`#passphraseError`+`#btnSetPassphrase`; unlock: solo `#unlockPassphrase`+`#passphraseError`+`#btnUnlock`; aviso DE10 en ambos "Si perdés la contraseña, tus datos son irrecuperables. Exportá regularmente a Excel (📥 Exportar) como respaldo.". Red: none — 4.5.
- [x] 2.4 `index.html` markup: `#changePassphraseModal`: `#changeCurrent`/`#changeNew`/`#changeConfirm`/`#changePassphraseError`/`#btnChangePassphrase` + aviso DE10; navbar (`btnCurrencySettings` línea 26) gana `🔐 Bloquear` `id="btnPassphrase"` (sin data-bs-target; handler `fpCrypto.reset()`); panel `#secureContextError` (bloquea el contenido de la app). Red: none — 4.5.

## Phase 3: Pegamento boot — `app.js`

- [x] 3.1 `cryptoGate()` (nuevo): (1) `try{window.fpCrypto.assertSecureContext()}catch{mostrar #secureContextError; return false}` (DE3, sin loads/plaintext); (2) `const {hasKey}=await storage.hasEncryptionKey()` + `determineBootState` → abre `#passphraseModal` en setup (no-key: pass+confirm+aviso) o unlock (key: pass solo); (3) submit → `await storage.initKey(pass)`; `errorToInlineMessage(err)` en `#passphraseError` (WrongPassphrase → modal queda, datos intactos, retry infinito — decisión 1, DE5); éxito → oculta modal; setup-mode → one-time toast DE10 (flag `finanzas:recovery-warned`, metadata); return true.
- [x] 3.2 `setupPassphraseModal()`: Enter/envío valida setup (confirm === new) y llama `storage.initKey` vía 3.1; no descartable (backdrop static por 2.3). `setupChangePassphraseModal()` (espejo de `setupCurrencySettingsModal()` línea 373): valida new ≥8 + confirm match → `await storage.changePassphrase(cur,next)` → `errorToInlineMessage` en `#changePassphraseError`, toast "Contraseña actualizada" en éxito (DE6 — payloads nunca re-cifrados, probado en unidad de PR1 task 1.7).
- [x] 3.3 `init()` (1655): insertar `if (!(await cryptoGate())) return;` justo antes de `await loadFromStorage()` (1656) — `checkAndGenerateRecurring()` (1662, escribe) corre solo post-clave (sin escritura en claro); registrar `setupPassphraseModal()`+`setupChangePassphraseModal()` junto a `setupAiSettingsModal()` (1680)/`setupCurrencySettingsModal()` (1681); `btnPassphrase` → `window.fpCrypto.reset()` → re-ejecuta `cryptoGate()` (vuelve a unlock, datos intactos — decisión 2).

## Phase 4: Verificación

- [x] 4.1 Gate unit: `npx vitest run src/boot.test.js` + `npx vitest run` full en verde (regresión).
- [x] 4.2 Checklist manual 4.6 (= tarea 4.6 del parent): `python -m http.server` localhost:3000 → primer boot setup con aviso DE10; reload re-prompt unlock (DE4); passphrase incorrecta → inline, datos intactos, retry infinito (DE5); cambio de passphrase → reload descifra con la nueva, payloads byte-idénticos (DE6); `🔐 Bloquear` → vuelve a unlock sin tocar datos (decisión 2); AI/currency gated hasta desbloquear (decisión 3); DevTools byte-scan IDB+LS → solo envelopes (solo plaintext: `finanzas:dark-mode`/`migrated`/`recovery-warned`); offline con crypto.js pre-cacheado descifra; contexto no seguro (`file://`/LAN HTTP) → `#secureContextError`, boot rechazado (DE3); nota de coste PBKDF2 (~2 s) en hardware bajo.

## Definition of Done

- [x] `src/boot.test.js` verde (RED→GREEN); `npx vitest run` full verde
- [x] Script de `crypto.js` en orden + precache; `cryptoGate()` antes de `loadFromStorage()`; `checkAndGenerateRecurring()` solo post-clave
- [x] Checklist manual 4.6 verificado en navegador (setup/unlock/wrong/change/lock/gate/offline/secure-context/PBKDF2)
- [x] Commits convencionales, sin atribución AI; cada trabajo-unit revertible
