# SHELRACODE — AUDITORÍA FORENSE COMPLETA DE AUTONOMÍA, AGENTES, MEMORIA Y ARQUITECTURA

**Fecha:** 2026-08-26  
**Repositorio:** D:\PROYECTS\shelra  
**Commit de referencia:** 14f79ecf86097a8df60e52497986ebdf84e436d5  
**Rama:** main  
**Modo:** auditoría de solo lectura.

## Convenciones

- **VERIFIED_RUNTIME:** observado ejecutando el checkout o el artefacto actual.
- **VERIFIED_SOURCE:** trazado en el código actual.
- **VERIFIED_TEST:** demostrado por pruebas actuales.
- **VERIFIED_EXTERNAL:** documentado por una fuente pública oficial actual.
- **HISTORICAL:** evidencia anterior.
- **INFERENCE:** conclusión razonada.
- **UNPROVEN:** evidencia insuficiente.

Estados: **PROVEN**, **PRESENT_BUT_PARTIAL**, **PRESENT_BUT_UNPROVEN**, **CONFIG_ONLY**, **UI_ONLY**, **LEGACY**, **DEAD**, **MISSING**.

---

## 1. Veredicto ejecutivo

ShelraCode es hoy un **FUNCTIONAL CODING AGENT** acotado, no un agente autónomo complejo de nivel Claude Code/Codex. Hay un loop real de varios turnos, tools de filesystem/shell, permisos, checkpoints de archivos, ledger tipado, plan validado por el host, recuperación bounded y verificación parcial. La evidencia principal procede de fake providers, fixtures y tests de integración.

El producto real está menos demostrado: dist\shelra.exe arranca y el TUI muestra la ruta local, pero la sonda real contra Qwen3 14B Claude 4.5 Opus Distill clasificó el modelo como chat_only porque no seleccionó ReadFile ni EditFile. No se obtuvo una tarea real multiarchivo con modelo local, verificación y finalización.

Resultado: autonomía ponderada **41.5 / 100**, madurez **4.2 / 10**, clasificación **FUNCTIONAL CODING AGENT**. La confianza sin supervisión sobre un repositorio importante es **NO**; completar de forma confiable un objetivo complejo, nuevo y multiarchivo desde un prompt es **NO**.

---

## 2. Línea base exacta

~~~text
git rev-parse --show-toplevel
D:/PROYECTS/shelra

git rev-parse HEAD
14f79ecf86097a8df60e52497986ebdf84e436d5

git branch --show-current
main
~~~

El worktree ya estaba sucio antes de la auditoría: 40 rutas rastreadas modificadas, además de archivos nuevos bajo docs, src, tests y el reporte histórico SHELRACODE-AUTONOMY-ARCHITECTURE-AUDIT.md. git diff --stat inicial: 40 files changed, 3913 insertions(+), 252 deletions(-). git diff --check no mostró errores de whitespace; solo advertencias LF/CRLF. No se hizo rollback, staging, commit ni push.

OS: Windows 11 Home 10.0.26200, 64-bit. PowerShell 5.1.26100.9168. Bun 1.3.14. Node v20.18.2. npm 10.8.2. Git 2.53.0.windows.1. Python 3.12.10. LM Studio lms.exe commit 07b7252 está disponible; Ollama y llama.cpp no fueron encontrados. El catálogo reportó nueve modelos locales. El modelo observado fue qwen3-14b-claude-4.5-opus-high-reasoning-distill, Q3_K_S.

Variables de credencial solo fueron enumeradas por nombre; nunca se imprimieron valores.

Artefactos locales: dist/index.js 2,712,287 bytes, dist/shelra.exe 111,313,920 bytes y dist/shelra-probe.exe 111,248,896 bytes. dist está ignorado por Git. EXE version/help/config terminaron en código 0. Esto prueba startup smoke, no provenance con HEAD ni aceptación del agent loop.

---

### 2.5 Resultado de integridad al cierre

Se repitieron git status --short y git diff --check después de crear el presente informe. Las rutas del baseline permanecen, pero aparecieron diferencias de estado adicionales que no estaban en el baseline registrado: CHANGELOG.md, README.md, bun.lock, docs/ACCEPTANCE.md, docs/STATUS.md, docs/WEEK-ONE.md, package.json, scripts/build.ts, scripts/smoke.ts, src/agent/turn-policy.ts, src/cli/args.ts, src/index.ts, tests/unit/task-analysis.test.ts, tests/unit/turn-policy.test.ts, tsconfig.json, SHELRACODE-AUTONOMY-V2-FINAL.md, src/cli/installation.ts, src/version.ts y tests/unit/installation.test.ts. Además, index.html pasó de M en el baseline a D al cierre. Sus timestamps/contenidos son compatibles con cambios concurrentes o preexistentes que aparecieron durante la ventana de auditoría; no se atribuyen al reporte y no se tocaron.

El único archivo creado deliberadamente por esta auditoría es SHELRACODE-FULL-AUTONOMY-AUDIT-2026.md. Debido a esa divergencia, no es correcto afirmar que el worktree final contiene solo el reporte nuevo. Se preservaron todos los cambios y no se ejecutó ninguna reversión. git diff --check volvió a producir únicamente advertencias LF/CRLF y ningún error de whitespace.

## 3. Metodología

Se usó la jerarquía runtime actual > source actual > tests actuales > documentación actual > auditoría anterior > inferencia. Se leyeron los seis documentos base, WEEK-ONE, agent-kernel/STATUS, toda la auditoría histórica y el código activo desde src/index.ts y src/tui/launch.ts.

Las pruebas mutantes usaron fixtures/estado temporal. No se modificó producción, no se ejecutó inferencia pagada y no se expusieron secretos. Se usaron los comandos:

~~~text
bun run typecheck
  PASS — tsc --noEmit

bun run format:check
  FAIL — 28 archivos con diferencias; no se modificaron

focused agent/planner/recovery tests
  99 pass, 0 fail, 410 expect()

focused context/compiler/privacy/capability tests
  26 pass, 0 fail, 104 expect()

bun --conditions=browser test
  589 pass, 1 skip, 0 fail, 1905 expect(), 590 archivos
~~~

La suite usa fake providers y fixtures; no demuestra una tarea autónoma real con modelo local. La sonda real atravesó LM Studio pero quedó en protocol-only al fallar la selección de tools.

---

## 4. Mapa de arquitectura actual

