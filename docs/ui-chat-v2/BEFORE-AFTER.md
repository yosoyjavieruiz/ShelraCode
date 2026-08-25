# Chat V2 — Before / After

The `before/` and `final/` folders contain deterministic text frames, not
marketing screenshots. Each change is tied to an implementation contract.

| Before issue | Current treatment | Reason |
| --- | --- | --- |
| Reading column stayed nearly full width on wide terminals. | Adaptive centered geometry with 116/128/140 cell caps. | Prose remains readable and tools retain room without a sidebar. |
| Empty home used a large ASCII wordmark. | Compact `◆ ShelraCode` mark, short context and suggestions. | Conversation starts quickly and preserves vertical calm. |
| Empty composer used a different horizontal width from active chat. | Composer and transcript/home column use the same geometry. | First submit no longer shifts the input horizontally. |
| Assistant deltas updated presentation for every token. | 32 ms UI event batching with ordered event flush. | Streaming is smoother without changing agent semantics. |
| Abstract work had no structured visual state. | Structured phases feed AgentMatrixPulse. | The UI does not guess activity from prose. |
| Tool rows shared one generic renderer. | Registry with READ/SEARCH/EDIT/RUN/TEST renderers and fallback. | Known activity gets useful summaries and bounded details. |
| Repetitive reads could consume the transcript. | Homogeneous completed groups collapse to counts/duration. | Detail remains available without log flooding. |
| Long shell/test runs exposed no useful output. | Six-line live tail while running, summary after completion. | The user sees progress without a terminal log in chat. |
| User scroll could be followed by new activity without explanation. | Sticky follow pauses and exposes `↓ New activity`. | The viewport respects reading intent. |
