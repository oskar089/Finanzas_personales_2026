# Design: Búsqueda por Descripción

## Architecture

```
index.html: input #filterSearch + botón limpiar
    └── app.js: filterSearch debounce → filterEntries(..., {search})
         └── src/finance.js: filterEntries() extendido
```

## Files
- **Modify**: `src/finance.js` (filterEntries agrega parámetro search)
- **Modify**: `index.html` (input búsqueda en filtros)
- **Modify**: `app.js` (debounce + integración)
- **Modify**: `src/finance.test.js` (tests)

## Filtro
- Busca en: `descripcion`, `categoria`
- Case-insensitive, substring match
- Debounce 300ms en app.js