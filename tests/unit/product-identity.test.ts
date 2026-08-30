import { describe, expect, test } from "bun:test";
import {
  CLI_NAME,
  LEGACY_PRODUCT_STATE_DIR_NAME,
  PRODUCT_NAME,
  PRODUCT_STATE_DIR_NAME,
  readProductEnv,
} from "../../src/product/identity.js";

describe("ShelraCode product identity", () => {
  test("uses ShelraCode and shelra as the canonical product and CLI", () => {
    expect(PRODUCT_NAME).toBe("ShelraCode");
    expect(CLI_NAME).toBe("shelra");
    expect(PRODUCT_STATE_DIR_NAME).toBe(".shelracode");
    expect(LEGACY_PRODUCT_STATE_DIR_NAME).toBe(".localcode");
  });

  test("canonical environment values take precedence over legacy values", () => {
    expect(
      readProductEnv(
        {
          SHELRACODE_ROUTING_MODE: "strict-zero",
          LOCALCODE_ROUTING_MODE: "ask-before-paid",
        },
        "ROUTING_MODE",
      ),
    ).toBe("strict-zero");
  });

  test("legacy environment values remain a read-only migration fallback", () => {
    expect(
      readProductEnv(
        { LOCALCODE_STATE_DIR: "C:\\legacy-state" },
        "STATE_DIR",
      ),
    ).toBe("C:\\legacy-state");
  });
});
