import { expect, test } from "bun:test";
import { recoverTextToolCalls } from "../../src/agent/tool-envelope.js";

test("recovers the LM Studio Qwen <tools> envelope", () => {
  const calls = recoverTextToolCalls(
    '<tools>\n{"name":"ReadFile","arguments":{"path":"demo.txt"}}\n</tools>',
    2,
  );

  expect(calls).toEqual([
    {
      id: "recovered-2-1",
      name: "ReadFile",
      arguments: '{"path":"demo.txt"}',
    },
  ]);
});

test("recovers the LM Studio Qwen <response> envelope", () => {
  const calls = recoverTextToolCalls(
    '<response>\n{"name":"ReadFile","arguments":{"path":"demo.txt"}}\n</response>',
    3,
  );

  expect(calls).toEqual([
    {
      id: "recovered-3-1",
      name: "ReadFile",
      arguments: '{"path":"demo.txt"}',
    },
  ]);
});

test("recovers XML-wrapped LM Studio tool envelopes", () => {
  const calls = recoverTextToolCalls(
    '```xml\n<response>\n{"name":"EditFile","arguments":{"path":"demo.txt","oldText":"hello","newText":"hello world"}}\n</response>\n```',
    4,
  );

  expect(calls).toEqual([
    {
      id: "recovered-4-1",
      name: "EditFile",
      arguments:
        '{"path":"demo.txt","oldText":"hello","newText":"hello world"}',
    },
  ]);
});

test("recovers the first fenced tool envelope embedded in model prose", () => {
  const calls = recoverTextToolCalls(
    "I will inspect the workspace first.\n\n```json\n" +
      '{"name":"ListFiles","arguments":{}}' +
      "\n```\n\nThen I will search for the relevant symbol.",
    5,
  );

  expect(calls).toEqual([
    {
      id: "recovered-5-1",
      name: "ListFiles",
      arguments: "{}",
    },
  ]);
});

test("recovers LM Studio default lowercase tool_request envelopes", () => {
  const calls = recoverTextToolCalls(
    '<tool_request>\n{"name":"ReadFile","arguments":{"path":"demo.txt"}}\n</tool_request>',
    6,
  );

  expect(calls).toEqual([
    {
      id: "recovered-6-1",
      name: "ReadFile",
      arguments: '{"path":"demo.txt"}',
    },
  ]);
});
