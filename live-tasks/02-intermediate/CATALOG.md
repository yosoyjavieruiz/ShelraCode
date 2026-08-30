# Nivel intermedio — 2 proyectos reales, en etapas

Misma dinámica que el nivel básico: una carpeta por proyecto, etapas
sucesivas sobre la misma carpeta, prompts detallados con varios requisitos
por etapa. Acá además entra en juego coordinar varios archivos y mantener
estado real (localStorage, persistencia en disco).

Carpeta sugerida: `live-tasks/02-intermediate/<nombre-proyecto>/`.

## Proyecto 1 — Lista de tareas interactiva (web)

Construida en 5 etapas, sin frameworks (HTML/CSS/JS vanilla).

**Etapa 1 — Estructura y agregar tareas.** "Quiero una app de lista de
tareas. Separá `index.html`, `styles.css` y `app.js`. Necesito un input de
texto con un botón 'Agregar' (y que también funcione con Enter), y que las
tareas agregadas aparezcan en una lista debajo, cada una con un checkbox
para marcarla como completada (tachado + opacidad reducida cuando está
completa) y un botón de borrar (ícono de tacho o una 'x', a tu criterio,
pero visualmente claro). El input se tiene que vaciar después de agregar."

**Etapa 2 — Persistencia.** "Las tareas tienen que sobrevivir a recargar la
página, usando localStorage. Guardá el texto, si está completada, y la
fecha de creación de cada tarea. Al cargar la página, restaurá el estado
exacto en el que quedó (orden incluido)."

**Etapa 3 — Categorías.** "Agregá la posibilidad de asignarle una
categoría a cada tarea al crearla (Personal, Trabajo, Urgente — un select
o botones, a tu criterio), mostrada como una etiqueta de color distinto
por categoría en cada ítem de la lista. Las categorías también se
persisten en localStorage junto con el resto de los datos."

**Etapa 4 — Filtros y contador.** "Agregá filtros arriba de la lista: Todas
/ Pendientes / Completadas, y también un filtro por categoría. Mostrá un
contador tipo '3 de 8 pendientes' que se actualice en tiempo real con
cualquier cambio (agregar, completar, borrar, filtrar)."

**Etapa 5 — Edición y orden.** "Permití editar el texto de una tarea
existente haciendo doble click sobre ella (se convierte en un input
editable, Enter o click afuera guarda el cambio, Esc cancela). Además,
agregá la posibilidad de reordenar tareas arrastrándolas (drag and drop),
persistiendo el nuevo orden."

**Qué mirar:** ¿coordinó bien los 3 archivos sin romper lo que ya
funcionaba de etapas anteriores? ¿el localStorage se actualiza en TODOS
los puntos donde cambia el estado (agregar, completar, borrar, editar,
reordenar), o se le olvidó alguno? ¿probó manualmente el flujo completo
antes de darlo por terminado, o solo el último cambio?

## Proyecto 2 — API de tareas con persistencia (backend)

La misma idea de "lista de tareas" pero como servicio, en 4 etapas. Usá
Bun/Express (o el framework HTTP que el agente prefiera, con justificación).

**Etapa 1 — CRUD básico.** "Necesito una API REST de tareas con
persistencia en un archivo JSON local (no hace falta base de datos real).
Endpoints: `GET /tasks` (lista todas), `POST /tasks` (crea, requiere
`title`, opcional `category`), `PATCH /tasks/:id` (actualiza `title`,
`completed` o `category`), `DELETE /tasks/:id`. Cada tarea tiene id
único, título, estado completado (default false), categoría opcional, y
fecha de creación. Validá el body de cada request y devolvé 400 con un
mensaje claro si falta algo obligatorio o el tipo de dato es incorrecto."

**Etapa 2 — Manejo de errores y códigos de estado.** "Revisá los 4
endpoints: `GET/PATCH/DELETE /tasks/:id` con un id que no existe tiene que
devolver 404 con un mensaje claro, no un 500 ni un crash del servidor.
Agregá un middleware que capture cualquier error no manejado y devuelva
un 500 genérico en vez de tirar abajo el proceso. Escribí tests que
prueben los casos de error, no solo el camino feliz."

**Etapa 3 — Filtros por query params.** "Agregá soporte para
`GET /tasks?completed=true`, `GET /tasks?category=Trabajo`, y la
combinación de ambos al mismo tiempo. Si se pasa un valor de `completed`
que no sea 'true' ni 'false', ignoralo en vez de romper (tratalo como si
no se hubiera pasado el filtro)."

**Etapa 4 — Paginación.** "La lista de tareas puede crecer mucho.
Agregá paginación con `?page=1&limit=20` (valores por defecto si no se
pasan), devolviendo también el total de tareas y el total de páginas en
la respuesta. Verificá que la paginación funcione bien combinada con los
filtros de la etapa anterior (por ejemplo, filtrar por categoría Y
paginar al mismo tiempo)."

**Qué mirar:** ¿los tests de etapas anteriores (si los escribió) siguen
pasando después de cada etapa nueva? ¿la combinación de filtros + paginación
de la etapa 4 realmente filtra primero y pagina después (no al revés, lo
que daría totales incorrectos)? ¿validó los edge cases (página fuera de
rango, limit negativo, etc.) o asumió que el input siempre es válido?
