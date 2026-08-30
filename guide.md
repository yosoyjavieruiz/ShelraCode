# ShelraCode: guía de continuidad

Documento de handoff para otra IA que deba entender qué es ShelraCode, qué ya
existe, qué se está trabajando y hacia dónde va el proyecto.

Última actualización: 2026-08-29

## 1. Qué es ShelraCode

ShelraCode es un runtime local-first de ingeniería de software. Su tesis es:

> La autoridad del agente debe seguir el comportamiento medido del modelo
> exacto, su artefacto, cuantización, runtime, template y configuración.

Primero se mide qué interfaz puede operar de forma fiable un modelo local
concreto; después se expone solamente ese nivel de autoridad. Un modelo de
1.5B útil para subtareas pequeñas y verificables es un resultado válido, pero
no se debe prometer paridad bruta con modelos frontier.

El producto es privado y local-first. `strict-zero` nunca debe ejecutar una
ruta de inferencia pagada o no verificada, y ningún secreto puede enviarse a
un proveedor remoto.

## 2. Repositorio y stack

```text
Repositorio: D:\PROYECTS\shelra
Stack: Bun 1.3+, TypeScript ESM estricto, SolidJS/OpenTUI, bun:sqlite
CLI: src/index.ts
TUI: src/tui/
Loop: src/agent/loop.ts
Tools: src/tools/workspace.ts
Providers: src/providers/
Router: src/router/
Persistencia: src/storage/
Evaluaciones: src/evals/ y tests/evals/
```

Leer antes de una modificación arquitectónica:

```text
AGENTS.md
docs/PRODUCT.md
docs/ARCHITECTURE.md
docs/ROUTING.md
docs/PRIVACY.md
docs/DECISIONS.md
docs/STATUS.md
```

## 3. Reglas de trabajo

- Auditar la ruta activa y el artefacto que usa el usuario antes de editar.
- Preservar el worktree sucio y los cambios ajenos.
- No usar `git reset --hard`, `git checkout --`, staging masivo ni commits no
  solicitados.
- No inventar archivos, comandos, runtimes, capacidades o resultados.
- El modelo solicita acciones; el host decide si son legales.
- El controlador posee el estado, obligaciones, evidencia y completion gate;
  una declaración `DONE` del modelo nunca es prueba.
- Las mutaciones necesitan permiso, checkpoint, stale-edit protection y
  verificación ejecutable.
- Skills, retrieval y subagentes son capacidades opcionales: sólo se
  autoactivan después de una evaluación paired OFF/ON que demuestre beneficio.
- Un gate fallido se arregla, se acota o se marca `BLOCKED`; no se salta.

## 4. Hacia dónde va la arquitectura

```text
objetivo
  -> estado autoritativo
  -> Context Capsule mínima
  -> Driver calibrado del modelo exacto
  -> una decisión semántica acotada
  -> LegalAction validada por host
  -> ExecutionBroker
  -> herramienta/proceso/workspace
  -> observación tipada + evidencia
  -> verificar, recuperar, bloquear o completar con prueba
```

El Core debe permanecer pequeño. Repository intelligence, Skills, expertos,
subagentes, retrieval, runtime administrado y entrenamiento se añaden sólo si
una evaluación demuestra mejora sin empeorar falsos éxitos, seguridad, loops,
latencia o intervención.

## 5. Estado de fases

| Fase  | Estado                        | Nota                                                                                                                                                                                                         |
| ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0-10  | Completadas en trabajo previo | Baseline, Lab, perfiles, calibración, Core, contexto, repository intelligence, evidencia, recovery y DCS están en el worktree; revalidar antes de confiar en cualquier cifra histórica.                      |
| 11    | PASS                          | Estado durable, checkpoints, recuperación y `resume` real implementados y revisados independientemente.                                                                                                      |
| 12    | En progreso / reauditoría pendiente | ExecutionBroker, paths/symlinks, strict-zero host-side, redacción y downgrade de autoridad no certificada. Los bypasses reproducibles de la auditoría inicial fueron corregidos; falta que la revisión independiente confirme el gate y sigue pendiente el aislamiento físico del SO. |
| 13-16 | Pendientes                    | Subagentes, runtime administrado, trayectorias/entrenamiento y certificación. No comenzar antes de Phase 12 PASS.                                                                                            |

