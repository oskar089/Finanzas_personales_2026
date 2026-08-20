# Spec: Dashboard Inteligente

## Context
La app muestra resumen (ingresos, gastos, balance) pero no métricas avanzadas. Un dashboard con promedio diario, proyección y comparativa ayuda a tomar mejores decisiones.

## Requirements

### R1: Métricas a calcular
- **Promedio gasto diario**: total gastos del mes / días transcurridos
- **Proyección fin de mes**: promedio diario × días del mes
- **Comparativa mes anterior**: gastos mes actual vs mes anterior (delta y %)
- **Días restantes del mes**: para contexto

### R2: UI del Dashboard
- Nueva sección entre Resumen y Gráficos
- 4 tarjetas: Promedio diario, Proyección, Comparativa, Días restantes
- Responsive (4 cols en desktop, 2 en tablet, 1 en móvil)

### R3: Funciones puras en src/finance.js
- `calculateDailyAverage(entries, month)` — promedio gasto diario del mes
- `calculateProjection(entries, month)` — proyección fin de mes
- `calculateComparison(entries, month)` — delta y % vs mes anterior
- `getDaysInMonth(year, month)` — días del mes
- `getDaysElapsedInMonth(year, month)` — días transcurridos

### R4: Testing
- Tests unitarios para todas las funciones puras
- No romper los 50 tests existentes
