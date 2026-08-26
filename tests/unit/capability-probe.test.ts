import { expect, test } from "bun:test";
import {
  AGENT_CAPABILITY_PROBE_VERSION,
  probeAgentCapability,
  probeFreeCloudModelCapabilities,
  probeLocalModelCapabilities,
} from "../../src/agent/capability-probe.js";
import type { ProviderAdapter } from "../../src/providers/types.js";
import type { ModelCandidate } from "../../src/shared/types.js";
import { createLogger, type LogRecord } from "../../src/shared/logging.js";

function fakeHealthQuota(
  id: string,
): Pick<
  ProviderAdapter,
  "id" | "displayName" | "discoverModels" | "health" | "quota" | "classifyError"
> {
  return {
    id,
    displayName: id,
    async discoverModels() {
      return [];
    },
    async health() {
      return { state: "healthy" };
    },
    async quota() {
      return {
        providerId: id,
        confidence: "unknown",
        observedAt: new Date().toISOString(),
      };
    },
    classifyError(error) {
      return {
        code: "UNKNOWN",
        message: error instanceof Error ? error.message : String(error),
      };
    },
  };
}

test("a well-behaved model probes as agentic-coding eligible", async () => {
  let call = 0;
  const records: LogRecord[] = [];
  const logger = createLogger({
    level: "debug",
    sink: { write: (record) => records.push(record) },
  });
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("good"),
    async *stream() {
      call += 1;
      if (call === 1) {
        yield { type: "text.delta", text: "Hi! How can I help?" };
      } else if (call === 2) {
        yield {
          type: "tool.call",
          call: {
            id: "probe-read-1",
            name: "ReadFile",
            arguments: JSON.stringify({ path: "demo.txt" }),
          },
        };
      } else if (call === 3) {
        // Multi-turn: should respond with text after seeing the tool result,
        // not call ReadFile again.
        yield { type: "text.delta", text: "demo.txt contains: hello probe." };
      } else if (call === 4) {
        yield {
          type: "tool.call",
          call: {
            id: "probe-edit-1",
            name: "EditFile",
            arguments: JSON.stringify({
              path: "demo.txt",
              oldText: "hello",
              newText: "hello world",
            }),
          },
        };
      } else if (call === 6) {
        yield {
          type: "tool.call",
          call: {
            id: "probe-test-1",
            name: "RunTests",
            arguments: JSON.stringify({}),
          },
        };
      } else {
        yield {
          type: "text.delta",
          text: "The observed operation is complete.",
        };
      }
      yield { type: "done" };
    },
  };

  const result = await probeAgentCapability(provider, "good-model", undefined, {
    logger,
  });

  expect(result.conversation).toBe(true);
  expect(result.readTool).toBe(true);
  expect(result.multiTurnTools).toBe(true);
  expect(result.agenticCodingEligible).toBe(true);
  expect(result.agentCapabilityClass).toBe("coding_agent");
  expect(result.profile?.runtimeId).toBe("good");
  expect(result.profile?.editReliability.status).toBe("pass");
  expect(result.profile?.verificationBehavior.status).toBe("pass");
  expect(records.map((record) => record.event)).toEqual([
    "capability.probe.started",
    "capability.probe.finished",
  ]);
  expect(JSON.stringify(records)).not.toContain("Read the file demo.txt");
});

