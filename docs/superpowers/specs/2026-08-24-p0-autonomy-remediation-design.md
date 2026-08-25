# LocalCode — Remediación P0+P1 de autonomía — Diseño

**Fecha:** 2026-08-24
**Origen:** `LOCALCODE — AUTONOMY & AGENT HARNESS AUDIT` (misma fecha, misma conversación). Puntuación ponderada de partida: 4.4/10.
**Objetivo de producto (declarado por el usuario):** que LocalCode sea capaz de tareas de programación complejas en local. Eso excede el techo de "solo P0" (~6/10, agente funcional para tareas pequeñas) — requiere P0+P1 (~7.5-8/10, "Complex Autonomous Engineer" en la escala de la auditoría).
**Alcance:** los tres P0 originales más cuatro componentes P1 seleccionados específicamente porque son los que más mueven la aguja hacia "tareas complejas", no todo el backlog P1. Ver "Fuera de alcance" para lo que queda explícitamente para después.
**Modelo de referencia para verificación en vivo:** Qwen2.5-1.5B-Instruct vía LM Studio (mismo modelo del reporte de bug original y de la auditoría).
**Proceso:** sin gates de revisión intermedios — se ejecuta directo, se reporta resultado (tests/typecheck en verde o rojo), no se pide aprobación paso a paso.

## Objetivo

Cerrar, con evidencia y tests:

**P0** (bloqueantes de confianza mínima):

1. **LF-AUT-001** — sin gate de finalización basado en evidencia; `verified` puede ser un `true` vacío.
2. **LF-AUT-002** — permisos aplicados por convención (no centralizados); `Shell`/`RunTests` no contenidos al workspace.
3. **LF-AUT-003** — lectura ad hoc de archivo sensible a mitad de tarea no se re-escanea antes de reenviarse a un proveedor cloud.

**P1** (necesarios para tareas complejas reales, seleccionados de la auditoría): 4. **LF-AUT-005** — sin compactación de contexto; `messages[]` crece sin límite, imposible sostener una tarea larga/multi-archivo. 5. **LF-AUT-007** — `probeAgentCapability` existe y está probado pero nadie lo invoca; cualquier modelo configurado se trata como apto para codificación autónoma sin evidencia. 6. **LF-AUT-009** — taxonomía tipada de error solo en 2 de 9 tools; el mismo patrón de fallo que causó el bug original sigue reproducible en `SearchText`/`WriteFile`/`EditFile`/`Shell`/`RunTests`/`GitStatus`/`GitDiff`. 7. **LF-AUT-013 (nuevo, no tenía ID en la auditoría)** — sin estado de plan estructurado; "planificación" es prosa opaca del modelo que el loop nunca lee ni verifica, lo que hace que tareas multi-paso no tengan forma de rastrear qué falta.

## Fuera de alcance (explícito, para después de esta pasada)

- Subagentes, worktrees, background tasks, MCP, hooks — subsistemas nuevos grandes; se abordan después de verificar que lo de abajo funciona con el modelo real.
- Sandbox real a nivel de SO (Job Objects/contenedor) — el Componente 2 sigue siendo heurística endurecida, no sandbox real.
- Tool `WebFetch`/`WebSearch` — pospuesto por decisión explícita anterior del usuario.
- Persistencia de sesión resumible (LF-AUT-008), observabilidad persistente (§9 de la auditoría) — quedan para una pasada posterior enfocada en madurez operativa, no en capacidad de tarea.
- Cambios de UI/TUI más allá del mínimo necesario para reflejar los estados nuevos (verificación/grounded, plan activo) — no hay rediseño visual.

## Contexto arquitectónico relevante

Archivos que este trabajo toca: `src/agent/loop.ts` (dispatcher central y punto de finalización), `src/agent/types.ts` (forma de `AgentRunResult`), `src/tools/permissions.ts` (clasificador de shell), `src/tools/workspace.ts` (definición de los 9 tools), `src/privacy/policy.ts` (`scanSecrets`/`isNeverRemotePath`, ya existentes y probados — se reutilizan, no se reescriben), `src/tui/app.tsx` (único consumidor de `AgentRunResult`, necesita interpretar los nuevos campos).

No se toca: `src/context/`, `src/router/`, `src/checkpoint/`, `src/providers/`, `src/runtimes/` — ninguno de los tres P0 requiere cambios ahí.

---

## Componente 1 — Gate de finalización basado en evidencia (LF-AUT-001)

