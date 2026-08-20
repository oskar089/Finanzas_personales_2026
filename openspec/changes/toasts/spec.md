# Spec: Toasts (Notificaciones No Intrusivas)

## Context
La app usa `alert()` para todo: errores, confirmaciones, éxito. Es intrusivo y bloquea la UI. Los toasts son notificaciones temporales que aparecen y desaparecen solas.

## Requirements

### R1: Componente Toast
- Función `showToast(message, type = 'info', duration = 3000)`
- Types: 'success' (verde), 'error' (rojo), 'warning' (amarillo), 'info' (azul)
- Auto-dismiss después de duration
- Stack de múltiples toasts

### R2: Reemplazar alerts
- Errores de validación → toast error
- Confirmaciones críticas (borrar) → mantener confirm() o modal
- Éxitos (guardar, importar, exportar) → toast success
- Advertencias → toast warning

### R3: UI
- Container fijo en esquina (top-right)
- Animación slide-in / fade-out
- Accesible (role="alert", aria-live="polite")

### R4: Testing
- Tests unitarios para showToast
- Verificar que no rompe funcionalidad existente