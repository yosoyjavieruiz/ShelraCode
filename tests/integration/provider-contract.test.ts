import { describe, expect, test } from "bun:test";
import { GenericOpenAICompatibleProvider } from "../../src/providers/openai-compatible.js";
import type { FetchLike, ProviderEvent } from "../../src/providers/types.js";
import { createLogger, type LogRecord } from "../../src/shared/logging.js";

function provider(
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  logger?: ReturnType<typeof createLogger>,
) {
  return new GenericOpenAICompatibleProvider({
    id: "fake",
    displayName: "Fake provider",
    baseUrl: "https://fake.test/v1",
    source: "free_cloud",
    freeStatus: {
      status: "verified_free",
      verifiedAt: "2026-08-23T18:00:00.000Z",
      expiresAt: "2026-08-24T18:00:00.000Z",
    },
    privacy: {
      classification: "zdr_capable",
      retentionKnown: true,
      zdrAvailable: true,
      trainsOnInputs: false,
    },
    fetchImpl,
    logger,
  });
}

describe("OpenAI-compatible provider contract", () => {
  test("normalizes model discovery and health", async () => {
    const fakeFetch: FetchLike = async (input) => {
      expect(String(input)).toContain("/models");
      return new Response(
        JSON.stringify({
          data: [
            { id: "fake-coder", context_length: 32_000 },
            { id: "fake-chat", context_length: 8_000 },
          ],
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-ratelimit-limit-requests": "100",
            "x-ratelimit-remaining-requests": "84",
          },
        },
      );
    };
    const adapter = provider(fakeFetch);

    const models = await adapter.discoverModels(new AbortController().signal);
    const health = await adapter.health(new AbortController().signal);

    expect(models[0]?.id).toBe("fake/fake-coder");
    expect(models[0]?.capabilities.maxContext).toBe(32_000);
    expect(health.state).toBe("healthy");
  });

  test("normalizes streamed text, tool calls, usage and completion", async () => {
    const fakeFetch: FetchLike = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { stream?: boolean };
      expect(body.stream).toBe(true);
      return new Response(
        [
          'data: {"choices":[{"delta":{"content":"hello"}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"ReadFile","arguments":"{\\"path\\":"}}]}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.ts\\\"}"}}]}}]}',
          'data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
    const events: ProviderEvent[] = [];
    for await (const event of provider(fakeFetch).stream(
      {
        modelId: "fake-coder",
        messages: [{ role: "user", content: "read a.ts" }],
        stream: true,
      },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual(
      expect.arrayContaining([
        { type: "text.delta", text: "hello" },
        {
          type: "tool.call",
          call: expect.objectContaining({
            id: "call-1",
            name: "ReadFile",
            arguments: '{"path":"a.ts"}',
          }),
        },
        {
          type: "usage",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
        { type: "done" },
      ]),
    );
  });

  test("normalizes object-valued tool arguments instead of dropping the call", async () => {
    const fakeFetch: FetchLike = async () =>
      new Response(
        [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-object","type":"function","function":{"name":"ReadFile","arguments":{"path":"a.ts"}}}]},"finish_reason":"tool_calls"}]}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    const events: ProviderEvent[] = [];
    for await (const event of provider(fakeFetch).stream(
      {
        modelId: "fake-coder",
        messages: [{ role: "user", content: "read a.ts" }],
        stream: true,
      },
      new AbortController().signal,
    ))
      events.push(event);

    expect(events).toEqual(
      expect.arrayContaining([
        {
          type: "tool.call",
          call: {
            id: "call-object",
            name: "ReadFile",
            arguments: '{"path":"a.ts"}',
          },
        },
      ]),
    );
  });

  test("quarantines textual tool envelopes at the provider boundary", async () => {
    const fakeFetch: FetchLike = async () =>
      new Response(
        [
          'data: {"choices":[{"delta":{"content":"<tools>\\n"}}]}',
          'data: {"choices":[{"delta":{"content":"{\\"name\\":\\"ReadFile\\",\\"arguments\\":{\\"path\\":\\"a.ts\\"}}"}}]}',
          'data: {"choices":[{"delta":{"content":"\\n</tools>"}}]}',
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    const events: ProviderEvent[] = [];
    for await (const event of provider(fakeFetch).stream(
      {
        modelId: "fake-coder",
        messages: [{ role: "user", content: "read a.ts" }],
        stream: true,
      },
      new AbortController().signal,
    ))
      events.push(event);

    expect(events.some((event) => event.type === "text.delta")).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([
        {
          type: "tool.call",
          call: {
            id: "recovered-0-1",
            name: "ReadFile",
            arguments: '{"path":"a.ts"}',
          },
        },
      ]),
    );
  });

  test("serializes assistant tool calls before matching tool results", async () => {
    let requestBody: unknown;
    const fakeFetch: FetchLike = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as unknown;
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    for await (const _event of provider(fakeFetch).stream(
      {
        modelId: "fake-coder",
        messages: [
          { role: "user", content: "read package.json" },
          {
            role: "assistant",
            content: "",
            toolCalls: [
              {
                id: "call-1",
                name: "ReadFile",
                arguments: '{"path":"package.json"}',
              },
            ],
          },
          {
            role: "tool",
            toolCallId: "call-1",
            content: '{"ok":true}',
          },
        ],
        stream: true,
      },
      new AbortController().signal,
    )) {
      // Consume the stream so request serialization completes.
    }

    expect(requestBody).toEqual(
      expect.objectContaining({
        messages: [
          { role: "user", content: "read package.json" },
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "ReadFile",
                  arguments: '{"path":"package.json"}',
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call-1",
            content: '{"ok":true}',
          },
        ],
      }),
    );
  });

  test("sends tool_choice alongside tools, omits both without tools, and forwards the output cap", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fakeFetch: FetchLike = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response("data: [DONE]\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };
    const adapter = provider(fakeFetch);

    for await (const _event of adapter.stream(
      {
        modelId: "fake-coder",
        messages: [{ role: "user", content: "read package.json" }],
        tools: [{ type: "function", function: { name: "ReadFile" } }],
        toolChoice: "auto",
        temperature: 0.1,
        maxOutputTokens: 64,
        stream: true,
      },
      new AbortController().signal,
    )) {
      // drain
    }
    for await (const _event of adapter.stream(
      {
        modelId: "fake-coder",
        messages: [{ role: "user", content: "Hola" }],
        stream: true,
      },
      new AbortController().signal,
    )) {
      // drain
    }

    expect(bodies[0]?.tool_choice).toBe("auto");
    expect(bodies[0]?.temperature).toBe(0.1);
    expect(bodies[0]?.max_tokens).toBe(64);
    expect(bodies[0]?.tools).toEqual([
      { type: "function", function: { name: "ReadFile" } },
    ]);
    expect(bodies[1]).not.toHaveProperty("tools");
    expect(bodies[1]).not.toHaveProperty("tool_choice");
  });

  test("provider logs request and stream lifecycle without logging message content", async () => {
    const logs: LogRecord[] = [];
    const logger = createLogger({
      level: "debug",
      sink: { write: (record) => logs.push(record) },
    });
    const adapter = provider(
      async (_input, _init) =>
        new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      logger,
    );

    for await (const _event of adapter.stream(
      {
        modelId: "fake-coder",
        messages: [{ role: "user", content: "private prompt content" }],
        stream: true,
      },
      new AbortController().signal,
    )) {
      // drain
    }

    expect(logs.map((record) => record.event)).toEqual(
      expect.arrayContaining([
        "provider.request.started",
        "provider.response.received",
        "provider.stream.completed",
      ]),
    );
    const rendered = JSON.stringify(logs);
    expect(rendered).not.toContain("private prompt content");
    expect(logs.every((record) => record.context?.providerId === "fake")).toBe(
      true,
    );
  });

  test("maps quota and billing failures into domain failures", async () => {
    const fakeFetch: FetchLike = async () =>
      new Response(JSON.stringify({ error: { message: "payment required" } }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    const result = await provider(fakeFetch).health(
      new AbortController().signal,
    );

    expect(result.state).toBe("down");
    expect(result.failure?.code).toBe("PAID_PLAN_REQUIRED");
  });

  test("normalizes authentication, quota, capacity, timeout and malformed responses", async () => {
    const adapter = provider();
    expect(
      adapter.classifyError({ status: 401, message: "unauthorized" }).code,
    ).toBe("AUTH_MISSING");
    expect(
      adapter.classifyError({ status: 403, message: "forbidden" }).code,
    ).toBe("AUTH_INVALID");
    expect(
      adapter.classifyError({ status: 429, message: "daily quota exhausted" })
        .code,
    ).toBe("DAILY_QUOTA_EXHAUSTED");
    expect(
      adapter.classifyError({ status: 429, message: "free tier exhausted" })
        .code,
    ).toBe("FREE_TIER_EXHAUSTED");
    expect(
      adapter.classifyError({ status: 500, message: "capacity" }).code,
    ).toBe("CAPACITY");
    expect(
      adapter.classifyError(new DOMException("cancelled", "AbortError")).code,
    ).toBe("CANCELLED");

    const malformed = new GenericOpenAICompatibleProvider({
      id: "malformed",
      displayName: "Malformed",
      baseUrl: "https://fake.test/v1",
      source: "free_cloud",
      freeStatus: {
        status: "verified_free",
        verifiedAt: "2026-08-23T18:00:00.000Z",
        expiresAt: "2026-08-24T18:00:00.000Z",
      },
      privacy: {
        classification: "zdr_capable",
        retentionKnown: true,
        trainsOnInputs: false,
      },
      fetchImpl: async () =>
        new Response("data: {not-json}\n\n", { status: 200 }),
    });
    const events = [];
    for await (const event of malformed.stream(
      { modelId: "x", messages: [], stream: true },
      new AbortController().signal,
    ))
      events.push(event);
    expect(
      events.some(
        (event) => event.type === "error" && event.error.code === "BAD_REQUEST",
      ),
    ).toBe(true);
  });
});
