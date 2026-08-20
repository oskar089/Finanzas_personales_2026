# Spec: Búsqueda por Descripción

## Context
El usuario quiere filtrar movimientos escribiendo texto en la descripción. Actualmente solo hay filtros por tipo, categoría y mes.

## Requirements

### R1: Input de búsqueda
- Campo de texto en la sección de filtros
- Filtrado en tiempo real (debounce 300ms)
- Busca en: descripción, categoría
- Case-insensitive

### R2: Funciones puras en src/finance.js
- `filterEntries(entries, { type, category, month, search })` — extiende filtro existente

### R3: UI
- Input "Buscar" en la card de filtros
- Botón limpiar búsqueda

### R4: Testing
- Tests unitarios para búsqueda