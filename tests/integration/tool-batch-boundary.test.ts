import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CheckpointService } from "../../src/checkpoint/checkpoint.js";
import { runAgent } from "../../src/agent/loop.js";
import { workspaceTools } from "../../src/tools/workspace.js";
import { LocalCodeDatabase } from "../../src/storage/database.js";
import {
  createScriptedProvider,
  fakeAgentCandidate,
} from "../support/fake-provider.js";

describe("agent tool-batch boundary", () => {
  test("rejects an oversized native batch before executing any tool", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-batch-"));
    await mkdir(path.join(root, "src"));
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    const calls = Array.from({ length: 100 }, (_, index) => ({
      type: "tool.call" as const,
      call: {
        id: `read-${index + 1}`,
        name: "ReadFile",
        arguments: JSON.stringify({ path: "src/value.ts" }),
      },
    }));
    const provider = createScriptedProvider([calls]);
    const startedTools: string[] = [];

    const result = await runAgent(
      {
        id: "oversized-tool-batch",
        objective: "Inspect src/value.ts and make the requested change.",
        mode: "coding",
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        context: "The requested target is src/value.ts.",
      },
      {
        provider,
        tools: workspaceTools,
        onEvent: (event) => {
          if (event.type === "tool.started") startedTools.push(event.tool);
        },
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
      },
    );

    expect(result.status).toBe("failed");
    expect(result.toolRuns).toHaveLength(0);
    expect(startedTools).toHaveLength(0);
    expect(result.completion.reasons.join(" ")).toContain(
      "maximum tool calls per response",
    );
    expect(result.ledger.blockers.length).toBeGreaterThan(0);
    db.close();
  });
});
