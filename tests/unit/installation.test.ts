import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import os from "node:os";
import path from "node:path";
import {
  installExecutable,
  mergePathEntries,
} from "../../src/cli/installation.js";

test("mergePathEntries is idempotent and case-insensitive", () => {
  const entry = "C:\\Users\\Javie\\.shelra\\bin";
  const existing = `C:\\Tools${path.delimiter}${entry}\\`;
  const merged = mergePathEntries(existing, entry);
  expect(merged.split(path.delimiter)).toHaveLength(2);
  expect(path.normalize(merged.split(path.delimiter)[1] ?? "")).toBe(
    path.normalize(`${entry}\\`),
  );
  expect(mergePathEntries("C:\\Tools", entry)).toBe(
    `C:\\Tools${path.delimiter}${entry}`,
  );
});

test("installExecutable atomically activates a version and keeps the previous one", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-installation-"));
  const profile = path.join(root, "profile");
  const installDir = path.join(profile, ".shelra", "bin");
  const sourceOne = path.join(root, "shelra-one.exe");
  const sourceTwo = path.join(root, "shelra-two.exe");
  const firstBytes = Buffer.from([0x4d, 0x5a, 0x01]);
  const secondBytes = Buffer.from([0x4d, 0x5a, 0x02]);

  try {
    await writeFile(sourceOne, firstBytes);
    await writeFile(sourceTwo, secondBytes);

    const first = await installExecutable({
      sourcePath: sourceOne,
      version: "0.1.0",
      platform: "win32",
      architecture: "x64",
      installDir,
      environment: { USERPROFILE: profile, Path: "C:\\Windows" },
      persistUserPath: false,
      now: new Date("2026-08-26T12:00:00.000Z"),
    });

    expect(await readFile(first.paths.executablePath)).toEqual(firstBytes);
    expect(await readFile(first.paths.compatibilityShimPath, "utf8")).toContain(
      '"%~dp0shelra.exe" %*',
    );
    expect(
      JSON.parse(await readFile(first.paths.manifestPath, "utf8")),
    ).toMatchObject({
      product: "ShelraCode",
      command: "shelra",
      version: "0.1.0",
      executable: "shelra.exe",
    });

    const second = await installExecutable({
      sourcePath: sourceTwo,
      version: "0.1.1",
      platform: "win32",
      architecture: "x64",
      installDir,
      environment: { USERPROFILE: profile, Path: "C:\\Windows" },
      persistUserPath: false,
      now: new Date("2026-08-26T12:01:00.000Z"),
    });

    expect(await readFile(second.paths.executablePath)).toEqual(secondBytes);
    expect(await readFile(`${second.paths.executablePath}.previous`)).toEqual(
      firstBytes,
    );
    expect(second.previousVersionBackedUp).toBe(true);
    expect(
      JSON.parse(await readFile(second.paths.manifestPath, "utf8")),
    ).toMatchObject({
      version: "0.1.1",
      installedAt: "2026-08-26T12:01:00.000Z",
    });
    await expect(stat(second.paths.executablePath)).resolves.toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
