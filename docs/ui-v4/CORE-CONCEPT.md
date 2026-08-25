# LocalCode UI V4 core concept

## Decision

Concept B, the compact timeline, is the production direction.

It keeps one centered responsive column, preserves the user turn and agent activity at 80×24, and communicates work as progress instead of a sequence of log records. The composer uses a quiet upper rule rather than a heavy enclosing card. Focus will be made explicit through the cursor, a violet focus rule, and a text-safe focus marker in `NO_COLOR` mode.

## Independent review

Two fresh read-only reviewers evaluated all 18 frames at 80×24, 120×40, and 160×50. Both selected Concept B.

The shared findings were:

- B best communicates active, completed, and pending work.
- B is the only concept that retains the full conversation, four activity steps, composer, and status at 80×24.
- B looks least like raw CLI logs because its activity is expressed as progress rather than uppercase tool records.
- Concept A has the clearest composer boundary, but its loose vertical rhythm displaced the user turn at 80×24.
- Concept C spends attention on uppercase actor labels and a structural rail, and it drops the third Home suggestion at 80 columns.

## Why A lost

The editorial layout was calm at wide sizes, but it used too many blank rows between tool steps. At 80×24 its bottom-sticky transcript began with the assistant turn, hiding the user request. Its fully boxed composer was discoverable but visually heavier than necessary.

## Why C lost

The command-canvas layout made the transcript resemble formatted terminal output. `YOU`, `LOC·CODE`, and uppercase tool rows competed with the content. Its Home suggestions were less obviously interactive and one disappeared at the narrow target.

## Production contract

- Header, viewport, composer, and status form one vertical flex layout.
- Home and Chat use the same `getContentGeometry()` result.
- Transcript and composer have identical `x` and `width` at every supported terminal size.
- One assistant turn owns its prose, activity, tests, route changes, and completion.
- Activity groups are compact, stateful, expandable, and keyboard/mouse operable.
- The composer is a real multiline editor with a visible cursor and a non-color focus affordance.
- Sticky follow pauses when the user scrolls away from the bottom and resumes only at the bottom or through `New activity`.
- Violet is limited to the brand, current focus, selection, and current execution step.
- Normal transcript presentation never contains tool invocation JSON or route scoring diagnostics.

## Required interaction work

The concept frames are design evidence, not acceptance evidence. Production must add editor focus and input, suggestion activation, activity expansion, stable scroll anchoring, `New activity`, mouse targets, resize preservation, cancellation, and overlay focus restoration.
