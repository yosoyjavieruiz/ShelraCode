// Diagnostic: run the REAL production runAgent (the same code dist/shelra.exe
// bundles) against the REAL loaded local model on the operator's exact
// complaint — "create a simple web page" — in a greenfield workspace, tracing
// EVERY event. Real model, real tools, real execution broker, real write-auth
// gate. No fake provider. Success is measured by inspecting the actual file.
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { CheckpointService } from "../src/checkpoint/checkpoint.js";
import { runAgent } from "../src/agent/loop.js";
import { LocalCodeDatabase } from "../src/storage/database.js";
import { OpenAICompatibleLocalRuntime } from "../src/runtimes/http.js";
import { workspaceTools } from "../src/tools/workspace.js";
import { recommendedAgentContextChars } from "../src/agent/context-budget.js";
import {
  probeAgentCapability,
  driverProfileFromCapabilityProbe,
} from "../src/agent/capability-probe.js";
import { createExecutionBroker } from "../src/security/execution-broker.js";

const runtime = new OpenAICompatibleLocalRuntime(
  "lm-studio",
  "LM Studio",
  "http://127.0.0.1:1234/v1",
);
const modelId =
  process.env.SHELRACODE_LIVE_MODEL_ID ?? "parable-qwen3-4b-claude-fable-5";
const candidates = await runtime.listModels();
const candidate = candidates.find((c) => c.modelId === modelId);
if (!candidate) {
  throw new Error(
    `No live model matched ${modelId}. Available: ${candidates.map((c) => c.modelId).join(", ")}`,
  );
}

const root = await mkdtemp(path.join(os.tmpdir(), "shelra-web-eval-"));
const database = new LocalCodeDatabase(":memory:");
const checkpoint = new CheckpointService(database, root);
const controller = new AbortController();

// Greenfield: a bare project, exactly the "make me a web page" starting point.
await writeFile(
  path.join(root, "package.json"),
  JSON.stringify({ name: "web-fixture", version: "0.0.0" }) + "\n",
  "utf8",
);

const probe = await probeAgentCapability(
  runtime.provider(),
  candidate.modelId ?? candidate.displayName,
  controller.signal,
  { root },
);
const driverProfile = driverProfileFromCapabilityProbe(candidate, probe);
console.log(
  `PROBE: class=${probe.agentCapabilityClass} editApplied=${probe.execution?.editApplied} certified=${driverProfile ? "yes" : "NO"} writeAuthority=${driverProfile?.writeAuthority ?? "none"}`,
);

const events: string[] = [];
let turnCount = 0;

const result = await runAgent(
  {
    id: "web-eval-create-page",
    objective:
      "Create a simple web page in this project. Create a file named index.html at the project root containing a valid HTML document with a <title>, one <h1> heading, and at least one <p> paragraph. Then confirm the file exists with those elements.",
    root,
    candidate,
    repositoryPolicy: "local_only",
    permissionMode: "AUTO",
    mode: "coding",
    successCriteria: [
      "index.html exists at the project root",
      "index.html contains an <h1> heading and a <p> paragraph",
    ],
    verificationCommands: [],
    context:
      "This is a disposable greenfield project. Use only the exposed workspace tools to create files. There is no build or test step; success is the created file.",
    maxTurns: 16,
    contextBudgetChars: recommendedAgentContextChars(candidate, "coding", 0.5),
    temperature: 0,
    maxOutputTokens: 1024,
    systemPromptProfile: "coding",
  },
  {
    provider: runtime.provider(),
    tools: workspaceTools,
    toolChoice: "auto",
    onEvent(event: { type: string; [k: string]: unknown }) {
      // Capture EVERY event, not just tool ones.
      if (event.type === "task.started") turnCount = 0;
      const extra: string[] = [];
      for (const k of ["tool", "stage", "exitCode", "phase", "reason", "message"])
        if (event[k] !== undefined) extra.push(`${k}=${String(event[k]).slice(0, 60)}`);
      if (event.type === "tool.finished" && (event as any).result) {
        const r = (event as any).result;
        extra.push(`ok=${r.ok}`);
        if (r.ok === false)
          extra.push(`code=${r.code ?? ""} err=${String(r.error ?? "").slice(0, 90)}`);
      }
      events.push(`${event.type} ${extra.join(" ")}`.trim());
    },
    checkUserWorkPreserved: (checkpointId) =>
      checkpointId ? checkpoint.isPreserved(checkpointId) : true,
    reviewFinalDiff: () => true,
    async verifySuccessCriteria() {
      let html = "";
      try {
        html = await readFile(path.join(root, "index.html"), "utf8");
      } catch {}
      const hasH1 = /<h1[\s>]/i.test(html);
      const hasP = /<p[\s>]/i.test(html);
      const exists = html.length > 0;
      const pass = exists && hasH1 && hasP;
      return {
        pass,
        satisfiedCriterionIds: pass ? ["criterion-1", "criterion-2"] : [],
        issues: pass
          ? []
          : [
              `index.html ${exists ? "exists" : "MISSING"}; hasH1=${hasH1}; hasP=${hasP}`,
            ],
        nextActions: pass
          ? []
          : [
              "Use CreateFile or WriteFile to create index.html at the project root with a full HTML document including <h1> and <p>.",
            ],
        nextPaths: ["index.html"],
      };
    },
    async createExecutionContext() {
      // WEB_EVAL_FORCE_BOUNDED=1 simulates the app.tsx local-first fallback:
      // NO certified driver profile, but bounded write authority (what the fix
      // grants a local coding task when certification never produced a profile).
      const forceBounded = process.env.WEB_EVAL_FORCE_BOUNDED === "1";
      const effProfile = forceBounded ? undefined : driverProfile;
      return {
        root,
        permissionMode: "AUTO" as const,
        signal: controller.signal,
        network: false,
        modelAuthority: (forceBounded ? "host" : "model") as "host" | "model",
        ...(effProfile ? { driverProfile: effProfile } : {}),
        executionBroker: createExecutionBroker({
          root,
          networkMode: "strict-zero" as const,
          allowUnverifiedProcesses: false,
          ...(effProfile
            ? { driverProfile: effProfile }
            : {
                writeAuthority: (forceBounded ? "bounded" : "none") as
                  | "bounded"
                  | "none",
              }),
        }),
        checkpoint,
        env: process.env,
      };
    },
  },
  controller.signal,
);

let finalHtml = "";
try {
  finalHtml = await readFile(path.join(root, "index.html"), "utf8");
} catch {}

console.log("\n===== EVENT TRACE (every event) =====");
for (const e of events) console.log("  " + e);
console.log("\n===== RESULT =====");
console.log("status:", (result as any).status);
console.log(
  "index.html:",
  finalHtml.length > 0 ? `CREATED (${finalHtml.length} chars)` : "NOT CREATED",
);
if (finalHtml)
  console.log(
    "has <h1>:",
    /<h1[\s>]/i.test(finalHtml),
    " has <p>:",
    /<p[\s>]/i.test(finalHtml),
  );
console.log("--- index.html (first 500 chars) ---");
console.log(finalHtml.slice(0, 500));