test("an eligible protocol model must also complete disposable edit and test iteration probes", async () => {
  let protocolCall = 0;
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("executable"),
    async *stream(request) {
      const user = [...request.messages]
        .reverse()
        .find((message) => message.role === "user")?.content;
      const last = request.messages.at(-1);
      const emitTool = (
        name: string,
        argumentsValue: Record<string, unknown>,
      ) => ({
        type: "tool.call" as const,
        call: {
          id: `probe-${name}-${request.messages.length}`,
          name,
          arguments: JSON.stringify(argumentsValue),
        },
      });

      if (user?.includes("CAPABILITY EDIT")) {
        if (last?.role === "user")
          yield emitTool("ReadFile", { path: "src/message.ts" });
        else if (
          last?.role === "tool" &&
          !last.content.includes('"replacements"')
        )
          yield emitTool("EditFile", {
            path: "src/message.ts",
            oldText: 'greeting = "hello"',
            newText: 'greeting = "hello world"',
          });
        else yield { type: "text.delta", text: "The edit is verified." };
      } else if (user?.includes("CAPABILITY TEST")) {
        const content = last?.role === "tool" ? last.content : "";
        if (last?.role === "user")
          yield emitTool("RunTests", { command: "bun test" });
        else if (
          content.includes("TEST_FAILED") ||
          content.includes('"exitCode":1')
        )
          yield emitTool("ReadFile", { path: "src/math.ts" });
        else if (content.includes("return a - b"))
          yield emitTool("EditFile", {
            path: "src/math.ts",
            oldText: "return a - b;",
            newText: "return a + b;",
          });
        else if (content.includes('"replacements"'))
          yield emitTool("RunTests", { command: "bun test" });
        else yield { type: "text.delta", text: "The tests are verified." };
      } else {
        protocolCall += 1;
        if (
          protocolCall === 1 ||
          protocolCall === 3 ||
          protocolCall === 5 ||
          protocolCall === 7
        )
          yield { type: "text.delta", text: "The protocol step is complete." };
        else if (protocolCall === 2)
          yield emitTool("ReadFile", { path: "demo.txt" });
        else if (protocolCall === 4)
          yield emitTool("EditFile", {
            path: "demo.txt",
            oldText: "hello",
            newText: "hello world",
          });
        else if (protocolCall === 8)
          yield emitTool("ListFiles", { path: "demo.txt" });
        else if (protocolCall === 9)
          yield emitTool("ReadFile", { path: "demo.txt" });
        else yield emitTool("RunTests", {});
      }
      yield { type: "done" };
    },
  };

  const result = await probeAgentCapability(
    provider,
    "executable-model",
    new AbortController().signal,
    { root: process.cwd() },
  );

  expect(result.execution?.editApplied).toBe(true);
  expect(result.execution?.testIteration).toBe(true);
  expect(result.agentCapabilityClass).toBe("advanced_coding_agent");
});

test("an inconclusive executable probe keeps protocol-capable models in the bounded coding tier", async () => {
  let call = 0;
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("protocol-only"),
    async *stream(request) {
      call += 1;
      const user = [...request.messages]
        .reverse()
        .find((message) => message.role === "user")?.content;
      if (user?.startsWith("CAPABILITY EDIT")) {
        yield {
          type: "text.delta",
          text: "I could not apply the disposable edit.",
        };
      } else if (user?.startsWith("CAPABILITY TEST")) {
        yield {
          type: "text.delta",
          text: "I could not complete the disposable test.",
        };
      } else if (call === 1) {
        yield { type: "text.delta", text: "Hi." };
      } else if (call === 2) {
        yield {
          type: "tool.call",
          call: {
            id: "read",
            name: "ReadFile",
            arguments: JSON.stringify({ path: "demo.txt" }),
          },
        };
      } else if (call === 3) {
        yield { type: "text.delta", text: "demo.txt contains hello." };
      } else if (call === 4) {
        yield {
          type: "tool.call",
          call: {
            id: "edit",
            name: "EditFile",
            arguments: JSON.stringify({
              path: "demo.txt",
              oldText: "hello",
              newText: "hello world",
            }),
          },
        };
      } else if (call === 5) {
        yield { type: "text.delta", text: "The edit is complete." };
      } else if (call === 6) {
        yield {
          type: "tool.call",
          call: {
            id: "tests",
            name: "RunTests",
            arguments: JSON.stringify({ command: "bun test" }),
          },
        };
      } else if (call === 7) {
        yield { type: "text.delta", text: "The test observation is complete." };
      } else if (call === 8) {
        yield {
          type: "tool.call",
          call: {
            id: "list",
            name: "ListFiles",
            arguments: JSON.stringify({ path: "demo.txt" }),
          },
        };
      } else if (call === 9) {
        yield {
          type: "tool.call",
          call: {
            id: "read-after-error",
            name: "ReadFile",
            arguments: JSON.stringify({ path: "demo.txt" }),
          },
        };
      } else {
        yield { type: "text.delta", text: "The probe is complete." };
      }
      yield { type: "done" };
    },
  };

  const result = await probeAgentCapability(
    provider,
    "protocol-only-model",
    new AbortController().signal,
    { root: process.cwd() },
  );

  expect(result.execution?.editApplied).toBe(false);
  expect(result.agenticCodingEligible).toBe(true);
  expect(result.agentCapabilityClass).toBe("coding_agent");
  expect(result.profile?.editReliability.status).toBe("fail");
});

