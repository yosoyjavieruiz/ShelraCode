# Chat V2 Visual Review — Pass 3: Product Polish

Date: 2026-08-24.

## Comparison basis

The review used the current official research recorded in `RESEARCH.md`:
Claude Code fullscreen/status behavior, Codex interrupt semantics, OpenCode
OpenTUI tool/picker patterns, Gemini's independent loading/detail controls,
Warp approvals, Zed tool activity and Raycast fuzzy keyboard search.

## ShelraCode-specific decisions

- true-black canvas rather than a dashboard surface;
- restrained violet only for focus, selection and abstract work;
- AgentMatrixPulse as a small 3×3 signature, not a logo or card;
- structured compact tool timelines with specialized renderers;
- local-first route wording without cloud quota noise for local work;
- fixed input geometry and a small `↓ New activity` recovery action.

The result is intentionally not a pixel copy of any reference. The review did
not find raw tool JSON, giant ASCII branding, permanent sidebars, purple-only
state, full shell-log flooding or an unavailable interrupt action in the
fixture path. Artifact and cross-terminal claims remain bounded by the final
release-proof section.
