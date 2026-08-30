export const PRODUCT_NAME = "ShelraCode" as const;
export const CLI_NAME = "shelra" as const;
export const PRODUCT_STATE_DIR_NAME = ".shelracode" as const;
export const LEGACY_PRODUCT_STATE_DIR_NAME = ".localcode" as const;

/**
 * Reads the canonical ShelraCode environment variable and accepts the former
 * prefix only as a read-only migration input for existing installations.
 */
export function readProductEnv(
  env: Record<string, string | undefined>,
  suffix: string,
): string | undefined {
  const canonical = env[`SHELRACODE_${suffix}`]?.trim();
  if (canonical) return canonical;
  const legacy = env[`LOCALCODE_${suffix}`]?.trim();
  return legacy || undefined;
}
