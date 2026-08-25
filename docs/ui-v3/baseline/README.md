# UI frame captures

Run `bun run scripts/capture-ui.ts docs/ui-v3/baseline/current` to capture the active source shell at 80, 100, 120, 160, and 200 columns. The capture is a character-frame artifact for geometry and text assertions; it does not replace a real PTY journey.

Use `NO_COLOR=1` (or the PowerShell equivalent) for a no-color capture set.

Deterministic review states are available only when explicitly requested with
`LOCALCODE_UI_FIXTURE=conversation|models|provider-error|settings|diff`. The
normal launch path does not load fixture data; fixture captures are stored under
`docs/ui-v3/final/` and are not production state.
