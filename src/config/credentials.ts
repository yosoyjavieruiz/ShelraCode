export interface CredentialStore {
  get(provider: string): Promise<string | undefined>;
}

export class EnvironmentCredentialStore implements CredentialStore {
  constructor(
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  async get(provider: string): Promise<string | undefined> {
    const key = providerEnvKey(provider);
    const value = this.env[key];
    return value?.trim() || undefined;
  }
}

export function providerEnvKey(provider: string): string {
  const normalized = provider
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_");
  return `${normalized.toUpperCase()}_API_KEY`;
}

export function envBoolean(
  env: Record<string, string | undefined>,
  key: string,
): boolean {
  return ["1", "true", "yes", "on"].includes(
    (env[key] ?? "").trim().toLowerCase(),
  );
}
