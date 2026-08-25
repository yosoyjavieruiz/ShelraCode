import { describe, expect, test } from "bun:test";
import { prepareInteractiveTerminal } from "../../src/tui/terminal.js";

describe("interactive terminal preparation", () => {
  test("normalizes dumb Windows terminals for OpenTUI", () => {
    const env: Record<string, string | undefined> = { TERM: "dumb" };

    prepareInteractiveTerminal({
      env,
      platform: "win32",
      isInteractive: true,
    });

    expect(env.TERM).toBe("xterm-256color");
  });

  test("fills in a missing Windows terminal type", () => {
    const env: Record<string, string | undefined> = {};

    prepareInteractiveTerminal({
      env,
      platform: "win32",
      isInteractive: true,
    });

    expect(env.TERM).toBe("xterm-256color");
  });

  test("does not change an explicit terminal type", () => {
    const env: Record<string, string | undefined> = {
      TERM: "xterm-256color",
    };

    prepareInteractiveTerminal({
      env,
      platform: "win32",
      isInteractive: true,
    });

    expect(env.TERM).toBe("xterm-256color");
  });

  test("does not rewrite TERM on other platforms", () => {
    const env: Record<string, string | undefined> = { TERM: "dumb" };

    prepareInteractiveTerminal({
      env,
      platform: "linux",
      isInteractive: true,
    });

    expect(env.TERM).toBe("dumb");
  });

  test("fails clearly when no interactive terminal is available", () => {
    expect(() =>
      prepareInteractiveTerminal({
        env: {},
        platform: "win32",
        isInteractive: false,
      }),
    ).toThrow("requires an interactive terminal");
  });
});
