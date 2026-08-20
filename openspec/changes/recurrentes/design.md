# Design: Gastos Recurrentes

## Architecture

```
src/storage.js: loadRecurring(), saveRecurring()
    └── src/finance.js: generateRecurringEntries()
         └── app.js: checkAndGenerateRecurring() al init
              └── UI: modal configurar recurrentes
```

## Files
- **Modify**: `src/storage.js` (loadRecurring, saveRecurring)
- **Modify**: `src/finance.js` (generateRecurringEntries)
- **Modify**: `index.html` (modal recurrentes)
- **Modify**: `app.js` (checkAndGenerateRecurring, UI)
- **Modify**: `src/finance.test.js` (tests)

## Storage
- Store 'recurring' en IndexedDB: { id, tipo, monto, categoria, descripcion, diaMes, fechaInicio, activo }

## Lógica generación
- Para cada recurrente activo:
  - Si fechaInicio <= mes actual
  - Si día del mes <= hoy (o es futuro próximo)
  - Si no existe entry con misma descripción+categoría+monto+tipo en ese mes
  - Crear entry