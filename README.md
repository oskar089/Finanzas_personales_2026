# 💰 Finanzas Personales 2026

App web simple para llevar el control de gastos personales.

## Características

- Cargar gastos con monto, categoría, descripción y fecha.
- Ver lista de gastos ordenados por fecha (más reciente primero).
- Filtrar por categoría y/o por mes.
- Resumen: total del mes, cantidad de gastos y promedio.
- Borrar gastos.
- Exportar a CSV (compatible con Excel y Google Sheets).
- Datos guardados en el navegador (`localStorage`). No salen de tu compu.

## Stack

- HTML5
- CSS3 + Bootstrap 5.3 (por CDN)
- JavaScript vanilla (sin frameworks, sin build)

## Cómo usar

1. Abrí `index.html` en tu navegador (doble click y listo).
2. Empezá a cargar gastos.
3. Filtrá por categoría o por mes cuando quieras.
4. Exportá a CSV cuando quieras pasarlo a Excel / Google Sheets / OneDrive.

## Decisiones de diseño

- **Una sola fuente de verdad**: el array `gastos` en memoria. `localStorage` se sincroniza en cada cambio. La UI se re-renderiza desde el array, no por parches.
- **Categorías centralizadas** en una constante (`CATEGORIAS` en `app.js`). Para agregar una nueva, modificás esa lista y se actualizan los `<select>` automáticamente.
- **Versión en la clave de storage** (`finanzas:gastos:v1`). Si en el futuro cambia la estructura, se puede migrar leyendo `v1` y escribiendo `v2` sin romper datos viejos.
- **CSV con BOM** al inicio (`\ufeff`) para que Excel reconozca acentos y la ñ sin pedirte encoding.

## Próximas mejoras posibles

- Gráficos por categoría (Chart.js o similar).
- Editar gastos en vez de solo borrar.
- Ingresos y balance (gastos - ingresos).
- Modo oscuro.
- Sincronización con la nube (OneDrive / Google Drive vía API).
