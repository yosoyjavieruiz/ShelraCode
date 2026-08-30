import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalCodeDatabase } from "../../src/storage/database.js";
import {
  createExactModelIdentity,
  createUncalibratedDriverProfile,
  driverProfileCanWrite,
  exactModelIdentityDigest,
  parseModelDriverProfile,
  type ModelDriverProfile,
} from "../../src/driver/profile.js";

function identity() {
  return createExactModelIdentity({
    providerFamily: "lm-studio",
    modelId: "qwen2.5-coder-7b-instruct",
    artifactId: "qwen2.5-coder-7b-instruct@Q6_K",
    runtime: "lm-studio",
    endpointProtocol: "openai-compatible",
    quantization: "Q6_K",
    contextConfiguration: {
      loadedContextTokens: 16_384,
      catalogMaxTokens: 32_768,
    },
    samplingConfiguration: {
      temperature: 0,
      maxOutputTokens: 512,
    },
    operatingSystem: "win32 10.0.26200",
    hardwareFingerprint: "fixture-hardware",
    createdAt: "2026-08-28T20:00:00.000Z",
  });
}

function certifiedProfile(): ModelDriverProfile {
  const base = createUncalibratedDriverProfile(identity());
  return {
    ...base,
    status: "certified",
    capabilityLevel: "C2",
    protocol: "constrained_json",
    editCodec: "structured_patch",
    maxCertifiedToolSurface: 4,
    preferredToolStages: [["repo.search", "repo.read"], ["edit.apply"]],
    contextBudget: { minimum: 2_048, preferred: 8_192, maximum: 16_384 },
    outputBudget: 512,
    reasoning: { mode: "off", budget: null },
    maxCertifiedActionHorizon: 2,
    recoveryPolicyId: "bounded-reencode-v1",
    writeAuthority: "bounded",
    networkAuthority: "none",
    benchmarkEvidence: [{ id: "eval:fixture:001", digest: "evidence-digest" }],
  };
}

test("exact identity digest changes on material configuration and ignores observation time", () => {
  const first = identity();
  const sameConfiguration = { ...first, createdAt: "2026-08-28T21:00:00.000Z" };
  const changedQuantization = { ...first, quantization: "Q4_K_M" };
  const changedRuntime = { ...first, runtimeVersion: "0.3.20" };

  expect(exactModelIdentityDigest(first)).toBe(
    exactModelIdentityDigest(sameConfiguration),
  );
  expect(exactModelIdentityDigest(first)).not.toBe(
    exactModelIdentityDigest(changedQuantization),
  );
  expect(exactModelIdentityDigest(first)).not.toBe(
    exactModelIdentityDigest(changedRuntime),
  );

  const changedVariants = [
    { ...first, artifactId: "other-artifact" },
    { ...first, artifactSha256: "a".repeat(64) },
    { ...first, parameterClass: "14B" },
    { ...first, endpointProtocol: "ollama_chat" },
    { ...first, chatTemplate: "chat-template-v2" },
    { ...first, toolTemplate: "tool-template-v2" },
    { ...first, structuredOutputMode: "json-schema" },
    { ...first, reasoningMode: "runtime-native" },
    { ...first, tokenizerId: "tokenizer-v2" },
    {
      ...first,
      contextConfiguration: { ...first.contextConfiguration, parallel: 2 },
    },
    {
      ...first,
      samplingConfiguration: {
        ...first.samplingConfiguration,
        temperature: 0.2,
      },
    },
    { ...first, operatingSystem: "linux 6.8" },
    { ...first, hardwareFingerprint: "other-hardware" },
  ];
  for (const changed of changedVariants)
    expect(exactModelIdentityDigest(first)).not.toBe(
      exactModelIdentityDigest(changed),
    );
});

test("uncalibrated profiles are explicit and have no write or network authority", () => {
  const profile = createUncalibratedDriverProfile(identity());

  expect(profile.status).toBe("uncalibrated");
  expect(profile.capabilityLevel).toBe("C0");
  expect(profile.protocol).toBe("unselected");
  expect(profile.editCodec).toBe("unselected");
  expect(profile.writeAuthority).toBe("none");
  expect(profile.networkAuthority).toBe("none");
  expect(driverProfileCanWrite(profile, identity())).toBe(false);
});

test("profile parser rejects an uncalibrated profile that smuggles write authority", () => {
  const profile = createUncalibratedDriverProfile(identity());
  const parsed = parseModelDriverProfile({
    ...profile,
    writeAuthority: "bounded",
  });

  expect(parsed.ok).toBe(false);
});