La autonomía real de un modelo local no está demostrada en esta continuación.
No afirmar C2/C3/C4 ni “autonomía” sin una corrida E2E del artefacto/runtime
exactos.

## 6. Fase 11 ya implementada

No reescribir sin evidencia:

- `src/agent/recovery.ts`: snapshots del detector anti-loop.
- `src/agent/task-runtime-state.ts`: referencias exactas al Driver, digest de
  configuración, checkpoint, recovery history y acceptance evidence.
- `src/agent/task-ledger-codec.ts`: validación bounded al persistir/restaurar.
- `src/agent/loop.ts`: marcador durable in-flight, no replay automático de una
  mutación interrumpida y continuidad de checkpoint.
- `src/storage/database.ts` y `src/checkpoint/checkpoint.ts`: existencia y
  ownership de checkpoints.
- `src/tui/app.tsx`: comprobaciones de resume y referencias exactas.
- `docs/architecture/persistence.md` y `docs/phases/phase-11-report.md`.
- Tests de recovery, codec, resume, checkpoint y replay-window.

La revisión independiente reportó `122 pass / 0 fail / 509 expectations`,
typecheck PASS y Prettier focalizado PASS. Un baseline completo anterior fue
`869 pass, 24 fail, 1 skip`; separar esos fallos previos de regresiones nuevas.

## 7. Fase 12 actual: ExecutionBroker

### Implementación

`src/security/execution-broker.ts` contiene `ExecutionBroker`, una frontera
host-side para operaciones solicitadas por el modelo:

- `resolvePath()` aplica containment del workspace y checks de symlink/junction.
- cwd y argumentos de ruta obvios se validan antes de spawn.
- Shell se valida usando el texto original antes del transporte base64.
- `strict-zero` se traduce a deny en la política de procesos antes de lanzar.
- Cuando no hay aislamiento OS, la ruta model-facing usa una allowlist local
  fail-closed y rechaza ejecutables/scripts opacos.
- stdout, stderr y chunks de `onOutput` se redaccionan antes de salir del host.
- `writeFile()` y `deleteFile()` exigen checkpoint y stale-edit check.
- Los reemplazos escriben un temporal en el padre canonicalizado y hacen
  `rename`; las creaciones usan `wx` y los deletes no siguen el target de un
  symlink.
- Un contexto marcado como `model` sólo recibe escritura con un
  `ModelDriverProfile` certificado/vigente; sin él, el broker queda en
  `writeAuthority: none`.
- `redactText()` cubre secretos de alta confianza y paths protegidos.

`src/tools/types.ts` admite `executionBroker`, `networkMode`, autoridad de
modelo y `driverProfile` en `ToolExecutionContext`. `src/tools/workspace.ts`
crea strict-zero por defecto cuando `network` es falso o está ausente, rechaza
un broker con root distinto, política más permisiva o autoridad no certificada,
y enruta por él:

```text
ReadFile, WriteFile, CreateFile, EditFile, DeleteFile
ListFiles, GlobFiles, SearchText, Shell, GitStatus, GitDiff, RunTests
```

`ReadFile` mantiene raw sólo dentro del host. `.env`, credentials, private
keys, tokens y contenido secret-shaped se devuelven redacted. Search, Git,
Shell y RunTests también redaccionan observaciones.

`src/tui/app.tsx` crea un broker por tarea. Los subagentes reciben un broker
nuevo en su worktree en `src/agent/subagents/coordinator.ts`.

## 8. Documentación y tests actuales

Documentación de seguridad:

```text
docs/security/execution-boundaries.md
docs/security/strict-zero-network.md
docs/security/secret-handling.md
docs/security/threat-model.md
```

