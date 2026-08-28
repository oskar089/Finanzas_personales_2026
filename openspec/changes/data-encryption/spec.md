# Data Encryption Specification

## Purpose

Encrypt all sensitive financial data at rest — entries, budgets, recurring, customCategories, and the aiSettings API key — in IndexedDB and its localStorage mirrors, using a passphrase envelope (a random data-encryption key wrapped by a passphrase-derived key). Boot becomes passphrase-gated. The ciphertext format is versioned and portable so a future encrypted cloud-sync change can reuse it. This change introduces a new `data-encryption` capability and modifies the `storage` capability (all load/save paths become key-gated and encrypt/decrypt at the serialization boundary).

This change is split internally into two capability domains. The `data-encryption` domain defines the envelope/key-management contract (new capability). The `storage` domain defines how existing persistence behavior changes (modified capability).

---

## Domain: data-encryption (new capability)

### Requirement: DE1 — Passphrase policy

The system MUST require a passphrase of at least 8 characters when setting or changing it, MUST SHOW a clear validation error when shorter, and MUST NOT block weak-but-valid passphrases. The passphrase MUST be used to derive the key-wrapping key (KEK) via PBKDF2-SHA256 with a fresh random salt; the KEK MUST NOT be stored.

#### Scenario: Set a passphrase that is too short

- GIVEN the user is on first boot setting a passphrase
- WHEN the passphrase is fewer than 8 characters
- THEN the system rejects the input with a clear error message
- AND no key material is derived or persisted

#### Scenario: Set a valid passphrase

- GIVEN the user is on first boot setting a passphrase of 8+ characters
- WHEN the passphrase is submitted
- THEN a random salt is generated and a KEK is derived via PBKDF2-SHA256
- AND a random DEK is generated and wrapped by the KEK
- AND the wrapped DEK and salt are persisted to the `cryptoMeta` store

#### Scenario: Weak but valid passphrase is accepted

- GIVEN the user enters a passphrase of 8+ characters that is easy to guess
- WHEN the passphrase is submitted
- THEN the passphrase is accepted (no weak-passphrase block)

### Requirement: DE2 — Envelope key management

The system MUST protect each payload with AES-GCM-256 using a per-payload random 12-byte IV, and MUST commit the result to a versioned envelope `{ v, alg, salt, iv, ct }`. The DEK MUST be a random key, wrapped by the passphrase-derived KEK. Only the wrapped DEK and the PBKDF2 salt are stored, in the `cryptoMeta` store; the DEK and KEK MUST never be persisted in plaintext.

#### Scenario: Encrypt a payload into a versioned envelope

- GIVEN the system is initialized with a passphrase and an unwrapped DEK
- WHEN a payload is encrypted
- THEN the system generates a fresh 12-byte IV and encrypts with AES-GCM-256
- AND the output is a versioned envelope `{ v, alg, salt, iv, ct }` with `v` identifying the envelope version and `alg` identifying the algorithm
- AND only the DEK's wrapped form and salt live in `cryptoMeta`

#### Scenario: Decrypt an envelope yields the original payload

- GIVEN a versioned envelope produced by the system and the correct DEK
- WHEN the envelope is decrypted
- THEN the plaintext equals the original payload

#### Scenario: cryptoMeta stores no plaintext key material

- GIVEN the system is initialized
- WHEN the `cryptoMeta` store is inspected
- THEN it contains only the wrapped DEK and the PBKDF2 salt
- AND neither the KEK nor the raw DEK appears anywhere in storage

### Requirement: DE3 — Secure-context guard

The system MUST verify `crypto.subtle` is available before starting encryption. If it is missing (e.g. `file://` in Safari, or plain HTTP over a LAN IP), the system MUST refuse to start encryption and MUST NOT silently store plaintext; it MUST present a clear message explaining the secure-context requirement.

#### Scenario: crypto.subtle available

- GIVEN the app is served from a secure context (localhost or HTTPS) with `crypto.subtle` present
- WHEN boot begins
- THEN encryption is enabled and the passphrase flow proceeds

#### Scenario: crypto.subtle missing

- GIVEN the app is opened in a context where `crypto.subtle` is undefined (e.g. `file://` in Safari, LAN HTTP)
- WHEN the system tries to initialize encryption
- THEN the system refuses to start and shows a clear message explaining encryption requires a secure context
- AND no plaintext financial data is written to IDB or localStorage
- AND no silent plaintext fallback occurs

### Requirement: DE4 — Passphrase boot gating and re-prompt