test("textual JSON tool envelopes are measured through the same recovery path as the agent loop", async () => {
  let call = 0;
  const envelope = (name: string, args: Record<string, unknown>) =>
    "```json\n" + JSON.stringify({ name, arguments: args }, null, 2) + "\n```";
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("textual"),
    async *stream() {
      call += 1;
      if (call === 1) yield { type: "text.delta", text: "Hi!" };
      else if (call === 2)
        yield {
          type: "text.delta",
          text: envelope("ReadFile", { path: "demo.txt" }),
        };
      else if (call === 3)
        yield { type: "text.delta", text: "demo.txt contains hello." };
      else if (call === 4)
        yield {
          type: "text.delta",
          text: envelope("EditFile", {
            path: "demo.txt",
            oldText: "hello",
            newText: "hello world",
          }),
        };
      else if (call === 5)
        yield { type: "text.delta", text: "The edit is complete." };
      else if (call === 6)
        yield {
          type: "text.delta",
          text: envelope("RunTests", { command: "bun test" }),
        };
      else yield { type: "text.delta", text: "The tests completed." };
      yield { type: "done" };
    },
  };

  const result = await probeAgentCapability(provider, "textual-model");

  expect(result.conversation).toBe(true);
  expect(result.readTool).toBe(true);
  expect(result.multiTurnTools).toBe(true);
  expect(result.agenticCodingEligible).toBe(true);
  expect(result.agentCapabilityClass).toBe("coding_agent");
  expect(result.profile?.editReliability.status).toBe("pass");
  expect(result.profile?.verificationBehavior.status).toBe("pass");
});

test("capability probes measure recovery after a textual duplicate before rejecting multi-turn work", async () => {
  let call = 0;
  const envelope = (name: string, args: Record<string, unknown>) =>
    "<tools>\n" +
    JSON.stringify({ name, arguments: args }, null, 2) +
    "\n</tools>";
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("recovery"),
    async *stream(request) {
      call += 1;
      if (call === 1) yield { type: "text.delta", text: "Hi!" };
      else if (call === 2)
        yield {
          type: "text.delta",
          text: envelope("ReadFile", { path: "demo.txt" }),
        };
      else if (call === 3 && request.toolChoice === "auto")
        yield {
          type: "text.delta",
          text: envelope("ReadFile", { path: "demo.txt" }),
        };
      else if (call === 4 && request.toolChoice === "none")
        yield { type: "text.delta", text: "demo.txt contains hello." };
      else if (call === 5)
        yield {
          type: "tool.call",
          call: {
            id: "edit",
            name: "EditFile",
            arguments: JSON.stringify({
              path: "demo.txt",
              oldText: "hello",
              newText: "hello world",
            }),
          },
        };
      else if (call === 6 && request.toolChoice === "auto")
        yield {
          type: "tool.call",
          call: {
            id: "edit-repeat",
            name: "EditFile",
            arguments: JSON.stringify({
              path: "demo.txt",
              oldText: "hello",
              newText: "hello world",
            }),
          },
        };
      else if (call === 7 && request.toolChoice === "none")
        yield { type: "text.delta", text: "The edit is complete." };
      else if (call === 8)
        yield {
          type: "tool.call",
          call: {
            id: "test",
            name: "RunTests",
            arguments: JSON.stringify({ command: "bun test" }),
          },
        };
      else if (call === 9 && request.toolChoice === "auto")
        yield {
          type: "tool.call",
          call: {
            id: "test-repeat",
            name: "RunTests",
            arguments: JSON.stringify({ command: "bun test" }),
          },
        };
      else yield { type: "text.delta", text: "The tests are complete." };
      yield { type: "done" };
    },
  };

  const result = await probeAgentCapability(provider, "recovery-model");

  expect(result.conversation).toBe(true);
  expect(result.readTool).toBe(true);
  expect(result.multiTurnTools).toBe(true);
  expect(result.agenticCodingEligible).toBe(true);
  expect(result.agentCapabilityClass).toBe("coding_agent");
});

