# Personal Finance 2026

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-222222?style=for-the-badge&logo=github&logoColor=white)](https://oskar089.github.io/Finanzas_personales_2026/)

A Progressive Web App to track personal finances (expenses, income and savings) with local AI features.

> **Note on the live demo:** AI features (auto-categorization, financial analysis) require Ollama running locally on your machine, so they are not available in the deployed version. The rest of the app works normally.

## Features

- Add expenses, income and savings with amount, category, subcategory, description and date.
- Edit and delete entries (inline editing for type, category and subcategory).
- View the transaction list ordered by date (most recent first).
- Filter by type, category, search text and **month range** (Desde/Hasta).
- Summary: income, expenses, savings and balance.
- Category distribution charts with type-aware colors (green for income, red for expenses).
- Monthly trend chart.
- Budget management with progress tracking.
- Recurring entries with automatic generation.
- Local AI auto-categorization (Ollama).
- AI financial analysis with recommendations (includes subcategory breakdown).
- Dark mode.
- **Export to Excel (.xlsx)** with formatted columns and totals.
- **Import from Excel (.xlsx/.xls)** with validation.
- **Manual encrypted backup (.fpkg)**: export/import a portable encrypted bundle with all stores (export/import buttons in the toolbar). Useful for cross-device or cloud recovery — any device with the passphrase can decrypt it.
- **Encrypted at rest**: all data (entries, budgets, recurring, categories and the AI API key) is encrypted with AES-GCM-256 using a passphrase. Stored in the browser (IndexedDB with localStorage mirror). It never leaves your machine without your key.
- **Important**: If you clear browser data, uninstall the app, or lose your passphrase, the data is unrecoverable. Export to Excel regularly as backup.
- **Multi-currency support**: 8 currencies (EUR, USD, GBP, ARS, MXN, BRL, JPY, CHF) with EUR as the fixed base. Amounts are always stored in EUR and converted only for display, with manual or live (Frankfurter) exchange rates.
- **PWA install prompt**: install button shown via the `beforeinstallprompt` event (`manifest.json` with `display: standalone` and a Service Worker that precaches assets).
- Service Worker for offline support (network-first for local assets, cache-first for CDN).
- One-click launcher (`start.bat`) for Windows.

## Tech Stack

- HTML5
- CSS3 + Bootstrap 5.3 (CDN with SRI)
- Vanilla JavaScript (no frameworks, no build step)
- Chart.js 4.x (CDN with SRI)
- SheetJS (xlsx 0.18.5, CDN with SRI) for Excel export/import
- IndexedDB + localStorage fallback for persistence
- Ollama (gemma3:4b) for local AI features
- Vitest + jsdom + fake-indexeddb for tests

## How to Use

### Option 1: One-click (Windows)

Double-click `start.bat`. It will:
1. Check Node.js and npm
2. Install dependencies if needed
3. Start Ollama if not running
4. Open the app in your browser

### Option 2: Manual

```bash
npm install
npx serve .
```

Then open `http://localhost:3000` in your browser.

### Option 3: Direct

Open `index.html` in your browser (some AI features may not work due to CORS).

## AI Features (optional)

Requires [Ollama](https://ollama.com) running on `localhost:11434`:

```bash
ollama pull gemma3:4b
ollama serve
```

- **Auto-categorize**: Type a description and click the brain icon to auto-detect the category.
- **Financial analysis**: Click "Analizar" to get AI-powered recommendations based on your spending patterns.

> Performance note: On CPU-only machines (no GPU), responses take 10-20 seconds. The button shows "Pensando..." while waiting.

## Tests

```bash
npx vitest run
```

264 tests covering pure functions in the `src/` layer (finance, storage, crypto, boot, ai-providers) and the storage/cloud-sync logic.

## Design Decisions

- **Single source of truth**: the `entries` array in memory. IndexedDB syncs on every change. The UI re-renders from the array, not from patches.
- **Currency**: EUR base with `es-ES` formatting. Multi-currency is supported by converting EUR to any of the 8 display currencies (amounts are stored in EUR, converted only for display). See `CURRENCIES` in `src/finance.js`.
- **Centralized categories** in `src/finance.js` (`EXPENSE_CATEGORIES` and `INCOME_CATEGORIES`). Custom categories can be added via the UI.
- **Versioned storage key** (`finanzas:gastos:v1`). If the structure changes in the future, it can be migrated by reading `v1` and writing `v2` without breaking old data.
- **Excel with BOM** so Excel recognizes accents and n without asking for encoding, and with neutralized fields against formula injection.
- **CDN with SRI** (`integrity` + `crossorigin`) so the browser verifies Bootstrap, Chart.js and SheetJS were not altered.
- **Golden angle color palette** (137.5 degrees) for unlimited distinct chart colors without repetition.
- **Service Worker**: network-first for local assets (always fresh), cache-first for CDN (fast + offline).

## Possible Future Improvements

- Automate cloud sync (OneDrive / Google Drive via API). The manual `.fpkg` backup already supports cross-device recovery: any device with `crypto.subtle` and the passphrase can decrypt a backup bundle.
