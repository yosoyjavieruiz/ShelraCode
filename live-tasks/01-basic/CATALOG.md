# Nivel básico — 2 proyectos reales, en etapas

Cada proyecto vive en una sola carpeta de trabajo que se construye en pasos
sucesivos. Corré cada etapa como un turno nuevo sobre la MISMA carpeta (no
borres nada entre etapas) y revisá el resultado antes de pasar a la
siguiente. Los prompts son deliberadamente detallados — así se prueba si el
agente realmente sigue una especificación completa, no si adivina bien un
pedido de una línea.

Carpeta sugerida: `live-tasks/01-basic/<nombre-proyecto>/`.

## Proyecto 1 — Sitio de una cafetería (web)

Un sitio estático de una página, sin frameworks, construido en 5 etapas.

**Etapa 1 — Base y hero.** "Quiero el sitio web de mi cafetería, 'Café
Aurora'. Empezá con `index.html` y `styles.css` (enlazado, no embebido). El
hero necesita: el nombre de la cafetería como título grande, una frase
corta abajo tipo 'café de especialidad, tostado en casa', un botón que diga
'Ver menú', y una imagen de fondo (usá un color sólido oscuro con overlay si
no hay imagen real disponible, no dejes un placeholder roto). La tipografía
tiene que ser legible y el botón necesita un estado hover visible. Que se
vea bien tanto en desktop como en una pantalla angosta tipo celular."

**Etapa 2 — Menú.** "Agregá una sección de menú justo debajo del hero, con
el título 'Nuestro menú'. Necesito 3 categorías (Cafés, Panadería, Bebidas
frías), cada una con 3-4 productos: nombre, descripción de una línea, y
precio alineado a la derecha. Usá tarjetas con separación visual clara
entre categorías. Mantené la paleta de colores que ya definiste en la
etapa 1, no inventes colores nuevos sin relación."

**Etapa 3 — Horarios y ubicación.** "Entre el menú y el footer, agregá una
sección con el horario de atención (lunes a viernes 8 a 20, sábados y
domingos 9 a 14) en formato de tabla o lista clara, y la dirección con un
mapa placeholder (un `<iframe>` o un div gris con el texto 'Mapa' está
bien, no hace falta integración real de Google Maps). Esta sección tiene
que verse distinta visualmente de la del menú para que se note la
separación, pero seguir la misma identidad visual del sitio."

**Etapa 4 — Formulario de reservas.** "Agregá un formulario de reserva de
mesa antes del footer: nombre, teléfono, fecha, hora, cantidad de personas.
Validación en JavaScript vanilla (todos los campos son obligatorios, fecha
no puede ser en el pasado, cantidad de personas entre 1 y 12) y al enviar
mostrá un mensaje de confirmación sin recargar la página (no hace falta
mandar la reserva a ningún lado real, es una demo)."

**Etapa 5 — Footer y pulido final.** "Agregá el footer: links a redes
sociales (Instagram, Facebook), copyright con el año actual generado por
JavaScript (no hardcodeado), y un botón flotante 'Volver arriba' que
aparezca solo después de hacer scroll y suba con animación suave. Después
de esto, revisá el sitio completo de punta a punta: que todos los enlaces
internos funcionen, que no haya elementos rotos, y que el diseño sea
consistente entre todas las secciones."

**Qué mirar:** ¿en cada etapa leyó lo que ya existía antes de tocarlo, o
reescribió partes de cero perdiendo trabajo anterior? ¿respetó TODOS los
requisitos de cada prompt (son varios por etapa) o solo los más obvios?
¿mantuvo consistencia visual entre etapas sin que se lo repitieras?

## Proyecto 2 — Utilidad de línea de comandos (no-web)

Un conversor de unidades en TypeScript, construido en 4 etapas.

**Etapa 1 — Conversión de temperatura.** "Necesito una herramienta de
línea de comandos en TypeScript (`convert.ts`, corrible con
`bun run convert.ts`) que convierta temperaturas. Uso esperado:
`bun run convert.ts 25 --from=c --to=f`. Tiene que soportar Celsius,
Fahrenheit y Kelvin en cualquier combinación, redondear a 2 decimales, y
si el usuario no pasa argumentos válidos mostrar un mensaje de ayuda claro
explicando el uso correcto en vez de tirar un error críptico."

**Etapa 2 — Tests y validación de errores.** "Escribí tests para las 6
combinaciones de conversión de temperatura (c→f, f→c, c→k, k→c, f→k, k→f)
más al menos 2 casos de entrada inválida (unidad desconocida, valor no
numérico) verificando que el mensaje de error sea el esperado y no un
crash sin manejar."

**Etapa 3 — Conversión de distancia.** "Agregá un segundo modo de
conversión para distancias: kilómetros, millas, metros y pies, en
cualquier combinación (`bun run convert.ts 10 --unit=distance --from=km
--to=mi`). Reusá la misma estructura de parseo de argumentos y el mismo
patrón de manejo de errores que ya armaste para temperatura, no dupliques
la lógica de arriba a abajo — si hace falta refactorizar temperatura para
compartir código con distancia, hacelo."

**Etapa 4 — Modo interactivo.** "Agregá un modo interactivo: si corro
`bun run convert.ts` sin argumentos, en vez de mostrar el error de uso
tiene que preguntar por consola qué querés convertir (temperatura o
distancia), el valor, unidad de origen y destino, paso a paso. Los tests
existentes tienen que seguir pasando sin modificarlos."

**Qué mirar:** ¿los tests de etapas anteriores siguen en verde después de
cada etapa nueva? ¿evitó duplicar lógica cuando el prompt explícitamente
se lo pidió? ¿el modo interactivo realmente reusa las funciones de
conversión ya escritas, o las reimplementó?
