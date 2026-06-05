# Code Review Rules

## JavaScript
- Usar `const` / `let`, nunca `var`.
- Preferir funciones arrow para callbacks, funciones nombradas para handlers.
- Evitar mutación directa; preferir métodos inmutables (`map`, `filter`, `spread`).
- Validar inputs del usuario (formularios) antes de procesar.

## HTML / CSS
- Mantener separación: estructura en HTML, estilos en CSS, comportamiento en JS.
- Accesibilidad: usar etiquetas semánticas y `label` asociado a `input`.

## Git
- Mensajes de commit en conventional commits.
- No agregar Co-Authored-By ni atribución de AI.
- Commits atómicos: un cambio lógico por commit.

## General
- Comentarios en español (este proyecto es personal y en español).
- Nombres de variables y funciones en español o inglés, pero ser consistente.
- Una sola fuente de verdad en el estado de la app.