test("a model that calls tools during plain conversation fails the chat probe", async () => {
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("chatty-tooler"),
    async *stream() {
      yield {
        type: "tool.call",
        call: { id: "x", name: "ReadFile", arguments: "{}" },
      };
      yield { type: "done" };
    },
  };

  const result = await probeAgentCapability(provider, "chatty-tooler");

  expect(result.conversation).toBe(false);
  expect(result.agenticCodingEligible).toBe(false);
  expect(result.notes.join(" ")).toMatch(/tool call/i);
});

test("the plain-conversation probe does not advertise repository tools", async () => {
  const requests: Array<{ tools?: unknown[]; toolChoice?: unknown }> = [];
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("no-tool-advertising"),
    async *stream(request) {
      requests.push({ tools: request.tools, toolChoice: request.toolChoice });
      yield { type: "text.delta", text: "Probe response." };
      yield { type: "done" };
    },
  };

  await probeAgentCapability(provider, "no-tool-advertising");

  expect(requests[0]).toEqual({ tools: [], toolChoice: "none" });
});

test("a model that never calls the requested tool fails the read probe", async () => {
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("no-tools"),
    async *stream() {
      yield { type: "text.delta", text: "Sure, here's a summary." };
      yield { type: "done" };
    },
  };

  const result = await probeAgentCapability(provider, "no-tools");

  expect(result.conversation).toBe(true);
  expect(result.readTool).toBe(false);
  expect(result.agenticCodingEligible).toBe(false);
  expect(result.agentCapabilityClass).toBe("chat_only");
});

test("a model that repeats the tool call instead of continuing fails the multi-turn probe", async () => {
  // Turn 1 (chat probe): plain text — passes. Turn 2 (read probe): calls
  // ReadFile correctly — passes. Turn 3 (multi-turn continuation, after
  // seeing the tool result): calls ReadFile *again* instead of answering —
  // this is exactly the "stuck loop" failure mode the probe exists to catch.
  let call = 0;
  const stuckProvider: ProviderAdapter = {
    ...fakeHealthQuota("stuck"),
    async *stream() {
      call += 1;
      if (call === 1) {
        yield { type: "text.delta", text: "Hi there!" };
      } else {
        yield {
          type: "tool.call",
          call: {
            id: `again-${call}`,
            name: "ReadFile",
            arguments: JSON.stringify({ path: "demo.txt" }),
          },
        };
      }
      yield { type: "done" };
    },
  };

  const result = await probeAgentCapability(stuckProvider, "stuck");

  expect(result.readTool).toBe(true);
  expect(result.multiTurnTools).toBe(false);
  expect(result.agenticCodingEligible).toBe(false);
  expect(result.agentCapabilityClass).toBe("chat_only");
});