**Problema:** `loop.ts:244` inicializa `let verified = true`; solo se recalcula si hubo mutación y hay `verificationCommand`. El `finalText` del modelo se devuelve como respuesta sin comprobar que descanse en algún `ToolResult` exitoso. La UI (`app.tsx:1057-1060`) muestra "Task completed and verified" incluso cuando nada corrió.

**Diseño:**

`AgentRunResult` gana dos campos nuevos, reemplazando la semántica ambigua del `verified: boolean` actual:

```ts
interface AgentRunResult {
  // ...campos existentes sin cambio...
  verification: { ran: boolean; passed: boolean } | null; // null = no aplicaba (sin mutación)
  grounded: boolean; // true si el turno requería evidencia y al menos un tool call tuvo éxito
}
```

`grounded` se calcula en el punto de retorno de `loop.ts` (líneas 574-582 hoy), de forma puramente determinista a partir de datos que **ya existen** en el loop — sin turno extra al modelo, sin componente nuevo, y **sin agregar ningún campo nuevo a `AgentTask`/`AgentLoopOptions`** (`turnMode` vive hoy en `app.tsx`/`turn-policy.ts`, no en `types.ts`; el loop no lo recibe, y no hace falta que lo reciba):

- Si `options.tools` está vacío (el caso `conversation`/`knowledge`, donde `resolveTurnPolicy` ya decide no ofrecer ningún tool): `grounded = true` trivialmente — no se esperaba evidencia porque no había nada que investigar.
- Si `options.tools` no está vacío (`workspace_read`/`coding`): `grounded = toolRuns.some(r => r.ok === true)`. Si es `false`, el resultado se marca como no fundamentado — la UI debe mostrar esto explícitamente (p. ej. "No pude reunir evidencia suficiente para responder con confianza" en vez de presentar el texto del modelo como respuesta autoritativa), no ocultarlo.

Esta señal (`options.tools.length > 0`) es un proxy exacto del `turnMode` real, porque es la misma condición que `turn-policy.ts` ya usa para decidir cuántos tools ofrecer — no es una aproximación con margen de error, es leer la misma decisión que ya se tomó río arriba, sin duplicarla.

**Nota importante de alcance:** este cálculo usa `toolRuns[].ok`, un booleano que el dispatcher ya asigna en el `catch` de _cualquier_ fallo de tool — tipado (`ToolError`) o no (`Error` plano). Por eso el gate **no depende** de que se complete la extensión de `ToolError` a los 7 tools restantes (fuera de alcance, P1); funciona igual de bien hoy con errores sin tipar. Sí se beneficiará de esa extensión más adelante (mejores mensajes de recuperación), pero no la requiere.

`verification` reemplaza el `verified: boolean` vacío: `null` cuando no hubo mutación (nada que verificar — antes se mostraba `true`, ahora se muestra explícitamente "sin cambios, no había nada que verificar"), `{ran:true, passed:bool}` cuando el controlador sí ejecutó `RunTests`.

`app.tsx` (único consumidor) debe distinguir tres presentaciones: completado y verificado (`verification.passed === true`), completado con verificación fallida (`verification.passed === false`), completado sin cambios (`verification === null`), y — nuevo — completado sin evidencia suficiente (`grounded === false`), que se muestra de forma visiblemente distinta a un "Done" normal.

**Testing:** nuevo caso en `tests/integration/agent-loop.test.ts` — turno `workspace_read` donde todas las tool calls fallan y el modelo igual produce texto → asertar `grounded === false`. Caso existente de "fix a failing test" actualizado para asertar `verification.ran === true`. Caso nuevo para turno sin mutación → asertar `verification === null` (no `true`).

---

## Componente 2 — Permisos centralizados + contención de Shell (LF-AUT-002)

**Problema:** `checkPermission()`/`requirePermission()` se invocan por convención dentro de cada uno de los 9 tools; el dispatcher de `loop.ts` nunca lo fuerza, así que un tool futuro que omita la llamada bypasea el sistema completo en silencio. `Shell`/`RunTests` fijan `cwd` pero no impiden que el _string_ de comando escape el workspace (`cd ..`, rutas absolutas). El entorno heredado es `process.env` completo sin filtrar.

**Diseño (tres cambios independientes, mismo componente):**

**(a) Gate central.** El dispatcher de `loop.ts`, justo antes de invocar `tool.execute()`, llama él mismo a `checkPermission()` usando `tool.risk` y el resultado de `classifyShellCommand()` cuando aplique — sin confiar en que el tool lo haga. Las llamadas existentes dentro de cada tool **se mantienen** (defensa en profundidad, no cuestan nada) pero dejan de ser la única garantía. Un test nuevo simula un tool que omite intencionalmente su propio `requirePermission()` y confirma que el gate central igual lo bloquea en modo `PLAN`.

