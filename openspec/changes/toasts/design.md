# Design: Toasts

## Architecture

```
src/toast.js (módulo nuevo)
    └── showToast(message, type, duration)
    └── initToastContainer()

app.js: reemplazar alert() por showToast()
```

## Files
- **Create**: `src/toast.js`
- **Modify**: `index.html` (script tag + container)
- **Modify**: `app.js` (reemplazar alerts)
- **Modify**: `src/finance.test.js` (tests opcionales)

## Toast Types
- success: bg-success, icon ✅
- error: bg-danger, icon ❌
- warning: bg-warning, icon ⚠️
- info: bg-info, icon ℹ️

## Animación
- CSS: transform translateX(100%) → translateX(0)
- Opacity 0 → 1
- Transition 0.3s ease