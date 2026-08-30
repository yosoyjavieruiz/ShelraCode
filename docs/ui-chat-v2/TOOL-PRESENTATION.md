# ShelraCode Chat V2 — Tool Presentation

## Registry

`src/tui/components/tool-renderers.tsx` exports `ToolRendererRegistry` and
`getToolRenderer()`. Known kinds have dedicated renderers for `read`,
`search`, `edit`, `write`, `run` and `test`; malformed or unknown kinds use a
safe generic fallback. Domain payloads are adapted in
`src/tui/presentation/adapter.ts` before rendering.

Normal transcript output never contains raw tool JSON.

## Row contract

Every activity has an explicit state: `pending`, `running`, `success`,
`failed` or `cancelled`.

| State | Presentation |
| --- | --- |
| pending | muted open circle and `queued` |
| running | violet dot, semantic verb and optional live tail |
| success | green check, bounded summary and duration |
| failed | danger cross and bounded relevant details |
| cancelled | amber exclamation and `cancelled` |

Tool kinds stay mostly neutral. State, not tool category, carries semantic
color.

## Grouping and detail

Consecutive calls in one assistant turn form one activity group. Homogeneous
completed groups collapse into a single line such as `✓ READ 3 files · 43ms`
or `✓ SEARCH 7 searches`. Enter or mouse click expands the individual rows.
Mixed groups retain their compact timeline; expanded rows expose tool-specific
details.

- READ: path, line count and duration; expanded content is bounded.
- SEARCH: query, match count and expandable locations.
- GlobFiles: rendered as SEARCH — the glob pattern as target, matched files
  as expandable detail (adapter.ts `activityMetadata`/`resultPresentation`).
- EDIT/WRITE: path, diff statistics and real added/removed lines when the
  event carries old/new text.
- RUN/TEST: command, duration/result and a small live tail while running.
- DelegateSubagent/DelegateSubagents: the delegated objective(s) as target,
  child status, evidence count and a bounded excerpt of the child's findings
  as detail — a delegated investigation is never just a bare "TOOL" row with
  no visibility into what the child did.
- Unknown tools (anything not in `activityMetadata`'s definitions map, e.g. a
  malformed or model-invented name): safe label/target fallback without
  payload serialization.

Long output is never treated as the transcript. Live tails are capped at six
lines, and finished output collapses to its summary. Failed test output is
limited to the useful failure lines.

## Checkpoints

Every `checkpoint.created` event (agent/loop.ts, emitted right before the
first mutating tool call touching a given path) renders as a `checkpoint-notice`
transcript row — "⌁ Checkpoint saved · <path> · restorable with /rollback".
A checkpoint is a safe restore point; it must never be created silently.

## Fixture and test evidence

The registry contract is covered by
`tests/unit/tui-tool-renderer-registry.test.ts`; activity behavior is covered
by `tui-v4-tools.test.tsx`, `tui-live-tail.test.tsx`,
`ui-edit-diff-adapter.test.ts`, `ui-live-tail-adapter.test.ts` and
`tui-v4-presentation.test.ts` (GlobFiles, DelegateSubagent and
checkpoint-notice coverage).
