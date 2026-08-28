# Proposal: Data Encryption at Rest

## Intent

All financial data — entries, budgets, recurring, the aiSettings API key — is persisted in plaintext in IndexedDB and its localStorage mirrors; any browser/devtools access reads every amount and secret. This change encrypts persisted data with a user passphrase and lays the foundation for a future encrypted cloud-sync feature.

## Scope

### In Scope
- New `src/crypto.js` (dual `window.*`/`module.exports` export, loaded before `src/storage.js`)
- Passphrase envelope: random DEK wrapped by passphrase-derived KEK (PBKDF2-SHA256 + salt); AES-GCM-256, per-payload random 12-byte IV, optional AAD; versioned envelope `{v, alg, salt, iv, ct}`
- New `cryptoMeta` store (DB v7, additive): wrapped DEK + salt only
- Encrypt/decrypt at the storage.js serialization boundary — IDB stores AND LS mirrors (aiSettings/settings dual-writes included)
- Passphrase boot UX: prompt before first load; passphrase change re-wraps DEK only (data untouched)
- Migration v6→v7: plaintext → ciphertext in both backends, purge plaintext remnants, zero data loss
- STRICT TDD (vitest); crypto tests via per-file `// @vitest-environment node` (jsdom lacks `crypto.subtle`)

### Out of Scope
- Cloud sync — separate future change (envelope keeps ciphertext portable)
- `finanzas:dark-mode` — stays plaintext (sync pre-init read in app.js)
- Whole-DB obfuscation, extra auth/lock UX, passphrase recovery (none exists)

## Capabilities

### New Capabilities
- `data-encryption`: passphrase envelope encryption of all sensitive persisted data (IDB + LS)

### Modified Capabilities
- `storage`: all load/save paths become passphrase-gated and encrypt/decrypt at the serialization boundary; key resolution MUST precede the first load

## Approach

`src/crypto.js` exposes async `init(passphrase)` (derive KEK → unwrap DEK from `cryptoMeta`) and `encryptPayload`/`decryptPayload`. `src/storage.js` wraps every `idbPutAll*/idbGetAll*/lsSave*/lsLoad*` boundary; the envelope format is identical across backends so loads decrypt from either source. `app.js` gates `init()` on key resolution before the first `storage.load*`. Migration runs on first v7 boot: read plaintext → write ciphertext → purge plaintext in both backends, proven by seeded legacy tests (fake-indexeddb + LS) asserting byte-level ciphertext and lossless round-trips.

## Closed Decisions

- Passphrase envelope (option A): key never stored; passphrase change re-wraps DEK only; cloud-sync-ready
- Encrypt IDB + LS mirrors; dark-mode stays plaintext; boot passphrase-gated
- No recovery on passphrase loss — warn clearly and recommend regular Excel export as backup

## Open Questions / Assumptions (spec phase)

- Passphrase policy: min length/strength enforcement? `crypto.subtle` missing (file://, LAN HTTP): refuse or warn-and-continue?
- Encrypt LOW-sensitivity customCategories too? (Assumed: yes, for uniformity.) AAD content? (Assumed: per-payload context tag.) Re-prompt per boot? (Assumed: yes, every boot.)
- Assumed: single-user/single-browser; whole-payload encryption (no key queries)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/crypto.js` | New | Envelope key management, encrypt/decrypt, dual export |
| `src/storage.js` | Modified | DB v7 + cryptoMeta, encryption at all IDB/LS boundaries, migration |
| `app.js` | Modified | Passphrase boot gating, no-recovery warning, export reminder |
| `index.html` | Modified | Script load order, passphrase modal |
| Tests | Modified | `crypto.test.js` (node env), storage migration suites |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Passphrase loss = permanent data loss (NON-RECOVERABLE) | Med | Clear warning UX + recommend regular Excel export |
| jsdom lacks `crypto.subtle` | Certain | Test-environment strategy built into design |
| Migration failure = data loss | Low | Seeded legacy tests; purge only after verified encrypted write |
| PBKDF2 ~1–2 s boot cost | Med | Acceptable; non-blocking UX |
| No secure context → subtle missing | Low | Detect and degrade gracefully per design |

## Rollback Plan

Revert code: remove `src/crypto.js`, set `DB_VERSION` back to 6, drop encrypt/decrypt wrappers, restore the legacy boot path. The DB migration is additive — a downgraded v6 ignores the orphan `cryptoMeta` store. Data caveat: ciphertext is unrecoverable without the passphrase, so rollback after migration restores code only; data is recovered from the recommended Excel export. Migration MUST NOT purge plaintext until encrypted writes verify.

## Dependencies

- Web Crypto `crypto.subtle` (secure context: localhost + HTTPS both qualify)
- Node ≥24 global `crypto.subtle` + fake-indexeddb for tests (already in stack)
- No new runtime dependencies

## Success Criteria

- [ ] No plaintext financial data in IDB or LS after migration (tests + devtools inspection)
- [ ] Passphrase gates boot; wrong passphrase fails cleanly, data untouched
- [ ] Seeded v6 plaintext migrates losslessly to ciphertext in both backends
- [ ] Passphrase change re-wraps DEK only; data untouched
- [ ] Payloads decrypt from either backend; envelope is versioned
- [ ] All vitest suites green; legacy behaviors unchanged