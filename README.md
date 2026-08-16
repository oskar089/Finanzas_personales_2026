# 💰 Personal Finance 2026

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-222222?style=for-the-badge&logo=github&logoColor=white)](https://oskar089.github.io/Finanzas_personales_2026/)

A simple web app to track personal finances (expenses and income).

> **Note on the live demo:** AI auto-categorization (Ollama / Gemma 4) requires Ollama running locally on your machine, so this feature is not available in the deployed version. The rest of the app works normally.

## Features

- Add expenses and income with amount, category, description and date.
- Edit and delete entries.
- View the transaction list ordered by date (most recent first).
- Filter by type, category and/or month.
- Summary: income, expenses and balance.
- Category distribution charts (Chart.js).
- Local AI auto-categorization (Ollama / Gemma 4).
- Dark mode.
- Export to CSV (Excel and Google Sheets compatible, with formula injection protection).
- Export and import JSON (backup and manual restore).
- Data stored in the browser (`localStorage`). It never leaves your machine.

## Tech Stack

- HTML5
- CSS3 + Bootstrap 5.3 (CDN with SRI)
- Vanilla JavaScript (no frameworks, no build step)
- Chart.js 4.x (CDN with SRI)
- Vitest + jsdom for tests

## How to Use

1. Open `index.html` in your browser (double click and you're done).
2. Start adding entries.
3. Filter by type, category or month whenever you want.
4. Export to CSV or JSON when you want a backup.

### AI auto-categorization (optional)

- Requires [Ollama](https://ollama.com) running on `localhost:11434` with the `gemma4` model (`ollama pull gemma4`).
- Due to CORS, auto-categorization works best when serving the app over local HTTP
  (for example `npx serve .` or `python -m http.server`) instead of opening `index.html` directly.

## Tests

```bash
npx vitest run
```

Pure functions live in `src/finance.js` and are the test surface (`src/finance.test.js`).

## Design Decisions

- **Single source of truth**: the `entries` array in memory. `localStorage` syncs on every change. The UI re-renders from the array, not from patches.
- **Currency**: euro (€) with `es-ES` formatting.
- **Centralized categories** in `src/finance.js` (`EXPENSE_CATEGORIES` and `INCOME_CATEGORIES`). To add a new one, edit those lists and the `<select>` elements update automatically.
- **Versioned storage key** (`finanzas:gastos:v1`). If the structure changes in the future, it can be migrated by reading `v1` and writing `v2` without breaking old data.
- **CSV with BOM** at the start (`\ufeff`) so Excel recognizes accents and ñ without asking for encoding, and with neutralized fields against formula injection.
- **CDN with SRI** (`integrity` + `crossorigin`) so the browser verifies Bootstrap and Chart.js were not altered.

## Possible Future Improvements

- User-defined categories.
- Data encryption in localStorage.
- Cloud sync (OneDrive / Google Drive via API).