test("local model probing attaches evidence to the exact model candidate", async () => {
  const candidate: ModelCandidate = {
    id: "fake/good-model",
    providerId: "good",
    displayName: "good-model",
    source: "local",
    capabilities: {
      tools: true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
    },
    free: { status: "verified_free" },
    privacy: { classification: "local", retentionKnown: true },
    quality: { confidence: "unknown" },
    health: { state: "healthy" },
  };
  let call = 0;
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("good"),
    async *stream() {
      call += 1;
      if (call === 1) yield { type: "text.delta", text: "Hello" };
      else if (call === 2)
        yield {
          type: "tool.call",
          call: {
            id: "read",
            name: "ReadFile",
            arguments: JSON.stringify({ path: "demo.txt" }),
          },
        };
      else if (call === 3) yield { type: "text.delta", text: "hello probe" };
      else if (call === 4)
        yield {
          type: "tool.call",
          call: {
            id: "edit",
            name: "EditFile",
            arguments: JSON.stringify({
              path: "demo.txt",
              oldText: "hello",
              newText: "hello world",
            }),
          },
        };
      else if (call === 6)
        yield {
          type: "tool.call",
          call: { id: "test", name: "RunTests", arguments: "{}" },
        };
      else yield { type: "text.delta", text: "hello probe" };
      yield { type: "done" };
    },
  };

  const [result] = await probeLocalModelCapabilities(
    [candidate],
    [provider],
    new AbortController().signal,
    undefined,
    {
      hardware: {
        os: "test",
        platform: "win32",
        arch: "x64",
        cpuModel: "fixture CPU",
        cpuCores: 8,
        memoryGb: 16,
        accelerator: "fixture GPU",
      },
    },
  );

  expect(result?.agentProbe?.agentCapabilityClass).toBe("coding_agent");
  expect(result?.agentProbe?.agenticCodingEligible).toBe(true);
  expect(result?.agentProbe?.environment?.hardware?.cpuCores).toBe(8);
});

test("free-cloud probing is explicit and never probes local candidates", async () => {
  let calls = 0;
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("free-cloud"),
    async *stream() {
      calls += 1;
      if (calls === 1) yield { type: "text.delta", text: "Hello" };
      else if (calls === 2)
        yield {
          type: "tool.call",
          call: {
            id: "read",
            name: "ReadFile",
            arguments: JSON.stringify({ path: "demo.txt" }),
          },
        };
      else if (calls === 3) yield { type: "text.delta", text: "hello" };
      else if (calls === 4)
        yield {
          type: "tool.call",
          call: {
            id: "edit",
            name: "EditFile",
            arguments: JSON.stringify({
              path: "demo.txt",
              oldText: "hello",
              newText: "hello world",
            }),
          },
        };
      else if (calls === 6)
        yield {
          type: "tool.call",
          call: { id: "test", name: "RunTests", arguments: "{}" },
        };
      else yield { type: "text.delta", text: "Complete." };
      yield { type: "done" };
    },
  };
  const remoteCandidate: ModelCandidate = {
    id: "free-cloud/model",
    providerId: "free-cloud",
    modelId: "model",
    displayName: "Free model",
    source: "free_cloud",
    capabilities: {
      tools: true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
    },
    free: { status: "verified_free" },
    privacy: { classification: "zdr_capable", retentionKnown: true },
    quality: { confidence: "unknown" },
    health: { state: "healthy" },
  };
  const localCandidate: ModelCandidate = {
    ...remoteCandidate,
    id: "local/model",
    providerId: "local",
    displayName: "Local model",
    source: "local",
    privacy: { classification: "local", retentionKnown: true },
  };

  const [remote, local] = await probeFreeCloudModelCapabilities(
    [remoteCandidate, localCandidate],
    [provider],
    new AbortController().signal,
  );

  expect(remote?.agentProbe?.agentCapabilityClass).toBe("coding_agent");
  expect(local?.agentProbe).toBeUndefined();
  expect(calls).toBeGreaterThan(0);
});

test("capability probing sends the provider model id instead of the display label", async () => {
  const modelIds: string[] = [];
  const candidate: ModelCandidate = {
    id: "lm-studio/qwen-wire-id",
    providerId: "lm-studio",
    modelId: "qwen-wire-id",
    displayName: "Qwen Coder (human label)",
    source: "local",
    capabilities: {
      tools: true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
    },
    free: { status: "verified_free" },
    privacy: { classification: "local", retentionKnown: true },
    quality: { confidence: "unknown" },
    health: { state: "healthy" },
  };
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("lm-studio"),
    async *stream(request) {
      modelIds.push(request.modelId);
      yield { type: "text.delta", text: "Probe response." };
      yield { type: "done" };
    },
  };

  await probeLocalModelCapabilities(
    [candidate],
    [provider],
    new AbortController().signal,
  );

  expect(modelIds.length).toBeGreaterThan(0);
  expect(modelIds.every((modelId) => modelId === "qwen-wire-id")).toBe(true);
});

