import { expect, test } from "bun:test";
import { describesMutation } from "../../src/agent/mutation-intent.js";

test("detects common English mutation verbs in their inflected forms", () => {
  expect(describesMutation("Fix the failing test")).toBe(true);
  expect(describesMutation("Patch the race condition in the pool")).toBe(true);
  expect(describesMutation("Correct the typo in the docstring")).toBe(true);
  expect(describesMutation("Migrate the database schema")).toBe(true);
  expect(describesMutation("Configure the linter")).toBe(true);
  expect(describesMutation("Write a helper function")).toBe(true);
  expect(describesMutation("Repair the broken build script")).toBe(true);
});

test("detects common Spanish mutation verbs, with or without accents", () => {
  expect(describesMutation("Añade una prueba unitaria")).toBe(true);
  expect(describesMutation("Anade una prueba unitaria")).toBe(true);
  expect(describesMutation("Corrige el error de tipeo")).toBe(true);
  expect(describesMutation("Repara el script roto")).toBe(true);
  expect(describesMutation("Actualiza la dependencia")).toBe(true);
});

test("does not flag a pure question or explanation with no mutation verb", () => {
  expect(describesMutation("Explain how the router selects a model")).toBe(
    false,
  );
  expect(describesMutation("What does this function return?")).toBe(false);
});

test("does not flag common technical nouns derived from a mutation verb", () => {
  // A stem+wildcard match would wrongly catch these; explicit word forms
  // must not.
  expect(describesMutation("Describe the current implementation")).toBe(false);
  expect(describesMutation("Check the linter configuration")).toBe(false);
  expect(describesMutation("Summarize the proposed modification")).toBe(false);
});

test("does not flag a passive description of an existing language/format", () => {
  expect(
    describesMutation("What programming language is this project written in?"),
  ).toBe(false);
  expect(describesMutation("En que lenguaje esta escrito este proyecto?")).toBe(
    false,
  );
});

test("does not flag past-participle descriptions of existing state (the systemic false-positive class)", () => {
  // Every one of these is the passive/descriptive use of a verb that is also
  // in the mutation list in its active form; only the active form (base,
  // -s, -ing) should trigger describesMutation, never the "-ed"/participle
  // form used to describe something that already happened or already is.
  expect(
    describesMutation(
      "How is this dashboard built? Is it built with React or Vue?",
    ),
  ).toBe(false);
  expect(
    describesMutation(
      "Explain why this file is generated automatically and should not be edited by hand",
    ),
  ).toBe(false);
  expect(
    describesMutation(
      "Check whether the eslint-plugin-react package is installed and report its version",
    ),
  ).toBe(false);
  expect(
    describesMutation(
      "Explain how authentication middleware is configured in this project",
    ),
  ).toBe(false);
  expect(
    describesMutation("Summarize what changed between v1 and v2 of the API"),
  ).toBe(false);
  expect(
    describesMutation(
      "Note that the legacy /v1 endpoint was removed in version 3 and should not be referenced",
    ),
  ).toBe(false);
  expect(
    describesMutation("What is the last modified date of this file?"),
  ).toBe(false);
  expect(describesMutation("When was this dependency last updated?")).toBe(
    false,
  );
  expect(describesMutation("What is the date created for this record?")).toBe(
    false,
  );
  expect(
    describesMutation("List the features added in the changelog for version 2"),
  ).toBe(false);
  expect(
    describesMutation("Is this bug already fixed in the latest release?"),
  ).toBe(false);
  expect(
    describesMutation("What is the correct way to configure logging?"),
  ).toBe(
    // "correct" as an adjective is a known, accepted pre-existing ambiguity
    // (this lexicon cannot disambiguate adjective vs. verb usage), but the
    // participle forms must not compound the problem.
    true,
  );
});

test("still detects active-voice requests using the same verbs that have risky passive forms", () => {
  expect(describesMutation("Build the project for production")).toBe(true);
  expect(describesMutation("Generate a changelog entry")).toBe(true);
  expect(describesMutation("Install the missing dependency")).toBe(true);
  expect(describesMutation("Configure the linter to ignore dist/")).toBe(true);
  expect(describesMutation("Change the default timeout to 30s")).toBe(true);
  expect(describesMutation("Remove the deprecated endpoint")).toBe(true);
});
