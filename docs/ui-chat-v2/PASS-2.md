# Chat V2 Visual Review — Pass 2: Information Hierarchy

Date: 2026-08-24.

## Review questions

- Does the eye land on the user request, current activity and final answer?
- Are completed tools quieter than the current action?
- Are route, model and timing details kept out of the conversation unless
  meaningful?
- Are errors and approvals concise without hiding the decision?

## Result

The current frames establish the intended order: `You` and `ShelraCode`
prose first, one active matrix or tool row second, bounded result details
third, and model/route context in the header/status row. Completed mixed tool
groups recede through muted connectors; homogeneous groups use one-line
summaries. Initial local route selection is quiet, while a real route change
gets a compact transition block. The failure fixture shows only the relevant
test name and assertion lines.

The main information-density control is presentation mode: Focus omits route
events and keeps collapsed essentials, Default permits manual expansion, and
Verbose expands technical details. No permanent telemetry sidebar was added.

Evidence: `docs/ui-chat-v2/review/pass-1/` plus the final fixture set;
behavioral coverage is in `tui-v4-events.test.tsx`, `tui-v4-tools.test.tsx`,
`tui-live-tail.test.tsx` and the presentation adapter unit tests.
