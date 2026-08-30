# Nivel avanzado — 2 proyectos reales, en etapas

Acá entran decisiones de arquitectura que el agente tiene que tomar solo
(no se las das masticadas en el prompt), persistencia real, y en el
Proyecto 2 un refactor sobre código que ya existe y que vos mismo generás
en la etapa 1 a propósito con cierto desorden.

Carpeta sugerida: `live-tasks/03-advanced/<nombre-proyecto>/`.

## Proyecto 1 — App de notas full-stack con autenticación

Backend + frontend real, en 5 etapas.

**Etapa 1 — Backend de notas.** "Quiero el backend de una app de notas:
Bun/Express + SQLite (usá `bun:sqlite`, no una librería externa de ORM).
CRUD completo de notas (`title`, `content`, `createdAt`, `updatedAt`),
persistido de verdad en un archivo `.sqlite` (no en memoria). Los
timestamps se actualizan solos, no los recibe el cliente. Documentá
brevemente los endpoints en un `README.md`."

**Etapa 2 — Frontend consumiendo la API.** "Ahora el frontend: HTML/JS
plano que consuma esta API. Necesito: lista de notas (título + preview
del contenido + fecha), crear nota nueva, editar una existente, borrar
con confirmación. Mientras se cargan o guardan datos mostrá un estado de
'cargando' visible, y si la API falla (probá apagando el backend) mostrá
un mensaje de error claro en vez de dejar la pantalla en blanco o
colgada."

**Etapa 3 — Autenticación.** "Agregá registro y login con sesión (elegí
vos si usar JWT o cookie de sesión, y justificá brevemente por qué). Las
contraseñas se guardan hasheadas, nunca en texto plano. Las notas ahora
pertenecen a un usuario: cada usuario solo puede ver, editar y borrar
SUS PROPIAS notas, ni siquiera conociendo el id de una nota ajena por la
URL. El frontend necesita pantallas de login/registro y ocultar la app de
notas hasta estar autenticado."

**Etapa 4 — Búsqueda y ordenamiento.** "Agregá una barra de búsqueda que
filtre notas por título o contenido en tiempo real (mientras se escribe,
sin necesidad de apretar un botón, pero sin mandar un request por cada
tecla — implementá debounce). Agregá también la posibilidad de ordenar
por fecha de creación o última modificación, ascendente o descendente."

**Etapa 5 — Manejo de conflictos.** "Si abro la misma nota en dos
pestañas, la edito en ambas, y guardo primero en una y después en la
otra, ¿qué pasa hoy? Probalo. Si el segundo guardado pisa silenciosamente
el primero sin avisar, arreglalo: al guardar, verificá que la nota no
haya cambiado desde que se cargó (por `updatedAt`), y si cambió avisale
al usuario en vez de sobrescribir en silencio."

**Qué mirar:** ¿tomó decisiones de arquitectura razonables sin que se las
dictaras (JWT vs cookie, cómo estructurar las carpetas) y las explicó?
¿la separación de datos por usuario en la etapa 3 es real (probá intentar
acceder a una nota ajena por id) o solo cosmética en el frontend? ¿la
etapa 5 realmente previene el conflicto o solo lo detecta después de que
ya se perdió el dato?

## Proyecto 2 — Refactor de un servicio existente (no-web)

Este proyecto tiene una etapa 0 especial: le pedís al agente que te
genere una base de código con problemas típicos a propósito, y después
en las etapas siguientes le pedís que los corrija — sin decirle
exactamente qué está mal, solo el síntoma, como pasaría en un trabajo
real.

**Etapa 0 — Generar la base (con desorden intencional).** "Necesito un
servicio de gestión de pedidos en TypeScript con Express: `POST /orders`
crea un pedido con lista de items y calcula el total, `GET /orders/:id`
lo devuelve. Implementalo rápido, priorizando que funcione — no hace
falta que esté perfectamente organizado." (El objetivo de este prompt es
que el agente probablemente mezcle validación, cálculo de totales y
acceso a datos en el mismo handler, sin capas separadas. Si lo entrega ya
bien separado en capas, salteá directo a la Etapa 3.)

**Etapa 1 — Síntoma: es difícil de testear.** "Quiero escribir tests
unitarios del cálculo de totales del pedido (con descuentos, impuestos,
etc.) sin tener que levantar un servidor HTTP ni mockear Express. Hoy no
puedo. Arreglalo." (Se espera que separe la lógica de negocio del
handler HTTP.)

**Etapa 2 — Síntoma: agregar una validación nueva toca demasiados
lugares.** "Necesito validar que ningún item tenga cantidad negativa o
cero. Agregala donde corresponda — pero si notás que la validación de
inputs está mezclada con la lógica de negocio o el acceso a datos,
separalas primero en vez de agregar un parche más arriba de otros
parches."

**Etapa 3 — Capas explícitas.** "Terminá de separar el servicio en capas
claras (routing/HTTP, lógica de negocio, acceso a datos), sin romper la
API pública existente ni los tests ya escritos. Documentá brevemente la
estructura resultante en el `README.md`."

**Qué mirar:** en la Etapa 0, ¿qué tan desordenado quedó realmente el
código generado? En las etapas siguientes, ¿identificó la causa raíz del
síntoma (acoplamiento, falta de capas) en vez de poner un parche
superficial? ¿los tests y la API pública siguieron funcionando en cada
etapa (correlo, no solo lo mires)?
