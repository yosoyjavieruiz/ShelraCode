# ShelraCode Chat V2 — Design System

Status: current source contract, 2026-08-24.

## Principles

- Conversation is the product. The home state is a quiet starting point, not
  a dashboard.
- The transcript and composer are one reading column. The composer is a
  sibling below the scroll viewport, never content inside it.
- Violet identifies focus, selection and abstract agent activity. Tool kinds
  remain neutral; result state carries the semantic color.
- Every visible activity is derived from a structured presentation event.
- Motion is scarce, cancellable and independently suppressible.

## Tokens

`src/tui/theme/tokens.ts` is the only UI color source.

| Role | Token |
| --- | --- |
| canvas | `#000000` |
| surface | `#050506` |
| elevated | `#08080A` |
| floating | `#0D0D10` |
| selected/active | `#15101D` |
| whisper border | `#141416` |
| default border | `#202024` |
| focus border | `#513177` |
| primary text | `#F5F5F7` |
| secondary text | `#A1A1AA` |
| tertiary text | `#71717A` |
| muted text | `#52525B` |
| violet | `#8B5CF6` |
| strong violet | `#7C3AED` |
| soft violet | `#A78BFA` |
| success | `#4ADE80` |
| warning | `#FBBF24` |
| danger | `#FB7185` |
| info | `#38BDF8` |

## Hierarchy

1. User prompt and final answer.
2. Current abstract agent state or concrete active tool.
3. Completed tool summaries, plans and bounded results.
4. Quiet route/model status and technical details on demand.

User and assistant content use editorial labels (`You`, `ShelraCode`) and
spacing. There are no message bubbles and no permanent sidebar.

## Glyph contract

Common Unicode glyphs are used where the terminal supports them: `◆`, `●`,
`○`, `✓`, `×`, `!`, `↓`, `├`, `└`, `│`. Labels and layout preserve meaning
under `NO_COLOR`; color is never the only state signal.

## Motion contract

Only the matrix orbit and the active tool marker may animate. OpenTUI runs at
30 target FPS; the matrix consumes the existing 120 ms tick (~8.3 fps). A
reduced-motion session renders static agent text and retains all controls.
