# LocalCode Core UI — Layout Decision

Date: 2026-08-23. Scope note: `docs/ui-core/BASELINE.md` found the transcript/tool/route
presentation layer already close to spec (7-8/10) — that layer is kept as-is and shared across
all three concepts. This exercise concentrates on the two areas the baseline scored weakest:
**Home's vertical rhythm at tall terminals**, and (described, not rendered — see note at end)
**command-surface depth**. Real renders live in `docs/ui-core/concepts/{A,B,C}/`.

## The three concepts

### A — Editorial Column

Current strategy, refined: brand + status + suggestions as one block, vertically centered as a
group via `justifyContent: center`, regardless of terminal height.

### B — Anchored Workspace

Content anchored to the upper area at every height — never centered in the mathematical middle
of a tall viewport. A quiet readiness/shortcut line is pinned to the bottom of the empty region
via `justifyContent: flex-end`, so the eye has two anchors (top content, bottom hint) instead of
one floating island.

### C — Confident Minimal

Mark + tagline + one status line only. No suggestions on Home at all — discoverable through
Ctrl+P instead. Anchored top, nothing pinned at the bottom.

## Real evidence — 160×50 (the size that broke down in the baseline audit)

**A** — brand block still centered at rows 18-31 of 50 rows; ~17 empty rows above, ~19 below.
Reproduces the exact "small card floating in a black void" problem the baseline audit flagged.

**B** — brand block at rows 4-12; suggestions end at row 12; the `Ctrl+J suggestions · Ctrl+P
commands` hint is pinned at row 45, just above the composer. The empty middle (rows 13-44) is
still empty, but it now reads as _intentional negative space between two anchored things_
rather than _nothing was designed for this size_.

**C** — brand block at rows 4-8, then genuinely nothing until the composer at row 47 — 38 empty
rows with zero content. At 80×24 this restraint reads as calm; at 160×50 it reads as **broken or
unfinished**, not confident. This is the concept's clearest failure mode.

## Real evidence — 80×24 (the size that must never break)

All three fit cleanly with the full transcript/composer/status stack intact — no regression
risk at the small end for any of them. B and C are visually near-identical at this size (B's
extra footer line is the only difference); A and B are also close. The differentiation only
shows up at height ≥ 40.

## Scoring

| Criterion                                     | A      | B      | C      |
| --------------------------------------------- | ------ | ------ | ------ |
| 80×24 usability                               | 8      | 8      | 8      |
| 160×50 balance                                | 3      | 8      | 4      |
| Feels "premium," not sparse                   | 4      | 8      | 5      |
| Feels calm, not busy                          | 7      | 7      | 8      |
| Implementation risk (delta from current code) | lowest | low    | low    |
| **Total /40**                                 | **22** | **31** | **25** |

## Why A loses

It's the status quo, and the baseline audit already found the status quo's wide-terminal
balance to be the single biggest concrete gap in the whole surface. Keeping it means shipping
this task without fixing the one problem it most clearly diagnosed.

## Why C loses

The restraint is appealing in principle and partially validates master-prompt §8's "must not
become a dashboard" instinct, but rendered evidence at 160×50 shows it tips past calm into
looking unfinished — a first-time user opening LocalCode on a large monitor would reasonably
wonder if the screen finished loading. Its copy/suggestion restraint (no suggestions block) is
still worth keeping as a _principle_ — see recommendation below.

## Recommendation: Concept B, with one refinement borrowed from C

Ship B's anchored-top + bottom-pinned-hint structure. Additionally borrow C's discipline on one
point neither A nor B got right: at very tall terminals, don't fill the middle with _more_
suggestion text or decoration just because there's room — the empty middle is fine and should
stay quiet. B already does this (it doesn't add content to fill space, it just repositions what
exists), so no further change is needed beyond confirming this in the implementation contract.

## Implementation contract (binding for Phase E)

- Home content anchors to the top region at every terminal height; it is never
  vertically centered as a block.
- A single quiet line (readiness + keyboard hint) is pinned to the bottom of the empty region
  above the composer at heights where that room exists (roughly ≥ 30 rows); below that, it's
  omitted entirely rather than cramped in.
- The empty space between top content and the bottom hint is intentional negative space — no
  new content is added there to "use" it.
- This treatment applies to Home specifically. The conversation view keeps its existing
  transcript-fills-available-height behavior (already correct per the baseline audit) —
  Concept B only changes the empty/Home state.

## Note on command-surface depth (not rendered this pass)

`REFERENCES.md` identified command-palette depth (flat list vs. Raycast/Linear-style
drill-down) as the other real differentiator, and `BASELINE.md` scored the current palette the
lowest of any surface (3/10: no descriptions, no keybinding hints, plain-text header instead of
a receding-background overlay). Rendering three palette variants was scoped out of this pass to
keep the concept-review checkpoint focused on the one gap with the clearest supporting evidence
(Home). The command palette rebuild is still committed work for Phase E — descriptions,
right-aligned keybindings, and grouped/contextual filtering per §45-46 — it will be built once,
directly, informed by the Raycast/Linear research rather than compared across throwaway
variants first.

## What ships from the throwaway concept harness

Nothing — `scripts/capture-ui-core-concepts.tsx` and `docs/ui-core/concepts/` are comparison
evidence only. Phase E implements Concept B's contract for real inside
`src/tui/views/HomeView.tsx` and `src/tui/app.tsx`, reusing the existing (already-good)
`coreGeometry()`/content-column machinery rather than the simplified stand-ins in the harness.
