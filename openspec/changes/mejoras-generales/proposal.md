# Proposal: Mejoras Generales a Finanzas Personales 2026

## Intent
Convertir una app funcional pero básica en una app de finanzas personales completa y moderna, con dashboard, presupuestos, tendencias, búsqueda, recurrentes, UX mejorada, y soporte offline/PWA.

## Scope

### 10 mejoras agrupadas por categoría

#### Técnico
1. **IndexedDB** — Reemplazar localStorage por IndexedDB para soportar más datos
2. **PWA + Service Worker** — App instalable, funciona offline

#### Funcionalidad
3. **Dashboard inteligente** — Promedio gasto diario, proyección fin de mes, comparativa mes anterior
4. **Presupuestos por categoría** — Tope mensual por categoría con alertas visuales
5. **Gráfico de tendencia** — Línea temporal de gastos vs ingresos por mes
6. **Búsqueda por descripción** — Filtrar movimientos escribiendo texto
7. **Gastos recurrentes** — Movimientos automáticos mensuales (alquiler, suscripciones, sueldo)

#### UX
8. **Toasts** — Notificaciones no intrusivas en vez de alerts
9. **Edición inline** — Editar directamente en la tabla

#### CI/CD
10. **GitHub Actions** — Tests automáticos en cada push

## Non-goals
- No se agregan frameworks (React, Vue, etc.)
- No se agrega bundler (Webpack, Vite, etc.)
- No se cambia el stack actual
- No se agregan dependencias innecesarias

## Approach
Implementar en orden lógico: técnico primero (IndexedDB, PWA), después funcionalidad, después UX, al final CI/CD. Cada mejora es un PR encadenado.

## Risks
- IndexedDB requiere refactor de toda la capa de persistencia
- PWA requiere manifest.json y service worker registration
- Gastos recurrentes requieren lógica de "próxima fecha"
