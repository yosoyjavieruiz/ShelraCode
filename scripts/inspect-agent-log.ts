import { readFileSync } from "node:fs";
import path from "node:path";
import {
  parseLogLines,
  summarizeLogRecords,
} from "../src/shared/log-report.js";

const logPath = process.argv[2];
if (!logPath) {
  console.error("Usage: bun run logs:inspect -- <path-to-jsonl>");
  process.exitCode = 1;
} else {
  try {
    const parsed = parseLogLines(readFileSync(logPath, "utf8"));
    const summary = summarizeLogRecords(parsed.records);
    const events = Object.entries(summary.byEvent).sort(
      ([, left], [, right]) => right - left,
    );

    console.log("ShelraCode agent log report");
    console.log(`File: ${path.resolve(logPath)}`);
    console.log(`Records: ${summary.totalRecords}`);
    console.log(`Malformed lines: ${parsed.malformedLines}`);
    console.log(
      `Time: ${summary.firstTimestamp ?? "n/a"} -> ${summary.lastTimestamp ?? "n/a"}`,
    );
    console.log(
      `Levels: debug=${summary.byLevel.debug} info=${summary.byLevel.info} warn=${summary.byLevel.warn} error=${summary.byLevel.error}`,
    );
    console.log(`Tasks: ${summary.taskIds.join(", ") || "none"}`);
    console.log(`Errors: ${summary.failureEvents.join(", ") || "none"}`);
    console.log(`Warnings: ${summary.warningEvents.join(", ") || "none"}`);
    console.log("Events:");
    for (const [event, count] of events) console.log(`  ${count}  ${event}`);
  } catch (error) {
    console.error(
      `Could not read log file: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  }
}
