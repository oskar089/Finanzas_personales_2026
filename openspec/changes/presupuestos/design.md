# Design: Presupuestos por Categoría

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Storage (IndexedDB)                                    │
│  - Key: 'budgets' (object { categoria: monto })         │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  src/finance.js                                         │
│  calculateBudgetProgress(entries, budgets, month)       │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│  app.js                                                 │
│  - Cargar presupuestos al inicio                        │
│  - UI configuración (modal)                             │
│  - renderBudgets() en dashboard                         │
│  - Badges en tabla                                      │
└─────────────────────────────────────────────────────────┘
```

## Files
- **Modify**: `src/finance.js` (calculateBudgetProgress)
- **Modify**: `src/storage.js` (loadBudgets, saveBudgets)
- **Modify**: `index.html` (modal configuración + dashboard)
- **Modify**: `app.js` (cargar, UI, render)
- **Modify**: `src/finance.test.js` (tests)

## Estados
- OK: < 80% → verde
- Advertencia: 80-100% → amarillo/naranja
- Excedido: > 100% → rojo