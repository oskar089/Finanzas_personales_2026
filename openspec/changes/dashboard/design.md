# Design: Dashboard Inteligente

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Dashboard (nueva sección en index.html)                │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Promedio │ │Proyección│ │Comparati-│ │  Días    │  │
│  │  diario  │ │ fin mes  │ │va vs ant.│ │restantes │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────┘
         │               │               │
         ▼               ▼               ▼
┌─────────────────────────────────────────────────────────┐
│  src/finance.js (funciones puras)                       │
│  calculateDailyAverage()                                │
│  calculateProjection()                                  │
│  calculateComparison()                                  │
│  getDaysInMonth()                                       │
│  getDaysElapsedInMonth()                                │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│  app.js — renderDashboard()                             │
│  Llama a las funciones puras y actualiza el DOM         │
└─────────────────────────────────────────────────────────┘
```

## Files
- **Modify**: `src/finance.js` (5 funciones nuevas)
- **Modify**: `index.html` (nueva sección HTML)
- **Modify**: `app.js` (renderDashboard + integración)
- **Modify**: `src/finance.test.js` (tests de las nuevas funciones)

## Edge cases
- Mes actual sin gastos → mostrar "€0" y "-"
- Mes anterior sin datos → comparativa "Sin datos"
- Hoy es día 1 → promedio = total (1 día)
- Proyección con 0 días → "€0"
