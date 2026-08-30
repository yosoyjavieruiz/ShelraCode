# live-tasks — banco de pruebas manuales de ShelraCode

Esta carpeta es para probar el agente compilado (`dist/shelra.exe`) contra
tareas reales, de dificultad creciente, y dejar la evidencia junto a la tarea
para poder revisarla después.

## Convención de carpetas

Cada tarea que corras vive en su propia carpeta, dentro del nivel que le
corresponda:

```
live-tasks/
  01-basic/<nombre-de-la-tarea>/
  02-intermediate/<nombre-de-la-tarea>/
  03-advanced/<nombre-de-la-tarea>/
  04-complex/<nombre-de-la-tarea>/
```

`<nombre-de-la-tarea>` es libre, pero usa algo descriptivo en minúsculas con
guiones (ej. `landing-page`, `todo-api`, `refactor-auth`). Esa carpeta es el
**workspace** que le vas a apuntar a ShelraCode — ahí es donde el agente va a
leer/crear/editar archivos. Cuando termines una corrida, el resultado queda
ahí mismo, con nombre reconocible, así que yo puedo entrar directo a
`live-tasks/01-basic/landing-page/` y ver exactamente qué generó.

## Cómo correr una tarea

1. Crea la carpeta vacía (o con un `README.md` describiendo el objetivo si
   quieres dejar constancia del prompt exacto que usaste).
2. Corre `dist/shelra.exe` con esa carpeta como workspace (`cd` a la carpeta
   antes de lanzar el .exe, o usa la opción de elegir directorio si el TUI la
   ofrece).
3. Dale el objetivo (podés copiar/adaptar uno de los catálogos abajo).
4. Cuando termine (o si querés que yo lo revise a mitad de camino), avisame
   la ruta de la carpeta.

Los logs en vivo del `.exe` quedan en `live-tasks/.logs/shelracode.log` (ver
`docs/live-monitoring.md` para el detalle de qué se activó y cómo).

## Catálogo de pruebas por nivel

Cada nivel tiene **2 proyectos reales**, no una lista de prompts sueltos.
Cada proyecto se construye en **etapas sucesivas sobre la misma carpeta**
(turno 1 pone la base, turno 2 agrega sobre eso, etc.) con prompts
detallados de varios requisitos cada uno — así se prueba si el agente sigue
una especificación completa y mantiene contexto entre turnos, no solo si
acierta un pedido de una línea.

- [`01-basic/CATALOG.md`](01-basic/CATALOG.md) — sitio de una cafetería
  (web) + utilidad de línea de comandos (no-web).
- [`02-intermediate/CATALOG.md`](02-intermediate/CATALOG.md) — lista de
  tareas interactiva (web, con persistencia) + API de tareas (backend, con
  filtros y paginación).
- [`03-advanced/CATALOG.md`](03-advanced/CATALOG.md) — app de notas
  full-stack con autenticación + refactor de un servicio que el propio
  agente genera desordenado a propósito y después tiene que corregir.
- [`04-complex/CATALOG.md`](04-complex/CATALOG.md) — mini e-commerce con
  notificaciones en vivo por websocket + trabajo sobre un repo real ajeno
  clonado.

No hace falta seguir el catálogo al pie de la letra — es un punto de partida
para tener variedad de dificultad y tipo de proyecto mientras probamos.
