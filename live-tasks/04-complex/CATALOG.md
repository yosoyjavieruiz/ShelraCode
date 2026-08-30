# Nivel complejo — 2 proyectos reales, en etapas

Horizontes largos, multi-servicio, y en el Proyecto 2 trabajo sobre código
que no escribió el agente (un repo real clonado). Acá se prueba si
aguanta sin perder el hilo, no solo si sabe programar.

Carpeta sugerida: `live-tasks/04-complex/<nombre-proyecto>/`.

## Proyecto 1 — Mini e-commerce con notificaciones en vivo

Backend + frontend + websocket, en 6 etapas.

**Etapa 1 — Catálogo.** "Backend Bun/Express + SQLite para un catálogo
de productos: nombre, descripción, precio, stock, imagen (url, no hace
falta subida real de archivos). `GET /products` con filtro opcional por
texto y por rango de precio, `GET /products/:id`. Frontend simple que
liste el catálogo en grilla con esos filtros."

**Etapa 2 — Carrito persistente.** "Agregá carrito de compras: agregar/
quitar producto, cambiar cantidad, ver subtotal por producto y total
general. El carrito tiene que sobrevivir a recargar la página. Al agregar
un producto, no dejes que la cantidad en el carrito supere el stock
disponible — avisá si se intenta."

**Etapa 3 — Checkout simulado.** "Agregá un flujo de checkout: datos de
envío (nombre, dirección, teléfono), resumen del pedido, confirmación.
Al confirmar, el pedido se guarda en el backend (nueva tabla `orders`),
el stock de cada producto se descuenta, y el carrito se vacía. No hace
falta integrar un método de pago real — un botón 'Confirmar pedido' que
simule el pago está bien, pero dejalo claramente marcado como simulado en
el código (comentario) y en la UI (texto tipo 'modo demo')."

**Etapa 4 — Panel de administración.** "Agregá una vista `/admin` (sin
necesidad de autenticación real para esta demo, pero dejalo anotado como
pendiente de seguridad) donde se vean todos los pedidos recibidos, con
su estado (pendiente, en preparación, enviado, entregado), y se pueda
cambiar el estado de cada uno."

**Etapa 5 — Notificaciones en vivo.** "Cuando el estado de un pedido
cambia desde el panel de admin, el cliente que lo hizo tiene que
enterarse en tiempo real si tiene la página abierta (sin recargar) —
implementá esto con WebSockets. Si se cae la conexión del websocket,
reconectá automáticamente sin que el usuario tenga que recargar la
página manualmente."

**Etapa 6 — Resiliencia.** "Probá cerrar y volver a abrir el servidor
backend mientras el frontend está abierto: ¿el frontend se recupera solo
cuando el backend vuelve, o queda roto para siempre hasta recargar?
Arreglalo si hace falta. También verificá qué pasa si dos clientes
intentan comprar la última unidad de un producto casi al mismo tiempo —
¿puede quedar el stock en negativo? Si puede, arreglalo."

**Qué mirar:** ¿mantuvo el objetivo general del proyecto a lo largo de 6
etapas sin perder contexto de decisiones anteriores (ej. la estructura de
la base de datos definida en la etapa 1)? ¿la reconexión del websocket y
el manejo de stock concurrente de la etapa 6 son soluciones reales o
solo taparon el síntoma que probaste?

## Proyecto 2 — Trabajar sobre un repo real ajeno

A diferencia de los demás, acá el código base NO lo escribe el agente
desde cero — lo trae de afuera. Esto prueba algo distinto: seguir
convenciones de un código que no conoce de antemano.

**Etapa 1 — Elegí y cloná.** Elegí un repositorio real, chico o mediano
(idealmente algo con issues abiertos etiquetados "good first issue" o
similar), y cloná una copia dentro de la carpeta del proyecto. Pedile al
agente: "Este es un repo que no escribiste vos. Antes de tocar nada,
explorá la estructura, identificá qué gestor de paquetes y qué
convenciones de estilo usa, y hacé un resumen corto de cómo está
organizado."

**Etapa 2 — Implementar algo real.** Elegí un issue real chico (o
inventá un feature pequeño y concreto si no hay issues abiertos
apropiados) y pedile: "Implementá esto: [descripción del issue],
siguiendo el estilo y las convenciones que identificaste en la etapa
anterior, no las tuyas por defecto."

**Etapa 3 — Verificación real.** "Corré la suite de tests del proyecto
completa (no solo un archivo) y confirmá que tu cambio no rompió nada
existente. Si el proyecto tiene linter/typecheck configurado, corré eso
también antes de darte por terminado."

**Qué mirar:** ¿respetó de verdad las convenciones existentes (nombres,
estructura de carpetas, estilo de commits si aplica) o impuso su propio
estilo por encima? ¿corrió la verificación real del proyecto ajeno o
asumió que estaba bien sin comprobarlo? Este proyecto en particular sirve
para ver cómo se comporta fuera de las convenciones que ya conoce de
ShelraCode mismo.
