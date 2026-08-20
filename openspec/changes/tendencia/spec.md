# Spec: Gráfico de Tendencia

## Context
El dashboard actual tiene gráficos doughnut (distribución por categoría). Falta una visión temporal: línea de gastos vs ingresos por mes para ver la evolución.

## Requirements

### R1: Datos para el gráfico
- Agrupar entries por mes (YYYY-MM)
- Para cada mes: total gastos, total ingresos, balance
- Últimos 12 meses (o menos si no hay datos)

### R2: Funciones puras en src/finance.js
- `calculateMonthlyTrend(entries, months = 12)` — array de {mes, gastos, ingresos, balance}

### R3: UI
- Nuevo gráfico de líneas (Chart.js) en el dashboard
- Dos líneas: gastos (rojo) e ingresos (verde)
- Eje X: meses, Eje Y: montos
- Tooltip con detalle

### R4: Testing
- Tests unitarios para calculateMonthlyTrend