# Chat V2 Visual Review — Pass 1: Structure and Motion

Date: 2026-08-24.

## Reviewed

Deterministic source captures in `docs/ui-chat-v2/review/pass-1/` and the
follow-up active-state captures in `review/pass-1b/` and `review/pass-1d/`:
home, thinking, tool stream/group/detail, shell tail, test running/failure,
edit diff, route change, error, approval, plan, completion, palette, context
picker and long conversation at all six required sizes.

## Findings and repairs

- The empty composer had diverged to half-width. The shared geometry invariant
  now applies before and after the first message.
- Active fixtures were reset to `Ready` by the mount initializer. Fixture
  states now retain `Working`, elapsed time and `Esc interrupt`.
- Status could animate while matrix/tool activity was already dominant. The
  status bar now separates lifecycle activity from spinner visibility.
- Repetitive completed tool rows initially expanded into every path. Homogeneous
  completed groups now collapse to one summary; running shell/test groups keep
  their live tails visible.
- The 3×3 matrix was inspected at 80 columns and remains three rows without a
  border or composer overlap.

## Result

The composer did not move in any captured active state, no fixture showed a
matrix plus a second animated status spinner, and the 80-column layout kept
the complete input and interrupt affordance. Remaining evidence boundary:
these are source fixtures; the rebuilt executable still needs PTY acceptance.
