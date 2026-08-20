# Design: Gráfico de Tendencia

## Architecture

```
src/finance.js: calculateMonthlyTrend()
    └── app.js: renderTrendChart() → Chart.js line chart
```

## Files
- **Modify**: `src/finance.js` (calculateMonthlyTrend)
- **Modify**: `index.html` (canvas en dashboard)
- **Modify**: `app.js` (renderTrendChart)
- **Modify**: `src/finance.test.js` (tests)

## Chart config
- Type: 'line'
- Datasets: Gastos (rojo), Ingresos (verde)
- X axis: meses (formato MM/YYYY)
- Y axis: montos
- Responsive