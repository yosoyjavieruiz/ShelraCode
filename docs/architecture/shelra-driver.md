# Shelra Driver profile boundary

Phase 2 introduces a small, host-owned boundary for exact model/runtime
identity and measured authority. The profile is not a model-card claim and it
is not keyed by a provider/model display name.

## Exact identity

`src/driver/profile.ts` records the material configuration that can change
behavior: provider family, wire model ID, artifact and quantization facts,
runtime/version, endpoint and tool/structured-output templates, tokenizer and
reasoning mode, context and sampling configuration, operating system, and
hardware fingerprint. Runtime facts that are not exposed are stored as
explicit `null` values.

`exactModelIdentityDigest()` canonicalizes object keys and excludes only
`createdAt`, which is observation time rather than configuration. A changed
quantization, runtime, template, context, sampling, or hardware value produces
a different digest.

## Profile lifecycle

Profiles are versioned (`schemaVersion: 1`) and persisted in SQLite's
`model_driver_profiles` table. A newly observed configuration starts as
`uncalibrated`, with C0, unselected protocol/edit codec, and no write or
network authority. Only a certified profile with an exact identity digest can
pass `driverProfileCanWrite()`; expiry, malformed identity, and digest mismatch
fail closed.

When an identity lookup observes a material change for the same provider/model,
stored profiles are persisted as `invalidated` and both authority fields are
set to `none`. The old evidence remains inspectable for audit, but it cannot be
reused for the new configuration. Recalibration is required before promotion.

## Protocol calibration

`src/driver/protocol-calibration.ts` provides a host-owned calibration
boundary for the four supported action representations: native function calls,
constrained JSON, XML system tools, and a minimal text action grammar. The
parser reports parse validity, schema validity, and legal-action validity
separately. `evaluateProtocolProbeCase()` then compares the normalized action
with the expected semantic action, validates action-specific argument shapes,
and records environment, progress, verification, false-success, and loop
signals. Valid JSON with an invalid action shape is therefore parse-valid but
schema-invalid; a legal action with missing or wrongly typed arguments is not
argument-valid.

`calibrateActionProtocols()` measures only protocols for which the probe has an
actual response. A typed `failure` response (for example, a timeout or model
refusal) remains a measured failed attempt; only a protocol with no response at
all is `unsupported`. When comparing multiple protocols, every result is
scored on the intersection of the same probe IDs. A winner is selected only
when at least two protocols have at least one paired probe; one available
representation, or disjoint coverage, is reported as
`insufficient_comparison`, never promoted by assumption. The score is a
deterministic comparison aid, not a certification claim. Results retain every
observed case while also exposing the paired subset and paired score used for
selection; exact paired ties remain unpromoted. Real-model trials must supply
the response and objective verification evidence for the exact Driver identity.

## Edit-codec calibration

`src/driver/edit-codec-calibration.ts` gives the same host-owned treatment to
whole-file, search/replace, unified-diff, and structured-patch representations.
Each response carries the target path and an expected-before digest. Structured
patch payloads repeat that digest and the host requires the nested value to be
a valid SHA-256 that matches the outer value. The host rejects unsafe paths,
missing or malformed digests, malformed payloads, ambiguous search matches,
overlapping structured operations, stale ranges, and no-op edits before any
mutation is considered.

`evaluateEditCodecCase()` separates parse/schema validity, apply success,
semantic content correctness, stale-edit rejection, no-progress behavior, and
payload token cost. `calibrateEditCodecs()` retains every observed result while
using only common paired probes for selection. A single codec, disjoint
coverage, or exact paired tie remains unpromoted. This is a pure calibration
primitive; it does not replace the existing workspace tools or grant write
authority.

## Scope

Protocol and edit-codec comparison are available as pure, reproducible
host-side calibration primitives. They do not invoke providers, execute
actions, select a production profile, or grant runtime writes. Authority
integration remains a later phase gate. Existing `model_capabilities` records
are preserved for compatibility; they are not treated as complete Driver
profiles.