Tests nuevos: `tests/unit/execution-broker.test.ts` y regresiones de permisos,
con containment de path/cwd, junctions protegidos, symlink, bloqueo de red
pre-spawn, runtime scripts opacos, allowlist fail-closed, redacción
stdout/live output, checkpoint/stale protection, autoridad de Driver, paths
protegidos, wiring de tools y errores tipados.

## 9. Evidencia fresca

```text
bun run typecheck
PASS

bun --conditions=browser test tests/unit/execution-broker.test.ts tests/unit/permissions.test.ts tests/unit/process.test.ts tests/unit/run-tests-tool.test.ts tests/integration/checkpoint.test.ts
62 pass, 0 fail, 159 expectations
```

`bun run typecheck` y Prettier focalizado están en PASS. La suite completa,
ejecutada con captura explícita después del wiring, dio `912 pass, 1 skip,
0 fail, 3205 expectations` y exit code `0`. También se aisló el fixture de
code-review que dependía del checkout sucio y se registró su archivo mutado
explícitamente. `git diff --check` todavía informa sólo trailing whitespace en
los goldens de UI ya modificados del worktree; no se eliminó porque son
fixtures de ancho fijo y pertenecen al trabajo existente.

## 10. Límite que no se debe ocultar

`src/shared/process-isolation.ts` informa actualmente:

```text
applicationPolicy: enforced
osEnforced: false
mechanism: none
```

No existe todavía un restricted token/Job Object de Windows ni un namespace de
red multiplataforma. Por tanto no afirmar aislamiento físico del sistema
operativo. El broker impone deny host-side para comandos reconocidos y una
allowlist fail-closed para procesos opacos en la ruta model-facing, pero la
garantía física de red/FS sigue sin estar demostrada. Un futuro adapter OS
necesita su propia suite y seguirá pasando por el broker.

## 11. Próximo orden de trabajo

1. Revisar `git diff`, `git status` y esta guía; no borrar cambios ajenos.
2. Repetir la auditoría adversarial de la Fase 12 después de estas
   correcciones, con especial atención al aislamiento OS físico.
3. Ejecutar focused tests, typecheck, Prettier y suite completa; categorizar
   cualquier regresión.
4. Hacer revisión independiente read-only del diff, tests y docs.
5. Crear `docs/phases/phase-12-report.md` sólo después del gate. Incluir
   repository evidence, cambios, comandos/resultados, real-model evidence,
   métricas, riesgos, `PASS|FAIL|BLOCKED` y elegibilidad siguiente.
6. No iniciar Phase 13 hasta que Phase 12 sea PASS independiente.

## 12. Gate de Phase 12

Debe probarse por la ruta real de tools que:

- workspace y symlink escapes sean denegados;
- comandos network-capable sean denegados antes de spawn en strict-zero;
- secretos no lleguen a tool result, live output, evidencia, logs o evals;
- stale edits y checkpoints ausentes/ajenos sean denegados;
- un broker inyectado no amplíe root ni red;
- una acción no autorizada falle aunque el modelo coopere;
- ninguna suite existente se debilite.

Un workspace escape, write/network no autorizado, secret disclosure, bypass de
política, stale authority o leakage de datos protegidos es hard FAIL.

## 13. Comandos de continuidad

```powershell
Set-Location D:\PROYECTS\shelra
bun run typecheck
bun --conditions=browser test tests/unit/execution-broker.test.ts tests/unit/permissions.test.ts tests/unit/process.test.ts tests/unit/run-tests-tool.test.ts
bun x prettier --check src/security/execution-broker.ts src/tools/types.ts src/tools/workspace.ts src/tui/app.tsx src/agent/subagents/coordinator.ts tests/unit/execution-broker.test.ts docs/security guide.md
bun --conditions=browser test
git diff --check
git status --short
```

Si no hay modelo/runtime local disponible, registrar `UNPROVEN` o `BLOCKED`,
nunca fabricar resultados. Mantener separada la evidencia de providers
falsos, pruebas deterministas y modelos locales reales.