test("profile parser requires every explicit identity unknown and reasoning budget field", () => {
  const profile = createUncalibratedDriverProfile(identity());
  const missingBudget = {
    ...profile,
    reasoning: { mode: profile.reasoning.mode },
  };

  const nullableFields = [
    "artifactId",
    "artifactSha256",
    "parameterClass",
    "quantization",
    "runtimeVersion",
    "chatTemplate",
    "toolTemplate",
    "structuredOutputMode",
    "reasoningMode",
    "tokenizerId",
    "hardwareFingerprint",
  ] as const;
  for (const field of nullableFields) {
    const missingIdentityField = {
      ...profile,
      identity: { ...profile.identity } as Record<string, unknown>,
    };
    delete missingIdentityField.identity[field];
    expect(parseModelDriverProfile(missingIdentityField).ok).toBe(false);
  }
  expect(parseModelDriverProfile(missingBudget).ok).toBe(false);
});

test("driver profile persistence migrates, matches exact identity, and invalidates changed identity", () => {
  const storage = new LocalCodeDatabase(":memory:");
  const profile = certifiedProfile();
  const current = identity();
  const changed = { ...current, toolTemplate: "xml-v2" };

  expect(storage.schemaVersion()).toBe(5);
  storage.saveModelDriverProfile(profile);

  expect(storage.getModelDriverProfile(profile.id)).toEqual(profile);
  expect(storage.getModelDriverProfileForIdentity(current)).toEqual(profile);
  expect(storage.getModelDriverProfileForIdentity(changed)).toBeUndefined();

  const invalidated = storage.getModelDriverProfile(profile.id);
  expect(invalidated?.status).toBe("invalidated");
  expect(invalidated?.writeAuthority).toBe("none");
  expect(invalidated?.networkAuthority).toBe("none");
  expect(driverProfileCanWrite(invalidated, current)).toBe(false);
  storage.close();
});

test("changing quantization or runtime cannot reuse a certified profile", () => {
  const storage = new LocalCodeDatabase(":memory:");
  const profile = certifiedProfile();
  const current = identity();
  storage.saveModelDriverProfile(profile);

  expect(
    storage.getModelDriverProfileForIdentity({
      ...current,
      quantization: "Q4_K_M",
    }),
  ).toBeUndefined();
  expect(storage.getModelDriverProfile(profile.id)?.status).toBe("invalidated");

  const second = certifiedProfile();
  storage.saveModelDriverProfile(second);
  expect(
    storage.getModelDriverProfileForIdentity({
      ...current,
      runtime: "ollama",
    }),
  ).toBeUndefined();
  expect(storage.getModelDriverProfile(second.id)?.status).toBe("invalidated");
  storage.close();
});

test("profile persistence keeps unavailable identity dimensions explicit", () => {
  const storage = new LocalCodeDatabase(":memory:");
  const profile = createUncalibratedDriverProfile(identity());
  storage.saveModelDriverProfile(profile);

  const stored = storage.getModelDriverProfile(profile.id);
  expect(stored?.identity.artifactSha256).toBeNull();
  expect(stored?.identity.runtimeVersion).toBeNull();
  expect(stored?.identity.chatTemplate).toBeNull();
  storage.close();
});

test("driver profile migration preserves a certified profile across database reopen", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shelra-driver-db-"));
  const filename = path.join(directory, "state.sqlite");
  const profile = certifiedProfile();

  try {
    const first = new LocalCodeDatabase(filename);
    first.saveModelDriverProfile(profile);
    first.close();

    const reopened = new LocalCodeDatabase(filename);
    expect(reopened.schemaVersion()).toBe(5);
    expect(reopened.getModelDriverProfile(profile.id)).toEqual(profile);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("schema version 4 databases migrate before profile persistence is used", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shelra-driver-v4-"));
  const filename = path.join(directory, "state.sqlite");
  const profile = certifiedProfile();

  try {
    const legacy = new Database(filename, { create: true, strict: true });
    legacy.run(
      "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    legacy
      .query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      )
      .run(4, "2026-08-28T00:00:00.000Z");
    legacy.close();

    const storage = new LocalCodeDatabase(filename);
    expect(storage.schemaVersion()).toBe(5);
    storage.saveModelDriverProfile(profile);
    expect(storage.getModelDriverProfile(profile.id)).toEqual(profile);
    storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("malformed persisted profiles fail closed on every read path", () => {
  const storage = new LocalCodeDatabase(":memory:");
  storage.db
    .query(
      `INSERT INTO model_driver_profiles
        (profile_id, identity_digest, profile_json, status, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      "corrupt-profile",
      "not-a-digest",
      "{not-json",
      "certified",
      "2026-08-28T00:00:00.000Z",
    );

  expect(storage.getModelDriverProfile("corrupt-profile")).toBeUndefined();
  expect(storage.getModelDriverProfileForIdentity(identity())).toBeUndefined();
  expect(storage.listModelDriverProfiles()).toEqual([]);
  storage.close();
});