| Subsistema | Paths/símbolos | Estado |
|---|---|---|
| CLI | src/index.ts, src/cli/control-plane.ts | PROVEN |
| TUI | src/tui/launch.ts, src/tui/app.tsx | PRESENT_BUT_PARTIAL |
| Task analysis | src/router/task-analysis.ts | PRESENT_BUT_PARTIAL |
| Task contract | src/agent/task-contract.ts | PRESENT_BUT_PARTIAL |
| Agent loop | src/agent/loop.ts, runAgent | PROVEN en tests; PARTIAL runtime |
| Task state | src/agent/task-state.ts | PROVEN |
| Planner | src/agent/planner.ts | PROVEN como validator |
| Task graph | src/agent/task-graph.ts | PRESENT_BUT_PARTIAL |
| Scheduler | no hay servicio/worker | MISSING |
| Repository discovery | src/context/repository.ts, repository-snapshot.ts | PROVEN acotado |
| Repository intelligence | src/context/repository.ts | PRESENT_BUT_PARTIAL |
| Context compiler | src/context/context-compiler.ts | PROVEN acotado |
| Compaction | src/agent/compaction.ts | PROVEN determinista |
| Memory | src/shared/memory.ts | PRESENT_BUT_PARTIAL |
| Skills | .agents/skills, skills-lock.json | CONFIG_ONLY/MISSING runtime |
| Agents | .codex/agents/*.toml | CONFIG_ONLY |
| Routing | src/router/router.ts, route-fallback.ts | PROVEN contractual |
| Providers | src/providers/* | PROVEN adapter |
| Local runtimes | src/runtimes/* | PRESENT_BUT_PARTIAL |
| Tools | src/tools/workspace.ts | PROVEN |
| Code intelligence | no AST/LSP/definition/reference runtime | MISSING |
| Verification | verifier.ts/objective-review.ts | PRESENT_BUT_PARTIAL |
| Completion | completion-gate.ts/loop.ts | PRESENT_BUT_PARTIAL |
| Checkpoints | src/checkpoint/checkpoint.ts | PROVEN files-only |
| Permissions/sandbox | permissions.ts/process.ts | PARTIAL/MISSING OS |
| Sessions/resume | database.ts/tui/app.tsx | PRESENT_BUT_PARTIAL |
| Observability | trace.ts/logging.ts | PRESENT_BUT_PARTIAL |
| Release | dist/package scripts | PRESENT_BUT_PARTIAL |

Mapa:

~~~text
CLI/TUI
  -> control-plane + SQLite + discovery
  -> turn policy / task analysis
  -> router admission + scoring + fallback
  -> repository context + TaskContract
  -> optional model plan validado
  -> provider adapter / stream normalizer
  -> tool parser + path/permission/context gates
  -> workspace/shell/tests + checkpoint
  -> observation + ledger + events + recovery
  -> next model turn o verification
  -> completion gate / blocked / failed / cancelled
~~~

## 5. Runtime call graph

| Flecha | Archivo/símbolo | Estado | Autoridad | Fallo |
|---|---|---|---|---|
| USER INPUT → CLI/TUI | src/index.ts; tui/app.tsx runTask | texto/sesión/root/settings | UI/CLI | args, cancelación, TUI exit |
| UI → analysis | router/task-analysis.ts analyzeTask; turn-policy.ts | TaskAnalysis/TurnMode | heurística host | clasificación incorrecta |
| analysis → routing | router.ts route; RouteRequest | class/complexity/privacy/quota/candidates | router | rejection tipado/fallback |
| routing → context | repository.ts/repository-snapshot.ts | root/objective/paths/instructions/snippets | host | evidence insuficiente |
| context → contract | task-contract.ts compileTaskContract | objective/paths/mode/verification/constraints | host compiler | scope incierto puede no bloquear |
| contract → plan | planner.ts/task-graph.ts | PlanProposal/nodes/deps/tools | modelo propone, host valida | cycles/path/tool mismatch |
| plan → model | loop.ts initial messages/planPrompt | system/context/objective/plan | host construye; modelo genera | protocol/timeout/model error |
| model stream → normalized | providers/openai-compatible.ts; stream-normalizer.ts | deltas/tool fragments | adapter | provider/protocol failure |
| normalized → tool decision | loop.ts/tool-envelope.ts | calls/args/node scope | modelo selecciona; host valida | malformed/unknown/batch >8 |
| decision → permission | permissions.ts/context-gate.ts | risk/path/policy/evidence | host | denied/approval/outside/insufficient |
| permission → execution | tools/workspace.ts; shared/process.ts | context/path/command/signal/env/checkpoint | tool host | file/command/timeout/conflict |
| execution → observation | loop.ts observeTool/task-state/trace | result/evidence/actions/files | loop/ledger | failure/recovery |
| observation → next turn | loop.ts outer loop | messages/recovery/current node | bounded loop | retry/replan/watchdog/blocked |
| observation → verification | loop.ts/verifier/objective-review | ledger/criteria/runs/diff | host verifier/callback | criteria missing/failure |
| verification → completion | completion-gate.ts/loop.ts finish | final/evidence/gates/blockers | host gate | complete/blocked/failed |
| completion → persistence/UI | database.ts/events/logger | result/messages/ledger/phase | storage/UI | DB existe, resume parcial |

El punto principal de autoridad es src/agent/loop.ts: decide continuar, recuperar, verificar y terminar. El modelo decide buena parte de la semántica del plan; el router decide admisión; el TUI prepara callbacks pero también orquesta lifecycle.

---

## 6. Comprensión de tareas

TaskAnalysis en shared/types.ts y router/task-analysis.ts contiene class, complexity, contextNeed, toolNeed, risk, opportunityCost y requiredCapability. TaskContract en agent/task-contract.ts agrega originalRequest, objective, executionProfile, deliverables, constraints, nonGoals, acceptanceCriteria, evidenceRequirements, risk, repositoryScope, permissions, uncertainty, verificationIntent y status.

Esto mejora materialmente la auditoría anterior. compileTaskContract deriva, sin embargo, muchas piezas desde paths, comandos, términos y defaults. En coding crea con frecuencia un criterio general, review/verification y evidencia; no crea una especificación semántica completa de cada deliverable. nonGoals puede quedar vacío y scope uncertainty es nonblocking.

| Elemento | Resultado |
|---|---|
| intención/clase | estructurada pero lexical |
| objetivo original | estructurado en contract/ledger |
| deliverables | estructurados, a menudo genéricos |
| constraints | parcial; algunas viven en prompt/settings |
| non-goals | campo presente, extracción robusta no demostrada |
| acceptance/success | typed, semántica general débil |
| evidencia requerida | typed/strings, no siempre comprobable |
| risk/permissions/scope | estructurados parcialmente |
| plan semántico | model-owned; host valida forma |
| recovery | contrato typed; causa depende del loop |

La separación de modes evita que toda tarea exponga las mismas tools, pero no demuestra generalización a frameworks, dependencias, APIs o criterios implícitos.

| Tipo | Evidencia |
|---|---|
| conversation/knowledge | no tools; tests |
| repository question | discovery/context lexical; real-model UNPROVEN |
| plan-only/review | read-only tools + planner; tests |
| one-file | fake-provider/checkpoint tests; real model UNPROVEN |
| multi-file/debug/refactor | profiles/graph existen; end-to-end UNPROVEN |
| greenfield/config/test generation | branches/tools; heterogenous real UNPROVEN |

Scores: intent understanding **4/10**; task compilation **5/10**; generalization **3/10**.  
Estado: PRESENT_BUT_PARTIAL. Evidencia: VERIFIED_SOURCE/VERIFIED_TEST.

---

## 7. Agent loop

src/agent/loop.ts contiene runAgent y 5035 líneas. Implementa maxTurns, prompts iniciales, modelo plan opcional, tools, observations, ledger, recovery, compaction, verification, final review y terminal phases.

| Pregunta | Resultado |
|---|---|
| múltiples turnos | sí, VERIFIED_SOURCE/TEST |
| decenas de acciones | posible con caps; tarea real larga UNPROVEN |
| observation informa próximo turno | sí, messages/ledger/recovery |
| tools secuenciales | sí |
| tools concurrentes | no como flujo general |
| batches bounded | sí, máximo 8 |
| retries bounded | sí, protocol 2, planner/recovery/watchdogs |
| cambia estrategia | parcial: repair/replan/decompose/switch/ask/stop |
| vuelve a explorar | si recovery lo pide; no universal |
| verification crea trabajo | sí, puede agregar recovery |
| detecta repetición | duplicate/non-progress parcial |
| sabe parar | host bounds; no implica objetivo semántico satisfecho |

La suite focalizada agent/planner/recovery pasó 99 casos; la suite total 589/1/0. Esa evidencia prueba el harness con fake providers. La ruta real del modelo Qwen3 14B no alcanzó tools básicas.

Estado: PROVEN como mecanismo de harness; PRESENT_BUT_PARTIAL como producto real.  
**Agent loop: 6/10.**

---

## 8. Planning, scheduler y task graph

planner.ts define PlanProposal versionado con proposalId, nodes, dependencies, acceptanceCriteria, evidenceRequirements, constraints y supersedes. validatePlanProposal limita 32 nodos y verifica IDs, ciclos, paths, tools y read/write coherence. appendPlanProposal conserva revisiones y supersede. Es autoridad estructural real.

El orden semántico lo propone planPrompt/modelo. El host valida seguridad y forma, pero no descubre por sí solo todos los subobjetivos.

task-graph.ts compila discover → analyze → mutate por path → verify → review, o answer. Mantiene pending/blocked/ready/running/verifying/passed/failed/superseded. El graph afecta el tool scope y puede avanzar por evidencia.

No existe scheduler independiente con ready queue, workers, ownership, parallelism, cancelación o merge. El loop consulta currentModelNode y cambia estados directamente.

| Capacidad | Estado |
|---|---|
| dependencias/current node/transiciones | PROVEN en el loop |
| retries/repair/replan | PRESENT_BUT_PARTIAL |
| failure propagation | PRESENT_BUT_PARTIAL |
| scheduler productivo independiente | MISSING |
| owners/workers/paralelo | MISSING |
| durable graph synchronization | PRESENT_BUT_PARTIAL |

Scores: planning **5/10**; task graph **4/10**; scheduler **2/10**; planning/scheduler agregado **4/10**.

---

## 9. Agents, subagents y multi-agent

| Concepto | Realidad |
|---|---|
| Agent/runAgent | loop productivo single-agent |
| Plan/Build/Verify/Review | fases/nodos del mismo loop |
| Explore | discovery/mode, no child agent demostrado |
| code-review-agent.ts | reviewer host read-only, no child model/context |
| .codex/agents/*.toml | configuración Codex, no runtime Shelra |
| TaskGraph nodes | ownership lógico, no workers |

No se observó el ciclo parent delegates → child bounded objective/context → child independent model/tools → structured result/evidence → parent incorporation → global continuation.

No hay API productiva para child context, SendMessage, lifecycle, parallel agents, per-agent permissions, worktrees, merge/reconciliation o child resume. docs/PRODUCT.md:37 excluye multi-agent runtime de V0.1.

| Capacidad | Estado |
|---|---|
| single-agent loop | PROVEN/PARTIAL |
| fresh isolated subagent context | MISSING |
| separate child model invocation | MISSING |
| child tools/permissions | MISSING |
| parallel agents | MISSING |
| message passing/ownership | MISSING |
| worktree isolation/merge | MISSING |
| child cancellation/resume | MISSING |
| agent config files | CONFIG_ONLY |

Scores: single-agent autonomy **5/10**; subagent maturity **0/10**; multi-agent maturity **0/10**.

---

## 10. Repository intelligence

context/repository.ts intenta Git files, rg y recorrido Node; ignora .git, node_modules, .localcode, dist, .next y .agents; recoge paths explícitos, priority files y hasta 10 términos; busca fixed strings con hasta 32 matches; clips archivos/instrucciones; redacts secrets; ordena por path/prioridad/lexical match.

Esto es discovery y SearchText, no comprensión semántica. No hay runtime productivo de FindDefinition, FindReferences, FindImplementations, AST, LSP, types, import/reference/dependency graph, related tests o symbol index persistente. Tree-sitter aparece en material de OpenTUI, no como inteligencia de código de ShelraCode.

| Dimensión | Estado |
|---|---|
| inventario Git/manifest/languages | PROVEN |
| paths explícitos | PROVEN |
| búsqueda textual | PROVEN |
| relevance de archivos | PRESENT_BUT_PARTIAL |
| AST/LSP/symbols | MISSING |
| imports/dependencies/references | MISSING |
| related tests | PRESENT_BUT_UNPROVEN |

Repository discovery **5/10**. Repository intelligence **3/10**.

---

## 11. Arquitectura de contexto

context-compiler.ts define ContextPacket con objective, subtask, constraints, instructions, evidence, code, recentObservations, unresolvedProblem, legalActions, expectedOutput y tokenBudget.

| Campo | Cap |
|---|---:|
| objective | 2,000 chars |
| item | 800 chars |
| evidence | 3,000 chars |
| code slice | 8,000 chars |
| render | tokenBudget aproximado a 4 chars/token |
| loop context | default 50,000 chars |
| model tool text | 8,000 chars |
| execution text | 4,000 chars |
| ReadFile | default 160 lines / 20,000 chars |
| SearchText | 200 matches / fallback 1 MB |
| Glob/List | 500/1000 entradas |
| RunTests | 50,000 chars |

En loop.ts:1453-1500, el request inicial es system prompt mínimo + contexto compilado/objective y plan instructions si aplica. Después se acumulan messages y observations. No se recompila un packet completo antes de cada tool decision. Memory se selecciona desde TUI antes de runTask; compaction no reinyecta explícitamente root instructions, memory, plan y recent files como canales separados.

context-gate.ts puede impedir mutation cuando falta/conflictúa evidencia, excepto greenfield vacío. evidence-sufficiency.ts acepta evidencia relevante/fresca mínima; no prueba símbolo, dependencia o criterio correcto.

| Superficie | Estado |
|---|---|
| system/task/instructions | PARTIAL |
| AGENTS scoped | PARTIAL |
| Skills | MISSING runtime |
| memory | initial only, reinjection no garantizada |
| conversation | acumulada/compactada |
| tool definitions | staged scope, coding puede exponer 12 |
| repository map | snapshot lexical |
| snippets/test/verification | acotados |
| route state | initial/ledger; resume parcial |

Scores: precision **4/10**; sufficiency **5/10**; efficiency **5/10**; compaction **5/10**; context engineering **4/10**.

---

## 12. Compaction

agent/compaction.ts implementa compaction determinista, no llamada LLM. stateSummary conserva, hasta 16K/fallbacks:

~~~text
objective, phase, contract, execution profile,
plan, graph, plan revisions, recovery contracts,
verification plan, files changed, verification runs,
actions, blockers, next action
~~~

compactTaskContext conserva system, state message, original anchor y mensajes recientes con clips de tool/assistant/user. El loop activa al superar contextBudgetChars.

| Tras compaction en el mismo proceso | Estado |
|---|---|
| objective/phase | conservados |
| contract/plan/graph/revisions | conservados si estaban en ledger |
| files changed/errors/tests/blockers | conservados de forma acotada |
| project instructions | reinjection explícita no garantizada |
| memory | reinjection explícita no garantizada |
| route/model | no hay rehidratación completa |
| restart | no probado; resume no restaura ledger |

Las pruebas unitarias fuerzan summary y prueban preservación estructurada. No se ejecutó un long-horizon real con modelo admitido para forzar compaction de producción; stress end-to-end UNPROVEN.

Claude Code documenta compaction con reinyección de CLAUDE.md, auto-memory, plan y contexto relevante. Codex documenta compaction automática mediante /responses/compact y continuation item. Shelra tiene un summary local útil, pero no el mismo protocolo durable.

**Score: 5/10. Estado: PROVEN en tests; PARTIAL en continuidad real.**

---

## 13. Memoria

### 13.1 Sistemas

| Tipo | Implementación | Estado |
|---|---|---|
| conversación | messages SQLite/en memoria | PROVEN |
| working task state | TaskLedger y agent_tasks | PROVEN/PARTIAL resume |
| repository snapshot | facts de layout/languages/commands con revision | PROVEN |
| episodic | outcome/status/phase/verified/files/last verification | PROVEN |
| procedural | tipo disponible, uso amplio no probado | PRESENT_BUT_UNPROVEN |
| preferences | settings, no auto-memory rica | PARTIAL |
| failure memory | recovery/events, retrieval limitado | PARTIAL |
| capability memory | model_capabilities, version/observedAt | PROVEN |
| semantic repository index | no existe | MISSING |

MemoryFact incluye kind, provenance, scope, tags, confidence, created/lastValidated/expires y evidence opcional con source/contentHash/revision/lineRange. SQLite persiste metadata. No se observó un updated_at separado, invalidated status explícito ni usage count; lastValidated/expires no sustituyen una invalidación completa por branch, rename o dependencia.

Las escrituras observadas las realiza controller/TUI a partir de snapshot/ledger; no hay tool de modelo para guardar memoria ni confirmación por fact. Esto reduce poisoning directo, pero un episode puede heredar confidence alta de un completion gate optimista.

selectRelevantMemory filtra expiración y revision cuando existe, rankea por overlap lexical/user_confirmed/confidence y devuelve por defecto seis. No hay invalidación completa por branch, rename, dependency update o corrección semántica.

Se probaron selección/expiración/revision aisladas; no se demostró:

~~~text
session A descubre convención
  -> persistencia
session B pide tarea relacionada
  -> retrieval correcto
  -> mejora frente a no-memory
~~~

**Veredicto de memoria: BASIC.** Working memory **6/10**; persistent project memory **4/10**; retrieval **4/10**; correctness/invalidation **2/10**; long-horizon memory **3/10**.

---

## 14. Skills e instruction hierarchy

Se encontraron seis Skills LocalCode bajo .agents/skills y material extenso OpenTUI. skills-lock.json y .codex/agents son configuración. No existe en src discovery/metadata/activation/lazy loader/dependency resolver/version/conflict validator/invocation productivo. La discovery de repo ignora .agents y la privacy-context test prueba que no se precarga Skill content.

| Capacidad | Estado |
|---|---|
| discovery productivo | MISSING |
| metadata global | MISSING |
| lazy full body | MISSING |
| scripts/templates/tool permissions | MISSING runtime |
| version/dependencies/conflicts | CONFIG_ONLY |
| documentación de desarrollo | PROVEN como archivos, no producto |

Skills **2/10**.

instructions.ts carga archivos scoped y ordena raíz→profundidad; snapshot reconoce AGENTS.md, AGENTS.override.md y CLAUDE.md. No hay precedencia explícita completa para system/developer, global/nested AGENTS, Skills, user, memory y runtime-generated instructions.

Project instructions **3/10**; instruction hierarchy **3/10**.

README, comments, tool output y external docs pueden influir como contenido observado. No hay frontera robusta trusted/untrusted/no-override para cada fuente. Redaction y tool separation ayudan, pero no resuelven prompt injection.

Prompt-injection resistance **2/10**.

## 15. Tool ACI

tools/workspace.ts:1668-1681 registra 12 tools:

| Tool | Efecto/riesgo | Bounds/error | Estado |
|---|---|---|---|
| ReadFile | read | lines/20K, binary/not found, signal | PROVEN |
| WriteFile | write/overwrite | path/permission/checkpoint | PROVEN |
| CreateFile | create | path/exists/permission | PROVEN |
| EditFile | exact mutation | stale/conflict/checkpoint | PROVEN |
| DeleteFile | destructive | approval/checkpoint | PROVEN |
| GlobFiles | read | max 500 | PROVEN |
| ListFiles | read | max 1000 | PROVEN |
| SearchText | read | max 200/fallback 1 MB | PROVEN |
| Shell | process/network possibility | timeout 120s; raw process output | PARTIAL |
| GitStatus | read | Git status | PROVEN |
| GitDiff | read | diff/status | PROVEN |
| RunTests | process | timeout 120s/output 50K | PARTIAL |

Strengths: ToolExecutionContext typed; paths canonical/symlink-aware; risk classes; error fields; model output clipping/redaction; shared permission/checkpoint/signal context.

Debilidades: Shell es texto genérico; network/destructive son regex; runCommand no limita output en su capa; coding puede exponer muchas tools; no hay MCP/provider-native semantic tools; batch max 8 es rechazo, no coordinación concurrente.

Scores: tool design **6/10**; tool protocol **6/10**; tool reliability **5/10**.

### 15.1.1 Defaults, permisos y uso

Los defaults relevantes son ReadFile con ventana 160 líneas/20K, RunTests con el comando configurado o bun test, timeout de proceso de 120 segundos y output de tests de 50K. La cancelación se propaga por AbortSignal. Read tools pasan en modes read-only; write/execute/destructive pasan por permission, checkpoint y, según settings, approval. Los tests de workspace, permissions, tool protocol y agent loop cubren varios contratos; el uso live observado solo cubre startup/probe negativo, no una tarea mutante real.



---

## 16. Provider boundary y tool protocol

Flujo:

~~~text
provider stream
 -> openai-compatible parser
 -> stream-normalizer
 -> tool-envelope / JSON parser
 -> schema/node/path validation
 -> permission/context gate
 -> execution
 -> observation
 -> next request
~~~

openai-compatible.ts concatena fragments de tool arguments y clasifica errores HTTP/mensaje. stream-normalizer.ts separa tool-shaped text y recupera envelopes textuales. tool-envelope.ts soporta JSON/delimiters/fences, máximo 8 calls y regla conservadora para múltiples read-only.

loop.ts maneja toolChoice none con tool call, malformed/unknown calls, batch >8, duplicate/repeated calls y dos protocol recoveries. Calls se ejecutan secuencialmente.

La frontera de tipos evita que objetos nativos de LM Studio lleguen al core. El adapter es genérico; runtime/http.ts enriquece metadata LM Studio, pero no hay perfiles profundos por template, quant, structured output y multi-turn. No hay provider-native tools ni MCP.

Estado: adapter PROVEN; portability PARTIAL. Provider isolation/coupling **6/10**.

---

## 17. Error taxonomy y recovery

errors.ts cubre INVALID_ARGUMENT, NOT_FOUND, PATH_NOT_FOUND, PATH_EXISTS, PATH_IS_FILE, PATH_IS_DIRECTORY, OUTSIDE_WORKSPACE, PERMISSION_DENIED, BINARY_FILE, OUTPUT_TRUNCATED, COMMAND_FAILED, COMMAND_TIMEOUT, TEST_FAILED, STALE_EDIT, CONFLICT, RUNTIME_UNAVAILABLE, MODEL_ERROR, TOOL_BATCH_TOO_LARGE, INSUFFICIENT_CONTEXT y CANCELLED. Provider types separa AUTH/RATE/QUOTA/MODEL/UNSUPPORTED/CONTEXT/PROTOCOL/CAPACITY/TIMEOUT/NETWORK.

recovery.ts define retry, retrieve_more, repair, replan, decompose, switch_model, ask_user y stop; con causa, requirement, evidencia, attempts, forbidden repeats y node supersede. loop.ts limita protocol, planner, repeated errors, dead-end, mutation failure, watchdog y non-progress.

La suite focalizada prueba harness/recovery en fake providers. Logs acumulados contienen 60 tool.failed, 12 non_progress.detected, 9 non_progress.recovered, 19 blocked tasks y errores de provider/context/TUI; no son un benchmark controlado de tasa de recuperación.

No se ejecutó una matriz real completa de wrong path, malformed args, failed patch, missing executable, failing tests, provider timeout y context pressure contra un modelo admitido; el comportamiento real queda UNPROVEN.

Scores: error recovery **5/10**; loop resistance **5/10**; replanning **4/10**.

---

## 18. Verification

| Mecanismo | Qué demuestra | Estado |
|---|---|---|
| RunTests/project commands | health/pass-fail parsing básico | PROVEN/PARTIAL |
| typecheck/build/lint | command evidence | PARTIAL |
| GitDiff/diff-check | diff/whitespace | PROVEN |
| workspace-review.ts | Git change o fallback filesChanged | PARTIAL |
| verifier.ts | latest runs/failure/review/blockers/user-work | PROVEN |
| objective-review.ts | paths/diff/structural review | PARTIAL |
| host success callback | criterios específicos si host lo provee | PRESENT_BUT_UNPROVEN |
| code-review-agent.ts | ledger/diff/evidence read-only review | PROVEN |
| artifact smoke | version/help/config | RUNTIME, alcance pequeño |
| UI/browser general | no aceptación general | UNPROVEN |

El sistema distingue parcialmente project health de user objective. Un comando 0, diff válido y ausencia de blocker no prueban que existan las propiedades semánticas solicitadas.

completionFor en loop.ts:2331-2400 usa final text no vacío, mutación coding, success criteria si existen, latest verification, final review, preservación y blockers. La callback host puede completar criterios; sin verifier host-owned devuelve criteria no ready. No existe semantic repository oracle general.

| Caso | Resultado |
|---|---|
| claim complete sin mutation | coding gate lo bloquea |
| mutation plausible pero deliverable ausente | puede pasar criterio básico sin semantic callback |
| verifier no aplicable/no disponible | puede bloquear por criteria no ready |
| verification falla | evidence/next action/recovery pueden reabrir |
| command no aplicable | política universal no demostrada |

Scores: project verification **6/10**; objective verification **3/10**; false-success resistance **5/10**; false-block resistance **4/10**; recovery after verification **4/10**.

---

## 19. Completion

La ruta autoritativa es loop.ts:2331-2400, loop.ts:2456-2588, completion-gate.ts y verifier.ts.

Condiciones: final text no vacío; mutation para coding; success criteria satisfied cuando se exigen; verification actual/pass; final review/diff review; sin blockers; preservación de user work; plan complete si profile lo exige; phase complete solo desde verify/review.

Esto evita que tool success o una frase aislada sea suficiente. Pero objectiveSatisfied nace de final text + mutation/evidence y no representa necesariamente todos los deliverables. La terminalidad del estado es más fuerte que la verdad semántica.

Completion truthfulness **5/10**. Estado PRESENT_BUT_PARTIAL.

---

## 20. Capability profiling, admission y write authority

capability-probe.ts usa versión 14, temperature 0 y max output 512. Prueba greeting/no-tools, ReadFile selection/args, continuación sin duplicate, EditFile, RunTests y recovery ListFiles → ReadFile después de PATH_IS_FILE; opcionalmente write/read/retest en workspace temporal.

AgentCapabilityProfile incluye conversation, noToolDiscipline, toolSelection, toolArguments, multiTurnTools, errorRecovery, repositoryReasoning, editReliability y verificationBehavior, junto con model/runtime/revision/quant/template/parser/generation/hardware. Varias dimensiones permanecen unmeasured; no prueba multi-file/debug/long-horizon/verification honesty.

control-plane.ts usa probe version 14, freshness 24h y last-known compatible. Carga probes guardados o hasta tres candidatos; no benchmark de todo el catálogo.

Sonda real actual:

~~~text
model: qwen3-14b-claude-4.5-opus-high-reasoning-distill
provider: lm-studio
probe: v14
quantization: Q3_K_S
context: 16384 en la sonda
temperature: 0
maxOutputTokens: 512
class: chat_only
eligible: false
conversation: true
readTool: false
multiTurnTools: false
notes:
  Model did not call ReadFile when explicitly asked to read a file.
  Model did not select EditFile with valid arguments for an explicit edit.
execution: omitido
~~~

doctor --agent terminó 0 pero mostró Probe version unknown, capacidades UNPROBED, Autonomous coding NOT READY, Progressive coding NOT READY y Bounded coding NOT READY. No prueba que todos los nueve modelos fallen.

Router separa admission de scoring: privacy, strict-zero, capability, tools, context, health, circuit breaker y quota preceden score. TUI exige ruta medida coding_agent/advanced para coding y mantiene discovery read-only cuando no existe. Progressive host-scaffolded puede admitir scope acotado; no equivale a capacidad general.

La invariant chat-only no recibe write authority se observa en policy/router/TUI normal; no existe una matriz exhaustiva de cada fallback/manual switch.

Scores: capability profiling **6/10**; model admission **6/10**; routing **6/10**.

---

## 21. Routing y causalidad

router.ts aplica privacy → capability → cost/strict-zero → tools → context → health → quota/circuit breaker → score. route-fallback.ts limita fallback a fallos pre-mutation, excluye candidatos intentados y no hace fallback silencioso después de mutation.

Se distinguen MODEL_INELIGIBLE, runtime/provider unavailable, context, protocol, quota/privacy y verification. UI/logs pueden presentar la cadena como agent incomplete/task failed.

Groq/OpenRouter fueron consultados en catálogo/health; no hubo inferencia pagada. strict-zero excluye paid route sin billing/free verification. Free candidates requieren metadata de gratuidad/ZDR, no solo credential.

Route failure causality: PRESENT_BUT_PARTIAL, **5/10**. Privacy/cost gate es más fuerte que la evidencia de calidad.

---

## 22. Small-model readiness

El modelo aún debe descubrir repositorio, rastrear dependencias, proponer plan, escoger tools, clasificar errores, seleccionar verification y decidir completion. El host reduce paths/bounds/gates, pero no compila toda la semántica.

| Tier | Score | Evidencia |
|---|---:|---|
| 1B–2B | 2/10 | actual no medido; histórico registró Qwen 2B recovery FAIL; carga excesiva |
| 3B–4B | 3/10 | scaffolding existe; benchmark real actual ausente |
| 7B–9B | 5/10 | viable solo para tareas acotadas si tool protocol funciona |
| 12B–14B | 4/10 | Qwen3 14B real falló ReadFile/EditFile |

Small-model readiness agregado: **4/10**. Se basa en burden del harness y evidencia, no en parameter count.

---

## 23. Local runtime/provider architecture

No hay runtime de inferencia nativo. Se consumen aplicaciones externas:

- LM Studio con endpoint OpenAI-compatible y enriquecimiento /api/v1/models.
- Ollama con /api/tags.
- llama.cpp/OpenAI-compatible por URL.
- adapter genérico OpenAI-compatible para local/cloud.

No existe lifecycle manager que instale/cargue/descargue modelos, aplique sandbox al proceso o garantice daemon propio. lms.exe y el endpoint LM Studio hacen posible la ruta local, pero la dependencia sigue siendo externa.

Native-local readiness **2/10**. Provider adapter PROVEN; runtime propio MISSING.

---

## 24. Sessions, persistence, resume y crash recovery

database.ts schema v4 contiene:

~~~text
schema_migrations
settings
sessions
messages
routes
quota_snapshots
provider_health
checkpoints
files_changed
agent_tasks
model_capabilities
memory_facts
~~~

sessions guarda id/repo/objective/timestamps; messages role/content/time; routes/quota/health/capabilities/memory/checkpoints tienen storage; agent_tasks guarda ledger_json y phase. El parser database.ts:654-674 valida mínimos y defaults, no rehidrata runtime completo.

openSelectedSession restaura mensajes/objetivo. resumeSelectedSession en tui/app.tsx:1953-1985 carga el objetivo y vuelve a llamar runTask como nuevo turno. No restaura autoritativamente:

~~~text
TaskLedger/TaskGraph/current node
plan revisions/recovery contracts
compaction summary
files ownership
verification state completo
route/model capability decision
~~~

La DB parece preparada para resume, pero el camino de usuario no rehidrata el estado. No hay evidencia de fork/archive lifecycle equivalente a thread protocol completo.

Scores: sessions **4/10**; resume **2/10**.

Durante inference/tool/mutation/verification puede persistirse parte del ledger, pero no se probó idempotencia/transacción/lease que distinga in-flight de committed. Checkpoints cubren archivos, no procesos, red, branch, child runtime o subagent.

Crash recovery **3/10**; long-horizon durability **3/10**; estado PRESENT_BUT_UNPROVEN.

---

## 25. Git safety y checkpoints

workspace-review.ts usa git diff/status y fallback filesChanged solo en no-repo. task-state.ts registra filesRead/filesChanged, pero no ownership fuerte agent-owned versus user-owned.

Hay staged paths, overwrite constraints, preservation checks y checkpoints antes de mutation. No se demostró exhaustivamente staged/unstaged/untracked/rename/deletion/partially staged/concurrent user edits. Una ruta en filesChanged no prueba ownership exclusivo.

checkpoint.ts snapshot/restore/conflict/stale edit usa contenido/hash de archivos. No cubre procesos/comandos, paquetes/builds/daemons, red, commits/branches/worktrees ni efectos de child agents.

Git safety **5/10**; checkpoints **5/10**.

## 26. Permissions, sandbox, network, privacy y secrets

permissions.ts es la frontera de alto nivel: ASK pide approval; destructive requiere approval; PLAN restringe write/execute; read-only modes reducen tools. ToolExecutionContext propaga root, signal, network, checkpoint y environment.

process-policy.ts y Shell buscan regex de curl/wget, git fetch/pull, package installs, redirects, rm, git reset/clean/push --force, etc. runCommand/runShellCommand ejecutan Bun.spawn/Bun.$ con timeout/signal y allowlist de env. No hay boundary OS que capture PowerShell, scripts, aliases, child processes u obfuscation.

~~~text
application policy: PRESENT_BUT_PARTIAL
OS sandbox: MISSING
~~~

safeExecutionEnvironment incluye PATH/PATHEXT/COMSPEC/SYSTEMROOT/temp/user paths/CI/TERM/NO_COLOR/LANG/TZ/LOCALCODE_*. No incluye API keys ni DATABASE_URL. Esto reduce exposición, pero no prueba aislamiento por archivos/argumentos/tools no cubiertas.

| Dimensión | Score |
|---|---:|
| Permissions | 5/10 |
| Git safety | 5/10 |
| Sandbox | 1/10 |
| Privacy | 6/10 |
| Secret protection | 6/10 |
| Prompt-injection resistance | 2/10 |

---

## 27. Observabilidad

trace.ts define task.started, context.built, route.selected, turn.started, tool.observed, verification.observed, task.completed/blocked/failed/cancelled; se activa con LOCALCODE_AGENT_TRACE=1 y redacta secrets. logging.ts tiene component/sessionId/taskId/turnId/requestId/providerId/modelId/phase y límites/redaction. log-report.ts parsea/resume JSONL.

El log .localcode/logs/agent.jsonl observado:

~~~text
Records: 192040
Malformed lines: 0
Time: 2026-08-25T01:21:32.601Z -> 2026-08-26T13:00:44.098Z
Levels: debug=144588 info=32698 warn=14748 error=6
~~~

Counts destacados: 835 turns, 746 tool observations, 619 model responses, 605 task starts, 604 contexts built, 602 completion evaluations, 179 verifications, 185 completed, 191 failed, 210 cancelled, 100302 route candidate rejections y 40 tool failures. Es actividad acumulada, no tasa de éxito.

### 27.1.1 UI frente al estado autoritativo

La UI consume AppEvent tipados para phase, tool started/finished, verification, plan, route, checkpoint, approval y terminal task states; no es puramente una animación de strings. Sin embargo, varios identificadores llegan por closures/estado del TUI y no por un envelope estable común, y el TUI también prepara/decide callbacks de criterios y lifecycle. Por ello la representación durante un proceso es estructurada, pero no constituye una fuente de verdad independiente ni se conserva completa al reanudar.



No hay schema único que propague siempre sessionId/taskId/turnId/nodeId/modelCallId/toolCallId/verificationId. No se guardan prompts/raw outputs completos por privacidad; replay exacto no siempre es posible. Logging usa appendFileSync; no hay rotation/retention declarada, metrics dedicated ni deterministic replay.

Scores: traceability **5/10**; diagnostics **6/10**; metrics **3/10**; replay/debuggability **3/10**; observability **5/10**.

---

## 28. Tests y agent evaluations

Hay unit tests de settings/permissions/contract/planner/graph/recovery/compaction/context/capability/objective review/workspace review/TUI; integration de agent loop/planner/context/privacy; functional acceptance/provider/runtime/control-plane; fixtures FS/Git/checkpoint/fake providers.

Suite actual: **589 pass, 1 skip, 0 fail, 1905 expect(), 590 archivos**. El skip es un test de foco Esc en renderer controlado.

La cobertura demuestra funciones/contratos más que tareas completas con modelo/artifact/quant/runtime reales. No hay campaña actual con objetivo nuevo, repo heterogéneo, multi-file, failing tests, recovery, compaction, restart/resume y objective verification bajo una métrica end-to-end.

| Categoría | Estado |
|---|---|
| conversation/repository question | VERIFIED_TEST; real model parcial |
| symbol lookup | UNPROVEN; code intelligence MISSING |
| read-only analysis/plan-only | VERIFIED_TEST parcial |
| one-file/multi-file | VERIFIED_TEST con fake provider; real UNPROVEN |
| debugging/failing-test repair | VERIFIED_TEST parcial; real UNPROVEN |
| greenfield/config/refactor | mecanismos parciales; end-to-end UNPROVEN |
| error recovery | harness VERIFIED_TEST; real UNPROVEN |
| long-running/resume | UNPROVEN |
| dirty-worktree | VERIFIED_TEST parcial |
| compaction | VERIFIED_TEST determinista; real stress UNPROVEN |
| false completion/blocking | VERIFIED_TEST parcial |

### Matriz de journey real

| Journey | Evidencia actual |
|---|---|
| CLI startup/config | VERIFIED_RUNTIME source y EXE |
| TUI startup/focus/composer | VERIFIED_RUNTIME EXE |
| TUI submit/task result | UNPROVEN; sesión terminó exit 1 sin resultado |
| real local tool call | VERIFIED_RUNTIME negativo: Qwen3 14B no ReadFile/EditFile |
| real multi-turn coding | UNPROVEN |
| real multi-file/debugging | UNPROVEN |
| real compaction/restart/resume | UNPROVEN |
| safe mutation in disposable fixture | VERIFIED_TEST/harness, no real model |
| model/provider heterogeneous breadth | UNPROVEN |

Agent E2E evaluation **4/10**.

---

## 29. Release architecture

Entrypoint src/index.ts; bundle dist/index.js; existen dist/shelra.exe y dist/shelra-probe.exe. EXE responde version/help/config. El bundle contiene símbolos recientes.

Limitaciones: dist está ignorado por Git; no hay manifest/hash firmado que ate EXE a HEAD; no se probó clean install, installer, update ni runtime-assets recovery; el smoke no llegó a tarea aceptada real; docs/STATUS.md es histórica; source tests y EXE startup no prueban la misma cobertura.

Release readiness **3/10**. Estado PRESENT_BUT_PARTIAL.

---

## 30. Coupling y deuda arquitectónica

loop.ts tiene 5035 líneas y concentra prompt, plan, graph, parser, permission boundary, checkpoint, observation, recovery, compaction, verification y completion. tui/app.tsx tiene 3463 líneas y orquesta DB, memory, routing, discovery, context, probing, criteria callbacks, checkpoint y runAgent. Son dos god objects.

TaskAnalysis, TaskContract, TaskGraph, TaskLedger, agent_tasks y TUI state representan objetivo/fase parcialmente duplicados. Plan model-owned, graph host-owned, criteria mutable y completion heuristic comparten autoridad. code-review-agent es reviewer host, no child model.

No se afirma un ciclo de imports concreto sin detector: queda UNPROVEN. El coupling funcional por imports/callbacks/concentración de lifecycle sí está demostrado.

| Apariencia | Realidad |
|---|---|
| .codex/agents | config externa, no subagents Shelra |
| .agents/skills/skills-lock | archivos/config, no runtime loader |
| TaskGraph | grafo útil, no scheduler |
| TaskContract | contract parcial, no semantic oracle |
| coding_agent/advanced | narrow protocol classification, no task benchmark |
| agent_tasks | ledger persistido, resume no lo rehidrata |
| UI plan/verification | estado durante proceso, no durabilidad |
| dist | artifact ignorado, startup no prueba release |
| docs/status/logs | histórico/operacional, no éxito fresco |

---

### 30.1. Top 20 símbolos consecuenciales

| # | Símbolo | Responsabilidad | Coupling/risk | Tests/complejidad | Autoridad |
|---:|---|---|---|---|---|
| 1 | src/index.ts main | entrypoint CLI/TUI | conecta toda la aplicación | smoke/typecheck; baja-media | proceso |
| 2 | cli/control-plane.ts openControlPlane | DB, runtimes, providers, settings | inicialización global | control-plane tests; alta | host |
| 3 | tui/app.tsx runTask | orquestación de sesión/tarea | god object/UI-storage coupling | TUI/integration; muy alta | TUI + host |
| 4 | agent/loop.ts runAgent | loop completo | god object crítico | agent-loop; muy alta | loop |
| 5 | agent/loop.ts observeTool | ledger/evidence/recovery | observation authority | agent-loop; alta | host |
| 6 | agent/loop.ts completionFor | decide completion result | false-success risk | completion tests; alta | host heuristic |
| 7 | agent/loop.ts finish | review/verify/terminal phase | concentra gates | integration; alta | host |
| 8 | agent/task-state.ts setTaskPhase | lifecycle transitions | phase authority | task-state tests; media | state |
| 9 | agent/task-state.ts recordTaskAction | files/actions/evidence | ownership incompleta | loop tests; media | ledger |
| 10 | agent/task-contract.ts compileTaskContract | objective → structured contract | semantic under-specification | contract tests; media | compiler |
| 11 | agent/planner.ts validatePlanProposal | valida plan/model nodes | plan validity, no semantics | planner tests; alta | host validator |
| 12 | agent/task-graph.ts nextReadyTaskNode | readiness/current node | no worker scheduler | graph tests; media | loop/graph |
| 13 | context/repository.ts buildRepositoryContext | files/instructions/snippets | lexical relevance | context tests; alta | context host |
| 14 | context/context-compiler.ts compileContextPacket | bounded context packet | inicial, no per-turn rebuild | compiler tests; media | context host |
| 15 | router/router.ts route | admission/scoring | privacy/cost safe; capability narrow | router tests; alta | router |
| 16 | router/route-fallback.ts | pre-mutation fallback | cause preservation | router/fallback tests; media | router |
| 17 | agent/capability-probe.ts probeAgentCapability | model admission evidence | probe too narrow | probe tests; alta | capability |
| 18 | providers/openai-compatible.ts | streaming/tool adapter | generic provider assumptions | provider tests; alta | adapter |
| 19 | providers/stream-normalizer.ts | normalize/recover model stream | protocol boundary | stream tests; media | adapter |
| 20 | tools/workspace.ts createWorkspaceTools | filesystem/shell/test tools | side effects/process policy | workspace tests; muy alta | tool host |

Esta tabla identifica responsabilidad y autoridad real, no solo nombres de tipos. Los mayores riesgos de complejidad son loop.ts, app.tsx, workspace.ts, planner.ts y capability-probe.ts; los mayores riesgos de autonomía son completionFor, buildRepositoryContext y resumeSelectedSession.

## 31. Benchmark público actual: Claude Code



La comparación usa mecanismos y comportamiento oficiales públicos; no especula sobre arquitectura privada.

Fuentes:

- [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
- [Context window management](https://code.claude.com/docs/en/context-window)
- [Memory](https://code.claude.com/docs/en/memory)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Permissions](https://code.claude.com/docs/en/permissions)
- [Checkpointing](https://code.claude.com/docs/en/checkpointing)
- [Sessions](https://code.claude.com/docs/en/sessions)
- [Skills](https://code.claude.com/docs/en/skills)
- [MCP](https://code.claude.com/docs/en/mcp)

| Capacidad | Benchmark público documentado |
|---|---|
| loop | Gather context → take action → verify results → repeat/adapt |
| exploration | file/search/shell/Git/testing y repo-wide context |
| code intelligence | code intelligence/integrations públicas; no se atribuyen internals privados |
| plan | Plan mode explícito, revisable/interrumpible |
| permissions | modos/patterns de aprobación y side-effect control |
| checkpoints | checkpoint/rewind documentado |
| sessions | JSONL persistence, resume/fork |
| context | auto compaction, clearing/summarization y reinjection |
| CLAUDE.md | root/nested scoped persistent instructions |
| auto-memory | memoria limitada, root project y topic files bajo demanda |
| Skills | metadata/lazy full body bajo demanda |
| subagents | fresh isolated context, foreground/background, tools/perms y result al parent |
| multi-agent | agent teams/parallel/message passing documentados |
| worktrees | soporte documentado |
| hooks/MCP | extensibilidad pública |
| agent SDK | superficie pública de integración; no se usa para inferir internals privados del CLI |
| long horizon | compaction + memory + subagents/background |
| interruption | interrupt/cancel/resume |
| verification | observations/tests/adaptation del loop |

Este benchmark describe capacidades públicas, no garantiza que cada ejecución sea correcta.

---

## 32. Benchmark público actual: Codex/Codex CLI

Fuentes:

- [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
- [Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/)
- [Codex repository](https://github.com/openai/codex)
- [Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Codex compaction source](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs)
- [Codex sandboxing source](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/sandboxing.rs)
- [Codex execution policy](https://github.com/openai/codex/blob/main/codex-rs/execpolicy/src/lib.rs)
- [AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Subagents guide](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Skills guide](https://learn.chatgpt.com/docs/build-skills)
- [Sandboxing and approvals](https://learn.chatgpt.com/docs/agent-approvals-security)
- [Internet access](https://learn.chatgpt.com/docs/cloud/internet-access)
- [Windows sandbox engineering](https://openai.com/index/building-codex-windows-sandbox/)

| Capacidad | Benchmark público |
|---|---|
| loop | USER ↔ MODEL ↔ TOOLS; cada tool output vuelve al contexto |
| tools | shell/patch/update plan/MCP/tool items y stream events |
| editing | patch/update operations |
| AGENTS | global → root → cwd/nested/override, merge y caps |
| context | roles system/developer/user/assistant + AGENTS/Skills/environment |
| compaction | automática cerca del límite, /responses/compact y continuation |
| sessions | thread start/resume/fork/archive/history |
| approvals | approval request/response y policies |
| sandbox | OS-level, heredado por children |
| network | políticas separadas y restringidas por defecto en superficies documentadas |
| rules | exec policy y condiciones de approval |
| Skills | progressive disclosure, metadata bounded, resources/scripts |
| subagents | built-in/custom, fresh bounded context, parallel workflows |
| observability | app-server JSON-RPC, stable thread/turn/item/tool IDs |
| integration tests | suites públicas de core, approvals, sandbox y agent logic |
| verification | tool/test evidence integrada; no se atribuye universal oracle no documentado |
| telemetry | controles/opt-in documentados |

No se infiere arquitectura privada fuera de estas fuentes. Issues de GitHub, si se considerasen, serían COMMUNITY / ISSUE EVIDENCE.

---

## 33. ShelraCode frente a Claude Code

**Harness architecture proximity: 4.0 / 10.**  
**Effective autonomy proximity: 2.3 / 10.**  
**Gap: VERY FAR.**

| Capability | ShelraCode | Claude Code public benchmark | Gap | Severity | Evidence |
|---|---|---|---|---|---|
| agent loop | multi-turn bounded host loop | adaptive gather/act/verify | parcial, grande en amplitud | P1 | loop.ts; Claude loop |
| context discovery | Git/rg/lexical clips | repo-wide adaptive exploration | superficial | P0 | repository.ts; Claude docs |
| repository intelligence | no AST/LSP/definition/reference | code intelligence pública | grande | P0 | source; Claude docs |
| planning | model proposal + host validation | plan mode operativo | semántica/durabilidad | P1 | planner.ts; Claude workflows |
| task state | ledger/graph en proceso | plan/context/session continuity | resume/authority | P0 | task-state/graph |
| error recovery | typed/bounded, fake tests | adaptive continuation | real evidence ausente | P1 | loop/recovery |
| verification | commands/diff/criteria parcial | verify/repeat loop | objective oracle | P0 | verifier/completion |
| completion | host gate + heuristic | contexto/verificación más rico | truth semantic | P0 | completion-gate |
| memory | facts/episodes, invalidation parcial | CLAUDE.md + auto-memory | retrieval/continuity | P1 | memory.ts; Claude memory |
| compaction | summary local, no reinjection completa | automatic management/reinjection | long session | P0 | compaction.ts; Claude context |
| Skills | config/docs, no loader | lazy/progressive Skills | ausente | P1 | .agents; Claude Skills |
| subagents | missing | fresh isolated foreground/background | total | P0 | no src; Claude subagents |
| permissions | app policy/regex | documented permissions/checkpoints | process boundary | P0 | permissions.ts |
| checkpoints | files-only | rewind/checkpoint workflow | external effects/worktree | P1 | checkpoint.ts |
| sessions/resume | objective/messages; no ledger rehydrate | resume/fork persistence | grande | P0 | app.tsx:1953-1985 |
| worktrees | missing | documented worktrees | total | P1 | no source |
| long horizon | unproven | compaction/memory/subagents/background | grande | P0 | runtime vs docs |
| code intelligence | SearchText only | public code intelligence | total | P0 | no AST/LSP |
| observability | JSONL partial | richer sessions/hooks/MCP | medium/grande | P1 | trace/logging |

ShelraCode sí tiene strict-zero/local-first, path/symlink safety, typed errors y gates conservadores. No compensan semantic intelligence, Skills runtime, subagents, durable resume y OS sandbox.

---

## 34. ShelraCode frente a Codex

**Harness architecture proximity: 4.0 / 10.**  
**Effective autonomy proximity: 2.5 / 10.**  
**Gap: VERY FAR.**

| Capability | ShelraCode | Codex public benchmark | Gap | Severity | Evidence |
|---|---|---|---|---|---|
| agent loop | runAgent + provider stream | USER/MODEL/TOOLS turns/events | protocolo menos durable | P1 | loop.ts; Codex loop |
| tool execution | 12 tools + shell | shell/patch/plan/MCP/item events | ecosistema/coverage | P1 | workspace.ts; Codex repo |
| context | initial packet + messages | bounded injected context/fragments | relevance/reinjection | P0 | context-compiler; Codex AGENTS |
| AGENTS | scoped order, precedence parcial | hierarchy/override/caps | grande | P1 | instructions.ts; AGENTS guide |
| compaction | deterministic summary | /responses/compact continuation | durable context | P0 | compaction.ts; compact.rs |
| sandbox | no OS sandbox | OS-enforced + child inheritance | total | P0 | process.ts; sandbox source |
| approvals | ASK/policy app | approval protocol/policy | enforcement | P0 | permissions.ts; sandbox source |
| network | regex deny | network policy/allowlist | bypass | P0 | process-policy.ts; internet docs |
| sessions | DB, resume incompleto | thread resume/fork/archive/history | grande | P0 | database/app; app-server |
| subagents | missing | custom/built-in parallel | total | P0 | no runtime; subagents docs |
| observability | partial JSONL | stable app-server IDs/events | grande | P1 | events/trace; app-server |
| integration tests | 589 principalmente fixture/fake | public core/approval/sandbox suites | evidence gap | P1 | tests; Codex core/suite |
| verification | health/structural objective | tool/test evidence integrated | objective gap | P0 | verifier/objective-review |
| Skills | no loader | progressive packages/scripts | total | P1 | .agents; Skills guide |
| event architecture | callbacks/local events | JSON-RPC typed items/approvals | maturity | P1 | events; app-server |

Shelra comparte con Codex host loop + model + tools y una frontera typed útil. Codex está por delante públicamente en sandbox OS, approvals, app-server/session protocol, compaction, AGENTS, Skills y subagents.

## 35. Árbol de causas raíz

### R1 — Sin árbitro semántico independiente

~~~text
TaskContract genérico + objectiveSatisfied = text/mutation/evidence
  ↓
completion sabe que hubo actividad, no todas las propiedades del deliverable
  ↓
cambio plausible + test parcial puede parecer suficiente
  ↓
false success y baja confianza en objetivos complejos
~~~

Evidencia: task-contract.ts, loop.ts:2331-2400, completion-gate.ts, objective-review.ts. VERIFIED_SOURCE.

### R2 — Repository intelligence lexical

~~~text
rg/path priority + clips
  ↓
faltan symbols, definitions, references, imports, related tests y types
  ↓
packet puede ser lexicalmente relevante pero estructuralmente incorrecto
  ↓
modelo carga discovery mecánico y falla más con tiers pequeños
~~~

Evidencia: context/repository.ts y ausencia de AST/LSP. VERIFIED_SOURCE.

### R3 — Estado duplicado sin scheduler durable

~~~text
TaskAnalysis + Contract + Graph + Ledger + DB + TUI state
  ↓
loop god object decide node/recovery/verify/completion
  ↓
Graph no tiene worker/ready queue y resume no lo rehidrata
  ↓
coordination debt y horizonte largo frágil
~~~

### R4 — Compaction no equivale a rehidratación

~~~text
summary determinista solo durante el proceso
  ↓
restart vuelve a objective/messages, no ledger/graph/route/verification
  ↓
DB existe pero no restaura autoridad operacional
  ↓
resume/crash recovery bajos
~~~

### R5 — Skills/subagents fuera del runtime

~~~text
.agents/.codex/docs presentes
  ↓
no loader/delegator/child context/result protocol
  ↓
no progressive expertise, fresh context ni división de trabajo
  ↓
más carga sobre un único modelo
~~~

### R6 — Safety de aplicación, no de proceso

~~~text
ASK + regex network/destructive + env allowlist
  ↓
control depende del texto visible del comando
  ↓
scripts/children/aliases pueden evadir parte de policy
  ↓
no apto para autonomía no supervisada
~~~

### R7 — Capability profiling estrecho

~~~text
greeting/read/edit/error probe
  ↓
coding_agent puede significar protocol readiness, no task success
  ↓
multi-file/debug/long-horizon quedan unmeasured
  ↓
admission y effective autonomy divergen
~~~

### R8 — Tests de harness dominan evidencia real

~~~text
589 tests pasan en contracts/fixtures/fake providers
  ↓
harness aislado está razonablemente cubierto
  ↓
tasa de éxito de modelos/artifacts/repo reales no conocida
  ↓
score end-to-end debe permanecer bajo/UNPROVEN
~~~

---

## 36. P0 / P1 / P2

### P0 — impiden autonomía compleja creíble

1. Falta verificación semántica global del objetivo.
2. Repository intelligence sin símbolos/AST/LSP/references.
3. Resume/crash recovery no rehidrata el estado autoritativo.
4. Falta sandbox OS y enforcement universal de proceso/red.
5. Falta runtime de subagents/parallel ownership/worktree merge.
6. El modelo local cargado no superó la sonda básica de tools.

### P1 — gaps grandes de fiabilidad/escala

1. Context compiler principalmente inicial, no packet fresco por decisión.
2. Compaction sin reinyección explícita de instructions/memory/plan.
3. TaskGraph sin scheduler independiente.
4. Capability probes sin benchmark real multi-file/debug/verification/long horizon.
5. Skills sin runtime e instruction precedence incompleta.
6. Git ownership/checkpoints solo parciales.
7. Observability sin IDs contractuales completos, replay, rotation y metrics.
8. TUI/EXE full journey, clean install y release acceptance no probados.

### P2 — madurez/optimización

1. Output de proceso sin cap antes del wrapper.
2. Ausencia de concurrencia read-only controlada.
3. Ranking lexical y parsing de test counts simple.
4. Memory episodes sin revision/branch invalidation universal.
5. Faltan perfiles provider/template/quant más profundos.
6. Logger síncrono sin retention/rotation.
7. UI expone causalidad de route/recovery de forma parcial.

No todo es P0: loop, tools, typed errors, path safety, strict-zero y preservation checks son mecanismos reales.

---

## 37. Componentes más fuertes

1. Boundary typed de tools/errores/resultados: ToolExecutionContext, ToolResult y errors.ts.
2. Path/symlink/stale edit/checkpoint safety.
3. Separación router/provider/core y gates privacy/strict-zero/quota.
4. Plan/ledger/graph/recovery host-validated.
5. Verifier, diff review y eventos tipados que impiden parte de false completes.

Son fortalezas reales; el problema es alcance e integración, no que sean solo nombres.

---

## 38. Componentes más débiles

1. loop.ts concentra demasiada autoridad.
2. objectiveSatisfied/criteria no representan todas las obligaciones semánticas.
3. repository.ts no conoce symbols/relations.
4. resumeSelectedSession no rehidrata ledger/graph/route/verification.
5. Skills, subagents, worktrees, MCP y hooks no están en runtime.
6. Network/permissions son filtros regex/app, no sandbox.
7. Capability profiling no mide task success.
8. Tests reales de modelo/repo/artifact son insuficientes.

Bottleneck único: **la ausencia de un árbitro semántico independiente del objetivo global**. Es el cuello principal porque plan, contexto lexical, health verification y completion pueden converger en terminado sin probar cada deliverable. Los siguientes cuatro son repository intelligence lexical; state/scheduler/resume no durable; falta de subagents/worktrees; y policy sin sandbox OS junto con probe estrecho.

---

## 39. Diagnóstico model-vs-harness

| Síntoma | Causa primaria | No atribuir automáticamente a |
|---|---|---|
| Qwen3 14B no llamó ReadFile/EditFile | model/template/runtime tool-use integration | todo el loop |
| no FindDefinition/References | harness capability missing | modelo pequeño |
| mutation + text puede completar | completion/verification harness | solo modelo |
| resume pierde graph/route | session architecture | context window |
| regex evade red | environment/policy boundary | model reasoning |
| plan semánticamente incompleto | model + compiler | solo scheduler |
| 589 tests pasan pero real route no | evaluation boundary/model evidence | inutilidad de tests |
| privacy/quota rejection | routing policy | incapacidad del modelo |

Modelo frontier con harness actual: **SOME**. Mejoraría tool selection, plan semántico, recovery y multi-file, pero no eliminaría AST/LSP ausente, semantic verifier, Skills/subagents, durable resume ni OS sandbox.

Harness Claude/Codex-class con modelos actuales: **SUBSTANTIAL** para tareas acotadas, no paridad. Reduciría carga mecánica, pero el Qwen3 14B observado falló tools básicas y un harness no inventa razonamiento.

---

## 40. Scorecard final

| Dimensión | /10 |
|---|---:|
| Intent understanding | 4 |
| Task compilation | 5 |
| Generalization | 3 |
| Agent loop | 6 |
| Action selection | 5 |
| Planning | 5 |
| Task graph | 4 |
| Scheduler | 2 |
| Progress detection | 5 |
| Recovery | 5 |
| Replanning | 4 |
| Repository discovery | 5 |
| Repository intelligence | 3 |
| Context relevance | 4 |
| Context sufficiency | 5 |
| Context efficiency | 5 |
| Context compaction | 5 |
| Working memory | 6 |
| Persistent memory | 4 |
| Memory retrieval | 4 |
| Memory correctness/invalidation | 2 |
| Skills | 2 |
| Instruction hierarchy | 3 |
| Single-agent autonomy | 5 |
| Subagents | 0 |
| Multi-agent coordination | 0 |
| Tool design | 6 |
| Tool protocol | 6 |
| Tool reliability | 5 |
| Code intelligence | 1 |
| Editing | 6 |
| Shell execution | 5 |
| Testing/debugging | 4 |
| Objective verification | 3 |
| Completion truthfulness | 5 |
| False-success resistance | 5 |
| False-block resistance | 4 |
| Capability profiling | 6 |
| Model admission | 6 |
| Routing | 6 |
| Small-model readiness | 4 |
| Git safety | 5 |
| Checkpoints | 5 |
| Permissions | 5 |
| Sandbox | 1 |
| Privacy | 6 |
| Prompt-injection resistance | 2 |
| Sessions | 4 |
| Resume | 2 |
| Crash recovery | 3 |
| Long-horizon durability | 3 |
| Observability | 5 |
| Agent evaluations | 4 |
| Release readiness | 3 |

### Weighted score

Se usaron los pesos solicitados, no promedio simple:

| Grupo | Peso | Score grupo | Contribución |
|---|---:|---:|---:|
| Task understanding/compilation | 8% | 3.8 | 3.04 |
| Agent loop/execution | 12% | 5.5 | 6.60 |
| Repository intelligence/context | 12% | 3.6 | 4.32 |
| Planning/scheduler/task state | 8% | 3.8 | 3.04 |
| Tools/editing/environment | 10% | 5.5 | 5.50 |
| Recovery/replanning | 10% | 4.3 | 4.30 |
| Verification/completion | 12% | 3.8 | 4.56 |
| Memory/compaction/long horizon | 8% | 3.8 | 3.04 |
| Model capability/routing | 6% | 4.8 | 2.88 |
| Safety/Git/permissions/sandbox | 6% | 4.0 | 2.40 |
| Subagents/delegation | 3% | 0.5 | 0.15 |
| Sessions/resume | 2% | 2.8 | 0.56 |
| Observability/evals/release | 3% | 3.8 | 1.14 |
| **Total** | **100%** | — | **41.53 / 100** |

Redondeado: **41.5 / 100 = 4.2 / 10**.

---

## 41. Veredicto final

SHELRACODE — FINAL AUTONOMY VERDICT  
Current classification: **FUNCTIONAL CODING AGENT**  
Overall autonomy: **4.2 / 10**  
Weighted score: **41.5 / 100**  
CORE  
Agent loop: **6 / 10**  
Task understanding: **4 / 10**  
Planning/scheduler: **4 / 10**  
Repository intelligence: **3 / 10**  
Context engineering: **4 / 10**  
Recovery: **4 / 10**  
Verification: **4 / 10**  
Completion: **5 / 10**  
MEMORY & KNOWLEDGE  
Working memory: **6 / 10**  
Persistent memory: **4 / 10**  
Compaction: **5 / 10**  
Skills: **2 / 10**  
Project instructions: **3 / 10**  
AGENTS  
Single-agent autonomy: **5 / 10**  
Subagents: **0 / 10**  
Multi-agent: **0 / 10**  
MODEL / LOCAL  
Capability profiling: **6 / 10**  
Routing: **6 / 10**  
Small-model readiness: **4 / 10**  
Native-local readiness: **2 / 10**  
SAFETY  
Git safety: **5 / 10**  
Permissions: **5 / 10**  
Sandbox: **1 / 10**  
Privacy: **6 / 10**  
DURABILITY  
Sessions: **4 / 10**  
Resume: **2 / 10**  
Long-horizon: **3 / 10**  
Crash recovery: **3 / 10**  
ENGINEERING MATURITY  
Observability: **5 / 10**  
Agent E2E evaluation: **4 / 10**  
Release readiness: **3 / 10**  
VERSUS CLAUDE CODE  
Harness architecture proximity: **4.0 / 10**  
Effective autonomy proximity: **2.3 / 10**  
Gap: **VERY FAR**  
Top advantages Claude Code currently has:
1. Context management y compaction con reinyección de instrucciones/memoria/plan.
2. Repository/code-intelligence y exploración adaptativa más amplias.
3. Subagents con contexto fresco, background/parallel y resultados al parent.
4. Sessions/resume/fork, checkpoints/worktrees y continuidad de horizonte largo.
5. Skills lazy, hooks/MCP y permisos/checkpoints públicos más maduros.
VERSUS OPENAI CODEX  
Harness architecture proximity: **4.0 / 10**  
Effective autonomy proximity: **2.5 / 10**  
Gap: **VERY FAR**  
Top advantages Codex currently has:
1. Sandbox a nivel de SO y boundary de aprobaciones heredado por child processes.
2. Context/compaction protocol y AGENTS.md jerárquico documentados.
3. Thread/session app-server con resume/fork/archive y eventos estables.
4. Subagents, Skills progressive y herramientas/eventos integrados públicamente.
5. Suite pública de integración para core, approvals, sandbox y agent logic.
PRIMARY BOTTLENECK  
La ausencia de un árbitro semántico independiente del objetivo global: ShelraCode comprueba actividad, estado y salud con estructura, pero no demuestra de forma general que los deliverables y propiedades solicitadas existan y sean correctos.
TOP 5 ROOT GAPS
1. Verificación semántica global insuficiente.
2. Repository intelligence lexical sin AST/LSP/definiciones/referencias.
3. Task state/scheduler/resume no forman un runtime durable único.
4. Skills, subagents, worktrees y multi-agent faltan en producción.
5. Policy de aplicación sin sandbox OS y capability benchmark estrecho.
STRONGEST SHELRACODE ADVANTAGES
1. Boundary tipado de tools, errores y resultados.
2. Seguridad de paths, symlinks, stale edits y checkpoints de archivos.
3. Strict-zero, privacidad y routing explicable/local-first.
4. Plan/ledger/graph/recovery/verifier host-controlled en el harness.
5. Suite amplia de contratos y fixtures: 589 pass, 1 skip, 0 fail.
WOULD I TRUST IT UNSUPERVISED ON A PRODUCTION REPOSITORY?  
**NO**
CAN IT RELIABLY SOLVE A COMPLEX UNSEEN ENGINEERING REQUIREMENT FROM ONE PROMPT?  
**NO**
FINAL VERDICT  
El ShelraCode actual ya no es solo una interfaz conversacional: contiene un agente de coding real y disciplinado para operaciones acotadas. Pero la evidencia no permite llamarlo un agente autónomo fuerte. La sonda del modelo local disponible falló las tools básicas; el contexto es léxico; la verificación global es estructural; memoria y compaction no proporcionan continuidad durable; no hay Skills runtime ni subagents; y la seguridad no está reforzada por sandbox del sistema operativo. Frente a los mecanismos públicos actuales de Claude Code y Codex, la brecha de harness es sustancial y la brecha de autonomía efectiva es muy grande. El score que soporta la evidencia actual es **4.2/10**, clasificación **FUNCTIONAL CODING AGENT**, no Claude/Codex-class.
