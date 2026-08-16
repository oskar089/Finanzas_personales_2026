# 💰 Finanzas Personales 2026

App web simple para llevar el control de finanzas personales (gastos e ingresos).

## Características

- Cargar gastos e ingresos con monto, categoría, descripción y fecha.
- Editar y borrar movimientos.
- Ver lista de movimientos ordenados por fecha (más reciente primero).
- Filtrar por tipo, categoría y/o mes.
- Resumen: ingresos, gastos y balance.
- Gráficos de distribución por categoría (Chart.js).
- Auto-categorización con IA local (Ollama / Gemma 4).
- Modo oscuro.
- Exportar a CSV (compatible con Excel y Google Sheets, con protección contra fórmulas).
- Exportar e importar JSON (backup y restauración manual).
- Datos guardados en el navegador (`localStorage`). No salen de tu compu.

## Stack

- HTML5
- CSS3 + Bootstrap 5.3 (por CDN con SRI)
- JavaScript vanilla (sin frameworks, sin build)
- Chart.js 4.x (por CDN con SRI)
- Vitest + jsdom para tests

## Cómo usar

1. Abrí `index.html` en tu navegador (doble click y listo).
2. Empezá a cargar movimientos.
3. Filtrá por tipo, categoría o mes cuando quieras.
4. Exportá a CSV o JSON cuando quieras respaldar.

### Auto-categorización con IA (opcional)

- Requiere [Ollama](https://ollama.com) corriendo en `localhost:11434` con el modelo `gemma4` (`ollama pull gemma4`).
- Por CORS, la auto-categorización funciona mejor sirviendo la app por HTTP local
  (por ejemplo `npx serve .` o `python -m http.server`) en vez de abrir `index.html` directo.

## Tests

```bash
npx vitest run
```

Las funciones puras viven en `src/finance.js` y son la superficie de prueba (`src/finance.test.js`).

## Decisiones de diseño

- **Una sola fuente de verdad**: el array `entries` en memoria. `localStorage` se sincroniza en cada cambio. La UI se re-renderiza desde el array, no por parches.
- **Moneda**: euro (€) con formato `es-ES`.
- **Categorías centralizadas** en `src/finance.js` (`EXPENSE_CATEGORIES` e `INCOME_CATEGORIES`). Para agregar una nueva, modificás esas listas y se actualizan los `<select>` automáticamente.
- **Versión en la clave de storage** (`finanzas:gastos:v1`). Si en el futuro cambia la estructura, se puede migrar leyendo `v1` y escribiendo `v2` sin romper datos viejos.
- **CSV con BOM** al inicio (`\ufeff`) para que Excel reconozca acentos y la ñ sin pedirte encoding, y con campos neutralizados contra inyección de fórmulas.
- **CDN con SRI** (`integrity` + `crossorigin`) para que el navegador verifique que Bootstrap y Chart.js no fueron alterados.

## Próximas mejoras posibles

- Categorías personalizadas por el usuario.
- Cifrado de datos en localStorage.
- Sincronización con la nube (OneDrive / Google Drive vía API).
