# ShelraCode Autonomy V2 - Permission, Planning and Real CLI Evidence

**Fecha:** 2026-08-26  
**Repositorio:** `D:\PROYECTS\shelra`  
**Branch:** `main`  
**HEAD auditado:** `14f79ecf86097a8df60e52497986ebdf84e436d5`

## Resultado ejecutivo

Se corrigió el bloqueo de permisos que hacía que ShelraCode rechazara o
ejecutara silenciosamente acciones del agente sin preguntarle al usuario.

El worktree ya contenía cambios del usuario al comenzar esta intervención,
incluida la eliminación marcada de `index.html`. Ese estado no se revirtió, no
se mezcló con el fixture de aceptación y no se usó ningún rollback destructivo.

El modo predeterminado ahora es `ASK`: cada acción de workspace pasa por una
solicitud interactiva antes de ejecutarse, incluyendo:

- listar directorios;
- leer archivos;
- crear archivos;
- editar archivos;
- ejecutar comandos, tests o Git;
- borrar archivos o realizar acciones destructivas.

La aprobación se limita a la invocación exacta. `Enter` aprueba una vez y
`Esc` rechaza esa acción. Un rechazo no se convierte en un fallo opaco: llega
al agente como `PERMISSION_DENIED` recuperable, con una instrucción para no
repetir idénticamente la acción.

La corrección se comprobó usando el bundle actual de ShelraCode y una sesión
PTY real. No se simuló el agente con un mock para la aceptación principal.

## Correcciones de dirección solicitadas

### El plan lo define el LLM

El plan de trabajo no se convirtió en una lista fija de reglas para prompts
concretos. En modo de planificación semántica, el LLM propone los nodos, sus
descripciones, dependencias y alcance. ShelraCode conserva la autoridad sobre
seguridad, permisos, validación de esquema, ciclo de vida, evidencia y
transiciones legales.

La prueba real de la web mostró un plan generado por el modelo:

```text
Plan · 0/3
- Create the main HTML structure with time display element
- Create CSS styling for the clock interface
- Create JavaScript to update time every second
```

Después de cada creación, la interfaz avanzó:

```text
0/3 -> 1/3 -> 2/3 -> 3/3
```

Esto es distinto de inventar desde el host los archivos o pasos de una web.
El controlador solo ejecutó y verificó el plan propuesto por el LLM dentro de
los límites de seguridad.

### No hay lógica de producción para una frase específica

No se agregó una condición del tipo `if task === website`, ni una regla para
el contador, la hora o un benchmark concreto. La única corrección adicional
relacionada con el primer arranque fue genérica: separar el estado interno de
LocalCode (`agent.jsonl` y `.localcode/`) de los archivos del proyecto para que
un log del propio agente no haga parecer que un workspace vacío contiene código.

El contador/reset que apareció en discusiones anteriores no es un requisito
del producto ni una condición de éxito de esta implementación.

## Causa raíz original

El problema no era solo que el modelo fuera pequeño. La cadena observada era:

```text
acción válida del modelo
  -> política no interactiva o límite de plan
  -> rechazo del host
  -> estado BLOCKED
  -> sin diálogo de aprobación utilizable
```

Había tres defectos principales:

1. `PermissionMode` no tenía un modo interactivo predeterminado para todas las
   operaciones. Los modos seguros permitían lecturas silenciosamente o
   bloqueaban acciones de plan sin darle al usuario la oportunidad de
   aprobarlas.
2. El loop tenía límites de alcance del plan que podían producir
   `PERMISSION_DENIED`/`CONFLICT` antes de que una acción válida llegara al
   mecanismo de autorización.
3. En un workspace vacío, un `agent.jsonl` generado por el runtime se contaba
   como evidencia de proyecto. Eso impedía que el gate de contexto reconociera
   correctamente una creación greenfield y terminaba en:

```text
CREATE BLOCKED index.html · INSUFFICIENT_CONTEXT
```

El primer intento real reprodujo exactamente ese último bloqueo. Tras excluir
el estado interno del índice de proyecto, el segundo intento pudo pedir
aprobación y completar el flujo.

## Solución adoptada

### Modos de permiso

| Modo   | Comportamiento                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------- |
| `ASK`  | Predeterminado. Pregunta antes de cada acción de workspace, incluidas lecturas.                   |
| `PLAN` | Permite lecturas automáticamente; pregunta antes de escribir o ejecutar.                          |
| `EDIT` | Permite trabajo ordinario; pregunta antes de acciones destructivas.                               |
| `AUTO` | Modo explícito menos interactivo para usuarios que lo elijan. Mantiene las barreras de seguridad. |