test("a failed local capability probe still records its reproducibility metadata", async () => {
  const candidate: ModelCandidate = {
    id: "lm-studio/unavailable-model",
    providerId: "lm-studio",
    modelId: "unavailable-model",
    displayName: "Unavailable Model",
    source: "local",
    capabilities: {
      tools: true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
      maxContext: 16_384,
    },
    free: { status: "verified_free" },
    privacy: { classification: "local", retentionKnown: true },
    quality: { confidence: "unknown" },
    health: { state: "healthy" },
    local: { runtime: "lm-studio", quant: "Q4_K_M" },
  };
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("lm-studio"),
    async *stream() {
      throw new Error("runtime unavailable");
    },
  };

  const [result] = await probeLocalModelCapabilities(
    [candidate],
    [provider],
    new AbortController().signal,
  );

  expect(result?.agentProbe?.agentCapabilityClass).toBe("chat_only");
  expect(result?.agentProbe?.probeVersion).toBe(AGENT_CAPABILITY_PROBE_VERSION);
  expect(result?.agentProbe?.environment).toEqual(
    expect.objectContaining({
      modelId: "unavailable-model",
      runtimeId: "lm-studio",
      quantization: "Q4_K_M",
      contextLength: 16_384,
    }),
  );
});

test("capability probes use deterministic generation settings", async () => {
  const temperatures: unknown[] = [];
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("deterministic"),
    async *stream(request) {
      temperatures.push(
        (request as unknown as { temperature?: unknown }).temperature,
      );
      yield { type: "text.delta", text: "The probe step is complete." };
      yield { type: "done" };
    },
  };

  const result = await probeAgentCapability(provider, "deterministic-model");

  expect(temperatures.length).toBeGreaterThan(0);
  expect(temperatures.every((temperature) => temperature === 0)).toBe(true);
  expect(result.environment).toEqual(
    expect.objectContaining({
      modelId: "deterministic-model",
      runtimeId: "deterministic",
      task: "capability-probe",
      generation: { temperature: 0, maxOutputTokens: 512 },
    }),
  );
});

test("capability-aware probes do not claim executable success when the protocol gate skips it", async () => {
  let call = 0;
  const provider: ProviderAdapter = {
    ...fakeHealthQuota("protocol-gate"),
    async *stream() {
      call += 1;
      if (call === 1 || call === 2) {
        yield {
          type: "tool.call",
          call: {
            id: `read-${call}`,
            name: "ReadFile",
            arguments: JSON.stringify({ path: "demo.txt" }),
          },
        };
      } else if (call === 3) {
        yield { type: "text.delta", text: "The file contains hello." };
      } else if (call === 4) {
        yield {
          type: "tool.call",
          call: {
            id: "edit",
            name: "EditFile",
            arguments: JSON.stringify({
              path: "demo.txt",
              oldText: "hello",
              newText: "hello world",
            }),
          },
        };
      } else if (call === 5) {
        yield { type: "text.delta", text: "The edit is complete." };
      } else if (call === 6) {
        yield {
          type: "tool.call",
          call: {
            id: "test",
            name: "RunTests",
            arguments: JSON.stringify({ command: "bun test" }),
          },
        };
      } else if (call === 8) {
        yield {
          type: "tool.call",
          call: {
            id: "list-error-path",
            name: "ListFiles",
            arguments: JSON.stringify({ path: "demo.txt" }),
          },
        };
      } else if (call === 9) {
        yield {
          type: "tool.call",
          call: {
            id: "read-after-error",
            name: "ReadFile",
            arguments: JSON.stringify({ path: "demo.txt" }),
          },
        };
      } else {
        yield { type: "text.delta", text: "The tests are complete." };
      }
      yield { type: "done" };
    },
  };

  const result = await probeAgentCapability(
    provider,
    "protocol-gated-model",
    new AbortController().signal,
    { root: process.cwd() },
  );

  expect(result.execution).toBeUndefined();
  expect(result.profile?.errorRecovery.status).toBe("pass");
  expect(result.profile?.editReliability.status).toBe("fail");
  expect(result.profile?.verificationBehavior.status).toBe("fail");
});