**(b) Detección de escape de workspace en el comando.** Nueva función en `src/tools/permissions.ts`, `detectWorkspaceEscape(command, root)`, aplicada antes de ejecutar `Shell`/`RunTests`: detecta rutas absolutas fuera de `root`, secuencias `../` que superen la profundidad del workspace, y (Windows) rutas UNC/con letra de unidad distinta. Si detecta escape, el comando requiere aprobación explícita igual que un comando `destructive` — no se bloquea duro, porque hay usos legítimos (leer una dependencia global), pero deja de pasar desapercibido. **Límite documentado sin ambigüedad:** esto es una heurística de string, no una garantía — un comando suficientemente ofuscado puede evadirla. No se vende como sandbox.

**(c) Entorno mínimo para procesos hijos.** `ctx.env` deja de ser `process.env` completo. Se construye una allowlist (`PATH`, `HOME`/`USERPROFILE`, `TEMP`/`TMP`, y las 2-3 variables que el propio LocalCode necesite para que `bun`/`git`/`rg` funcionen) más un filtro que excluye cualquier variable cuyo nombre matchee los mismos patrones que `scanSecrets` ya usa (reuso directo de `src/privacy/policy.ts`, sin duplicar lógica de detección).

**Testing:** unit tests para `detectWorkspaceEscape` (positivos y negativos, incluyendo casos límite tipo `./../sibling-dir` que no debería dispararlo si `sibling-dir` está dentro del root real tras resolver). Test de que el gate central bloquea un tool "hostil" simulado. Test de que una variable tipo `AWS_SECRET_ACCESS_KEY` en `process.env` del proceso padre no aparece en el `env` que recibe un `Shell` hijo.

---

## Componente 3 — Re-escaneo de secretos en lecturas ad hoc bajo ruta cloud (LF-AUT-003)

**Problema:** `buildRepositoryContext()` redacta secretos correctamente en el prefetch inicial, pero un `ReadFile`/`SearchText` que el modelo invoca por su cuenta a mitad de tarea no pasa por ningún escáner — su resultado entra crudo a `messages[]` y se reenvía al proveedor en el siguiente turno, sin importar si la ruta activa es cloud.

**Diseño:** en `loop.ts`, justo antes de serializar el resultado de `ReadFile`/`SearchText` hacia `messages[]` (líneas ~517-521 hoy), si `route.candidate.privacy.classification !== "local"`, correr `scanSecrets`/`isNeverRemotePath` (ya existentes, ya probados) sobre el contenido devuelto. Coincidencia de alta confianza → el contenido se reemplaza por un marcador (`[REDACTED: contenido sensible omitido — ruta activa no es local]`) antes de entrar a `messages[]`, en vez de bloquear la lectura entera (evita romper flujos legítimos donde el usuario solo quiere confirmar que un archivo existe). Con ruta `local`, el contenido **no se toca** — preserva el invariante "local remains a first-class execution path" (`AGENTS.md`, invariante #3).

**Testing:** test de integración que reproduce exactamente el escenario de la auditoría — `ReadFile(".env")` a mitad de tarea con una ruta cloud seleccionada — y asegura que el contenido en `messages[]` está redactado, no crudo. Test negativo simétrico con ruta local confirmando que no hay redacción.

---

## Estrategia de testing y gate de release

Cada componente: tests unitarios + al menos un test de integración que reproduzca el escenario real descrito en la auditoría (no solo la unidad aislada). Gate de release igual al que ya usa el repo (`AGENTS.md`, "Testing gate"): `bun run format:check`, `bun run typecheck`, `bun test`, y — para este trabajo específico, dado que hay modelo real disponible — una pasada de verificación en vivo contra LM Studio + Qwen2.5-1.5B-Instruct por componente, no bloqueante para considerar el código correcto pero sí recomendada antes de dar el P0 por cerrado en el sentido en que lo definió la auditoría.

## Puntuación esperada (estimación de dirección, no una medición)

Recalculando el baremo ponderado de la auditoría solo en las dimensiones que este trabajo toca (Verification/completion 12%, Safety/Git/permissions 8%): si ambas suben de ~4/10 y ~3/10 a ~7/10 cada una, el total ponderado pasa de 4.4 a aproximadamente **5.5-6/10** — umbral bajo de "Functional Coding Agent". No hay forma honesta de prometer un número exacto sin una nueva auditoría con la misma metodología.