`ASK` es el valor que se usa cuando no hay configuración persistida ni variable
de entorno. Los modos `EDIT` y `AUTO` siguen existiendo como decisiones
explícitas del usuario; esto conserva compatibilidad con el producto y con el
patrón de modos de Claude Code. Las políticas duras de workspace, red, secretos
y privacidad no se pueden saltar mediante un clic de aprobación.

### Flujo central

```text
TUI submit
  -> runAgent
  -> createExecutionContext
  -> modelo propone una acción
  -> validación del tool
  -> límite de plan/alcance
  -> checkPermission
  -> requestApproval exacto
  -> usuario aprueba o rechaza
  -> tool ejecuta una sola vez
  -> observación tipada
  -> continuación del modelo
```

Una aprobación ya concedida se guarda como autorización de una sola invocación
(`approvalGranted`). No se transforma en permiso global para todas las acciones
siguientes.

## Evidencia de código actual

| Responsabilidad                               | Archivo y símbolo                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Tipo de modos                                 | `src/shared/types.ts:31` - `PermissionMode`                                                                  |
| Valor predeterminado y lectura de entorno     | `src/config/settings.ts:20` - `readSettings`                                                                 |
| Decisión central de riesgo                    | `src/tools/permissions.ts:56` - `checkPermission`                                                            |
| Aplicación uniforme a cada tool               | `src/tools/workspace.ts:377` - `requirePermission`                                                           |
| Aprobación exacta de una invocación           | `src/tools/types.ts:25` - `ToolApprovalRequest`; `src/tools/types.ts:52` - `approvalGranted`                 |
| Aprobación de límites del plan LLM            | `src/agent/loop.ts:4012` - `requestControllerApproval`                                                       |
| Callback interactivo del TUI                  | `src/tui/app.tsx:1660` - `requestApproval`                                                                   |
| Resolución Enter/Esc                          | `src/tui/app.tsx:704` - `resolveApproval`; `src/tui/app.tsx:2535` - manejo del overlay                       |
| Diálogo visible                               | `src/tui/components/ApprovalDialog.tsx:19`                                                                   |
| Ciclo de modos en Settings                    | `src/tui/app.tsx:2069`                                                                                       |
| Separación del runtime del índice de proyecto | `src/context/repository.ts:31` - `isIgnoredContextFile`; `src/tools/workspace.ts:370` - `isRuntimeStatePath` |
| Plan semántico LLM                            | `src/agent/task-graph.ts:269` y `src/agent/loop.ts:1037`                                                     |

Todos los tools de workspace activos pasan por `requirePermission`: `ReadFile`,
`WriteFile`, `CreateFile`, `EditFile`, `DeleteFile`, `ListFiles`, `GlobFiles`,
`SearchText`, `Shell`, `GitStatus`, `GitDiff` y `RunTests`.

## Relación con Claude Code

La solución replica el patrón público documentado, sin afirmar acceso a
implementaciones privadas de Anthropic:

1. el host evalúa el nombre del tool y sus argumentos;
2. las reglas de permiso deciden si la acción está permitida, debe preguntarse
   o debe denegarse;
3. una callback recibe la acción exacta y la presenta al usuario;
4. aprobar permite solo esa operación;
5. rechazar devuelve el motivo al agente para que cambie de estrategia.

La documentación oficial relevante es:

- [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes)
- [Claude Agent SDK permissions](https://code.claude.com/docs/en/agent-sdk/permissions)
- [Claude Agent SDK approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)

La diferencia deliberada de ShelraCode es que el modo nuevo `ASK` es más
estricto que el modo predeterminado usual de Claude Code: pregunta también
antes de leer, porque esa es la política solicitada para ShelraCode. `PLAN`
mantiene la semántica de exploración de solo lectura con aprobación antes de
editar o ejecutar.

## Pruebas reales con el CLI/TUI

### Artefacto y comando

Se reconstruyó el bundle desde el código actual:

```text
bun run build
Built current source to dist/
```

La aceptación interactiva se ejecutó con:

```text
bun D:\PROYECTS\shelra\dist\index.js --tui
```

El directorio de trabajo fue el fixture desechable:

```text
C:\Users\Javie\AppData\Local\Temp\localcode-cli-clock-current-final-202608261
```

No se modificó el workspace real de ShelraCode durante la aceptación.

### Creación greenfield real

Prompt físico inyectado en el TUI:

```text
crea una web de la hora usa html, css y JavaScript
```

Resultado visible en el TUI:

```text
Approval required · Create workspace file: index.html
Approval required · Create workspace file: style.css
Approval required · Create workspace file: script.js

Plan · 0/3 -> 1/3 -> 2/3 -> 3/3
Done · 3 files changed
Task completed and verified
```

La sesión tuvo aprobación física con `Enter` para cada creación. El runtime
identificado en el flujo fue `lm-studio · Qwen3.5 4B`; la etiqueta inicial de
la UI mostraba también una recomendación `Qwen3 14B Claude 4.5 Opus Distill`.
Por tanto, esta prueba demuestra el comportamiento real del harness y de los
permisos, pero no debe presentarse como una prueba ejecutada por un modelo 14B.

### Lectura y rechazo real

En otra sesión, el modelo solicitó:

```text
Approval required · Read workspace file: index.html
```

Se pulsó `Esc`. El TUI mostró:

```text
Approval denied
READ BLOCKED index.html · PERMISSION_DENIED
```

El archivo no fue modificado por esa acción. El agente recibió recuperación
tipada y no se convirtió en un falso éxito.

### Edición real

En una sesión posterior se aprobó la lectura y el modelo llegó a:

```text
Approval required · Edit workspace file: index.html
```

Se pulsó `Enter`. El TUI registró:

```text
EDIT index.html · +1 -0
```

Después se comprobó en disco que el fixture contenía la nota agregada. Esto
prueba el ciclo real `ReadFile -> aprobación -> EditFile -> aprobación ->
mutación`, no solo el contrato unitario.

### Observación de calidad del modelo

La sesión greenfield creó `index.html`, `style.css` y `script.js`, pero el
modelo también dejó CSS y JavaScript inline en `index.html` y no enlazó
necesariamente los dos archivos externos. Eso es una limitación de calidad
semántica del modelo/validador de la tarea, no un fallo del diálogo de
permisos. No se afirma aquí una prueba completa de navegador: no se ejecutó un
browser smoke test en esta aceptación.

### Recorrido real contra el `.exe` instalado

Se probó el ejecutable activo, no el bundle de desarrollo, desde el mismo
fixture externo:

```text
C:\Users\Javie\.shelra\bin\shelra.exe
cwd: C:\Users\Javie\AppData\Local\Temp\localcode-cli-clock-current-final-202608261
modelo observado: Local · Qwen3.5 4B
prompt inyectado: Lee el proyecto actual y dime que archivos existen. No edites nada.
```

La primera ejecución del artefacto instalado, antes de la regresión del
clasificador, produjo el fallo real:

```text
Local preparation paused · no verified mutation scope was found
```

No apareció una aprobación de lectura ni un resultado de workspace. La causa
fue verificable en código: `analyzeTask` encontraba `edit` como substring de
`edites`, y `resolveTurnMode` permitía que esa etiqueta `SMALL_EDIT` ganara
frente a `No edites nada`. Se canceló con `Ctrl+C` y el TUI restauró el terminal.

Después de corregir la coincidencia por palabra completa y dar prioridad a la
restricción explícita de solo lectura, se reconstruyó e instaló de nuevo el
`.exe`. La misma prueba produjo:

```text
Approval required · List workspace directory: .
Approval granted once · Enter
3 files · 28.2s
Task completed and verified
```

El resultado mostró `index.html`, `style.css` y `script.js`, con sus
descripciones, sin una mutación. Se cerró nuevamente con `Ctrl+C`, código 0.
Esta es evidencia de una jornada CLI/TUI real sobre el artefacto instalado,
con modelo local y aprobación de herramienta; no es un mock ni una aserción
derivada solamente de una prueba unitaria.

## Cobertura automatizada de apoyo

Los tests automatizados no sustituyen la aceptación real; sirven para evitar
regresiones en el contrato y en el kernel.

### Permisos

```text
bun test tests/unit/permissions.test.ts
13 pass
0 fail
31 expect() calls
```

La cobertura incluye aprobación para lectura, creación, edición, comandos
destructivos, denegación tipada y política de red.

### Kernel, planner y contexto

```text
bun test tests/unit/permissions.test.ts tests/unit/settings.test.ts tests/unit/context-gate.test.ts tests/integration/context-relevance.test.ts tests/integration/agent-loop.test.ts tests/integration/agent-planner.test.ts
79 pass
0 fail
348 expect() calls
```

Esto incluye el planner definido por el LLM, avances del plan después de
mutaciones, recuperación de errores, gate de contexto y separación de
`agent.jsonl` como estado runtime.

### Typecheck, build y smoke del bundle

```text
bun run typecheck
$ tsc --noEmit

bun run build
Built bundle: dist/index.js
Built standalone executable: dist/shelra.exe
Installed active ShelraCode 0.1.1.
Global command: shelra
Install directory: C:\Users\Javie\.shelra\bin
User PATH updated. Open a new terminal to use shelra everywhere.

bun run smoke
source help: ShelraCode - local-first coding agent
source version: ShelraCode 0.1.1
source doctor: LocalCode Doctor
bundle help: ShelraCode - local-first coding agent
bundle version: ShelraCode 0.1.1
bundle doctor: LocalCode Doctor
standalone help: ShelraCode - local-first coding agent
standalone version: ShelraCode 0.1.1
standalone doctor: LocalCode Doctor
```

## Produccion: build, instalacion y comando global

Esta entrega implementa el alcance de produccion solicitado para Windows: al
ejecutar `bun run build`, el proyecto compila el bundle, genera un ejecutable
standalone y activa esa version para el usuario actual. La instalacion no
depende de LM Studio ni de Ollama.

La ruta activa verificada fue:

```text
Repositorio:       D:\PROYECTS\shelra
Bundle:            dist\index.js
Ejecutable fuente: dist\shelra.exe
Ejecutable activo: C:\Users\Javie\.shelra\bin\shelra.exe
Manifest:          C:\Users\Javie\.shelra\active.json
Compatibilidad:    C:\Users\Javie\.shelra\bin\localcode.cmd
Version:           0.1.1
Arquitectura:      Windows x64
```

El instalador escribe primero un archivo temporal, conserva la version activa
anterior como `shelra.exe.previous` cuando existe, reemplaza el ejecutable y
actualiza el manifiesto. El comando `shelra` se registra en el User PATH de
Windows de forma idempotente. El proceso que ejecuta el build tambien recibe la
ruta actualizada, pero una terminal ya abierta no puede heredar cambios del
registro: hay que abrir una terminal nueva.

La prueba de una terminal externa produjo:

```text
cwd=C:\Users\Javie\AppData\Local\Temp\localcode-cli-clock-current-final-202608261
command=C:\Users\Javie\.shelra\bin\shelra.exe
ShelraCode 0.1.1
EXIT=0
```

Ademas, el ejecutable instalado sin argumentos fue iniciado desde ese proyecto
externo y permanecio en el proceso TUI. El TUI usa `process.cwd()` como
workspace, por lo que `shelra` puede abrir proyectos diferentes desde rutas
diferentes. La aceptacion PTY anterior comprobo el recorrido real de teclado,
aprobacion, rechazo, edicion, cancelacion y restauracion del terminal; el
proceso adicional de esta prueba se cerro despues de confirmar su linea de
comando exacta.

### Paridad de pantalla entre bundle y ejecutable

La primera comparacion revelo una diferencia de estado, no de compilacion: un
proyecto externo sin `.localcode/config.json` entraba en onboarding, mientras
el repositorio de Shelra ya configurado entraba en conversacion. Para cumplir
el contrato de que ambos comandos sean iguales en cualquier ruta, el arranque
sin argumentos ahora siempre usa la pantalla `conversation`. El onboarding se
abre solo con el comando explicito `shelra setup` (o `localcode setup`).

La correccion esta implementada en `src/cli/startup.ts` y conectada desde
`src/index.ts`; fue cubierta primero por una prueba de regresion y despues por
una jornada PTY real desde el fixture externo sin configuracion. Tanto
`dist/index.js` como `C:\Users\Javie\.shelra\bin\shelra.exe`, ejecutados sin
argumentos, mostraron la misma cabecera, compositor y superficie de
conversacion; ambos fueron cerrados con `Ctrl+C` y restauraron el terminal.

La solucion sigue el patron publico de Claude Code, sin copiar implementacion
privada: un binario instalado por usuario, un comando disponible desde el PATH,
ejecucion relativa al directorio actual, configuracion separada de usuario y
proyecto, y aprobaciones de herramientas en el host. Referencias oficiales:

- [Claude Code installation](https://code.claude.com/docs/en/installation)
- [Claude Code CLI usage](https://code.claude.com/docs/en/cli-usage)
- [Claude Code permissions](https://code.claude.com/docs/en/permissions)
- [Claude Code settings](https://code.claude.com/docs/en/settings)

Tambien se verificaron directamente los comandos del ejecutable:

```text
shelra.exe --help     -> ShelraCode - local-first coding agent
shelra.exe --version  -> ShelraCode 0.1.1
shelra.exe doctor     -> LocalCode Doctor
```

Esto prueba la instalacion local activa y la resolucion global del CLI. Todavia
no prueba un instalador firmado publico, actualizaciones remotas ni artefactos
macOS/Linux; esos son gates de distribucion posteriores.

### Suite completa

La suite completa se ejecutó y produjo:

```text
593 pass
1 skip
0 fail
1925 expect() calls
Ran 594 tests across 104 files
```

La suite canónica completa quedó verde en esta ejecución. El único skip es una
prueba interactiva de cierre del menú slash. El flujo de permisos real, el
planner LLM, el contexto, el recovery, el instalador y las pruebas TUI
deterministas pasan. Esto no sustituye la jornada interactiva contra cada
artefacto final, pero elimina el bloqueo de tests automatizados que estaba
documentado antes de este empaquetado.

El chequeo global de formato también encuentra 27 archivos ya modificados o
documentos de trabajo con diferencias de Prettier. No se ejecutó un
`prettier --write .` porque habría reescrito cambios de usuario ajenos a este
alcance.

## Qué queda protegido

- Los cambios existentes del usuario se conservaron.
- No se usó `git reset --hard`, `git clean`, `git checkout`, `git restore` ni
  `git stash`.
- El fixture de prueba fue externo y desechable.
- La aprobación no concede permisos permanentes.
- `OUTSIDE_WORKSPACE`, secretos, red bloqueada por política y otras barreras
  duras siguen siendo denegaciones del host.
- El modo `STRICT_ZERO` continúa separado de la autorización de workspace y
  no habilita inferencia pagada.
- La respuesta del modelo no puede declarar por sí sola que el trabajo está
  completo.

## Límites actuales

1. La aceptación interactiva de permisos y plan se hizo contra `dist/index.js`
   desde un PTY real; el ejecutable standalone ya pasa el lanzamiento,
   `--help`, `--version` y `doctor`, y fue iniciado desde un proyecto externo.
   Falta repetir toda la jornada interactiva de modelo contra el `.exe` como
   gate separado de release.
2. Un consumidor no interactivo de `runAgent` que no suministre
   `requestApproval` recibe una denegación recuperable porque no existe una
   persona a quien preguntar. El TUI sí suministra la callback interactiva.
3. `EDIT` y `AUTO` siguen siendo opt-outs explícitos. El comportamiento de
   seguridad por defecto es `ASK`; no se pretende que un modo no interactivo
   pregunte mágicamente sin UI.
4. La verificación de artefactos y navegador debe seguir evolucionando para
   que `Task completed and verified` implique evidencia semántica completa en
   tareas greenfield heterogéneas.
5. La distribución pública firmada, la actualización remota y los artefactos
   macOS/Linux siguen fuera de esta entrega. El build/install local de Windows
   x64 ya está verificado.

## Criterio de finalización de este cambio

Este cambio se considera funcional para el problema reportado cuando:

```text
PASS  ASK es el modo predeterminado
PASS  ReadFile pide aprobación
PASS  CreateFile pide aprobación
PASS  EditFile pide aprobación
PASS  Shell/RunTests/Git pasan por la misma política
PASS  Enter aprueba una sola invocación
PASS  Esc rechaza con PERMISSION_DENIED recuperable
PASS  el plan visible proviene del LLM y avanza con la ejecución
PASS  un log runtime no bloquea una creación greenfield
PASS  el bundle real ejecuta el flujo en un PTY
```

La definición de finalización de todo Autonomy V2 es más amplia que este
arreglo de permisos y todavía requiere la matriz general de tareas, browser
verification, compaction/resume, subagentes y la suite TUI completa.

## Archivos de referencia

- [SHELRACODE-AUTONOMY-ARCHITECTURE-AUDIT.md](SHELRACODE-AUTONOMY-ARCHITECTURE-AUDIT.md)
- [docs/autonomy-v2/CURRENT-ARCHITECTURE.md](docs/autonomy-v2/CURRENT-ARCHITECTURE.md)
- [docs/AGENT-HARNESS.md](docs/AGENT-HARNESS.md)
- [docs/ui-v3/SETTINGS.md](docs/ui-v3/SETTINGS.md)

## Veredicto final

El bloqueo de permisos reportado quedó resuelto en el flujo interactivo real:
ShelraCode pregunta antes de leer, crear y editar cuando opera en `ASK`, y el
usuario conserva el control de cada acción.

La autonomía no se arregló con reglas para la web de la hora ni con un plan
monótono del host. El LLM mantiene la responsabilidad de proponer el plan
semántico; ShelraCode mantiene la responsabilidad de pedir autorización,
ejecutar una acción acotada, observar el resultado y devolver evidencia al
modelo.

La implementación es una corrección funcional verificada del permiso
interactivo, no una afirmación de que toda la arquitectura universal ya sea
equivalente a Claude Code ni de que un modelo pequeño tenga capacidades
frontier por sí solo.
