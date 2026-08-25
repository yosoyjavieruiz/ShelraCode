import { expect, test } from "bun:test";
import {
  groupTranscriptMessages,
  type TranscriptMessage,
} from "../../src/tui/state/conversation.js";

test("groups consecutive tool activity into one expandable block", () => {
  const messages: TranscriptMessage[] = [
    { role: "user", text: "Inspect the auth flow" },
    { role: "tool", text: "read", detail: "src/auth.ts", status: "info" },
    { role: "tool", text: "search", detail: "refreshToken", status: "success" },
    { role: "assistant", text: "The token is refreshed twice." },
  ];

  const blocks = groupTranscriptMessages(messages);
  expect(blocks).toHaveLength(3);
  expect(blocks[1]?.kind).toBe("activity");
  expect(blocks[1]?.messages).toHaveLength(2);
});
