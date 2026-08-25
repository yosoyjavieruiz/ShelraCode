export type TranscriptRole =
  "user" | "assistant" | "event" | "tool" | "route" | "error";

export type TranscriptStatus =
  "success" | "warning" | "danger" | "info" | "muted";

export interface TranscriptMessage {
  role: TranscriptRole;
  text: string;
  detail?: string;
  status?: TranscriptStatus;
}

export interface TranscriptBlock {
  kind: "message" | "activity";
  messages: TranscriptMessage[];
}

export function groupTranscriptMessages(
  messages: readonly TranscriptMessage[],
): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  for (const message of messages) {
    const previous = blocks.at(-1);
    if (message.role === "tool" && previous?.kind === "activity") {
      previous.messages.push(message);
      continue;
    }
    blocks.push({
      kind: message.role === "tool" ? "activity" : "message",
      messages: [message],
    });
  }
  return blocks;
}
