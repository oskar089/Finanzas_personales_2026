# Spec: Presupuestos por Categoría

## Context
El usuario quiere definir topes mensuales por categoría (ej: Comida €300, Transporte €150) y recibir alertas visuales cuando se acerca o supera el límite.

## Requirements

### R1: Configuración de presupuestos
- UI para definir presupuesto mensual por categoría
- Guardar en IndexedDB (persistente)
- Categorías sin presupuesto = sin límite

### R2: Cálculo de progreso
- Por categoría: gasto actual / presupuesto
- % usado: (actual / presupuesto) × 100
- Estado: OK (< 80%), Advertencia (80-100%), Excedido (> 100%)

### R3: UI de alertas
- En tabla de movimientos: badge en categoría con color según estado
- En dashboard: tarjeta resumen de presupuestos
- Toasts (cuando se implemente mejora 8)

### R3: Funciones puras en src/finance.js
- `calculateBudgetProgress(entries, budgets, month)` — array de {categoria, actual, presupuesto, porcentaje, estado}

### R4: Testing
- Tests unitarios para calculateBudgetProgress
- Tests de integración con storage