---
name: localcode-release-gate
description: Verify that LocalCode changes are actually releasable by running formatting, type checking, tests, TUI smoke tests, security checks, documentation checks and MVP acceptance flows.
---

# Release Gate

Run evidence from the current source: clean install, format, typecheck, unit tests, integration tests, fixture E2E, strict-zero E2E, privacy E2E, TUI smoke, doctor smoke, and the real CLI path. Inspect the final Git diff. Report commands, results, skipped checks, known issues, and whether the release criteria pass. Never accept “should work.”
