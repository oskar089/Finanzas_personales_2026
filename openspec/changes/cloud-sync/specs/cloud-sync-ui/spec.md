# Cloud Sync UI

## Purpose

Export/Import buttons and confirmation flow for manual `.fpkg` file sync in the settings view.

## Requirements

### Requirement: Export Button

The system MUST display an "Export Backup" button in the settings/sync section of `index.html`, near the existing Excel export button. Clicking it MUST trigger a `.fpkg` file download.

#### Scenario: Export triggers download

- GIVEN the user is on the settings view with encryption active
- WHEN the user clicks "Export Backup"
- THEN `exportAll()` is called, the result is serialized as JSON, and the browser downloads a file named `finanzas-backup-<YYYY-MM-DD>.fpkg`

#### Scenario: Export with empty data

- GIVEN no user data exists in any store
- WHEN the user clicks "Export Backup"
- THEN the `.fpkg` file downloads with empty stores; no error shown

#### Scenario: Export file naming

- GIVEN the current date is `2026-09-02`
- WHEN export is triggered
- THEN the downloaded file is named `finanzas-backup-2026-09-02.fpkg`

### Requirement: Import Button

The system MUST display an "Import Backup" button next to the Export button. Clicking it MUST open a file picker filtered to `.fpkg` files.

#### Scenario: File picker opens

- GIVEN the user is on the settings view
- WHEN the user clicks "Import Backup"
- THEN a native file picker dialog opens, filtered to `.fpkg` extension

#### Scenario: User cancels file picker

- GIVEN the file picker is open
- WHEN the user cancels (closes dialog without selecting)
- THEN no import occurs and no error is shown

### Requirement: Import Confirmation Dialog

The system MUST show a confirmation dialog before executing import. The dialog MUST display the bundle's `timestamp` and `dbVersion`, and warn that existing data will be overwritten.

#### Scenario: Confirmation shown with metadata

- GIVEN the user selected a valid `.fpkg` file
- WHEN the file is parsed and validated
- THEN a confirmation dialog appears showing: "This backup was created on {timestamp}. Your current data will be overwritten. Continue?"

#### Scenario: User confirms import

- GIVEN the confirmation dialog is showing
- WHEN the user clicks "Confirm" / "Yes"
- THEN `importAll(bundle)` is executed, and on success the page reloads

#### Scenario: User cancels import

- GIVEN the confirmation dialog is showing
- WHEN the user clicks "Cancel" / "No"
- THEN the dialog closes, no import occurs, no data is modified

### Requirement: Import Error Handling

The system MUST handle file parse errors, validation failures, and import errors gracefully by showing user-facing messages.

#### Scenario: Invalid file content

- GIVEN the user selected a file that is not valid JSON
- WHEN the file is parsed
- THEN an error message is shown: "Invalid backup file" and no import occurs

#### Scenario: Validation failure

- GIVEN the user selected a valid JSON file with `{ version: 99 }`
- WHEN `importAll()` validates the bundle
- THEN the confirmation dialog does NOT appear; an error message is shown instead: "Unsupported backup version"

#### Scenario: Import write failure

- GIVEN import was confirmed but IDB write fails
- WHEN `importAll()` returns `{ ok: false, errors: [...] }`
- THEN an error message is shown listing the failures; no reload occurs

### Requirement: Passphrase Gate

The system MUST require the encryption passphrase to be active before any sync operation. If `hasEncryptionKey()` returns false, sync buttons MUST be disabled or hidden.

#### Scenario: Buttons disabled without passphrase

- GIVEN the app has not been unlocked (no active encryption key)
- WHEN the settings view renders
- THEN Export and Import buttons are disabled or hidden

#### Scenario: Buttons enabled after unlock

- GIVEN the user has entered their passphrase and key is active
- WHEN the settings view renders
- THEN Export and Import buttons are enabled and clickable

## Interface

```js
// src/cloud-sync.js — exported functions

/**
 * Triggers browser download of .fpkg bundle.
 * @returns {Promise<void>} resolves after download triggered
 */
downloadPackage() → Promise<void>

/**
 * Opens file picker, validates, shows confirmation, runs import.
 * @returns {Promise<{ok: boolean, errors: string[]}>} import result
 */
uploadPackage() → Promise<{ok: boolean, errors: string[]}>
```

**Errors**: `downloadPackage` rejects if `exportAll()` fails. `uploadPackage` never throws — returns result object.

## Dependencies

- `exportAll()` from `src/storage.js`
- `importAll()` from `src/storage.js`
- `hasEncryptionKey()` from `src/crypto.js`
- `DB_VERSION` from `src/storage.js`
- Bootstrap modals (existing CDN)

## Implementation Notes

- Use `Blob` + `URL.createObjectURL` + `<a>` click for download (standard browser pattern).
- File picker: `<input type="file" accept=".fpkg">` hidden, triggered by button click.
- Confirmation dialog: Bootstrap modal (already used in the app). Show parsed `timestamp` formatted as locale string.
- Passphrase check: `hasEncryptionKey()` — same check used elsewhere in the app.
- After successful import, `location.reload()` to re-init with new data.
- File naming: `finanzas-backup-{YYYY-MM-DD}.fpkg` using local date.