The system MUST prompt for the passphrase before the first data load on every boot, and MUST NOT load or render financial data until the passphrase resolves. The system MUST re-prompt on every boot (the passphrase is never remembered).

#### Scenario: First boot with no key

- GIVEN the app has no `cryptoMeta` record (fresh install or first v7 boot)
- WHEN boot begins and the user provides a new passphrase
- THEN a new DEK is generated and wrapped
- AND the passphrase gate resolves before the first load
- AND data loads normally afterward

#### Scenario: Re-prompt on every boot

- GIVEN a returning user who previously set a passphrase
- WHEN the page is reloaded
- THEN the system prompts for the passphrase again
- AND data loads only after the correct passphrase is entered

### Requirement: DE5 — Wrong passphrase clean failure

The system MUST detect an incorrect passphrase during boot (KEK unwrap of the stored DEK fails) and MUST fail cleanly: show a clear error, leave all stored data untouched, and allow the user to retry.

#### Scenario: Wrong passphrase at boot

- GIVEN a `cryptoMeta` record exists and the user enters an incorrect passphrase
- WHEN the KEK unwraps the stored DEK
- THEN unwrap fails and the system shows a clear "incorrect passphrase" error
- AND no stored data is modified or deleted
- AND the user can try again

### Requirement: DE6 — Passphrase change re-wraps DEK only

The system MUST support changing the passphrase by re-wrapping the existing DEK with the new KEK, WITHOUT re-encrypting any payload data. Changing the passphrase MUST NOT alter any payload ciphertext.

#### Scenario: Change passphrase re-wraps DEK

- GIVEN the user is authenticated with the current passphrase and there is persisted data
- WHEN the user changes the passphrase to a new valid one
- THEN a new salt and KEK are derived and the existing DEK is re-wrapped
- AND the updated wrapped DEK and new salt replace the old in `cryptoMeta`
- AND all existing payload ciphertext remains byte-identical and decrypts with the new passphrase

### Requirement: DE7 — apiKey and payload protection

The system MUST encrypt every sensitive payload, including the aiSettings record and its `apiKey` field, at rest. The `apiKey` MUST NOT appear in plaintext in any store (IDB or localStorage mirror).

#### Scenario: apiKey never stored in plaintext

- GIVEN the user saves AI provider settings with an API key
- WHEN the aiSettings record is persisted
- THEN both the IDB `aiSettings` store and the localStorage mirror contain only ciphertext
- AND no plaintext `apiKey` is present in either backend

### Requirement: DE8 — AAD context tag

The system MUST bind each encrypted payload to its store via a per-payload authenticated context tag (the store name) provided as AES-GCM additional authenticated data (AAD). A payload decrypted with the wrong context tag MUST fail authentication.

#### Scenario: AAD binds payload to its store

- GIVEN a payload encrypted with the `entries` context tag
- WHEN decryption is attempted with a different context tag (or with AAD omitted)
- THEN authentication fails and no plaintext is returned

### Requirement: DE9 — Portability for cloud sync

The system MUST produce a ciphertext format that is self-contained and portable from the envelope itself (version, algorithm, salt, IV, ciphertext) plus the externally-held passphrase, so a future cloud-sync change can upload and decrypt the blob without device-specific state. Cloud-sync itself is out of scope.

#### Scenario: Ciphertext is portable

- GIVEN an envelope written by this system
- WHEN the envelope and the correct passphrase are available on a different device with `crypto.subtle`
- THEN the payload can be decrypted there using only the envelope fields and the passphrase

### Requirement: DE10 — No passphrase recovery

The system MUST NOT provide any passphrase recovery mechanism. On setup and on passphrase changes the system MUST clearly warn that losing the passphrase makes the data permanently unrecoverable, and MUST recommend regular Excel export as the backup path.

#### Scenario: Recovery warning on setup

- GIVEN the user is setting a passphrase
- WHEN the passphrase is accepted
- THEN the system shows a clear warning that a lost passphrase cannot be recovered
- AND recommends regular Excel export to protect the data

---

## Domain: storage (modified capability)

### Requirement: DE11 — Serialization-boundary encryption in both backends

The system MUST encrypt at the storage serialization boundary so ALL persisted sensitive data is ciphertext in IndexedDB stores AND in their localStorage mirrors, using the identical envelope format in both backends so a load can decrypt from either source. `finanzas:dark-mode` MUST remain plaintext.

#### Scenario: Entries ciphertext in IDB and LS

- GIVEN the app is initialized and a user has entries
- WHEN the user saves or loads entries
- THEN the IDB `entries` store and the LS mirror key contain only ciphertext
- AND the plaintext entry is readable only after decryption

