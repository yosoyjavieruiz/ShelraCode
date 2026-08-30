import { describe, expect, test } from "bun:test";
import { cliUsage, parseCliArgs } from "../../src/cli/args.js";
import { defaultTuiScreen } from "../../src/cli/startup.js";

describe("ShelraCode CLI", () => {
  test("parses the default interactive command", () => {
    expect(parseCliArgs([])).toEqual({ command: "tui", args: [] });
    expect(defaultTuiScreen()).toBe("conversation");
  });

  test("parses supported subcommands and flags", () => {
    expect(parseCliArgs(["setup"])).toEqual({ command: "setup", args: [] });
    expect(parseCliArgs(["doctor"])).toEqual({ command: "doctor", args: [] });
    expect(parseCliArgs(["--tui"])).toEqual({ command: "tui", args: [] });
  });

  test("returns help and version as explicit commands", () => {
    expect(parseCliArgs(["--help"])).toEqual({ command: "help", args: [] });
    expect(parseCliArgs(["-v"])).toEqual({ command: "version", args: [] });
    expect(cliUsage).toContain("ShelraCode");
    expect(cliUsage).not.toContain("LocalCode");
  });

  test("rejects unknown commands with a stable error", () => {
    expect(() => parseCliArgs(["unknown"])).toThrow("Unknown command: unknown");
  });
});
