# Spec: Gastos Recurrentes

## Context
El usuario quiere definir movimientos que se repiten automáticamente cada mes (alquiler, suscripciones, sueldo, etc.) para no tener que cargarlos manualmente.

## Requirements

### R1: Definición de recurrentes
- UI para crear/editar/eliminar recurrentes
- Campos: tipo, monto, categoría, descripción, fecha inicio, día del mes (1-28), activo/inactivo
- Guardar en IndexedDB

### R2: Generación automática
- Al cargar la app, verificar si hay recurrentes que deban generarse para el mes actual
- Crear entries automáticamente si no existen ya para ese mes
- Solo generar si el día del mes ya pasó (o es hoy)

### R3: Funciones puras en src/finance.js
- `generateRecurringEntries(recurring, entries, month)` — array de entries a crear

### R4: Testing
- Tests unitarios para generación
- Tests de integración con storage