#### Scenario: payloads decrypt from either backend

- GIVEN a payload persisted to IDB and its LS mirror
- WHEN a load reads from IDB (or from the LS mirror after an IDB failure)
- THEN the ciphertext from either source decrypts to the same plaintext

#### Scenario: dark-mode stays plaintext

- GIVEN the app initializes
- WHEN the `finanzas:dark-mode` preference is read or written
- THEN it is read and written as plaintext, unencrypted, exactly as before

### Requirement: DE12 — Migration v6→v7 without data loss

The system MUST migrate existing plaintext v6 data to ciphertext in both backends on first v7 boot with zero data loss, adding the `cryptoMeta` store additively (DB v7). Plaintext remnants MUST be purged only AFTER the corresponding encrypted write has been verified.

#### Scenario: Legacy plaintext migrates losslessly

- GIVEN an existing v6 database with plaintext records in all stores and LS mirrors
- WHEN the database upgrades to v7 and the user enters a passphrase
- THEN each plaintext payload is encrypted and written to its destination
- AND only after the encrypted write is verified is the plaintext purged
- AND all data is recoverable via decryption with the correct passphrase

#### Scenario: Migration purges plaintext only after verified write

- GIVEN a legacy plaintext payload being migrated
- WHEN the encrypted write fails or cannot be verified
- THEN the plaintext is NOT purged
- AND the error surfaces and retry can proceed without data loss

### Requirement: DE13 — Dual-write settings encrypted in both backends

The system MUST encrypt the aiSettings and currency settings records that are intentionally dual-written (IDB AND localStorage) in both backends, preserving the dual-write semantics with ciphertext on both sides.

#### Scenario: aiSettings dual-write is ciphertext on both sides

- GIVEN the user saves AI settings (dual-written)
- WHEN persistence runs
- THEN both the IDB `aiSettings` store and the localStorage mirror hold ciphertext
- AND the record still loads correctly through the normal boot path

#### Scenario: currency settings dual-write is ciphertext on both sides

- GIVEN the user saves currency settings (dual-written)
- WHEN persistence runs
- THEN both the IDB `settings` store and the localStorage mirror hold ciphertext
- AND the record still loads correctly through the normal boot path

### Requirement: DE14 — customCategories encrypted for uniformity

The system MUST encrypt customCategories (LOW sensitivity) like all other sensitive stores, for uniformity of the persistence layer.

#### Scenario: customCategories stored as ciphertext

- GIVEN custom categories exist
- WHEN they are saved or loaded
- THEN the IDB `customCategories` store and the LS mirror hold ciphertext
- AND the categories decrypt losslessly on load

### Requirement: DE15 — Round-trip integrity from LS mirror

The system MUST verify that a payload encrypted and stored via the LS fallback/mirror decrypts losslessly on load, preserving existing fallback behavior.

#### Scenario: LS mirror round-trip

- GIVEN IDB is unavailable and data is stored via the LS mirror
- WHEN the data is later read back from LS
- THEN the ciphertext decrypts to the exact original payload

---

## Non-Functional Requirements

- All sensitive financial data MUST be ciphertext at rest in both IndexedDB and localStorage after migration
- The DB migration from v6 to v7 MUST be additive only (new `cryptoMeta` store) with zero data loss
- Plaintext MUST be purged only after a verified encrypted write
- Payload encryption MUST use AES-GCM-256 with a per-payload random 12-byte IV and optional AAD; the envelope MUST be versioned
- Key material (DEK/KEK) MUST never be stored in plaintext; only the wrapped DEK and PBKDF2 salt persist
- The passphrase MUST be required before the first load on every boot, with no remembered passphrase
- Lost passphrase MUST be non-recoverable, clearly warned, with Excel export recommended
- Key derivation (PBKDF2) MUST remain acceptable at boot (~1–2 s) and SHOULD NOT block the UI silently
- STRICT TDD: crypto tests MUST run under the Node environment (`// @vitest-environment node`) because jsdom lacks `crypto.subtle`
- No new runtime dependencies; offline/local operation preserved
- `finanzas:dark-mode` MUST remain plaintext

## Out of Scope

- Cloud sync (future separate change; the portable ciphertext is the foundation only)
- Passphrase recovery/reset mechanisms (none exist)
- Password strength meter or weak-passphrase blocking (only a minimum-length check)
- Extra authentication or app-lock UX beyond the passphrase boot gate
- Encrypting `finanzas:dark-mode` (plain UI preference)
- Whole-database obfuscation or per-query/key-level encrypted lookups (whole-payload encryption only)
- Multi-user or multi-device profiles
